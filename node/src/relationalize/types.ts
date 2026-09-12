/**
 * Column-type vocabulary.
 *
 * Ported 1:1 from `relationalize/types.py`.
 *
 * ```
 * unsupported:[type]
 * c-{hyphen-delimited choice type list}
 * ```
 */

/** A concrete, non-ambiguous column type. Mirrors `BaseSupportedColumnType`. */
export type BaseSupportedColumnType =
  | 'bool'
  | 'datetime'
  | 'float'
  | 'int'
  | 'none'
  | 'str';

/** `c-{hyphen-delimited choice type list}` (e.g. `c-int-str`). */
export type ChoiceColumnType = `c-${string}`;

/** `unsupported:[type]` - a value whose type relationalize cannot represent. */
export type UnsupportedColumnType = `unsupported:${string}`;

/** `BaseSupportedColumnType | ChoiceColumnType` - mirrors `SupportedColumnType`. */
export type SupportedColumnType = BaseSupportedColumnType | ChoiceColumnType;

/** `SupportedColumnType | UnsupportedColumnType` - mirrors `ColumnType`. */
export type ColumnType = SupportedColumnType | UnsupportedColumnType;

export const CHOICE_SEQUENCE = 'c-';
export const UNSUPPORTED_SEQUENCE = 'unsupported:';

/** Type guard mirroring `is_choice_column_type`. */
export function isChoiceColumnType(column: string): column is ChoiceColumnType {
  return column.startsWith(CHOICE_SEQUENCE);
}

/** Type guard mirroring `is_unsupported_column_type`. */
export function isUnsupportedColumnType(
  column: string,
): column is UnsupportedColumnType {
  return column.startsWith(UNSUPPORTED_SEQUENCE);
}
