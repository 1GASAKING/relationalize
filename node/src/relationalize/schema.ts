import {
  isChoiceColumnType,
  type BaseSupportedColumnType,
  type ChoiceColumnType,
  type ColumnType,
} from './types.js';
import { PostgresDialect, type SQLDialect } from './sqlDialects.js';

/**
 * A choice-supporting schema for a flattened JSON object.
 *
 * Ported 1:1 from `relationalize/schema.py`.
 */
export const CHOICE_SEQUENCE = 'c-';
export const CHOICE_DELIMITER = '-';

/** Characters (beyond alphanumerics) allowed in a column name. */
export const ALLOWED_COLUMN_CHARS: ReadonlySet<string> = new Set([
  ' ',
  '-',
  '_',
]);

export const DEFAULT_SQL_DIALECT = new PostgresDialect() as SQLDialect<unknown>;

/** Python's `str.isalnum()` for a single character (Unicode aware). */
function isAlnum(char: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(char);
}

/** Approximate `type(value)` label used for unsupported column types. */
function pythonTypeName(value: unknown): string {
  if (value === null || value === undefined) return "<class 'NoneType'>";
  if (Array.isArray(value)) return "<class 'list'>";
  switch (typeof value) {
    case 'boolean':
      return "<class 'bool'>";
    case 'number':
      return "<class 'int'>";
    case 'string':
      return "<class 'str'>";
    default:
      return "<class 'dict'>";
  }
}

