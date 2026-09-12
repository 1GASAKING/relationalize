/**
 * RTDB (Firebase Realtime Database) JSON tree -> SQL conversion stress test.
 *
 * Node/TypeScript port of `examples/rtdb_conversion_test.py`.
 *
 * It runs the *same* combined export fixture through:
 *
 *   PIPELINE A - the raw tree (keyed maps are NOT converted to arrays), which
 *                produces wide, key-dependent "polluted" columns, and
 *   PIPELINE B - the preprocessed tree (keyed maps -> real arrays), which
 *                produces proper normalized child tables + SQL DDL.
 *
 * Then it asserts every scenario in the fixture and writes the complete run
 * (report + machine-readable JSON + the bridge envelope) to
 * `examples/node_output/`.
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/rtdb_conversion_test.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Schema,
  convertExportToEnvelope,
  extractCollectionRecords,
  relationalizeExport,
  runPipeline,
} from '../../node/dist/src/index.js';

import { KNOWN_COLLECTION_FIELDS, RTDB_EXPORT } from './fixtures/stress_export.mjs';

// --------------------------------------------------------------------------- #
// Output plumbing
// --------------------------------------------------------------------------- #

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(here, '..', 'node_output');
mkdirSync(OUTPUT_DIR, { recursive: true });

const log = [];
function print(line = '') {
  log.push(line);
  process.stdout.write(`${line}\n`);
}

// --------------------------------------------------------------------------- #
// JSON helpers (mirror json.dumps(..., sort_keys=True))
// --------------------------------------------------------------------------- #

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/** `json.dumps(value, sort_keys=True)` */
function sortedJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

// --------------------------------------------------------------------------- #
// Pipeline helpers
// --------------------------------------------------------------------------- #

/** Return a copy of the schema with null-only columns removed. */
function cleanSchemaFor(schema) {
  const clean = new Schema(structuredClone(schema.schema));
  clean.dropNullColumns();
  return clean;
}

function printTableSummary(schemas, results, verbose = false) {
  for (const tableName of Object.keys(results).sort()) {
    const schema = schemas[tableName];
    if (verbose) {
      print('='.repeat(72));
      print(`TABLE: ${tableName}  (${results[tableName].length} rows)`);
      print(`RAW SCHEMA: ${sortedJson(schema.schema)}`);
    }

    const cleanSchema = cleanSchemaFor(schema);
    const dropped =
      Object.keys(schema.schema).length -
      Object.keys(cleanSchema.schema).length;
    if (dropped) {
      print(`  (dropped ${dropped} null-only column(s) from ${tableName})`);
    }

    print('='.repeat(72));
    print(`TABLE: ${tableName}  (${results[tableName].length} rows)`);
    print(`SCHEMA: ${sortedJson(cleanSchema.schema)}`);
    print('DDL:');
    print(cleanSchema.generateDdl(tableName));
    print('SAMPLE (converted rows):');
    const limit = verbose ? 3 : 2;
    const sampleRows = results[tableName].slice(0, limit);
    for (const row of sampleRows) {
      print(`    ${sortedJson(cleanSchema.convertObject(row))}`);
    }
    if (results[tableName].length > sampleRows.length) {
      print(
        `    ... (${results[tableName].length - sampleRows.length} more rows)`,
      );
    }
  }
  print('='.repeat(72));
}

// --------------------------------------------------------------------------- #
// Scenario bookkeeping
// --------------------------------------------------------------------------- #

const scenarios = [];
function assertScenario(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  scenarios.push({ name, status, detail, ok: Boolean(condition) });
  if (!condition) {
    print(`  [${status}] ${name}  <-- ${detail}`);
  } else {
    print(`  [${status}] ${name}`);
  }
}

// --------------------------------------------------------------------------- #
// PIPELINE A: demonstrate the problem WITHOUT preprocessing
// --------------------------------------------------------------------------- #

print('\n#####################################################################');
print('# PIPELINE A: RAW RTDB TREE (keyed maps NOT converted to arrays)');
print('# -> Expect: orders/account_settings/preferences flatten into');
print('#    ugly/polluted columns');
print('#    Because Relationalize only splits REAL arrays into child tables.');
print('#####################################################################\n');

const naiveArtifact = {};

