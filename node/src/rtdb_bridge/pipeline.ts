/**
 * Core RTDB export -> relational tables pipeline.
 *
 * Ported from `rtdb_bridge/pipeline.py`. Wraps `relationalize` + `Schema`
 * together with in-memory buffers so a whole Firebase RTDB export can be
 * processed into a dict of SQL-ready tables without touching disk.
 */
import {
  Relationalize,
  Schema,
  createLocalBuffer,
  isPlainObject,
  type JsonObject,
  type StringIO,
} from '../relationalize/index.js';

import { extractCollectionRecords } from './preprocess.js';

/** Metadata about one top-level RTDB collection. */
export class CollectionInfo {
  name: string;
  recordCount = 0;
  childTableCount = 0;
  tableNames: string[] = [];

  constructor(init: Partial<CollectionInfo> & { name: string }) {
    this.name = init.name;
    this.recordCount = init.recordCount ?? 0;
    this.childTableCount = init.childTableCount ?? 0;
    this.tableNames = init.tableNames ?? [];
  }
}

/** Schema + rows for one produced relational table. */
export class TableInfo {
  name: string;
  schema: Schema;
  rows: JsonObject[];

  constructor(name: string, schema: Schema, rows: JsonObject[]) {
    this.name = name;
    this.schema = schema;
    this.rows = rows;
  }

  /** Return a copy of the schema with null-only columns removed. */
  cleanSchema(): Schema {
    const clean = new Schema(structuredClone(this.schema.schema));
    clean.dropNullColumns();
    return clean;
  }
}

/** A detected 1:N relation between a parent column and a child table. */
export class RelationRef {
  fromTable: string;
  column: string;
  toTable: string;
  columnCount: number;

  constructor(init: RelationRef) {
    this.fromTable = init.fromTable;
    this.column = init.column;
    this.toTable = init.toTable;
    this.columnCount = init.columnCount;
  }
}

/** Everything produced by running the full RTDB export pipeline. */
export class ExportPipelineResult {
  tables = new Map<string, TableInfo>();
  relations: RelationRef[] = [];
  collections: CollectionInfo[] = [];

  /** Sorted list of produced table names. */
  get tableNames(): string[] {
    return [...this.tables.keys()].sort();
  }

  table(name: string): TableInfo | undefined {
    return this.tables.get(name);
  }

  mergedSchemas(): Map<string, Schema> {
    return new Map(
      [...this.tables.entries()].map(([name, info]) => [name, info.schema]),
    );
  }

  mergedResults(): Map<string, JsonObject[]> {
    return new Map(
      [...this.tables.entries()].map(([name, info]) => [name, info.rows]),
    );
  }
}

/**
 * Detect an RID emitted by relationalize
 * (e.g. `R_2d0418f3b5de415086f1297cf0a9d9a5`).
 */
export function isRelationId(value: unknown): boolean {
  return (
    typeof value === 'string' && value.startsWith('R_') && value.length === 34
  );
}

/**
 * Scan a parent table's rows for RID columns that point at child tables
 * produced by relationalize (`<parent>_<column>`).
 */
function detectRelations(
  tableName: string,
  rows: JsonObject[],
  availableTables: ReadonlySet<string>,
): RelationRef[] {
  const relations: RelationRef[] = [];
  if (rows.length === 0) {
    return relations;
  }
  const candidateCols = [
    ...new Set(rows.flatMap((row) => Object.keys(row))),
  ].sort();
  for (const column of candidateCols) {
    const values = rows
      .filter((row) => column in row)
      .map((row) => row[column]);
    if (values.length === 0) {
      continue;
    }
    if (!values.every((v) => isRelationId(v))) {
      continue;
    }
    const target = `${tableName}_${column}`;
    if (availableTables.has(target)) {
      relations.push(
        new RelationRef({
          fromTable: tableName,
          column,
          toTable: target,
          columnCount: values.length,
        }),
      );
    }
  }
  return relations;
}

/** Run relationalize + Schema over preprocessed records for one collection. */
export function runPipeline(
  collectionName: string,
  records: JsonObject[],
): [Record<string, Schema>, Record<string, JsonObject[]>] {
  const schemas: Record<string, Schema> = {};

  const onObjectWrite = (schemaName: string, obj: JsonObject): void => {
    if (!(schemaName in schemas)) {
      schemas[schemaName] = new Schema();
    }
    schemas[schemaName].readObject(obj);
  };

  const results: Record<string, JsonObject[]> = {};
  const r = new Relationalize(
    collectionName,
    createLocalBuffer(),
    onObjectWrite,
  );
  r.relationalize(records);
  // Drain in-memory buffers BEFORE closing them.
  for (const [schemaName, buffer] of Object.entries(r.outputs)) {
    const sio = buffer as StringIO;
    sio.seek(0);
    results[schemaName] = sio
      .readlines()
      .map((line) => JSON.parse(line) as JsonObject);
  }
  r.closeIo();

  return [schemas, results];
}

/**
 * Convert a raw RTDB export tree into relational tables.
 *
 * `exportTree` is the parsed RTDB export JSON. Each top-level key is a
 * collection name whose value is a dict of Firebase key -> record.
 */
export function relationalizeExport(
  exportTree: JsonObject,
  knownCollectionFields?: Iterable<string> | null,
): ExportPipelineResult {
  const known =
    knownCollectionFields != null ? new Set(knownCollectionFields) : undefined;

  const result = new ExportPipelineResult();

  for (const collectionName of Object.keys(exportTree)) {
    if (!isPlainObject(exportTree[collectionName])) {
      // Top-level primitive (e.g. { "version": 1 }) - not a collection.
      continue;
    }

    const records = extractCollectionRecords(
      collectionName,
      exportTree,
      known,
    );
    const [schemas, results] = runPipeline(collectionName, records);

    const collectionTableNames = Object.keys(results).sort();
    const childTableNames = collectionTableNames.filter(
      (name) => name !== collectionName,
    );

    result.collections.push(
      new CollectionInfo({
        name: collectionName,
        recordCount: records.length,
        childTableCount: childTableNames.length,
        tableNames: collectionTableNames,
      }),
    );

    for (const [tableName, rows] of Object.entries(results)) {
      result.tables.set(
        tableName,
        new TableInfo(tableName, schemas[tableName], rows),
      );
    }
  }

  // Detect relations across all parent tables.
  const availableTables = new Set(result.tables.keys());
  for (const [tableName, info] of result.tables.entries()) {
    result.relations.push(
      ...detectRelations(tableName, info.rows, availableTables),
    );
  }

  return result;
}
