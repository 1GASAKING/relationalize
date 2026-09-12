/**
 * Relationalize output -> UI schema-explorer tree (Node port).
 *
 * Node/TypeScript port of `examples/rtdb_schema_tree.py`. Where the Python
 * script uses a tiny demo export, this one uses the *full* stress-test export
 * (`fixtures/stress_export.mjs`) so the emitted tree covers **every** case:
 * choice columns, nested keyed collections, business-ID collections, presence
 * sets, nested arrays, sparse/null columns, special-char field names,
 * reserved-key collisions and empty collections.
 *
 * The tree has exactly four node keys (`kind`, `name`, `meta`, `children`) so
 * any renderer (React TreeView, Flutter, SwiftUI, TUI, ...) can render it
 * recursively with no custom parsing.
 *
 * Writes: examples/node_output/rtdb_schema_tree_sample.json
 *
 * Run from the repository root:
 *   npm --prefix node run build
 *   node examples/node/rtdb_schema_tree.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertExportToEnvelope } from '../../node/dist/src/index.js';

import { KNOWN_COLLECTION_FIELDS, RTDB_EXPORT } from './fixtures/stress_export.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(here, '..', 'node_output');
mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Convenience shim: run the canonical bridge and return just the explorer tree
 * root (`SchemaTreeNode` database node).
 */
function rtdbToUiTree(exportTree, databaseName = 'rtdb_to_sql', known = undefined) {
  const envelope = convertExportToEnvelope(
    exportTree,
    databaseName,
    databaseName,
    known,
    false,
  );
  return envelope.tree[0];
}

/** Tiny renderer to preview the UI data locally. */
function printTextTree(node, prefix = '', isLast = true, maxRows = 40, depth = 0) {
  if (maxRows !== null && depth > maxRows) {
    return;
  }
  const connector = isLast ? '└─ ' : '├─ ';
  let current = `${prefix}${connector}${node.name}`;
  const meta = node.meta || {};
  const details = [];
  if ('rowCount' in meta) {
    details.push(`table · ${meta.rowCount} rows`);
  } else if ('tableCount' in meta) {
    details.push(`database · ${meta.tableCount} tables`);
  } else if ('summary' in meta) {
    details.push(String(meta.summary));
  }
  if ('count' in meta) {
    details.push(`${meta.count}`);
  }
  if ('uiType' in meta) {
    details.push(String(meta.uiType));
  }
  if ('refTable' in meta) {
    details.push(`→ ${meta.refTable}`);
  }
  if (details.length) {
    current += `   [${details.join(', ')}]`;
  }
  console.log(current);

  const children = node.children || [];
  children.forEach((child, index) => {
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    printTextTree(
      child,
      nextPrefix,
      index === children.length - 1,
      maxRows,
      depth + 1,
    );
  });
}

const tree = rtdbToUiTree(RTDB_EXPORT, 'stress_test', KNOWN_COLLECTION_FIELDS);

const target = resolve(OUTPUT_DIR, 'rtdb_schema_tree_sample.json');
writeFileSync(target, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');

console.log('\nUI SCHEMA TREE PREVIEW\n=====================\n');
printTextTree(tree, '', true, 200);
console.log(`\nFull JSON written to ${target}`);
