/**
 * Port of `test/schema.test.py`.
 *
 * These assertions are the behavioural spec for the TypeScript `Schema` port;
 * the DDL strings are byte-for-byte identical to the Python output.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from '../src/relationalize/schema.js';

const CASE_1 = { 1: 1, 2: 'foobar', 3: false, 4: 1.2 };
const CASE_2 = { 1: 'foobar', 2: 9.9, 3: true, 4: 9.5 };
const CASE_3 = { 1: null };
const CASE_4 = { 1: 1 };
const CASE_5 = { 1: 'foobar' };

const CASE_1_DDL = `CREATE TABLE IF NOT EXISTS "public"."test" (
    "1" BIGINT
    , "2" VARCHAR(65535)
    , "3" BOOLEAN
    , "4" FLOAT
);`;

const CASE_2_DDL = `CREATE TABLE IF NOT EXISTS "public"."test" (
    "1_int" BIGINT
    , "1_str" VARCHAR(65535)
    , "2_float" FLOAT
    , "2_str" VARCHAR(65535)
    , "3" BOOLEAN
    , "4" FLOAT
);`;

test('all types no choice', () => {
  const schema = new Schema();
  schema.readObject(CASE_1);
  assert.deepEqual(schema.schema, {
    1: 'int',
    2: 'str',
    3: 'bool',
    4: 'float',
  });
});

test('basic choice', () => {
  const schema = new Schema();
  schema.readObject(CASE_1);
  schema.readObject(CASE_2);
  assert.deepEqual(schema.schema, {
    1: 'c-int-str',
    2: 'c-float-str',
    3: 'bool',
    4: 'float',
  });
});

test('merge noop', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  const schema2 = new Schema();
  schema2.readObject(CASE_1);
  const schema3 = new Schema();
  schema3.readObject(CASE_1);

  const merged = Schema.merge(schema1.schema, schema2.schema, schema3.schema);
  assert.deepEqual(merged.schema, schema1.schema);
  assert.deepEqual(merged.schema, schema2.schema);
  assert.deepEqual(merged.schema, schema3.schema);
});

test('merge choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  const schema2 = new Schema();
  schema2.readObject(CASE_2);

  const merged = Schema.merge(schema1.schema, schema2.schema);
  assert.deepEqual(merged.schema, {
    1: 'c-int-str',
    2: 'c-float-str',
    3: 'bool',
    4: 'float',
  });
});

test('merge equal parse', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  const schema2 = new Schema();
  schema2.readObject(CASE_2);
  const merged = Schema.merge(schema1.schema, schema2.schema);

  const schema3 = new Schema();
  schema3.readObject(CASE_1);
  schema3.readObject(CASE_2);

  assert.deepEqual(merged.schema, schema3.schema);
});

test('convert object no choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  assert.deepEqual(schema1.convertObject({ ...CASE_1 }), CASE_1);
});

test('convert object choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  schema1.readObject(CASE_2);

  assert.deepEqual(schema1.convertObject({ ...CASE_1 }), {
    '1_int': 1,
    '2_str': 'foobar',
    3: false,
    4: 1.2,
  });
  assert.deepEqual(schema1.convertObject({ ...CASE_2 }), {
    '1_str': 'foobar',
    '2_float': 9.9,
    3: true,
    4: 9.5,
  });
});

test('generate ddl no choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  assert.equal(schema1.generateDdl('test'), CASE_1_DDL);
});

test('generate ddl choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  schema1.readObject(CASE_2);
  assert.equal(schema1.generateDdl('test'), CASE_2_DDL);
});

test('none cases', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_3);
  assert.deepEqual(schema1.schema, { 1: 'none' });

  schema1.readObject(CASE_4);
  assert.deepEqual(schema1.schema, { 1: 'int' });

  schema1.readObject(CASE_5);
  assert.deepEqual(schema1.schema, { 1: 'c-int-str' });

  schema1.readObject(CASE_3);
  assert.deepEqual(schema1.schema, { 1: 'c-int-str' });
});

test('none convert', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_3);
  assert.deepEqual(schema1.convertObject(CASE_3), { 1: null });
});

test('none int convert', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_3);
  schema1.readObject(CASE_4);
  assert.deepEqual(schema1.convertObject(CASE_3), { 1: null });
  assert.deepEqual(schema1.convertObject(CASE_4), { 1: 1 });
});

test('none choice convert', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_3);
  schema1.readObject(CASE_4);
  schema1.readObject(CASE_5);

  assert.deepEqual(schema1.convertObject(CASE_3), { 1: null });
  assert.deepEqual(schema1.convertObject(CASE_4), { '1_int': 1 });
  assert.deepEqual(schema1.convertObject(CASE_5), { '1_str': 'foobar' });
});

test('drop null columns', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_3);
  assert.deepEqual(schema1.schema, { 1: 'none' });
  schema1.dropNullColumns();
  assert.deepEqual(schema1.schema, {});

  const schema2 = new Schema();
  schema2.readObject(CASE_3);
  schema2.readObject(CASE_4);
  schema2.dropNullColumns();
  assert.deepEqual(schema2.schema, { 1: 'int' });
});

test('generate output columns no choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  assert.deepEqual(schema1.generateOutputColumns(), ['1', '2', '3', '4']);
});

test('generate output columns choice', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  schema1.readObject(CASE_2);
  assert.deepEqual(schema1.generateOutputColumns(), [
    '1_int',
    '1_str',
    '2_float',
    '2_str',
    '3',
    '4',
  ]);
});

test('drop special char columns', () => {
  const schema1 = new Schema();
  schema1.readObject({
    'abc ': 1,
    'def@#': 1,
    '$$ghi': 1,
    jkl: 1,
    '!@#mno': 1,
  });
  assert.equal(schema1.dropSpecialCharColumns(), 3);
  assert.deepEqual(schema1.schema, { 'abc ': 'int', jkl: 'int' });

  const schema2 = new Schema();
  schema2.readObject({ abc: 1, def: 2, 'GH I ': 3 });
  assert.equal(schema2.dropSpecialCharColumns(), 0);
  assert.deepEqual(schema2.schema, { abc: 'int', def: 'int', 'GH I ': 'int' });

  const schema3 = new Schema();
  schema3.readObject({ abc: 1, 'de-f': 2, 'GH_I ': 3 });
  assert.equal(schema3.dropSpecialCharColumns(), 0);
  assert.deepEqual(schema3.schema, {
    abc: 'int',
    'de-f': 'int',
    'GH_I ': 'int',
  });
});

test('drop duplicate columns', () => {
  const schema1 = new Schema();
  schema1.readObject({
    'ABc ': 1,
    'DEf ': 1,
    ghi: 1,
    jkl: 1,
    ABC: 1,
    'abc ': 1,
    JkL: 1,
  });
  assert.equal(schema1.dropDuplicateColumns(), 2);
  assert.deepEqual(schema1.schema, {
    'ABc ': 'int',
    'DEf ': 'int',
    ghi: 'int',
    jkl: 'int',
    ABC: 'int',
  });

  const schema2 = new Schema();
  schema2.readObject({
    abc: 1,
    ABC: 2,
    ABc: 3,
    'abC ': 4,
    'D E F': 5,
    DEF: 5,
  });
  assert.equal(schema2.dropDuplicateColumns(), 2);
  assert.deepEqual(schema2.schema, {
    abc: 'int',
    'abC ': 'int',
    'D E F': 'int',
    DEF: 'int',
  });

  const schema3 = new Schema();
  schema3.readObject({ abc: 1, def: 2, 'GH I ': 3, 'abC ': 4, 'D E F': 5 });
  assert.equal(schema3.dropDuplicateColumns(), 0);
  assert.deepEqual(schema3.schema, {
    abc: 'int',
    def: 'int',
    'GH I ': 'int',
    'abC ': 'int',
    'D E F': 'int',
  });
});

test('serialize/deserialize roundtrip', () => {
  const schema1 = new Schema();
  schema1.readObject(CASE_1);
  schema1.readObject(CASE_2);
  const restored = Schema.deserialize(schema1.serialize());
  assert.deepEqual(restored.schema, schema1.schema);
});

