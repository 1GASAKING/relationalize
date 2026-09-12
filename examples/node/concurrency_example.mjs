/**
 * Concurrency example (Node port of `examples/concurrency_example.py`).
 *
 * Shows how concurrency in the "relationalize" and "convert_object" steps can
 * be added. This doesn't actually add any concurrency, but shows what it could
 * look like given a method of running concurrent workflows (e.g. Airflow).
 *
 *   [r] [r] [r] [r]...  ->  [merge]  ->  [c] [c] [c] [c]...  ->  [ddl]
 *
 * Writes: examples/output/node/concurrency_example/{temp,final}/...
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/concurrency_example.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Relationalize, Schema } from '../../node/dist/src/index.js';

import {
  ensureDir,
  exampleDir,
  openLocalFile,
  readNdjsonIterator,
  round2,
  writeLocalText,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const BASE_DIR = exampleDir('concurrency_example');
const TEMP_OUTPUT_DIR = join(BASE_DIR, 'temp');
const FINAL_OUTPUT_DIR = join(BASE_DIR, 'final');
const INPUT_DIR = resolve(here, '..', 'example_data', 'sharded_mock_lms');
const OBJECT_NAME = 'users';

// 0. Set up file system
const startTime = Date.now();
ensureDir(TEMP_OUTPUT_DIR);
ensureDir(FINAL_OUTPUT_DIR);

// 1. Define the relationalize/Schema read task
function relationalizeTask(file) {
  const schemas = {};

  const onObjectWrite = (name, object) => {
    if (!(name in schemas)) {
      schemas[name] = new Schema();
    }
    schemas[name].readObject(object);
  };

  const createLocalShardedFile = (identifier) => {
    const dir = join(TEMP_OUTPUT_DIR, identifier, 'files');
    ensureDir(dir);
    return openLocalFile(join(dir, file));
  };

  const r = new Relationalize(OBJECT_NAME, createLocalShardedFile, onObjectWrite);
  r.relationalize(readNdjsonIterator(join(INPUT_DIR, file)));
  r.closeIo();

  for (const schema of Object.keys(schemas)) {
    const dir = join(TEMP_OUTPUT_DIR, schema, 'schemas');
    ensureDir(dir);
    writeLocalText(join(dir, file), schemas[schema].serialize());
  }

  console.log(
    `Done relationalizing ${file} | Generated ${Object.keys(schemas).length} schemas.`,
  );
}

const relationalizeTasks = readdirSync(INPUT_DIR);

// PRETEND THAT THIS IS HAPPENING CONCURRENTLY
for (const file of relationalizeTasks) {
  relationalizeTask(file);
}

// 2. Merge Schemas
const schemas = {};
for (const entry of readdirSync(TEMP_OUTPUT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const schema = entry.name;
  const schemaDir = join(TEMP_OUTPUT_DIR, schema, 'schemas');
  const shardedSchemas = readdirSync(schemaDir).map((file) =>
    JSON.parse(readFileSync(join(schemaDir, file), 'utf8')),
  );
  schemas[schema] = Schema.merge(...shardedSchemas);
}

console.log(
  `Done merging schemas. Found ${Object.keys(schemas).length} schemas accross all shards.`,
);

// 3. Convert Objects
function convertTask(file, schemaName, schema) {
  const dir = join(FINAL_OUTPUT_DIR, 'json', schemaName);
  ensureDir(dir);

  const lines = [];
  for (const object of readNdjsonIterator(
    join(TEMP_OUTPUT_DIR, schemaName, 'files', file),
  )) {
    lines.push(`${JSON.stringify(schema.convertObject(object))}\n`);
  }
  writeLocalText(join(dir, file), lines.join(''));
  console.log(`Converted ${file} for schema ${schemaName}.`);
}

const convertTasks = [];
for (const schema of Object.keys(schemas)) {
  for (const file of readdirSync(
    join(TEMP_OUTPUT_DIR, schema, 'files'),
  )) {
    convertTasks.push([file, schema, schemas[schema]]);
  }
}

// PRETEND THAT THIS IS HAPPENING CONCURRENTLY
for (const [file, schemaName, schema] of convertTasks) {
  convertTask(file, schemaName, schema);
}

// 4. Write DDL Statements
const sqlDir = join(FINAL_OUTPUT_DIR, 'sql');
ensureDir(sqlDir);
for (const schema of Object.keys(schemas)) {
  writeLocalText(
    join(sqlDir, `DDL_${schema}.sql`),
    schemas[schema].generateDdl(schema, 'public'),
  );
}

console.log(`Wrote ${Object.keys(schemas).length} DDL files.`);
console.log(
  `Complete. Total Duration: ${round2((Date.now() - startTime) / 1000)} seconds.`,
);