for (const collectionName of Object.keys(RTDB_EXPORT)) {
  const rawMap = RTDB_EXPORT[collectionName];
  const naiveRecords = Object.entries(rawMap).map(([key, value]) => ({
    record_id: key,
    ...value,
  }));
  const [, naiveResults] = runPipeline(collectionName, naiveRecords);

  print(`\nCollection: ${collectionName}`);
  print(`Tables produced: ${JSON.stringify(Object.keys(naiveResults).sort())}`);

  const produced = naiveResults[collectionName];
  if (produced && produced.length) {
    const firstRow = produced[0];
    const badKeys = Object.keys(firstRow).filter(
      (k) => k.includes('_-') || k.includes('__'),
    );
    print(`  e.g. polluted columns: ${JSON.stringify(badKeys.slice(0, 8))}`);
    print(`  total columns on first row: ${Object.keys(firstRow).length}`);
  }
  print(
    '  NOTE: instead of proper child tables, keyed data is jammed into ' +
      'wide, key-dependent columns.',
  );

  naiveArtifact[collectionName] = {
    tables: Object.keys(naiveResults).sort(),
    firstRowColumns: produced && produced[0] ? Object.keys(produced[0]) : [],
  };
}

// --------------------------------------------------------------------------- #
// PIPELINE B: demonstrate the FIXED pipeline (preprocessed via rtdb_bridge)
// --------------------------------------------------------------------------- #

print('\n#####################################################################');
print('# PIPELINE B: PREPROCESSED RTDB TREE (keyed maps -> real arrays)');
print('# -> Expect: proper normalized child tables + SQL DDL for each');
print('#####################################################################\n');

const result = relationalizeExport(RTDB_EXPORT, KNOWN_COLLECTION_FIELDS);

const allTablesSchemas = result.mergedSchemas();
const allTablesResults = result.mergedResults();
const allTables = new Set(allTablesResults.keys());

for (const collectionName of Object.keys(RTDB_EXPORT)) {
  print(`\n\n################ COLLECTION: ${collectionName} ################`);
  const records = extractCollectionRecords(
    collectionName,
    RTDB_EXPORT,
    KNOWN_COLLECTION_FIELDS,
  );
  const [schemas, results] = runPipeline(collectionName, records);
  printTableSummary(schemas, results, false);
}

// --------------------------------------------------------------------------- #
// Scenario assertion summary
// --------------------------------------------------------------------------- #

print('\n\n#####################################################################');
print('# SCENARIO ASSERTION SUMMARY');
print('#####################################################################\n');

// Regular / nested collection cases
assertScenario(
  'nested keyed map (orders) split into child table',
  allTables.has('users_orders'),
);
assertScenario(
  'nested order items split from parent child',
  allTables.has('users_orders_items'),
);
assertScenario(
  'settings collection split',
  allTables.has('accounts_account_settings'),
);
assertScenario(
  'preferences collection split',
  allTables.has('accounts_preferences'),
);

// Primitives inside keyed maps (presence set)
assertScenario(
  'primitive keyed map (followers) split',
  allTables.has('users_followers'),
);
if (allTables.has('users_followers')) {
  const followerRows = allTablesResults.get('users_followers');
  const followerKeys = new Set(
    followerRows.map((row) => row['followers_record_id']),
  );
  assertScenario(
    'follower rows have keys preserved',
    ['u1', 'u5'].every((k) => followerKeys.has(k)),
    `got: ${JSON.stringify([...followerKeys])}`,
  );
}

// Business-ID keyed collections (non push style)
assertScenario(
  'business keyed map (enrolled_courses) split',
  allTables.has('users_enrolled_courses'),
);
if (allTables.has('users_enrolled_courses')) {
  const courseRows = allTablesResults.get('users_enrolled_courses');
  const courseKeys = new Set(
    courseRows.map((row) => row['enrolled_courses_record_id']),
  );
  assertScenario(
    'business keys (CS101 etc.) preserved',
    ['CS101', 'MATH200', 'PHYS150'].every((k) => courseKeys.has(k)),
    `got: ${JSON.stringify([...courseKeys])}`,
  );
}

// Deeply nested / sparse / mixed columns
const usersSchema = allTablesSchemas.get('users').schema;
assertScenario(
  'deep object (address.geo) flattened',
  'address_geo_lat' in usersSchema && 'address_geo_lng' in usersSchema,
  `got keys: ${JSON.stringify(Object.keys(usersSchema).sort())}`,
);
assertScenario(
  'choice column (age int/str) present',
  usersSchema['age'] === 'c-int-str',
  `got: ${usersSchema['age']}`,
);

// Mixed types across nested keyed children
if (allTables.has('accounts_preferences')) {
  const prefSchema = allTablesSchemas.get('accounts_preferences').schema;
  assertScenario(
    '2-way choice (enabled bool/str)',
    prefSchema['preferences_enabled'] === 'c-bool-str',
    `${prefSchema['preferences_enabled']}`,
  );
}

// 3-way choice (score int/float/str)
assertScenario(
  '3-way choice (score int/float/str)',
  usersSchema['score'] === 'c-float-int-str',
  `got: ${usersSchema['score']}`,
);

// Flattened special character keys
assertScenario(
  'field names w/ spaces & hyphens survived',
  ['contact email', 'phone-number', 'GH_I_'].every((k) => k in usersSchema),
  JSON.stringify(Object.keys(usersSchema).sort()),
);

