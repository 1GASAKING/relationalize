// Runs the Node bridge over an RTDB export fixture and prints the envelope.
//
// Usage:
//   npm run build
//   node scripts/dump-envelope.mjs <export.json> [database-name] [--no-validate]
//
// The output mirrors `python -m rtdb_bridge --indent 2`, so the two bridges can
// be diffed directly (see scripts/parity-check.mjs).
import { readFileSync } from 'node:fs';

import { convertExportToEnvelope } from '../dist/src/index.js';

const [, , file, databaseName = 'rtdb_to_sql', ...rest] = process.argv;
if (!file) {
  process.stderr.write(
    'usage: node scripts/dump-envelope.mjs <export.json> [database-name] [--no-validate]\n',
  );
  process.exit(1);
}

const exportTree = JSON.parse(readFileSync(file, 'utf8'));
const validate = !rest.includes('--no-validate');

const envelope = convertExportToEnvelope(
  exportTree,
  databaseName,
  databaseName,
  undefined,
  validate,
);

process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
