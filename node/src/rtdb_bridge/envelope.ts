/**
 * Build the canonical Python -> TS (now Node -> TS) envelope.
 *
 * Ported from `rtdb_bridge/envelope.py`. The envelope mirrors the TypeScript
 * contracts referenced by the VS Code extension and is the single object
 * returned by {@link convertExportToEnvelope}:
 *
 * ```
 * {
 *   envelopeVersion: 1,
 *   generator: { name: 'rtdb-bridge', version: '0.1.0', pipelineVersion: 1 },
 *   source: { format: 'rtdb-export-json', name: '...', ... },
 *   database: DatabaseSchema,     // canvas contract
 *   tree: [SchemaTreeNode],       // explorer tree
 *   sql: { dialect: 'postgres', tables: [...] },
 *   warnings: [...]
 * }
 * ```
 */
import type { BaseSupportedColumnType } from '../relationalize/types.js';
import type { JsonObject } from '../relationalize/relationalize.js';
import { Schema } from '../relationalize/index.js';
import { PostgresDialect } from '../relationalize/sqlDialects.js';

import {
  GENERATOR_NAME,
  POSTGRES_TYPE_MAPPING,
  choiceParts,
  normalizeTypeLabel,
} from './contracts.js';
import {
  ExportPipelineResult,
  TableInfo,
  relationalizeExport,
} from './pipeline.js';
import { buildDatabaseTree } from './uiTree.js';
import { loadSchema } from './schemas.js';
import {
  validateInstance,
  type SchemaRegistry,
} from './jsonSchema.js';
import { version as packageVersion } from './version.js';

export const ENVELOPE_VERSION = 1;
export const PIPELINE_VERSION = 1;
export { GENERATOR_NAME };
export const SOURCE_FORMAT = 'rtdb-export-json';
export const DEFAULT_DIALECT = 'postgres';
export const DEFAULT_SCHEMA_NAME = 'public';

const POSTGRES_DIALECT = new PostgresDialect();

/** Map a relationalize raw type to the dialect SQL column type. */
function columnSqlType(rawType: string): string {
  return (
    POSTGRES_TYPE_MAPPING[rawType as BaseSupportedColumnType] ??
    'VARCHAR(65535)'
  );
}

/** Build the physical member objects for a logical choice/mixed column. */
function buildChoiceMembers(
  rawRows: ReadonlyArray<JsonObject>,
  cleanSchema: Schema,
  column: string,
  parts: string[],
): Array<Record<string, unknown>> {
  const converted = rawRows.map((row) => cleanSchema.convertObject(row));
  const members: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (part === 'none') {
      continue;
    }
    const physName = `${column}_${part}`;
    const values = converted.map((row) => row[physName]);
    members.push({
      name: physName,
      type: normalizeTypeLabel(part),
      sqlType: columnSqlType(part),
      nullable: values.length
        ? values.some((v) => v === null || v === undefined)
        : false,
      partial: converted.some((row) => !(physName in row)),
    });
  }
  return members;
}

/** Convert one pipeline table into a DatabaseSchema table object. */
function buildDatabaseTable(
  tableInfo: TableInfo,
  availableTables: ReadonlySet<string>,
): Record<string, unknown> {
  const clean = tableInfo.cleanSchema();
  const rawRows = tableInfo.rows;
  const converted = rawRows.map((row) => clean.convertObject(row));

  const columns: Array<Record<string, unknown>> = [];
  for (const [column, rawType] of Object.entries(clean.schema)) {
    const parts = choiceParts(rawType);
    if (parts) {
      const members = buildChoiceMembers(rawRows, clean, column, parts);
      columns.push({
        name: column,
        type: 'mixed',
        uiType: 'mixed',
        types: parts.map((p) => normalizeTypeLabel(p)),
        sqlType: null,
        nullable: members.length
          ? members.some((m) => m['nullable'] === true)
          : false,
        partial: members.length
          ? members.some((m) => m['partial'] === true)
          : false,
        choiceOf: members,
      });
      continue;
    }

    const values = converted.map((row) => row[column]);
    const uiType = normalizeTypeLabel(rawType);
    columns.push({
      name: column,
      type: uiType,
      uiType,
      sqlType: columnSqlType(rawType),
      nullable: values.length
        ? values.some((v) => v === null || v === undefined) ||
          converted.some((row) => !(column in row))
        : false,
      partial: converted.some((row) => !(column in row)),
    });
  }

  const foreignKeys: Array<Record<string, unknown>> = [];
  for (const colObj of columns) {
    const colName = colObj['name'] as string;
    const childName = `${tableInfo.name}_${colName}`;
    if (availableTables.has(childName)) {
      foreignKeys.push({
        name: `${tableInfo.name}_${colName}_fk`,
        column: colName,
        refTable: childName,
        refColumn: 'record_id',
        cardinality: '1:N',
      });
    }
  }

  return {
    name: tableInfo.name,
    type: 'table',
    sourceCollection: null,
    rowCount: rawRows.length,
    columnCount: columns.length,
    columns,
    primaryKey: ['record_id'],
    indexes: [],
    foreignKeys,
  };
}

