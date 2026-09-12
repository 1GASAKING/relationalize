/**
 * `relationalize` - transform collections of JSON objects into a
 * relational-friendly format.
 *
 * TypeScript port of the `relationalize` Python package
 * (`relationalize/__init__.py`).
 */
export {
  Relationalize,
  DELIMITER,
  ID,
  ID_PREFIX,
  INDEX,
  VAL,
  isPlainObject,
  type CreateOutput,
  type JsonObject,
  type OnObjectWrite,
} from './relationalize.js';

export {
  Schema,
  ALLOWED_COLUMN_CHARS,
  CHOICE_DELIMITER,
  CHOICE_SEQUENCE,
  DEFAULT_SQL_DIALECT,
  compareStrings,
} from './schema.js';

export {
  PostgresDialect,
  SQLDialect,
  COLUMN_SEPARATOR,
  type PostgresColumn,
} from './sqlDialects.js';

export {
  createLocalBuffer,
  createLocalFile,
  noOp,
  FileBuffer,
  StringIO,
  type TextIO,
} from './utils.js';

export {
  UNSUPPORTED_SEQUENCE,
  isChoiceColumnType,
  isUnsupportedColumnType,
  type BaseSupportedColumnType,
  type ChoiceColumnType,
  type ColumnType,
  type SupportedColumnType,
  type UnsupportedColumnType,
} from './types.js';
