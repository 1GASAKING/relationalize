/**
 * Local file system example (Node port of `examples/local_fs_example.py`).
 *
 * Utilizes the local file system as a temporary storage location.
 *
 * Writes:
 *   examples/output/node/local_fs_example/temp/<table>.json
 *   examples/output/node/local_fs_example/final/<table>.json
 *   examples/output/node/local_fs_example/final/DDL_<table>.sql
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/local_fs_example.mjs
 */
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Relationalize, Schema, createLocalFile } from '../../node/dist/src/index.js';

import {
  ensureDir,
  exampleDir,
  readNdjson,
  readNdjsonIterator,
  toNdjson,
  writeLocalText,
} from './lib/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const BASE_DIR = exampleDir('local_fs_example');
const TEMP_OUTPUT_DIR = join(BASE_DIR, 'temp');
const FINAL_OUTPUT_DIR = join(BASE_DIR, 'final');
const INPUT_DIR = resolve(here, '..', 'example_data');

const INPUT_FILENAME = 'mock_lms_data.json';
const OBJECT_NAME = 'users';

// 0. Set up file system
ensureDir(TEMP_OUTPUT_DIR);
ensureDir(FINAL_OUTPUT_DIR);

const EXPORT_PATH = join(INPUT_DIR, INPUT_FILENAME);

// 1. Relationalize raw data (streaming straight to the temp files)
const r = new Relationalize(OBJECT_NAME, createLocalFile(TEMP_OUTPUT_DIR));
r.relationalize(readNdjsonIterator(EXPORT_PATH));
r.closeIo();

// 2. Generate schemas for each transformed/flattened file
const schemas = {};
for (const filename of readdirSync(TEMP_OUTPUT_DIR)) {
  const objectName = filename.replace(/\.json$/, '');
  schemas[objectName] = new Schema();
  for (const obj of readNdjsonIterator(join(TEMP_OUTPUT_DIR, filename))) {
    schemas[objectName].readObject(obj);
  }
}

// 3. Convert transformed/flattened data to prep for the database.
//    Generate SQL DDL.
for (const filename of readdirSync(TEMP_OUTPUT_DIR)) {
  const objectName = filename.replace(/\.json$/, '');
  const rows = readNdjson(join(TEMP_OUTPUT_DIR, filename)).map((obj) =>
    schemas[objectName].convertObject(obj),
  );
  writeLocalText(join(FINAL_OUTPUT_DIR, filename), toNdjson(rows));
  writeLocalText(
    join(FINAL_OUTPUT_DIR, `DDL_${objectName}.sql`),
    schemas[objectName].generateDdl(objectName, 'public'),
  );
}

console.log('-'.repeat(20));
console.log(`Wrote ${Object.keys(schemas).length} tables to ${FINAL_OUTPUT_DIR}`);
for (const objectName of Object.keys(schemas).sort()) {
  console.log(`  - ${objectName}.json + DDL_${objectName}.sql`);
}