/** Build the DatabaseSchema canvas contract from pipeline table outputs. */
export function buildDatabaseSchema(
  databaseName: string,
  pipelineResult: ExportPipelineResult,
): Record<string, unknown> {
  const availableTables = new Set(pipelineResult.tables.keys());
  const tables = [...pipelineResult.tables.values()].map((info) =>
    buildDatabaseTable(info, availableTables),
  );
  tables.sort((a, b) =>
    (a['name'] as string) < (b['name'] as string)
      ? -1
      : a['name'] === b['name']
        ? 0
        : 1,
  );
  return {
    name: databaseName,
    tables,
  };
}

/** Build one table object within the SQL contract. */
function buildSqlTable(tableInfo: TableInfo): Record<string, unknown> {
  const clean = tableInfo.cleanSchema();
  const ddl = clean.generateDdl(tableInfo.name);

  const columns: Array<Record<string, unknown>> = [];
  for (const [column, rawType] of Object.entries(clean.schema)) {
    const parts = choiceParts(rawType);
    if (parts) {
      const choiceOf: Array<Record<string, unknown>> = [];
      for (const part of parts) {
        if (part === 'none') {
          continue;
        }
        const physName = `${column}_${part}`;
        choiceOf.push({
          type: part,
          sqlType: columnSqlType(part),
          columnName: physName,
          nullable: true,
          partial: true,
        });
      }
      columns.push({
        name: column,
        rawType,
        sqlType: null,
        choiceOf,
      });
    } else {
      columns.push({
        name: column,
        rawType,
        sqlType: columnSqlType(rawType),
      });
    }
  }

  columns.sort((a, b) =>
    (a['name'] as string) < (b['name'] as string)
      ? -1
      : a['name'] === b['name']
        ? 0
        : 1,
  );
  return {
    name: tableInfo.name,
    schemaName: DEFAULT_SCHEMA_NAME,
    ddl,
    rowCount: tableInfo.rows.length,
    columns,
  };
}

/** Build SQL DDL metadata contract from pipeline schema outputs. */
export function buildSqlContract(
  pipelineResult: ExportPipelineResult,
): Record<string, unknown> {
  return {
    dialect: DEFAULT_DIALECT,
    tables: [...pipelineResult.tables.values()]
      .sort((a, b) =>
        a.name < b.name ? -1 : a.name === b.name ? 0 : 1,
      )
      .map((info) => buildSqlTable(info)),
  };
}

function buildSourceInfo(
  sourceName: string | null | undefined,
  pipelineResult: ExportPipelineResult,
): Record<string, unknown> {
  const recordCount = pipelineResult.collections.reduce(
    (sum, c) => sum + c.recordCount,
    0,
  );
  return {
    format: SOURCE_FORMAT,
    name: sourceName ?? null,
    recordCount,
    collectionCount: pipelineResult.collections.length,
  };
}

export interface EnvelopeWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RtdbBridgeEnvelope {
  envelopeVersion: number;
  generator: Record<string, unknown>;
  source: Record<string, unknown>;
  database: Record<string, unknown>;
  tree: Array<Record<string, unknown>>;
  sql: Record<string, unknown>;
  warnings: EnvelopeWarning[];
  [key: string]: unknown;
}

