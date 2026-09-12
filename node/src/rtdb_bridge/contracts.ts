/**
 * Shared contracts mirrored 1:1 from the dbchart VS Code extension.
 *
 * Ported from `rtdb_bridge/contracts.py`. These constants must stay in
 * lock-step with the TypeScript package:
 *
 *   packages/schema/src/tree/tree-node.ts       -> SCHEMA_NODE_KINDS
 *   packages/schema/src/tree/tree-node-meta.ts  -> KIND_ICONS / KIND_LABELS
 *   packages/schema/src/database.ts             -> SCHEMA_TABLE_TYPES
 */
import type {
  BaseSupportedColumnType,
  ColumnType,
} from '../relationalize/types.js';

export const ENVELOPE_VERSION = 1;
export const GENERATOR_NAME = 'rtdb-bridge';

/** SchemaTreeNode contract (tree-node.ts / tree-node-meta.ts). */
export const SCHEMA_NODE_KINDS: ReadonlySet<string> = new Set([
  'connection',
  'database',
  'section',
  'table',
  'view',
  'collection',
  'row',
  'schema',
  'column',
  'index',
  'foreignKey',
  'uniqueConstraint',
  'trigger',
  'type',
  'note',
]);

export const SCHEMA_NODE_ORIGINS: ReadonlySet<string> = new Set([
  'static',
  'metadata',
  'user',
]);

/** Codicon names without the `codicon-` prefix (must match tree-node-meta.ts). */
export const KIND_ICONS: Record<string, string> = {
  connection: 'server-process',
  database: 'database',
  section: 'folder',
  table: 'table',
  view: 'eye',
  collection: 'folder-library',
  row: 'git-commit',
  schema: 'symbol-struct',
  column: 'symbol-field',
  index: 'list-ordered',
  foreignKey: 'link',
  uniqueConstraint: 'check',
  trigger: 'zap',
  type: 'symbol-enum',
  note: 'note',
};

/** Codicon for a SchemaNodeKind (safe fallback for unknown kinds). */
export function kindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? 'question';
}

/** DatabaseSchema contract (database.ts). */
export const SCHEMA_TABLE_TYPES: ReadonlySet<string> = new Set([
  'table',
  'view',
  'collection',
  'stream',
  'queue',
]);

/**
 * Postgres types emitted by the default relationalize dialect. Mirrors
 * `sql_dialects.PostgresDialect.type_column_mapping`.
 */
export const POSTGRES_TYPE_MAPPING: Record<BaseSupportedColumnType, string> = {
  int: 'BIGINT',
  datetime: 'TIMESTAMP',
  float: 'FLOAT',
  str: 'VARCHAR(65535)',
  bool: 'BOOLEAN',
  none: 'BOOLEAN',
};

/** relationalize label -> explorer / UI vocabulary. */
export const UI_TYPE_LABELS: Record<string, string> = {
  str: 'string',
  string: 'string',
  int: 'number',
  float: 'number',
  number: 'number',
  bool: 'boolean',
  boolean: 'boolean',
  none: 'null',
  null: 'null',
  datetime: 'timestamp',
  timestamp: 'timestamp',
  list: 'list',
  array: 'list',
  map: 'map',
  dict: 'map',
  object: 'map',
};

/** Preferred display order for the per-table "Types" summaries. */
export const UI_TYPE_ORDER: readonly string[] = [
  'string',
  'number',
  'boolean',
  'timestamp',
  'ref',
  'list',
  'map',
  'null',
  'mixed',
];

/** `'str' -> 'string'`, `'c-int-str'` stays as-is (handled by callers). */
export function normalizeTypeLabel(raw: string): string {
  return UI_TYPE_LABELS[raw] ?? raw;
}

/**
 * `'c-int-str' -> ['int', 'str']`; plain `'str' -> null`.
 *
 * `none` members are stripped (they are dropped before DDL generation).
 */
export function choiceParts(columnType: ColumnType | string): string[] | null {
  if (typeof columnType !== 'string' || !columnType.startsWith('c-')) {
    return null;
  }
  const parts = columnType
    .slice(2)
    .split('-')
    .filter((p) => p && p !== 'none');
  return parts.length ? parts : null;
}
