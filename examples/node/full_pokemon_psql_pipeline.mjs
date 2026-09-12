/**
 * Full pokeAPI -> local FS -> Postgres pipeline.
 * Node port of `examples/full_pokemon_psql_pipeline.py`.
 *
 * The pokemon are exported from pokeAPI, relationalized to the local file
 * system, converted to CSV, and copied into Postgres.
 *
 * Postgres is optional: set PG_HOST (etc.) and `npm install --no-save pg` to
 * actually copy. Without it the exact SQL is printed and the DB step is
 * skipped, so the example always runs.
 *
 * Writes: examples/output/node/full_pokemon_psql_pipeline/<RUN_ID>/...
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/full_pokemon_psql_pipeline.mjs
 */
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
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
  postgresStatements,
  readNdjson,
  readNdjsonIterator,
  round2,
  sortedByLength,
  writeLocalText,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ### CONSTANTS ###
const PG = envConfig('PG', { port: 5432, database: 'postgres', schema: 'public' });
const PG_SCHEMA = process.env.PG_SCHEMA ?? 'public';

const OBJECT_NAME = 'pokemon';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const POKEMON_LIMIT = Number(process.env.POKEMON_LIMIT ?? 30);

const LOCAL_FS_PATH = exampleDir(join('full_pokemon_psql_pipeline', RUN_ID));
const LOCAL_EXPORT_LOCATION = join(LOCAL_FS_PATH, 'export');
const LOCAL_TEMP_LOCATION = join(LOCAL_FS_PATH, 'temp');
const LOCAL_FINAL_LOCATION = join(LOCAL_FS_PATH, 'final');
const EXPORT_PATH = join(LOCAL_EXPORT_LOCATION, `${OBJECT_NAME}.json`);

// ### SETUP ###
const startTime = Date.now();
ensureDir(LOCAL_EXPORT_LOCATION);
ensureDir(LOCAL_TEMP_LOCATION);
ensureDir(LOCAL_FINAL_LOCATION);

// A tiny offline fallback so the example is runnable without network access.
const FALLBACK_POKEMON = [
  {
    id: 1,
    name: 'bulbasaur',
    height: 7,
    weight: 69,
    base_experience: 64,
    types: [{ slot: 1, type: { name: 'grass', url: 'https://pokeapi.co/api/v2/type/12/' } }],
    abilities: [{ ability: { name: 'overgrow' }, is_hidden: false, slot: 1 }],
    moves: [
      { move: { name: 'tackle' }, version_group_details: [{ level_learned_at: 1 }] },
    ],
  },
  {
    id: 4,
    name: 'charmander',
    height: 6,
    weight: 85,
    base_experience: 62,
    types: [{ slot: 1, type: { name: 'fire', url: 'https://pokeapi.co/api/v2/type/10/' } }],
    abilities: [{ ability: { name: 'blaze' }, is_hidden: false, slot: 1 }],
    moves: [{ move: { name: 'scratch' }, version_group_details: [{ level_learned_at: 1 }] }],
  },
  {
    id: 7,
    name: 'squirtle',
    height: 5,
    weight: 90,
    base_experience: 63,
    types: [{ slot: 1, type: { name: 'water', url: 'https://pokeapi.co/api/v2/type/11/' } }],
    abilities: [{ ability: { name: 'torrent' }, is_hidden: false, slot: 1 }],
    moves: [{ move: { name: 'tackle' }, version_group_details: [{ level_learned_at: 1 }] }],
  },
];

// ### EXPORT DATA FROM API ###
// The sprites section is dropped: it would produce column names longer than
// Postgres supports (https://www.postgresql.org/docs/current/limits.html).
console.log('-'.repeat(20));
console.log(`Exporting ${OBJECT_NAME} from pokeAPI into ${EXPORT_PATH}`);

async function fetchPokemon() {
  const listResponse = await fetch(
    'https://pokeapi.co/api/v2/pokemon?limit=100000&offset=0',
  );
  const list = (await listResponse.json()).results.slice(0, POKEMON_LIMIT);
  const records = [];
  for (let index = 0; index < list.length; index += 1) {
    const data = await (await fetch(list[index].url)).json();
    delete data.sprites;
    records.push(data);
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
writeLocalText(
  EXPORT_PATH,
  pokemonRecords.map((record) => `${JSON.stringify(record)}\n`).join(''),
);
const exportCheckpoint = Date.now();

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
