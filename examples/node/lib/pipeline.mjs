/**
 * Shared helpers for the Node examples.
 *
 * Mirrors the small utilities the Python examples use inline:
 *   - NDJSON iterators / writers
 *   - a `csv.DictWriter` equivalent
 *   - the `on_object_write` schema collector
 *   - a `smart_open`-like `wopen` (S3 paths are emulated on the local FS so
 *     the S3 examples run without AWS credentials)
 *   - optional Postgres/Redshift/Mongo connectivity (only used when the
 *     matching client package is installed AND the environment is configured)
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema, createLocalFile } from '../../../node/dist/src/index.js';

export { Schema, createLocalFile };

const libDir = dirname(fileURLToPath(import.meta.url));

/** Root for every example's working/output files (gitignored, like `output/`). */
export const NODE_OUTPUT_ROOT = resolve(libDir, '..', '..', 'output', 'node');

/** Create (if needed) and return `<examples>/output/node/<name>`. */
export function exampleDir(name) {
  const dir = resolve(NODE_OUTPUT_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Python's `round(x, 2)`. */
export function round2(value) {
  return Math.round(value * 100) / 100;
}

// --------------------------------------------------------------------------- #
// NDJSON
// --------------------------------------------------------------------------- #

export function* readNdjsonIterator(path) {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    yield JSON.parse(line);
  }
}

export function readNdjson(path) {
  return [...readNdjsonIterator(path)];
}

/** Serialize rows to newline-delimited JSON (like the Python examples). */
export function toNdjson(rows, serialize = (row) => JSON.stringify(row)) {
  return rows.map((row) => `${serialize(row)}\n`).join('');
}

// --------------------------------------------------------------------------- #
// CSV (a small csv.DictWriter equivalent)
// --------------------------------------------------------------------------- #

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Writes only the declared `fieldnames` (columns), ignoring extra keys.
 * Values are serialized positionally, like Python's `csv.DictWriter`.
 */
export class DictWriter {
  constructor(fieldnames) {
    this.fieldnames = fieldnames;
    this.header = `${fieldnames.map(csvEscape).join(',')}\n`;
  }

  row(obj) {
    return `${this.fieldnames.map((name) => csvEscape(obj[name])).join(',')}\n`;
  }

  write(rows) {
    return this.header + rows.map((obj) => this.row(obj)).join('');
  }
}

// --------------------------------------------------------------------------- #
// Schema collection / DDL
// --------------------------------------------------------------------------- #

/** The `on_object_write` collector used by every example. */
export function createSchemaCollector() {
  const schemas = {};
  const onObjectWrite = (name, obj) => {
    if (!(name in schemas)) {
      schemas[name] = new Schema();
    }
    schemas[name].readObject(obj);
  };
  return { schemas, onObjectWrite };
}

/** Return a copy of the schema with null-only columns removed. */
export function cleanSchemaFor(schema) {
  const clean = new Schema(structuredClone(schema.schema));
  clean.dropNullColumns();
  return clean;
}

export function sortedByLength(names) {
  return [...names].sort((a, b) => a.length - b.length);
}

// --------------------------------------------------------------------------- #
// smart_open emulation
//
// The Python S3 examples use `smart_open.open("s3://bucket/key", ...)`.
// `pg`/`mongodb`/AWS access are optional here, so `wopen` emulates S3 on the
// local filesystem (rooted at `setSmartRoot`). Paths keep their exact
// `s3://bucket/key` shape, so the example code reads identically; swap `wopen`
// for `@aws-sdk/client-s3` to go live.
// --------------------------------------------------------------------------- #

let smartRoot = null;

/** Point `s3://...` paths at a local directory. */
export function setSmartRoot(dir) {
  smartRoot = ensureDir(dir);
  return smartRoot;
}

function mapSmartPath(path) {
  if (path.startsWith('s3://')) {
    if (smartRoot === null) {
      throw new Error('smart_open root not set; call setSmartRoot(dir) first');
    }
    return join(smartRoot, path.slice('s3://'.length));
  }
  return path;
}

/** A `smart_open`-compatible file object (buffers, flushes on `close`). */
export class SmartFile {
  constructor(path, mode = 'w') {
    this.path = path;
    this.mode = mode;
    this.chunks = mode.includes('w') ? [] : null;
  }

  write(chunk) {
    this.chunks.push(chunk);
  }

  close() {
    if (this.chunks !== null) {
      ensureDir(dirname(this.path));
      writeFileSync(this.path, this.chunks.join(''), 'utf8');
    }
  }
}

/**
 * `smart_open.open(path, mode)` equivalent. Returns a `SmartFile` for writing
 * (usable as a `Relationalize` `create_output` result), or reads text for `r`.
 */
export function wopen(path, mode = 'w') {
  const localPath = mapSmartPath(path);
  if (mode.includes('w')) {
    ensureDir(dirname(localPath));
  }
  return new SmartFile(localPath, mode);
}

export function smartReadText(path) {
  return readFileSync(mapSmartPath(path), 'utf8');
}

/** Write raw bytes (e.g. gzip) to a `s3://` (emulated) path. */
export function smartWriteBytes(path, buffer) {
  const localPath = mapSmartPath(path);
  ensureDir(dirname(localPath));
  writeFileSync(localPath, buffer);
}

/** Resolve an `s3://` (emulated) path to a local filesystem path. */
export function smartResolvePath(path) {
  return mapSmartPath(path);
}

export function* smartNdjsonIterator(path) {
  for (const line of smartReadText(path).split('\n')) {
    if (line.trim() === '') continue;
    yield JSON.parse(line);
  }
}

// --------------------------------------------------------------------------- #
// Local file IO (used when paths are not remote)
// --------------------------------------------------------------------------- #

export function writeLocalText(path, text) {
  ensureDir(dirname(path));
  writeFileSync(path, text, 'utf8');
}

/** A writable local file handle (mirrors the package's FileBuffer). */
export function openLocalFile(path) {
  ensureDir(dirname(path));
  const fd = openSync(path, 'w');
  return {
    write(chunk) {
      writeSync(fd, chunk);
    },
    close() {
      closeSync(fd);
    },
  };
}

// --------------------------------------------------------------------------- #
// Optional external services
// --------------------------------------------------------------------------- #

/** Try to dynamically import an optional client package. */
export async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

/**
 * Read connection config from environment variables using a prefix, e.g.
 * `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USERNAME`, `PG_PASSWORD`, `PG_SCHEMA`.
 * Returns `null` when the host is not set (the example skips the remote step).
 */
export function envConfig(prefix, defaults = {}) {
  const host = process.env[`${prefix}_HOST`];
  if (!host) return null;
  return {
    host,
    port: Number(process.env[`${prefix}_PORT`] ?? defaults.port ?? 5432),
    database: process.env[`${prefix}_DB`] ?? defaults.database ?? 'postgres',
    user: process.env[`${prefix}_USERNAME`] ?? '',
    password: process.env[`${prefix}_PASSWORD`] ?? '',
    schema: process.env[`${prefix}_SCHEMA`] ?? defaults.schema ?? 'public',
  };
}

export function mongoConfigFromEnv() {
  const uri = process.env.MONGO_URI;
  const db = process.env.MONGO_DB;
  if (!uri || !db) return null;
  return {
    uri,
    db,
    collection: process.env.MONGO_COLLECTION ?? 'users',
  };
}

/** Connect to Postgres/Redshift via the optional `pg` package. */
export async function connectPg(config) {
  if (config === null) return null;
  const pg = await tryImport('pg');
  if (pg === null) return null;
  const Client = (pg.default ?? pg).Client;
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });
  await client.connect();
  return client;
}