function comparePaths(
  a: Array<string | number>,
  b: Array<string | number>,
): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    return String(left) < String(right) ? -1 : 1;
  }
  return 0;
}

/**
 * Assemble the full envelope from pipeline outputs.
 *
 * When `validate` is true the envelope is validated against
 * `rtdb-bridge.schema.json` (and its cross-file `$ref`s); schema drift is
 * surfaced as a warning rather than a crash, exactly like the Python bridge.
 */
export function buildEnvelope(
  databaseName: string,
  pipelineResult: ExportPipelineResult,
  sourceName?: string | null,
  validate = true,
): RtdbBridgeEnvelope {
  const warnings: EnvelopeWarning[] = [];

  const envelope: RtdbBridgeEnvelope = {
    envelopeVersion: ENVELOPE_VERSION,
    generator: {
      name: GENERATOR_NAME,
      version: packageVersion,
      pipelineVersion: PIPELINE_VERSION,
    },
    source: buildSourceInfo(sourceName, pipelineResult),
    database: buildDatabaseSchema(databaseName, pipelineResult),
    tree: [
      buildDatabaseTree(databaseName, [
        ...pipelineResult.tables.values(),
      ]) as unknown as Record<string, unknown>,
    ],
    sql: buildSqlContract(pipelineResult),
    warnings,
  };

  if (validate) {
    validateEnvelope(envelope, warnings);
  }

  return envelope;
}

/** Validate the envelope against the canonical schema, collecting warnings. */
export function validateEnvelope(
  envelope: RtdbBridgeEnvelope,
  warnings: EnvelopeWarning[],
): void {
  const schema = loadSchema('rtdb-bridge');

  // Register every sibling canonical schema by its absolute $id so
  // cross-file $refs resolve - the Node analogue of the Python `Registry`.
  const registry: SchemaRegistry = new Map();
  registry.set(
    'https://dbchart.dev/contracts/database.schema.json',
    loadSchema('database'),
  );
  registry.set(
    'https://dbchart.dev/contracts/schema-tree.schema.json',
    loadSchema('schema-tree'),
  );
  registry.set(
    'https://dbchart.dev/contracts/sql.schema.json',
    loadSchema('sql'),
  );

  const errors = validateInstance(envelope, schema, registry);
  errors.sort((a, b) => comparePaths(a.path, b.path));

  for (const exc of errors) {
    warnings.push({
      code: 'schema-validation-failed',
      message:
        'Envelope failed validation against rtdb-bridge.schema.json: ' +
        exc.message,
      details: {
        path: exc.path,
        validator: exc.validator,
      },
    });
  }
}

/**
 * Full bridge: raw RTDB export JSON -> the canonical UI envelope.
 *
 * This is the primary entry point for the dbchart extension host and for the
 * Node worker.
 *
 * @param exportTree Parsed Firebase RTDB export JSON. Each top-level key is a
 *   collection name whose value is a dict of Firebase key -> record.
 * @param databaseName Display name for the database/canvas root. Defaults to
 *   `"rtdb_to_sql"`.
 * @param sourceName Optional original export / database name recorded in
 *   `source`. Defaults to `databaseName`.
 * @param knownCollectionFields Optional field-name set marking keyed maps
 *   collections keyed by business ids. Defaults to
 *   `DEFAULT_KNOWN_COLLECTION_FIELDS`.
 * @param validate Controls optional JSON-schema validation of the envelope.
 */
export function convertExportToEnvelope(
  exportTree: JsonObject,
  databaseName?: string | null,
  sourceName?: string | null,
  knownCollectionFields?: Iterable<string> | null,
  validate = true,
): RtdbBridgeEnvelope {
  const resolvedDatabaseName = databaseName ?? 'rtdb_to_sql';
  const resolvedSourceName = sourceName ?? resolvedDatabaseName;

  const pipelineResult = relationalizeExport(
    exportTree,
    knownCollectionFields,
  );
  return buildEnvelope(
    resolvedDatabaseName,
    pipelineResult,
    resolvedSourceName,
    validate,
  );
}
