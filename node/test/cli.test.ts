/**
 * End-to-end tests for the `rtdb-bridge` CLI, mirroring the stdin/stdout
 * contract documented in docs/vscode-extension.md.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(
  new URL('../src/rtdb_bridge/cli.js', import.meta.url),
);

const EXPORT = JSON.stringify({
  users: {
    u1: { name: 'Alice', age: 30, tags: ['admin'] },
    u2: { name: 'Bob', age: 'thirty' },
  },
  chat: { m1: { text: 'hi', user: 'u1' } },
});

function runCli(args: string[], input?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input: input ?? '',
    encoding: 'utf8',
  });
}

test('cli reads stdin and writes the envelope to stdout', () => {
  const result = runCli(['--database-name', 'demo'], EXPORT);
  assert.equal(result.status, 0, result.stderr);
  const env = JSON.parse(result.stdout);
  assert.equal(env.database.name, 'demo');
  assert.equal(env.tree[0].kind, 'database');
  assert.equal(env.generator.name, 'rtdb-bridge');
  assert.deepEqual(env.warnings, []);
});

test('cli honours --indent 0 for compact output', () => {
  const pretty = runCli(['--database-name', 'demo'], EXPORT);
  const compact = runCli(['--database-name', 'demo', '--indent', '0'], EXPORT);
  assert.equal(compact.status, 0, compact.stderr);
  assert.ok(compact.stdout.length < pretty.stdout.length);
});

test('cli --version prints a semver', () => {
  const result = runCli(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('cli --help prints usage', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: rtdb-bridge/);
});

test('cli rejects empty stdin with exit code 1', () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read input/);
});

test('cli rejects invalid JSON with exit code 1', () => {
  const result = runCli([], 'not json');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read input/);
});

test('cli rejects non-object input with exit code 1', () => {
  const result = runCli([], '[1, 2, 3]');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a JSON object/);
});
