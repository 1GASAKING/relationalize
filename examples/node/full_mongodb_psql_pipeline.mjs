/**
 * Full MongoDB -> local FS -> Postgres pipeline.
 * Node port of `examples/full_mongodb_psql_pipeline.py`.
 *
 * MongoDB is optional. Set MONGO_URI + MONGO_DB (+ MONGO_COLLECTION) and
 * `npm install --no-save mongodb` to export for real; otherwise the example
 * falls back to the bundled `example_data/mock_lms_data.json` export so the
 * rest of the pipeline runs.
 *
 * Postgres is optional in the same way (PG_HOST ... + `npm install --no-save pg`).
 *
 * Writes: examples/output/node/full_mongodb_psql_pipeline/<RUN_ID>/...
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/full_mongodb_psql_pipeline.mjs
 */
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Relationalize, createLocalFile } from '../../node/dist/src/index.js';

import {
  DictWriter,
  connectPg,
  copyTableToPostgres,
  createSchemaCollector,
  ensureDir,
  envConfig,
  exampleDir,
  mongoConfigFromEnv,
  postgresStatements,
  readNdjson,
  readNdjsonIterator,
  round2,
  sortedByLength,
  tryImport,
  writeLocalText,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ### CONSTANTS ###
const PG = envConfig('PG', { port: 5432, database: 'postgres', schema: 'public' });
const PG_SCHEMA = process.env.PG_SCHEMA ?? 'public';
const MONGO = mongoConfigFromEnv();

const OBJECT_NAME = MONGO?.collection ?? 'users';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);

const LOCAL_FS_PATH = exampleDir(join('full_mongodb_psql_pipeline', RUN_ID));
const LOCAL_EXPORT_LOCATION = join(LOCAL_FS_PATH, 'export');
const LOCAL_TEMP_LOCATION = join(LOCAL_FS_PATH, 'temp');
const LOCAL_FINAL_LOCATION = join(LOCAL_FS_PATH, 'final');
const EXPORT_PATH = join(LOCAL_EXPORT_LOCATION, `${OBJECT_NAME}.json`);

const FALLBACK_EXPORT = resolve(here, '..', 'example_data', 'mock_lms_data.json');

// ### SETUP ###
const startTime = Date.now();
ensureDir(LOCAL_EXPORT_LOCATION);
ensureDir(LOCAL_TEMP_LOCATION);
ensureDir(LOCAL_FINAL_LOCATION);

// ### EXPORT DATA FROM MongoDB ###
console.log('-'.repeat(20));
console.log(`Exporting ${OBJECT_NAME} from MongoDB into ${EXPORT_PATH}`);

async function exportFromMongo() {
  if (MONGO === null) return null;
  const mongodb = await tryImport('mongodb');
  if (mongodb === null) return null;
  const client = new mongodb.MongoClient(MONGO.uri);
  await client.connect();
  try {
    return await client
      .db(MONGO.db)
      .collection(MONGO.collection)
      .find()
      .toArray();
  } finally {
    await client.close();
  }
}

let documents = null;
try {
  documents = await exportFromMongo();
} catch (error) {
  console.log(`WARN: MongoDB export failed (${error.message}).`);
}

if (documents === null) {
  console.log(
    'SKIP: MongoDB not configured (set MONGO_URI/MONGO_DB and run ' +
      '`npm install --no-save mongodb`) - using bundled example export.',
  );
  writeLocalText(EXPORT_PATH, readNdjsonFallbackText());
} else {
  writeLocalText(
    EXPORT_PATH,
    documents.map((doc) => `${JSON.stringify(doc)}\n`).join(''),
  );
}
const exportCheckpoint = Date.now();

function readNdjsonFallbackText() {
  const rows = [...readNdjsonIterator(FALLBACK_EXPORT)];
  return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
}

// ### RELATIONALIZE ###
console.log('-'.repeat(20));
console.log(`Relationalizing ${OBJECT_NAME} from local file: ${EXPORT_PATH}`);
const { schemas, onObjectWrite } = createSchemaCollector();
const r = new Relationalize(OBJECT_NAME, createLocalFile(LOCAL_TEMP_LOCATION), onObjectWrite);
r.relationalize(readNdjsonIterator(EXPORT_PATH));
r.closeIo();
const relationalizeCheckpoint = Date.now();

// ### CONVERT OBJECTS ###
console.log('-'.repeat(20));
console.log(`Converting objects for ${Object.keys(schemas).length} relationalized schemas.`);
const conversionDurations = {};
const tableRows = {};
for (const [schemaName, schema] of Object.entries(schemas)) {
  const conversionStartTime = Date.now();
  console.log(
    `Converting objects for schema ${schemaName}. ` +
      `Reading from ${LOCAL_TEMP_LOCATION}/${schemaName}.json ` +
      `Writing to ${LOCAL_FINAL_LOCATION}/${schemaName}.csv`,
  );
  const rows = readNdjson(join(LOCAL_TEMP_LOCATION, `${schemaName}.json`));
  const writer = new DictWriter(schema.generateOutputColumns());
  writeLocalText(
    join(LOCAL_FINAL_LOCATION, `${schemaName}.csv`),
    writer.write(rows.map((row) => schema.convertObject(row))),
  );
  tableRows[schemaName] = rows;
  conversionDurations[schemaName] = Date.now() - conversionStartTime;
}
const conversionCheckpoint = Date.now();

// ### COPY TO POSTGRES ###
console.log('-'.repeat(20));
const uploadDurations = {};
const uploadRowCounts = {};

let client = null;
try {
  client = await connectPg(PG);
} catch (error) {
  console.log(`WARN: could not connect to Postgres (${error.message}).`);
  client = null;
}

if (PG === null || client === null) {
  console.log(
    'SKIP: Postgres not configured. Set PG_HOST/PG_PORT/PG_DB/PG_USERNAME/PG_PASSWORD ' +
      'and run `npm install --no-save pg` to perform the copy.',
  );
  console.log('The statements that would be executed:');
  for (const [schemaName, schema] of Object.entries(schemas)) {
    const statements = postgresStatements(
      PG_SCHEMA,
      schemaName,
      schema.generateDdl(schemaName, PG_SCHEMA),
    );
    console.log(statements.drop);
    console.log(statements.create);
    console.log(statements.copy);
    console.log(statements.analyze);
    console.log(statements.count);
    uploadRowCounts[schemaName] = -1;
  }
} else {
  console.log(
    `Copying data to Postgres using ${PG.host} DB ${PG.database} SCHEMA ${PG_SCHEMA}`,
  );
  for (const [schemaName, schema] of Object.entries(schemas)) {
    console.log(`Copying data for schema ${schemaName}.`);
    const uploadStartTime = Date.now();
    const { statements, rowCount } = await copyTableToPostgres(
      client,
      PG_SCHEMA,
      schemaName,
      schema,
      tableRows[schemaName],
    );
    console.log(statements.drop);
    console.log(statements.create);
    console.log(statements.copy);
    console.log(statements.analyze);
    console.log(statements.count);
    uploadRowCounts[schemaName] = rowCount;
    uploadDurations[schemaName] = Date.now() - uploadStartTime;
  }
  await client.end();
}
const uploadCheckpoint = Date.now();

console.log('-'.repeat(20));
console.log(
  `Data transformation/transfer complete. Created ${Object.keys(schemas).length} tables in Postgres:`,
);
for (const schemaName of Object.keys(schemas)) {
  console.log(`"${PG_SCHEMA}"."${schemaName}"`);
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
  `Postgres copy duration: ${round2((uploadCheckpoint - conversionCheckpoint) / 1000)} seconds.`,
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
