/**
 * Port of `test/rtdb_bridge.test.py`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isPlainObject,
  type JsonObject,
} from '../src/relationalize/index.js';
import {
  CollectionInfo,
  DEFAULT_KNOWN_COLLECTION_FIELDS,
  ExportPipelineResult,
  SCHEMA_FILENAMES,
  TableInfo,
  convertExportToEnvelope,
  extractCollectionRecords,
  keyedMapsToArrays,
  loadAllSchemas,
  loadSchema,
  normalizeTypeLabel,
  relationalizeExport,
  runPipeline,
  validateEnvelope,
  validateInstance,
  type EnvelopeWarning,
  type RtdbBridgeEnvelope,
} from '../src/rtdb_bridge/index.js';

// A representative RTDB export exercising choice columns, nested keyed maps,
// arrays of primitives, and sparse records.
const SAMPLE_EXPORT: JsonObject = {
  users: {
    u1: {
      name: 'Alice',
      age: 30,
      prefs: { theme: 'dark', notifications: true },
      tags: ['admin', 'mod'],
      orders: {
        '-o1': { order_id: 'ORD-1' },
      },
    },
    u2: {
      name: 'Bob',
      age: 'thirty',
      prefs: { theme: 'light' },
      tags: ['guest'],
    },
  },
  chat: {
    m1: { text: 'hi', user: 'u1' },
  },
};

test('load all schemas returns four contracts', () => {
  const schemas = loadAllSchemas();
  assert.deepEqual(
    Object.keys(schemas).sort(),
    Object.keys(SCHEMA_FILENAMES).sort(),
  );
});

test('schema titles and versions', () => {
  const expected: Record<string, [string, number]> = {
    database: ['DatabaseSchema', 1],
    'schema-tree': ['SchemaTreeNode', 1],
    sql: ['SqlContract', 1],
    'rtdb-bridge': ['RtdbBridgeEnvelope', 1],
  };
  for (const [name, [title, version]] of Object.entries(expected)) {
    const schema = loadSchema(name);
    assert.equal(schema['title'], title, name);
    assert.equal(schema['version'], version, name);
  }
});

test('unknown schema raises', () => {
  assert.throws(() => loadSchema('does-not-exist'));
});

test('keyed maps presence set becomes rows', () => {
  const converted = keyedMapsToArrays({ u1: true, u5: true });
  // Without known_collection_fields the keys are not push ids -> object.
  assert.ok(isPlainObject(converted));
  // Treating it as a collection converts to rows with value.
  const converted2 = keyedMapsToArrays({ u1: true, u5: true }, true);
  assert.deepEqual(converted2, [
    { record_id: 'u1', value: true },
    { record_id: 'u5', value: true },
  ]);
});

test('empty object becomes empty array', () => {
  assert.deepEqual(keyedMapsToArrays({}), []);
  assert.deepEqual(keyedMapsToArrays({ preferences: {} }), {
    preferences: [],
  });
});

test('extract collection records injects rtdb key', () => {
  const records = extractCollectionRecords('users', SAMPLE_EXPORT, ['friends']);
  assert.deepEqual(
    records.map((r) => r['record_id']),
    ['u1', 'u2'],
  );
  const u1 = records.find((r) => r['record_id'] === 'u1')!;
  // orders is push-keyed, so it always converts to a real array.
  assert.deepEqual(u1['orders'], [{ order_id: 'ORD-1', record_id: '-o1' }]);
  assert.ok(isPlainObject(u1['prefs']));
});

test('extract collection records arrayifies known fields', () => {
  const records = extractCollectionRecords('users', SAMPLE_EXPORT, ['orders']);
  const u1 = records.find((r) => r['record_id'] === 'u1')!;
  assert.deepEqual(u1['orders'], [{ order_id: 'ORD-1', record_id: '-o1' }]);
  // prefs is a plain object - flatten, not split.
  assert.ok(isPlainObject(u1['prefs']));
});

test('missing collection raises', () => {
  assert.throws(() => extractCollectionRecords('nope', SAMPLE_EXPORT));
});

test('default known collection fields', () => {
  assert.ok(DEFAULT_KNOWN_COLLECTION_FIELDS.has('orders'));
});

test('run pipeline produces schemas and rows', () => {
  const records = extractCollectionRecords('users', SAMPLE_EXPORT, ['orders']);
  const [, results] = runPipeline('users', records);
  // users + users_orders + users_tags
  assert.ok('users' in results);
  assert.ok('users_orders' in results);
  assert.ok('users_tags' in results);
  assert.ok(results['users'].length >= 2);
});

test('relationalize export detects child tables and relations', () => {
  const result = relationalizeExport(SAMPLE_EXPORT, ['orders', 'users']);
  assert.ok(result instanceof ExportPipelineResult);
  assert.ok(result.tables.has('users_tags'));
  assert.ok(result.tables.has('users_orders'));
  assert.ok(Array.isArray(result.relations));
  const targets = result.relations.map(
    (r) => [r.fromTable, r.column, r.toTable] as const,
  );
  assert.ok(
    targets.some(
      ([from, column, to]) =>
        from === 'users' && column === 'tags' && to === 'users_tags',
    ),
  );
  assert.ok(result.collections[0] instanceof CollectionInfo);
  assert.ok(result.tables.get('users') instanceof TableInfo);
});

test('normalize type label maps primitive labels', () => {
  assert.equal(normalizeTypeLabel('str'), 'string');
  assert.equal(normalizeTypeLabel('int'), 'number');
  assert.equal(normalizeTypeLabel('float'), 'number');
  assert.equal(normalizeTypeLabel('bool'), 'boolean');
  assert.equal(normalizeTypeLabel('datetime'), 'timestamp');
  assert.equal(normalizeTypeLabel('map'), 'map');
});

test('known good export validates with zero warnings', () => {
  const env = convertExportToEnvelope(
    SAMPLE_EXPORT,
    'demo',
    'demo-export',
    null,
    true,
  );
  assert.equal(env.envelopeVersion, 1);
  assert.equal(env.generator['name'], 'rtdb-bridge');
  assert.equal(env.database['name'], 'demo');
  assert.equal(env.source['name'], 'demo-export');
  assert.equal(env.tree[0]['kind'], 'database');
  assert.deepEqual(env.warnings, []);
});

test('sql contract mixed columns have null sqltype and members', () => {
  const env = convertExportToEnvelope(
    SAMPLE_EXPORT,
    undefined,
    undefined,
    undefined,
    false,
  );
  const tables = env.sql['tables'] as Array<Record<string, unknown>>;
  const usersSql = tables.find((t) => t['name'] === 'users')!;
  const columns = usersSql['columns'] as Array<Record<string, unknown>>;
  const age = columns.find((c) => c['name'] === 'age')!;
  assert.equal(age['sqlType'], null);
  assert.deepEqual(
    (age['choiceOf'] as Array<Record<string, unknown>>).map((m) => [
      m['type'],
      m['columnName'],
    ]),
    [
      ['int', 'age_int'],
      ['str', 'age_str'],
    ],
  );
});

test('canvas mixed column carries null sqltype and child members', () => {
  const env = convertExportToEnvelope(
    SAMPLE_EXPORT,
    undefined,
    undefined,
    undefined,
    false,
  );
  const tables = env.database['tables'] as Array<Record<string, unknown>>;
  const usersTable = tables.find((t) => t['name'] === 'users')!;
  const columns = usersTable['columns'] as Array<Record<string, unknown>>;
  const age = columns.find((c) => c['name'] === 'age')!;
  assert.equal(age['sqlType'], null);
  assert.deepEqual(
    (age['choiceOf'] as Array<Record<string, unknown>>).map((m) => [
      m['name'],
      m['sqlType'],
    ]),
    [
      ['age_int', 'BIGINT'],
      ['age_str', 'VARCHAR(65535)'],
    ],
  );
});

test('ui tree matches canonical schema tree shape', () => {
  const env = convertExportToEnvelope(
    SAMPLE_EXPORT,
    undefined,
    undefined,
    undefined,
    false,
  );
  const root = env.tree[0];
  // Validate the whole tree array against the full schema-tree document, so
  // the internal #/definitions refs resolve against the whole document.
  assert.deepEqual(validateInstance(env.tree, loadSchema('schema-tree')), []);
  assert.equal(root['kind'], 'database');
});

test('invalid envelope emits schema validation warning', () => {
  const good: RtdbBridgeEnvelope = convertExportToEnvelope(
    SAMPLE_EXPORT,
    undefined,
    undefined,
    undefined,
    false,
  );
  good.envelopeVersion = 99; // deliberately break the contract
  const warnings: EnvelopeWarning[] = [];
  validateEnvelope(good, warnings);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]['code'], 'schema-validation-failed');
});
