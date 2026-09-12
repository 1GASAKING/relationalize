/**
 * Full pokeAPI -> S3 -> Redshift pipeline.
 * Node port of `examples/full_pokemon_s3_redshift_pipeline.py`.
 *
 * S3 is emulated on the local filesystem (see `wopen`/`setSmartRoot`) so this
 * runs without AWS credentials; every path keeps its `s3://bucket/key` shape.
 *
 * Redshift is optional: set REDSHIFT_HOST (etc.) and `npm install --no-save pg`
 * to run the statements. Without it the exact SQL is printed and skipped.
 *
 * Writes: examples/output/node/full_pokemon_s3_redshift_pipeline/s3/...
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/full_pokemon_s3_redshift_pipeline.mjs
 */
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Relationalize, Schema } from '../../node/dist/src/index.js';

import {
  connectPg,
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

// If you don't change the export path/temp location, this creates:
//   <bucket>/pokemon/XXXX_YYYYMMDD/
//   <bucket>/pokemon/XXXX_YYYYMMDD/temp/*
const S3_BUCKET = process.env.S3_BUCKET ?? 'demo-bucket';
const RUN_STAMP = `${randomUUID().replaceAll('-', '').slice(0, 8)}_${new Date()
  .toISOString()
  .slice(0, 10)
  .replaceAll('-', '')}`;
const S3_EXPORT_PATH = process.env.S3_EXPORT_PATH ?? `pokemon/${RUN_STAMP}/`;
const S3_TEMP_LOCATION =
  process.env.S3_TEMP_LOCATION ?? `${S3_BUCKET}/${S3_EXPORT_PATH}temp/`;

const OBJECT_NAME = 'pokemon';
const POKEMON_LIMIT = Number(process.env.POKEMON_LIMIT ?? 30);

// ### SETUP ###
const startTime = Date.now();
const BASE_DIR = exampleDir('full_pokemon_s3_redshift_pipeline');
setSmartRoot(join(BASE_DIR, 's3'));

const s3FinalLocation = `${S3_TEMP_LOCATION}final/`;
const s3ExportFilePath = `${S3_EXPORT_PATH}${OBJECT_NAME}.json`;

const schemas = {};

function onObjectWrite(name, object) {
  if (!(name in schemas)) {
    schemas[name] = new Schema();
  }
  schemas[name].readObject(object);
}

// reducing min_part_size to 5mb (the minimum allowed) reduces memory usage.
function createRelationalizeS3File(identifier) {
  return wopen(`s3://${S3_TEMP_LOCATION}intermediate/${identifier}.json`, 'w');
}

// A tiny offline fallback so the example is runnable without network access.
const FALLBACK_POKEMON = [
  { id: 1, name: 'bulbasaur', height: 7, weight: 69, base_experience: 64,
    types: [{ slot: 1, type: { name: 'grass' } }],
    abilities: [{ ability: { name: 'overgrow' }, is_hidden: false, slot: 1 }] },
  { id: 4, name: 'charmander', height: 6, weight: 85, base_experience: 62,
    types: [{ slot: 1, type: { name: 'fire' } }],
    abilities: [{ ability: { name: 'blaze' }, is_hidden: false, slot: 1 }] },
  { id: 7, name: 'squirtle', height: 5, weight: 90, base_experience: 63,
    types: [{ slot: 1, type: { name: 'water' } }],
    abilities: [{ ability: { name: 'torrent' }, is_hidden: false, slot: 1 }] },
];

// ### EXPORT DATA FROM API ###
console.log('-'.repeat(20));
console.log(
  `Exporting ${OBJECT_NAME} from pokeAPI into S3 ${S3_BUCKET}/${s3ExportFilePath}`,
);

async function fetchPokemon() {
  const listResponse = await fetch(
    'https://pokeapi.co/api/v2/pokemon?limit=100000&offset=0',
  );
  const list = (await listResponse.json()).results.slice(0, POKEMON_LIMIT);
  const records = [];
  for (let index = 0; index < list.length; index += 1) {
    records.push(await (await fetch(list[index].url)).json());
    if ((index + 1) % 100 === 0) {
      console.log(`Exported ${index + 1} / ${list.length} pokemon...`);
    }
  }
  return records;
}

let pokemonRecords;
try {
  pokemonRecords = await fetchPokemon();
} catch (error) {
  console.log(
    `WARN: pokeAPI unavailable (${error.message}); using ${FALLBACK_POKEMON.length} bundled records.`,
  );
  pokemonRecords = FALLBACK_POKEMON;
}

{
  const exportFile = wopen(`s3://${S3_BUCKET}/${s3ExportFilePath}`, 'w');
  for (const record of pokemonRecords) {
    exportFile.write(`${JSON.stringify(record)}\n`);
  }
  exportFile.close();
}
const exportCheckpoint = Date.now();

// ### RELATIONALIZE ###
console.log('-'.repeat(20));
console.log(`Relationalizing ${OBJECT_NAME} from S3://${S3_BUCKET}/${s3ExportFilePath}`);
const r = new Relationalize(OBJECT_NAME, createRelationalizeS3File, onObjectWrite);
r.relationalize(smartNdjsonIterator(`s3://${S3_BUCKET}/${s3ExportFilePath}`));
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
      `Reading from ${S3_TEMP_LOCATION}intermediate/${schemaName}.json` +
      `Writing to ${s3FinalLocation}${schemaName}.json.gz`,
  );

  const lines = [];
  for (const row of smartNdjsonIterator(
    `s3://${S3_TEMP_LOCATION}intermediate/${schemaName}.json`,
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
  `Copying data from S3 to Redshift using cluster ${REDSHIFT_HOST} ` +
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

console.log(`Export duration: ${round2((exportCheckpoint - startTime) / 1000)} seconds.`);
console.log(
  `Relationalize duration: ${round2((relationalizeCheckpoint - exportCheckpoint) / 1000)} seconds.`,
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