/** Compare two strings by Unicode code point (Python's default ordering). */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  const iterA = a[Symbol.iterator]();
  const iterB = b[Symbol.iterator]();
  for (;;) {
    const nextA = iterA.next();
    const nextB = iterB.next();
    if (nextA.done && nextB.done) return 0;
    if (nextA.done) return -1;
    if (nextB.done) return 1;
    const ca = nextA.value.codePointAt(0) ?? 0;
    const cb = nextB.value.codePointAt(0) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

export class Schema<DialectColumnType = unknown> {
  schema: Record<string, ColumnType>;
  sqlDialect: SQLDialect<DialectColumnType>;

  constructor(
    schema?: Record<string, ColumnType>,
    sqlDialect: SQLDialect<DialectColumnType> = DEFAULT_SQL_DIALECT as SQLDialect<DialectColumnType>,
  ) {
    this.schema = schema ?? {};
    this.sqlDialect = sqlDialect;
  }

  /**
   * Convert a given object according to the schema. Splits choice-columns into
   * N separate columns and renames keys accordingly.
   *
   * Chooses between schema-iteration and object-iteration depending on which
   * one will be more efficient.
   */
  convertObject(record: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(this.schema).length > Object.keys(record).length) {
      return this.#convertObjectObjectIteration(record);
    }
    return this.#convertObjectSchemaIteration(record);
  }

  #convertObjectSchemaIteration(
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    const outputObject: Record<string, unknown> = {};
    for (const [key, valueType] of Object.entries(this.schema)) {
      if (!(key in record)) {
        continue;
      }
      const objectValue = record[key];
      if (objectValue === null || objectValue === undefined) {
        outputObject[key] = objectValue;
        continue;
      }
      if (isChoiceColumnType(valueType)) {
        const objectValueType = Schema.parseType(objectValue);
        // Python uses `not in` on a str, i.e. a substring check.
        if (!(valueType as string).includes(objectValueType)) {
          throw new Error(
            'Unknown type found within object. But not within the schema.\n' +
              `schema types: ${valueType}\n` +
              `object type: ${objectValueType}`,
          );
        }
        outputObject[`${key}_${objectValueType}`] = objectValue;
        continue;
      }
      outputObject[key] = objectValue;
    }
    return outputObject;
  }

  #convertObjectObjectIteration(
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    const outputObject: Record<string, unknown> = {};
    for (const [key, objectValue] of Object.entries(record)) {
      if (objectValue === null || objectValue === undefined) {
        outputObject[key] = objectValue;
        continue;
      }
      if (!(key in this.schema)) {
        continue;
      }
      const valueType = this.schema[key];
      if (isChoiceColumnType(valueType)) {
        const objectValueType = Schema.parseType(objectValue);
        if (!(valueType as string).includes(objectValueType)) {
          throw new Error(
            'Unknown type found within object. But not within the schema.\n' +
              `schema types: ${valueType}\n` +
              `object type: ${objectValueType}`,
          );
        }
        outputObject[`${key}_${objectValueType}`] = objectValue;
        continue;
      }
      outputObject[key] = objectValue;
    }
    return outputObject;
  }

  /** Generates the columns that will be in the output of `convertObject`. */
  generateOutputColumns(): string[] {
    const columns: string[] = [];
    for (const [key, valueType] of Object.entries(this.schema)) {
      if (!(valueType as string).includes(CHOICE_SEQUENCE)) {
        columns.push(key);
        continue;
      }
      for (const choiceType of (valueType as string)
        .slice(2)
        .split(CHOICE_DELIMITER)) {
        if (choiceType === 'none') {
          continue;
        }
        columns.push(`${key}_${choiceType}`);
      }
    }
    columns.sort(compareStrings);
    return columns;
  }

  /**
   * Generates a CREATE TABLE statement for this schema, breaking out choice
   * columns into separate columns.
   */
  generateDdl(table: string, schema = 'public'): string {
    const columns: string[] = [];
    for (const [key, valueType] of Object.entries(this.schema)) {
      if (!(valueType as string).includes(CHOICE_SEQUENCE)) {
        columns.push(
          this.sqlDialect.generateDdlColumn(
            key,
            this.sqlDialect.typeColumnMapping[valueType as BaseSupportedColumnType],
          ),
        );
        continue;
      }
      for (const choiceType of (valueType as string)
        .slice(2)
        .split(CHOICE_DELIMITER)) {
        if (choiceType === 'none') {
          continue;
        }
        columns.push(
          this.sqlDialect.generateDdlColumn(
            `${key}_${choiceType}`,
            this.sqlDialect.typeColumnMapping[choiceType as BaseSupportedColumnType],
          ),
        );
      }
    }
    columns.sort(compareStrings);
    return this.sqlDialect.generateDdl(schema, table, columns);
  }

  /** Drops none-typed columns. Returns the number of columns dropped. */
  dropNullColumns(): number {
    const columnsToDrop: string[] = [];
    for (const [key, value] of Object.entries(this.schema)) {
      if (value === 'none') {
        columnsToDrop.push(key);
      }
    }
    for (const column of columnsToDrop) {
      delete this.schema[column];
    }
    return columnsToDrop.length;
  }

  /**
   * Drops columns which have a non-alphanumeric in their name. `allowedChars`
   * defines any additional characters which are allowed (defaults to spaces,
   * dashes and underscores). Returns the number of columns dropped.
   */
  dropSpecialCharColumns(
    allowedChars: ReadonlySet<string> = ALLOWED_COLUMN_CHARS,
  ): number {
    const columnsToDrop: string[] = [];
    for (const key of Object.keys(this.schema)) {
      if ([...key].some((c) => !(isAlnum(c) || allowedChars.has(c)))) {
        columnsToDrop.push(key);
      }
    }
    for (const column of columnsToDrop) {
      delete this.schema[column];
    }
    return columnsToDrop.length;
  }

  /**
   * Drops columns which have a duplicate (case-insensitive) match. Keeps the
   * first column it reads. Returns the number of columns dropped.
   */
  dropDuplicateColumns(): number {
    const lowercasedKeys = new Set<string>();
    const columnsToDrop: string[] = [];
    for (const key of Object.keys(this.schema)) {
      const folded = key.toLowerCase();
      if (!lowercasedKeys.has(folded)) {
        lowercasedKeys.add(folded);
      } else {
        columnsToDrop.push(key);
      }
    }
    for (const column of columnsToDrop) {
      delete this.schema[column];
    }
    return columnsToDrop.length;
  }

  /** Read an object and merge into the current schema. */
  readObject(record: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(record)) {
      this.#readWriteObjectKey(key, value);
    }
  }

  /** Serialize this schema to a string. */
  serialize(): string {
    return JSON.stringify(this.schema);
  }

  /** Create a new Schema from a serialized schema. */
  static deserialize<DialectColumnType = unknown>(
    content: string,
  ): Schema<DialectColumnType> {
    return new Schema<DialectColumnType>(
      JSON.parse(content) as Record<string, ColumnType>,
    );
  }

  #readWriteObjectKey(key: string, value: unknown): void {
    const valueType = Schema.parseType(value);
    if (!(key in this.schema)) {
      this.schema[key] = valueType;
      return;
    }
    if (this.schema[key] === valueType) {
      return;
    }
    if (this.schema[key] === 'none') {
      this.schema[key] = valueType;
      return;
    }
    if (valueType === 'none') {
      return;
    }
    if ((this.schema[key] as string).slice(0, 2) === CHOICE_SEQUENCE) {
      if ((this.schema[key] as string).includes(valueType)) {
        return;
      }
      this.schema[key] =
        `${this.schema[key]}${CHOICE_DELIMITER}${valueType}` as ChoiceColumnType;

      const choices = (this.schema[key] as string)
        .split(CHOICE_DELIMITER)
        .slice(1);
      const noneIndex = choices.indexOf('none');
      if (noneIndex !== -1) {
        choices.splice(noneIndex, 1);
      }
      if (choices.length === 1) {
        this.schema[key] = choices[0] as BaseSupportedColumnType;
        return;
      }
      this.schema[key] = `${CHOICE_SEQUENCE}${[...choices]
        .sort(compareStrings)
        .join(CHOICE_DELIMITER)}` as ChoiceColumnType;
      return;
    }
    this.schema[key] = `${CHOICE_SEQUENCE}${[
      this.schema[key] as string,
      valueType,
    ]
      .sort(compareStrings)
      .join(CHOICE_DELIMITER)}` as ChoiceColumnType;
  }

  /**
   * Create a new Schema object from multiple serialized schemas, merging them
   * together.
   */
  static merge(...schemas: Array<Record<string, ColumnType>>): Schema {
    const mergedSchema: Record<string, ColumnType> = {};
    for (const schema of schemas) {
      for (const [key, valueType] of Object.entries(schema)) {
        if (!(key in mergedSchema)) {
          mergedSchema[key] = valueType;
          continue;
        }
        if (valueType === mergedSchema[key]) {
          continue;
        }

        const choices = new Set<string>();
        const addChoices = (type: string): void => {
          if (type.includes(CHOICE_SEQUENCE)) {
            for (const t of type.slice(2).split(CHOICE_DELIMITER)) {
              if (t === 'none') continue;
              choices.add(t);
            }
          } else {
            choices.add(type);
          }
        };
        addChoices(mergedSchema[key] as string);
        addChoices(valueType as string);

        choices.delete('none');
        if (choices.size === 0) {
          mergedSchema[key] = 'none';
          continue;
        }
        if (choices.size === 1) {
          mergedSchema[key] = [...choices][0] as BaseSupportedColumnType;
          continue;
        }
        mergedSchema[key] = `${CHOICE_SEQUENCE}${[...choices]
          .sort(compareStrings)
          .join(CHOICE_DELIMITER)}` as ChoiceColumnType;
      }
    }
    return new Schema(mergedSchema);
  }

  /** Get the relationalize column type of a given value. */
  static parseType(value: unknown): ColumnType {
    if (typeof value === 'boolean') {
      return 'bool';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'int' : 'float';
    }
    if (typeof value === 'string') {
      return 'str';
    }
    if (value === null || value === undefined) {
      return 'none';
    }
    return `unsupported:${pythonTypeName(value)}`;
  }
}