// Reserved key collision: payload record_id preserved
const usersRows = allTablesResults.get('users');
const frankRow = usersRows.find(
  (r) => r['record_id'] === 'u6' || r['name'] === 'Frank',
);
assertScenario(
  'record_id collision preserves source payload id',
  Boolean(frankRow && frankRow['source_record_id'] === 'custom-u6-payload-id'),
  `row: ${JSON.stringify(frankRow)}`,
);

// Null column hygiene: null-only columns dropped from DDL/schema
const cleanUsers = cleanSchemaFor(allTablesSchemas.get('users'));
assertScenario(
  'null-only column (email) was dropped from DDL',
  !('email' in cleanUsers.schema),
);

// Empty collection handling
const accRows = allTablesResults.get('accounts');
const bobRow = accRows.find((r) => r['owner'] === 'Bob');
assertScenario(
  'empty preferences collection did not invent junk',
  !bobRow ||
    (bobRow['preferences'] !== undefined && bobRow['preferences'] !== null),
  JSON.stringify(bobRow),
);

const devSchema = allTablesSchemas.get('devices').schema;
assertScenario(
  'device choice column revision (int/str)',
  devSchema['revision'] === 'c-int-str',
  `got: ${devSchema['revision']}`,
);

// Envelope fully validates against the canonical contract
let envelope = null;
try {
  envelope = convertExportToEnvelope(
    RTDB_EXPORT,
    'stress_test',
    'stress_test',
    KNOWN_COLLECTION_FIELDS,
    true,
  );
  assertScenario(
    'envelope validates against rtdb-bridge.schema.json',
    envelope.warnings.length === 0,
    `got warnings: ${JSON.stringify(envelope.warnings)}`,
  );
  assertScenario(
    'envelope tree root is a database',
    envelope.tree[0]['kind'] === 'database',
    `got: ${envelope.tree[0]['kind']}`,
  );
} catch (error) {
  assertScenario('envelope builds + validates', false, String(error));
}

const passed = scenarios.filter((s) => s.ok).length;
const failed = scenarios.length - passed;
print(`\n${passed}/${scenarios.length} scenarios passed, ${failed} failed.`);

// --------------------------------------------------------------------------- #
// Persist every artifact under examples/node_output/
// --------------------------------------------------------------------------- #

const tablesArtifact = {};
const ddlChunks = [];
for (const tableName of [...allTablesResults.keys()].sort()) {
  const schema = allTablesSchemas.get(tableName);
  const rows = allTablesResults.get(tableName);
  const clean = cleanSchemaFor(schema);
  const ddl = clean.generateDdl(tableName);
  tablesArtifact[tableName] = {
    rowCount: rows.length,
    rawSchema: sortKeysDeep(schema.schema),
    cleanSchema: sortKeysDeep(clean.schema),
    ddl,
    sampleRows: rows
      .slice(0, 3)
      .map((row) => sortKeysDeep(clean.convertObject(row))),
  };
  ddlChunks.push(`-- ${tableName} (${rows.length} rows)\n${ddl}`);
}

const resultArtifact = {
  generatedBy: 'examples/node/rtdb_conversion_test.mjs',
  databaseName: 'stress_test',
  knownCollectionFields: KNOWN_COLLECTION_FIELDS,
  collections: result.collections.map((c) => ({
    name: c.name,
    recordCount: c.recordCount,
    childTableCount: c.childTableCount,
    tableNames: c.tableNames,
  })),
  tableNames: [...allTablesResults.keys()].sort(),
  pipelineA: naiveArtifact,
  tables: tablesArtifact,
  scenarios,
  summary: { passed, failed, total: scenarios.length },
};

writeFileSync(
  resolve(OUTPUT_DIR, 'rtdb_conversion_report.txt'),
  `${log.join('\n')}\n`,
  'utf8',
);
writeFileSync(
  resolve(OUTPUT_DIR, 'rtdb_conversion_result.json'),
  `${JSON.stringify(resultArtifact, null, 2)}\n`,
  'utf8',
);
writeFileSync(
  resolve(OUTPUT_DIR, 'rtdb_table_ddl.sql'),
  `${ddlChunks.join('\n\n')}\n`,
  'utf8',
);
if (envelope) {
  writeFileSync(
    resolve(OUTPUT_DIR, 'rtdb_bridge_envelope.json'),
    `${JSON.stringify(envelope, null, 2)}\n`,
    'utf8',
  );
}

print(`\nArtifacts written to ${OUTPUT_DIR}`);
print('  - rtdb_conversion_report.txt');
print('  - rtdb_conversion_result.json');
print('  - rtdb_table_ddl.sql');
if (envelope) {
  print('  - rtdb_bridge_envelope.json');
}
print('\nALL DONE.');

if (failed > 0) {
  process.exitCode = 1;
}
