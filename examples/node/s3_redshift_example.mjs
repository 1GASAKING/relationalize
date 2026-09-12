/**
 * S3 -> Redshift example. Node port of `examples/s3_redshift_example.py`.
 *
 * Transforms/moves data from a given location in S3 into a Redshift database.
 *
 * S3 is emulated on the local filesystem (see `wopen`/`setSmartRoot`) so this
 * runs without AWS credentials; every path keeps its `s3://bucket/key` shape.
 * Swap `wopen` for `@aws-sdk/client-s3` to go live.
 *
 * Redshift is optional: set REDSHIFT_HOST (etc.) and `npm install --no-save pg`
 * to run the statements. Without it the exact SQL is printed and skipped.
 *
 * Writes: examples/output/node/s3_redshift_example/s3/...
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/s3_redshift_example.mjs
 */
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Relationalize, Schema } from '../../node/dist/src/index.js';

import {
  connectPg,
  createSchemaCollector,
  ensureDir,
  envConfig,
  exampleDir,
  redshiftCopyStatement,
  round2,
  setSmartRoot,
  smartNdjsonIterator,
  smartResolvePath,
  smartWriteBytes,
  sortedByLength,
  wopen,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ### CONSTANTS ###
const REDSHIFT_HOST = process.env.REDSHIFT_HOST ?? '';
const REDSHIFT_PORT = Number(process.env.REDSHIFT_PORT ?? 5439);
const REDSHIFT_DB = process.env.REDSHIFT_DB ?? 'dev';
const REDSHIFT_SCHEMA = process.env.REDSHIFT_SCHEMA ?? 'public';
const REDSHIFT_IAM_ROLE = process.env.REDSHIFT_IAM_ROLE ?? 'arn:aws:iam::000000000000:role/demo';
const REDSHIFT_REGION = process.env.REDSHIFT_REGION ?? 'us-east-1';
const REDSHIFT = envConfig('REDSHIFT', {
  port: REDSHIFT_PORT,
  database: REDSHIFT_DB,
  schema: REDSHIFT_SCHEMA,
});

const S3_BUCKET = process.env.S3_BUCKET ?? 'demo-bucket';
const S3_FILE_PATH = process.env.S3_FILE_PATH ?? 'users/mock_lms_data.json';
const S3_TEMP_LOCATION = process.env.S3_TEMP_LOCATION ?? null;
const OBJECT_NAME = process.env.OBJECT_NAME ?? 'users';

// ### SETUP ###
const startTime = Date.now();
const BASE_DIR = exampleDir('s3_redshift_example');
setSmartRoot(join(BASE_DIR, 's3'));

const s3TempLocation =
  S3_TEMP_LOCATION === null
    ? `${S3_BUCKET}/${randomUUID().replaceAll('-', '').slice(0, 8)}_temp/`
    : S3_TEMP_LOCATION;
const s3FinalLocation = `${s3TempLocation}final/`;

// Seed the emulated bucket with the bundled export so the example runs.
const seededInput = resolve(here, '..', 'example_data', 'mock_lms_data.json');
const s3InputLocal = smartResolvePath(`s3://${S3_BUCKET}/${S3_FILE_PATH}`);
if (!existsSync(s3InputLocal)) {
  ensureDir(dirname(s3InputLocal));
  copyFileSync(seededInput, s3InputLocal);
}

const schemas = {};

// reducing min_part_size to 5mb (the minimum allowed) reduces memory usage.
function createRelationalizeS3File(identifier) {
  return wopen(`s3://${s3TempLocation}intermediate/${identifier}.json`, 'w');
}

function onObjectWrite(name, object) {
  if (!(name in schemas)) {
    schemas[name] = new Schema();
  }
  schemas[name].readObject(object);
}

// ### RELATIONALIZE ###
console.log('-'.repeat(20));
console.log(
  `Relationalizing ${OBJECT_NAME} from remote file: ${S3_BUCKET}/${S3_FILE_PATH}`,
);
const r = new Relationalize(OBJECT_NAME, createRelationalizeS3File, onObjectWrite);
r.relationalize(smartNdjsonIterator(`s3://${S3_BUCKET}/${S3_FILE_PATH}`));
r.closeIo();
const relationalizeCheckpoint = Date.now();

// ### CONVERT OBJECTS ###
console.log('-'.repeat(20));
console.log(`Converting objects for ${Object.keys(schemas).length} relationalized schemas.`);
const conversionDurations = {};
for (const [schemaName, schema] of Object.entries(schemas)) {
  const conversionStartTime = Date.now();
  console.log(
    `Converting objects for schema ${schemaName}.` +
      `Reading from ${s3TempLocation}intermediate/${schemaName}.json` +
      `Writing to ${s3FinalLocation}${schemaName}.json.gz`,
  );

  const lines = [];
  for (const row of smartNdjsonIterator(
    `s3://${s3TempLocation}intermediate/${schemaName}.json`,
  )) {
    lines.push(`${JSON.stringify(schema.convertObject(row))}\n`);
  }
  smartWriteBytes(
    `s3://${s3FinalLocation}${schemaName}.json.gz`,
    gzipSync(Buffer.from(lines.join(''), 'utf8')),
  );

  conversionDurations[schemaName] = Date.now() - conversionStartTime;
}
const conversionCheckpoint = Date.now();

// ### COPY TO REDSHIFT ###
console.log('-'.repeat(20));
console.log(
  `Copying data from S3 to Redshift using cluster ${REDSHIFT_HOST}` +
    `DB ${REDSHIFT_DB} SCHEMA ${REDSHIFT_SCHEMA} IAM ROLE ${REDSHIFT_IAM_ROLE}`,
);

const uploadDurations = {};
const uploadRowCounts = {};

let client = null;
try {
  client = await connectPg(REDSHIFT);
} catch (error) {
  console.log(`WARN: could not connect to Redshift (${error.message}).`);
  client = null;
}

if (REDSHIFT === null || client === null) {
  console.log(
    'SKIP: Redshift not configured. Set REDSHIFT_HOST/REDSHIFT_PORT/REDSHIFT_DB/' +
      'REDSHIFT_USERNAME/REDSHIFT_PASSWORD and run `npm install --no-save pg` to run the COPY.',
  );
  console.log('The statements that would be executed:');
  for (const [schemaName, schema] of Object.entries(schemas)) {
    console.log(`DROP TABLE IF EXISTS "${REDSHIFT_SCHEMA}"."${schemaName}";`);
    console.log(schema.generateDdl(schemaName, REDSHIFT_SCHEMA));
    console.log(
      redshiftCopyStatement({
        redshiftSchema: REDSHIFT_SCHEMA,
        tableName: schemaName,
        s3FinalLocation,
        iamRole: REDSHIFT_IAM_ROLE,
        region: REDSHIFT_REGION,
      }),
    );
    console.log(`ANALYZE "${REDSHIFT_SCHEMA}"."${schemaName}";`);
    console.log(`SELECT COUNT(1) FROM "${REDSHIFT_SCHEMA}"."${schemaName}";`);
    uploadRowCounts[schemaName] = -1;
  }
} else {
  for (const [schemaName, schema] of Object.entries(schemas)) {
    console.log(`Copying data for schema ${schemaName}.`);
    const uploadStartTime = Date.now();
    const drop = `DROP TABLE IF EXISTS "${REDSHIFT_SCHEMA}"."${schemaName}";`;
    const create = schema.generateDdl(schemaName, REDSHIFT_SCHEMA);
    const copy = redshiftCopyStatement({
      redshiftSchema: REDSHIFT_SCHEMA,
      tableName: schemaName,
      s3FinalLocation,
      iamRole: REDSHIFT_IAM_ROLE,
      region: REDSHIFT_REGION,
    });
    const analyze = `ANALYZE "${REDSHIFT_SCHEMA}"."${schemaName}";`;
    const count = `SELECT COUNT(1) FROM "${REDSHIFT_SCHEMA}"."${schemaName}";`;

    console.log(drop);
    await client.query(drop);
    console.log(create);
    await client.query(create);
    console.log(copy);
    await client.query(copy);
    console.log(analyze);
    await client.query(analyze);
    console.log(count);
    const result = await client.query(count);
    uploadRowCounts[schemaName] = Number(result.rows[0].count);
    uploadDurations[schemaName] = Date.now() - uploadStartTime;
  }
  await client.end();
}
const uploadCheckpoint = Date.now();

console.log('-'.repeat(20));
console.log(
  `Data transformation/transfer complete. Created ${Object.keys(schemas).length} tables in redshift:`,
);
for (const schemaName of Object.keys(schemas)) {
  console.log(`"${REDSHIFT_SCHEMA}"."${schemaName}"`);
}
console.log('-'.repeat(20));

console.log(
  `Relationalize duration: ${round2((relationalizeCheckpoint - startTime) / 1000)} seconds.`,
);
console.log(
  `Conversion duration: ${round2((conversionCheckpoint - relationalizeCheckpoint) / 1000)} seconds.`,
);
console.log(
  `Redshift copy duration: ${round2((uploadCheckpoint - conversionCheckpoint) / 1000)} seconds.`,
);
console.log(`Total duration: ${round2((uploadCheckpoint - startTime) / 1000)} seconds.`);
console.log('-'.repeat(20));
console.log('Object Details:');
for (const schemaName of sortedByLength(Object.keys(schemas))) {
  console.log(
    `${schemaName}. Column Count: ${Object.keys(schemas[schemaName].schema).length} ` +
      `Row Count: ${uploadRowCounts[schemaName]} ` +
      `Conversion Duration: ${round2((conversionDurations[schemaName] ?? 0) / 1000)} seconds. ` +
      `Upload Duration: ${round2((uploadDurations[schemaName] ?? 0) / 1000)}`,
  );
}
