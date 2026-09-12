/**
 * Port of `test/relationalize.test.py`.
 *
 * Output rows are asserted by parsing the emitted NDJSON and checking the
 * structural relationships (RID linkage, index, value) rather than byte
 * equality, because `JSON.stringify` uses compact separators where Python's
 * `json.dumps` uses `", "` / `": "` (the parsed content is identical).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  Relationalize,
  type JsonObject,
} from '../src/relationalize/relationalize.js';
import { createLocalBuffer, StringIO } from '../src/relationalize/utils.js';

const RID = /^R_[a-z0-9]{32}$/;

const CASE_1 = { 1: 1, 2: 'foobar', 3: false, 4: 1.2 };
const CASE_2 = { 1: 'foobar', 2: 9.9, 3: true, 4: 9.5 };
const CASE_3 = { 1: [1, 2], 2: 'foobar' };
const CASE_4 = {
  1: [
    { 2: 'foobar', 3: 1 },
    { 2: 'barfoo', 3: 3 },
  ],
  2: 'foobar',
};
const CASE_5 = { 1: [[1], [2, 3]] };
const CASE_6 = {
  1: [
    { 2: 'foobar', 3: [1, 2] },
    { 2: 'barfoo', 3: [3, 4] },
  ],
  2: 'foobar',
};
const CASE_7 = { 1: { 2: 1, 3: 'foobar' } };
const CASE_8 = {
  1: [
    [{ 2: 3 }, { 2: 4 }],
    [{ 2: 5 }, { 2: 6 }],
  ],
};

function run(name: string, records: JsonObject[]): Relationalize {
  const r = new Relationalize(name, createLocalBuffer());
  r.relationalize(records);
  return r;
}

function contents(r: Relationalize, key: string): string {
  return (r.outputs[key] as StringIO).read();
}

function allLines(r: Relationalize, key: string): JsonObject[] {
  const text = contents(r, key).trim();
  return text === ''
    ? []
    : text.split('\n').map((line) => JSON.parse(line) as JsonObject);
}

function single(r: Relationalize, key: string): JsonObject {
  return JSON.parse(contents(r, key)) as JsonObject;
}

test('no array', () => {
  const r = run('test_case_1', [CASE_1]);
  assert.deepEqual(Object.keys(r.outputs), ['test_case_1']);
  assert.deepEqual(single(r, 'test_case_1'), CASE_1);
});

test('two records no array', () => {
  const r = run('test_case_2', [CASE_1, CASE_2]);
  assert.deepEqual(Object.keys(r.outputs), ['test_case_2']);
  assert.deepEqual(allLines(r, 'test_case_2'), [CASE_1, CASE_2]);
});

test('literal array', () => {
  const r = run('test_case_3', [CASE_3]);
  assert.deepEqual(
    Object.keys(r.outputs).sort(),
    ['test_case_3', 'test_case_3_1'],
  );

  const parent = single(r, 'test_case_3');
  assert.match(parent[1] as string, RID);
  assert.equal(parent[2], 'foobar');

  const child = allLines(r, 'test_case_3_1');
  assert.equal(child.length, 2);
  assert.deepEqual(child[0], {
    '1__val_': 1,
    '1__rid_': parent[1],
    '1__index_': 0,
  });
  assert.deepEqual(child[1], {
    '1__val_': 2,
    '1__rid_': parent[1],
    '1__index_': 1,
  });
});

test('struct array', () => {
  const r = run('test_case_4', [CASE_4]);
  assert.deepEqual(
    Object.keys(r.outputs).sort(),
    ['test_case_4', 'test_case_4_1'],
  );

  const parent = single(r, 'test_case_4');
  assert.match(parent[1] as string, RID);
  assert.equal(parent[2], 'foobar');

  const child = allLines(r, 'test_case_4_1');
  assert.deepEqual(child[0], {
    '1_2': 'foobar',
    '1_3': 1,
    '1__rid_': parent[1],
    '1__index_': 0,
  });
  assert.deepEqual(child[1], {
    '1_2': 'barfoo',
    '1_3': 3,
    '1__rid_': parent[1],
    '1__index_': 1,
  });
});

test('list of lists of literals', () => {
  const r = run('test_case_5', [CASE_5]);
  assert.deepEqual(Object.keys(r.outputs).sort(), [
    'test_case_5',
    'test_case_5_1',
    'test_case_5_1__val_',
  ]);

  const parent = single(r, 'test_case_5');
  assert.match(parent[1] as string, RID);

  const mid = allLines(r, 'test_case_5_1');
  assert.equal(mid.length, 2);
  const inner = allLines(r, 'test_case_5_1__val_');
  assert.equal(inner.length, 3);

  assert.deepEqual(mid[0], {
    '1__val_': inner[0]['1__val___rid_'],
    '1__rid_': parent[1],
    '1__index_': 0,
  });
  assert.deepEqual(mid[1], {
    '1__val_': inner[1]['1__val___rid_'],
    '1__rid_': parent[1],
    '1__index_': 1,
  });
  assert.deepEqual(inner[0], {
    '1__val___val_': 1,
    '1__val___rid_': mid[0]['1__val_'],
    '1__val___index_': 0,
  });
  assert.deepEqual(inner[1], {
    '1__val___val_': 2,
    '1__val___rid_': mid[1]['1__val_'],
    '1__val___index_': 0,
  });
  assert.deepEqual(inner[2], {
    '1__val___val_': 3,
    '1__val___rid_': mid[1]['1__val_'],
    '1__val___index_': 1,
  });
});

test('nested array of structs with array', () => {
  const r = run('test_case_6', [CASE_6]);
  assert.deepEqual(Object.keys(r.outputs).sort(), [
    'test_case_6',
    'test_case_6_1',
    'test_case_6_1_3',
  ]);

  const parent = single(r, 'test_case_6');
  assert.match(parent[1] as string, RID);
  assert.equal(parent[2], 'foobar');

  const mid = allLines(r, 'test_case_6_1');
  assert.equal(mid.length, 2);
  const sub = allLines(r, 'test_case_6_1_3');
  assert.equal(sub.length, 4);

  assert.deepEqual(mid[0], {
    '1_2': 'foobar',
    '1_3': sub[0]['1_3__rid_'],
    '1__rid_': parent[1],
    '1__index_': 0,
  });
  assert.deepEqual(mid[1], {
    '1_2': 'barfoo',
    '1_3': sub[2]['1_3__rid_'],
    '1__rid_': parent[1],
    '1__index_': 1,
  });

  assert.deepEqual(sub[0], {
    '1_3__val_': 1,
    '1_3__rid_': mid[0]['1_3'],
    '1_3__index_': 0,
  });
  assert.deepEqual(sub[1], {
    '1_3__val_': 2,
    '1_3__rid_': mid[0]['1_3'],
    '1_3__index_': 1,
  });
  assert.deepEqual(sub[2], {
    '1_3__val_': 3,
    '1_3__rid_': mid[1]['1_3'],
    '1_3__index_': 0,
  });
  assert.deepEqual(sub[3], {
    '1_3__val_': 4,
    '1_3__rid_': mid[1]['1_3'],
    '1_3__index_': 1,
  });
});

test('flatten struct', () => {
  const r = run('test_case_7', [CASE_7]);
  assert.deepEqual(Object.keys(r.outputs), ['test_case_7']);
  assert.deepEqual(single(r, 'test_case_7'), { '1_2': 1, '1_3': 'foobar' });
});

test('list of lists of structs', () => {
  const r = run('test_case_8', [CASE_8]);
  assert.deepEqual(Object.keys(r.outputs).sort(), [
    'test_case_8',
    'test_case_8_1',
    'test_case_8_1__val_',
  ]);

  const parent = single(r, 'test_case_8');
  assert.deepEqual(Object.keys(parent), ['1']);
  assert.match(parent[1] as string, RID);

  const mid = allLines(r, 'test_case_8_1');
  assert.equal(mid.length, 2);
  const inner = allLines(r, 'test_case_8_1__val_');
  assert.equal(inner.length, 4);

  assert.deepEqual(mid[0], {
    '1__val_': inner[0]['1__val___rid_'],
    '1__rid_': parent[1],
    '1__index_': 0,
  });
  assert.deepEqual(mid[1], {
    '1__val_': inner[2]['1__val___rid_'],
    '1__rid_': parent[1],
    '1__index_': 1,
  });

  assert.deepEqual(inner[0], {
    '1__val__2': 3,
    '1__val___rid_': mid[0]['1__val_'],
    '1__val___index_': 0,
  });
  assert.deepEqual(inner[1], {
    '1__val__2': 4,
    '1__val___rid_': mid[0]['1__val_'],
    '1__val___index_': 1,
  });
  assert.deepEqual(inner[2], {
    '1__val__2': 5,
    '1__val___rid_': mid[1]['1__val_'],
    '1__val___index_': 0,
  });
  assert.deepEqual(inner[3], {
    '1__val__2': 6,
    '1__val___rid_': mid[1]['1__val_'],
    '1__val___index_': 1,
  });
});
