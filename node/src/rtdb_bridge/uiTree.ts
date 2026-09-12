/**
 * Relationalize output -> UI schema-explorer tree.
 *
 * Ported from `rtdb_bridge/ui_tree.py`. Turns {@link TableInfo} results into
 * the recursive four-key UI node format:
 *
 * ```
 * node = {
 *   kind:     "...",   // database | table | columns | column |
 *                      // keys | key | references | reference | types
 *   name:     "...",
 *   meta:     { ... }, // title, row counts, type badges, nullable,
 *                      // partial, sample values, relation targets
 *   children: [ ... ]  // optional nested nodes
 * }
 * ```
 */
import { isPlainObject, type JsonObject } from '../relationalize/relationalize.js';
import { compareStrings } from '../relationalize/index.js';

import { isRelationId as pipelineIsRelationId, type TableInfo } from './pipeline.js';

export type UiTreeNode = {
  kind: string;
  name: string;
  meta?: Record<string, unknown>;
  children?: UiTreeNode[];
};

const COLUMN_TYPE_LABELS: Record<string, string> = {
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

export function normalizeTypeLabel(raw: string): string {
  return COLUMN_TYPE_LABELS[raw] ?? raw;
}

/** `'c-int-str' -> ['int', 'str']`; plain `'str' -> null`. */
export function choiceParts(columnType: string): string[] | null {
  if (!columnType.startsWith('c-')) {
    return null;
  }
  const parts = columnType
    .slice(2)
    .split('-')
    .filter((p) => p !== 'none');
  return parts.length ? parts : null;
}

/** The set of UI type labels present in a value, mirroring `value_types`. */
export function valueTypes(value: unknown): Set<string> {
  if (typeof value === 'boolean') return new Set(['boolean']);
  if (typeof value === 'number') return new Set(['number']);
  if (typeof value === 'string') return new Set(['string']);
  if (Array.isArray(value)) return new Set(['list']);
  if (isPlainObject(value)) return new Set(['map']);
  if (value === null || value === undefined) return new Set(['null']);
  return new Set([typeof value]);
}

export function isRelationId(value: unknown): boolean {
  return pipelineIsRelationId(value);
}

/** `json.dumps(value, sort_keys=True)` - a stable digest for distinctness. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort(compareStrings);
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

/** Distinct human-readable samples from the physical rows. */
export function sampleDistinct(
  rows: ReadonlyArray<JsonObject>,
  columns: ReadonlyArray<string>,
  limit = 4,
  skipRelationIds = true,
): unknown[] {
  const seen = new Set<string>();
  const samples: unknown[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const value = row[column];
      if (
        value === null ||
        value === undefined ||
        (skipRelationIds && isRelationId(value))
      ) {
        continue;
      }
      const digest = stableStringify(value);
      if (seen.has(digest)) {
        continue;
      }
      seen.add(digest);
      samples.push(value);
      if (samples.length >= limit) {
        return samples;
      }
    }
  }
  return samples;
}

export function keySamples(
  rows: ReadonlyArray<JsonObject>,
  limit = 12,
): unknown[] {
  return sampleDistinct(rows, ['record_id'], limit, false);
}

export function isNullable(
  convertedRows: ReadonlyArray<JsonObject>,
  columns: ReadonlyArray<string>,
): boolean {
  return convertedRows.some((row) =>
    columns.some((column) => !(column in row) || row[column] === null),
  );
}

export function isPartial(
  convertedRows: ReadonlyArray<JsonObject>,
  columns: ReadonlyArray<string>,
): boolean {
  return convertedRows.some((row) =>
    columns.some((column) => !(column in row)),
  );
}

/** For a choice column the physical SQL names are column_int/str etc. */
function physicalNames(column: string, parts: string[] | null): string[] {
  if (parts) {
    return parts.map((part) => `${column}_${part}`);
  }
  return [column];
}

export function tableToUiTree(
  table: TableInfo,
  availableTables: ReadonlySet<string>,
): UiTreeNode {
  const clean = table.cleanSchema();
  const rawRows = table.rows;
  const converted = rawRows.map((row) => clean.convertObject(row));

  const columns = buildColumnsUi(
    table.name,
    clean.schema,
    rawRows,
    converted,
    availableTables,
  );
  const keys = buildKeysUi(table.name, rawRows, converted);
  const refs = buildReferencesUi(table.name, rawRows, availableTables);
  const types = buildTypesUi(columns);

  return {
    kind: 'table',
    name: table.name,
    meta: {
      rowCount: rawRows.length,
      ddl: clean.generateDdl(table.name),
    },
    children: [columns, keys, refs, types],
  };
}

