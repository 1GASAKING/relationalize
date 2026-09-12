// Cross-checks the TypeScript bridge against the Python `rtdb_bridge` package.
//
//   npm run build && node scripts/parity-check.mjs
//
// Both bridges run over test/fixtures/sample_export.json; RIDs (which are
// random) are normalized before the envelopes are compared key-for-key.
// Skips (exit 0) when no Python interpreter with `rtdb_bridge` is available.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertExportToEnvelope } from '../dist/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const fixture = resolve(here, '..', 'test', 'fixtures', 'sample_export.json');
const DATABASE_NAME = 'demo';
const SOURCE_NAME = 'demo-export';

const normalize = (value) =>
  JSON.parse(JSON.stringify(value).replace(/R_[0-9a-f]{32}/g, 'RID'));

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
};

const exportTree = JSON.parse(readFileSync(fixture, 'utf8'));
const nodeEnvelope = convertExportToEnvelope(
  exportTree,
  DATABASE_NAME,
  SOURCE_NAME,
  undefined,
  true,
);

const pythonScript = `
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
from rtdb_bridge import convert_export_to_envelope
with open(sys.argv[1], encoding='utf-8') as fh:
    export = json.load(fh)
env = convert_export_to_envelope(
    export, ${JSON.stringify(DATABASE_NAME)}, ${JSON.stringify(SOURCE_NAME)}, None, True
)
print(json.dumps(env, sort_keys=True, ensure_ascii=False, default=str))
`;

const pythonCandidates = [
  resolve(repoRoot, 'venv', 'Scripts', 'python.exe'),
  resolve(repoRoot, 'venv', 'bin', 'python'),
  'python3',
  'python',
];

let pythonEnvelope = null;
for (const candidate of pythonCandidates) {
  const result = spawnSync(candidate, ['-c', pythonScript, fixture], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    pythonEnvelope = JSON.parse(result.stdout);
    break;
  }
}

if (!pythonEnvelope) {
  console.log(
    'SKIP: no Python interpreter with `rtdb_bridge` importable was found.',
  );
  process.exit(0);
}

const nodeText = JSON.stringify(sortKeys(normalize(nodeEnvelope)), null, 2);
const pythonText = JSON.stringify(sortKeys(normalize(pythonEnvelope)), null, 2);

if (nodeText === pythonText) {
  console.log(
    'PASS: the TypeScript envelope matches the Python bridge exactly (RIDs normalized).',
  );
  process.exit(0);
}

console.log('FAIL: the envelopes differ.');
const nodeLines = nodeText.split('\n');
const pythonLines = pythonText.split('\n');
let shown = 0;
for (let i = 0; i < Math.max(nodeLines.length, pythonLines.length); i += 1) {
  if (nodeLines[i] !== pythonLines[i]) {
    console.log(`  line ${i + 1}`);
    console.log(`    node: ${nodeLines[i]}`);
    console.log(`    py  : ${pythonLines[i]}`);
    shown += 1;
    if (shown >= 20) {
      console.log('  ... (truncated)');
      break;
    }
  }
}
process.exit(1);
