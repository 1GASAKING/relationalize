/**
 * Canonical JSON Schema contract loader.
 *
 * Ported from `rtdb_bridge/schemas/__init__.py`. The documents are bundled
 * (generated) rather than read from disk, but `loadSchema` returns a fresh
 * clone on every call just like `json.load` did in Python.
 */
import {
  SCHEMA_DOCUMENTS,
  SCHEMA_FILENAMES,
  type SchemaName,
} from './schemaData.js';

export { SCHEMA_FILENAMES };
export type { SchemaName };

/**
 * Load a canonical schema by short name (`database`, `schema-tree`, `sql`, or
 * `rtdb-bridge`).
 */
export function loadSchema(name: string): Record<string, unknown> {
  if (!(name in SCHEMA_DOCUMENTS)) {
    throw new Error(
      `Unknown schema '${name}'. Expected one of: ${JSON.stringify(
        Object.keys(SCHEMA_FILENAMES).sort(),
      )}`,
    );
  }
  return structuredClone(SCHEMA_DOCUMENTS[name as SchemaName]);
}

/** Load every canonical schema keyed by short name. */
export function loadAllSchemas(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of Object.keys(SCHEMA_FILENAMES)) {
    out[name] = loadSchema(name);
  }
  return out;
}
