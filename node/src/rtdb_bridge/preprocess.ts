/**
 * RTDB (Firebase Realtime Database) export preprocessing helpers.
 *
 * Ported from `rtdb_bridge/preprocess.py`.
 *
 * Firebase stores collections as *keyed maps* (`{ "-pushKey": record }`), but
 * relationalize only splits *real arrays* into child tables. Therefore every
 * keyed collection must first become an array, with the Firebase key injected
 * as the artificial `record_id` (a reserved key that pipelines use for joins).
 */
import { isPlainObject, type JsonObject } from '../relationalize/relationalize.js';

/**
 * Field names inside records that are (or can be) RTDB sub-collections keyed
 * by business ids rather than Firebase push ids (e.g. "CS101").
 */
export const DEFAULT_KNOWN_COLLECTION_FIELDS: ReadonlySet<string> = new Set([
  'orders',
  'items',
  'account_settings',
  'preferences',
  'enrolled_courses',
  'followers',
  'friends',
  'posts',
]);

/**
 * Recursively convert RTDB "keyed maps" into real JSON arrays.
 *
 * A dict is interpreted as a keyed collection when:
 *
 * * it is empty (an empty Firebase collection -> `[]`), OR
 * * every key looks like a Firebase push id ("-..."), OR
 * * `treatAsCollection` is true (the field matched a known collection field).
 *
 * For ordinary nested objects (e.g. `{ color: "red" }`) the dict is kept as an
 * object so Relationalize continues to flatten it rather than inventing a
 * child table.
 */
export function keyedMapsToArrays(
  value: unknown,
  treatAsCollection = false,
): unknown {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const pushKeyed =
      keys.length > 0 && keys.every((k) => k.startsWith('-'));

    if (keys.length === 0) {
      // An empty object in an RTDB export is almost always an empty
      // collection. Convert to [] so it cannot pollute parent columns.
      return [];
    }

    if (treatAsCollection || pushKeyed) {
      const rows: JsonObject[] = [];
      for (const [key, record] of Object.entries(value)) {
        if (isPlainObject(record)) {
          // Convert nested content first, then inject the key LAST so it
          // always remains the artificial relational id.
          const converted = keyedMapsToArrays(
            record,
            false,
          ) as JsonObject;
          if (isPlainObject(converted) && 'record_id' in converted) {
            converted['source_record_id'] = converted['record_id'];
            delete converted['record_id'];
          }
          converted['record_id'] = key;
          rows.push(converted);
        } else {
          // Keyed maps with primitive values (presence sets like
          // { "u1": true, "u5": true }) become rows with a "value".
          rows.push({ record_id: key, value: record });
        }
      }
      return rows;
    }

    // Ordinary nested object -> keep as an object, recurse into values.
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = keyedMapsToArrays(v, false);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => keyedMapsToArrays(v, false));
  }

  return value;
}

/**
 * Pull one top-level RTDB collection out of the export tree and turn it into
 * an array of flat-ish records ready for Relationalize.
 *
 * Example:
 *   `{ users: { u1: {...}, u2: {...} } }`
 *     -> `[{ record_id: "u1", ... }, { record_id: "u2", ... }]`
 */
export function extractCollectionRecords(
  collectionName: string,
  rawTree: JsonObject,
  knownCollectionFields?: Iterable<string> | null,
): JsonObject[] {
  const knownFields = new Set(
    knownCollectionFields ?? DEFAULT_KNOWN_COLLECTION_FIELDS,
  );

  if (!(collectionName in rawTree)) {
    throw new Error(
      `Collection '${collectionName}' not found in export tree. ` +
        `Available top-level collections: ${JSON.stringify(
          Object.keys(rawTree).sort(),
        )}`,
    );
  }

  const collectionMap = rawTree[collectionName];
  if (!isPlainObject(collectionMap)) {
    throw new Error(
      `Expected collection '${collectionName}' to be a keyed map ` +
        `(dict of Firebase key -> record), got ${jsTypeName(collectionMap)}.`,
    );
  }

  const records: JsonObject[] = [];
  for (const [key, rawRecord] of Object.entries(collectionMap)) {
    // Never let a source payload field named record_id overwrite the
    // artificial RTDB row key - preserve the payload value instead.
    const record: JsonObject = isPlainObject(rawRecord)
      ? { ...rawRecord }
      : { value: rawRecord };
    if ('record_id' in record) {
      record['source_record_id'] = record['record_id'];
      delete record['record_id'];
    }

    const row: JsonObject = { record_id: key };
    for (const [field, fieldValue] of Object.entries(record)) {
      const isCollectionField = knownFields.has(field);
      row[field] = keyedMapsToArrays(fieldValue, isCollectionField);
    }
    records.push(row);
  }

  return records;
}

/** JS counterpart to Python's `type(x).__name__` for error messages. */
function jsTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  return typeof value;
}