/** The exact SQL the examples run against Postgres. */
export function postgresStatements(pgSchema, tableName, ddl) {
  return {
    drop: `DROP TABLE IF EXISTS "${pgSchema}"."${tableName}";`,
    create: ddl,
    copy: `COPY ${pgSchema}.${tableName} from STDIN DELIMITER ',' CSV HEADER;`,
    analyze: `ANALYZE "${pgSchema}"."${tableName}";`,
    count: `SELECT COUNT(1) FROM "${pgSchema}"."${tableName}";`,
  };
}

/** The exact COPY statement the Redshift examples run. */
export function redshiftCopyStatement({
  redshiftSchema,
  tableName,
  s3FinalLocation,
  iamRole,
  region,
}) {
  return [
    `COPY "${redshiftSchema}"."${tableName}"`,
    `FROM 's3://${s3FinalLocation}${tableName}.json.gz'`,
    `iam_role '${iamRole}'`,
    `region '${region}'`,
    "FORMAT AS json 'auto ignorecase'",
    'TRUNCATECOLUMNS',
    'GZIP;',
  ].join('\n');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/** Build parameterless INSERT statements from converted rows. */
export function buildInserts(pgSchema, tableName, fieldnames, rows) {
  const columns = fieldnames.map((c) => `"${c}"`).join(', ');
  return rows.map(
    (row) =>
      `INSERT INTO "${pgSchema}"."${tableName}" (${columns}) VALUES (${fieldnames
        .map((f) => sqlLiteral(row[f]))
        .join(', ')});`,
  );
}

/**
 * Run the standard drop/create/insert/analyze/count cycle for one table.
 * Returns the statements that ran plus the row count the database reports.
 */
export async function copyTableToPostgres(
  client,
  pgSchema,
  tableName,
  schema,
  rows,
) {
  const statements = postgresStatements(
    pgSchema,
    tableName,
    schema.generateDdl(tableName, pgSchema),
  );
  const columns = schema.generateOutputColumns();
  const inserts = buildInserts(
    pgSchema,
    tableName,
    columns,
    rows.map((row) => schema.convertObject(row)),
  );

  await client.query(statements.drop);
  await client.query(statements.create);
  await client.query('BEGIN');
  for (const sql of inserts) {
    await client.query(sql);
  }
  await client.query('COMMIT');
  await client.query(statements.analyze);
  const result = await client.query(statements.count);
  return { statements, rowCount: Number(result.rows[0].count) };
}
