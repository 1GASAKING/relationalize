/**
 * In-memory buffer example (Node port of `examples/memory_example.py`).
 *
 * Utilizes an in-memory buffer to store the relationalized data.
 * OPTIMIZATION: schemas are generated as objects are relationalized.
 *
 * Writes: examples/output/node/memory_example/final/{<table>.json, DDL_<table>.sql}
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/memory_example.mjs
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Relationalize,
  createLocalBuffer,
} from '../../node/dist/src/index.js';

import {
  createSchemaCollector,
  ensureDir,
  exampleDir,
  readNdjsonIterator,
  toNdjson,
  writeLocalText,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const INPUT_DIR = resolve(here, '..', 'example_data');
const INPUT_FILENAME = 'mock_lms_data.json';
const OBJECT_NAME = 'users';

const FINAL_OUTPUT_DIR = join(exampleDir('memory_example'), 'final');
ensureDir(FINAL_OUTPUT_DIR);

const EXPORT_PATH = join(INPUT_DIR, INPUT_FILENAME);

// 0. Setup schemas and define the on_object_write function.
const { schemas, onObjectWrite } = createSchemaCollector();

// 1. Relationalize raw data
const r = new Relationalize(OBJECT_NAME, createLocalBuffer(), onObjectWrite);

console.log('-'.repeat(20));
console.log(`Relationalizing ${OBJECT_NAME} from ${EXPORT_PATH}`);
r.relationalize(readNdjsonIterator(EXPORT_PATH));

// 2. Convert transformed/flattened data to prep for the database and generate
//    SQL DDL. Buffers must be drained BEFORE closeIo().
for (const schemaName of Object.keys(schemas)) {
  const buffer = r.outputs[schemaName];
  buffer.seek(0);
  const rows = buffer
    .readlines()
    .map((line) => JSON.parse(line));
  const converted = rows.map((row) => schemas[schemaName].convertObject(row));

  writeLocalText(join(FINAL_OUTPUT_DIR, `${schemaName}.json`), toNdjson(converted));
  writeLocalText(
    join(FINAL_OUTPUT_DIR, `DDL_${schemaName}.sql`),
    schemas[schemaName].generateDdl(schemaName, 'public'),
  );
}
r.closeIo();

console.log('-'.repeat(20));
console.log(`Wrote ${Object.keys(schemas).length} tables to ${FINAL_OUTPUT_DIR}`);
for (const schemaName of Object.keys(schemas).sort()) {
  console.log(`  - ${schemaName}.json + DDL_${schemaName}.sql`);
}
