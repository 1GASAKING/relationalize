import type { SupportedColumnType } from './types.js';

/**
 * SQL dialect abstraction. Ported from `relationalize/sql_dialects.py`.
 */
export const COLUMN_SEPARATOR = '\n    , ';

export abstract class SQLDialect<DialectColumnType> {
  /** Mapping of relationalize column types -> dialect SQL types. */
  abstract typeColumnMapping: Record<SupportedColumnType, DialectColumnType>;

  /** Template containing `{schema}`, `{table_name}` and `{columns}`. */
  abstract baseDdl: string;

  /** Render a single column definition for a `CREATE TABLE` statement. */
  abstract generateDdlColumn(
    columnName: string,
    columnType: DialectColumnType,
  ): string;

  /**
   * Generates a complete "Create Table" statement given the schema,
   * table_name, and column definitions.
   */
  generateDdl(schema: string, tableName: string, columns: string[]): string {
    const columnsStr = columns.join(COLUMN_SEPARATOR);
    return this.baseDdl
      .replaceAll('{schema}', schema)
      .replaceAll('{table_name}', tableName)
      .replaceAll('{columns}', columnsStr);
  }
}

/** The concrete column types emitted by {@link PostgresDialect}. */
export type PostgresColumn =
  | 'BIGINT'
  | 'BOOLEAN'
  | 'FLOAT'
  | 'TIMESTAMP'
  | 'VARCHAR(65535)';

/** Inherits from {@link SQLDialect} and implements the postgres syntax. */
export class PostgresDialect extends SQLDialect<PostgresColumn> {
  override typeColumnMapping: Record<SupportedColumnType, PostgresColumn> = {
    int: 'BIGINT',
    datetime: 'TIMESTAMP',
    float: 'FLOAT',
    str: 'VARCHAR(65535)',
    bool: 'BOOLEAN',
    none: 'BOOLEAN',
  };

  override baseDdl =
    'CREATE TABLE IF NOT EXISTS "{schema}"."{table_name}" (\n' +
    '    {columns}\n' +
    ');';

  override generateDdlColumn(
    columnName: string,
    columnType: PostgresColumn,
  ): string {
    const cleanedColumnName = columnName.replaceAll('"', '""');
    return `"${cleanedColumnName}" ${columnType}`;
  }
}