export function buildColumnsUi(
  table: string,
  schemaColumns: Record<string, string>,
  rawRows: ReadonlyArray<JsonObject>,
  convertedRows: ReadonlyArray<JsonObject>,
  availableTables: ReadonlySet<string>,
): UiTreeNode {
  const children: UiTreeNode[] = [];
  const physicalFromRaw: Record<string, unknown[]> = {};
  for (const col of Object.keys(schemaColumns)) {
    physicalFromRaw[col] = rawRows
      .filter((r) => col in r && r[col] !== null && r[col] !== undefined)
      .map((r) => r[col]);
  }

  for (const [column, columnType] of Object.entries(schemaColumns)) {
    const parts = choiceParts(columnType);
    const physical = physicalNames(column, parts);

    // Relation column? Parent rows link to <table>_<column> child table.
    const targetChild = `${table}_${column}`;
    const nonNullValues = physicalFromRaw[column] ?? [];
    const isRef =
      nonNullValues.length > 0 &&
      nonNullValues.every((v) => isRelationId(v)) &&
      availableTables.has(targetChild);

    if (parts) {
      // choice -> logical mixed column with physical children
      const leafUi = parts.map((p) => normalizeTypeLabel(p)).join(' · ');
      const meta: Record<string, unknown> = {
        uiType: 'mixed',
        typeSummary: leafUi,
        types: parts.map((p) => normalizeTypeLabel(p)),
        sample: sampleDistinct(convertedRows, physical, 4, false),
        nullable: isNullable(convertedRows, physical),
        partial: isPartial(convertedRows, physical),
      };
      const physicalChildren: UiTreeNode[] = parts.map((part, index) => {
        const physCol = physical[index];
        return {
          kind: 'column',
          name: physCol,
          meta: {
            uiType: normalizeTypeLabel(part),
            typeSummary: normalizeTypeLabel(part),
            nullable: isNullable(convertedRows, [physCol]),
            partial: isPartial(convertedRows, [physCol]),
            sample: sampleDistinct(convertedRows, [physCol]),
          },
        };
      });
      children.push({
        kind: 'column',
        name: column,
        meta,
        children: physicalChildren,
      });
      continue;
    }

    // Non-choice column
    let meta: Record<string, unknown>;
    if (isRef) {
      meta = {
        uiType: 'ref',
        refTable: targetChild,
        cardinality: '1:N',
        sample: sampleDistinct(convertedRows, [column], 4, false),
      };
    } else {
      let columnValuesTypes = new Set<string>();
      for (const value of physicalFromRaw[column] ?? []) {
        for (const t of valueTypes(value)) {
          columnValuesTypes.add(t);
        }
      }
      if (columnValuesTypes.size === 0) {
        columnValuesTypes = new Set([normalizeTypeLabel(columnType)]);
      }
      const sorted = [...columnValuesTypes].sort(compareStrings);
      meta = {
        uiType: normalizeTypeLabel(columnType),
        typeSummary: sorted.join(' · '),
        types: sorted,
        nullable: isNullable(convertedRows, [column]),
        partial: isPartial(convertedRows, [column]),
        sample: sampleDistinct(convertedRows, [column]),
      };
    }
    children.push({ kind: 'column', name: column, meta });
  }

  children.sort((a, b) => compareStrings(a.name, b.name));
  return { kind: 'columns', name: 'Columns', children };
}

export function buildKeysUi(
  _table: string,
  rawRows: ReadonlyArray<JsonObject>,
  _convertedRows: ReadonlyArray<JsonObject>,
): UiTreeNode {
  const values = keySamples(rawRows);
  if (values.length === 0) {
    return {
      kind: 'keys',
      name: 'Keys',
      meta: { count: 0, empty: true },
      children: [],
    };
  }
  const keys: UiTreeNode[] = values.map((value) => ({
    kind: 'key',
    name: String(value),
    meta: { column: 'record_id', value },
  }));
  return {
    kind: 'keys',
    name: 'Keys',
    meta: { count: values.length, column: 'record_id' },
    children: keys,
  };
}

export function buildReferencesUi(
  table: string,
  rawRows: ReadonlyArray<JsonObject>,
  availableTables: ReadonlySet<string>,
): UiTreeNode {
  const relationIds: UiTreeNode[] = [];
  if (rawRows.length > 0) {
    for (const column of schemaColumnsForRows(rawRows)) {
      const values = rawRows
        .filter((row) => column in row && isRelationId(row[column]))
        .map((row) => row[column]);
      if (values.length === 0) {
        continue;
      }
      const target = `${table}_${column}`;
      if (availableTables.has(target)) {
        relationIds.push({
          kind: 'reference',
          name: `${table}.${column} -> ${target}`,
          meta: {
            from: `${table}.${column}`,
            to: target,
            count: values.length,
          },
        });
      }
    }
  }
  return {
    kind: 'references',
    name: 'References',
    meta: { count: relationIds.length },
    children: relationIds,
  };
}

export function schemaColumnsForRows(
  rows: ReadonlyArray<JsonObject>,
): string[] {
  const cols = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      cols.add(key);
    }
  }
  return [...cols].sort(compareStrings);
}

export function buildTypesUi(columnsNode: UiTreeNode): UiTreeNode {
  const acc = new Set<string>();
  const walk = (node: UiTreeNode): void => {
    const uiType = node.meta?.['uiType'];
    if (typeof uiType === 'string') {
      for (const part of uiType.split(' · ')) {
        if (part && part !== 'unknown') {
          acc.add(normalizeTypeLabel(part));
        }
      }
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  for (const child of columnsNode.children ?? []) {
    walk(child);
  }

  const order = [
    'string',
    'number',
    'boolean',
    'timestamp',
    'ref',
    'list',
    'map',
    'null',
  ];
  const typed = order.filter((t) => acc.has(t));
  typed.push(
    ...[...acc].filter((t) => !order.includes(t)).sort(compareStrings),
  );
  return {
    kind: 'types',
    name: 'Types',
    meta: {
      summary: typed.length ? typed.join(' · ') : 'unknown',
      count: typed.length,
    },
  };
}

/** Build the UI database root node from pipeline table outputs. */
export function buildDatabaseTree(
  databaseName: string,
  tableInfos: ReadonlyArray<TableInfo>,
): UiTreeNode {
  const availableTables = new Set(tableInfos.map((info) => info.name));
  const tables = [...tableInfos]
    .sort((a, b) => compareStrings(a.name, b.name))
    .map((info) => tableToUiTree(info, availableTables));
  return {
    kind: 'database',
    name: databaseName,
    meta: { tableCount: tables.length },
    children: tables,
  };
}
