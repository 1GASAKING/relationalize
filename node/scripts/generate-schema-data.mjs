// Regenerates src/rtdb_bridge/schemaData.ts from the canonical JSON Schema
// contracts shipped by the Python package (../rtdb_bridge/schemas/*.schema.json).
//
// Keeping the Python files as the single source of truth means the Node port
// always validates against the *same bytes* as `rtdb_bridge.schemas.load_schema`.
//
// Usage:  node scripts/generate-schema-data.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = resolve(here, '..', '..', 'rtdb_bridge', 'schemas');
const target = resolve(here, '..', 'src', 'rtdb_bridge', 'schemaData.ts');

/** Short name -> filename, mirroring rtdb_bridge/schemas/__init__.py. */
const NAMES = ['database', 'schema-tree', 'sql', 'rtdb-bridge'];

const documents = {};
for (const name of NAMES) {
  const file = resolve(schemaDir, `${name}.schema.json`);
  documents[name] = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`read ${file}`);
}

const lines = [];
lines.push('// AUTO-GENERATED FILE - do not edit by hand.');
lines.push('// Run `npm run gen:schemas` (scripts/generate-schema-data.mjs) to refresh.');
lines.push('//');
lines.push('// These are the canonical JSON Schema contracts copied verbatim from');
lines.push('// rtdb_bridge/schemas/*.schema.json so the Node port ships the exact same');
lines.push('// bytes as the Python package without any runtime filesystem access.');
lines.push('');
lines.push('/** Short name -> canonical filename (mirrors rtdb_bridge/schemas/__init__.py). */');
lines.push('export const SCHEMA_FILENAMES = {');
for (const name of NAMES) {
  lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(`${name}.schema.json`)},`);
}
lines.push('} as const;');
lines.push('');
lines.push('export type SchemaName = keyof typeof SCHEMA_FILENAMES;');
lines.push('');
lines.push('/** The canonical draft-07 JSON Schema documents, keyed by short name. */');
lines.push('export const SCHEMA_DOCUMENTS: Record<SchemaName, Record<string, unknown>> = {');
for (const name of NAMES) {
  lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(documents[name], null, 2)},`);
}
lines.push('};');
lines.push('');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`wrote ${target}`);
