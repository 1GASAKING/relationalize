# relationalize (Node / TypeScript)

A **full TypeScript port** of the `relationalize` Python library and its
`rtdb_bridge` companion. It turns Firebase Realtime Database export JSON into
normalized, SQL-ready relational tables and emits the same canonical bridge
envelope consumed by the dbchart UI:

```
RTDB export.json
      │
      ▼
rtdb_bridge.convertExportToEnvelope(...)
      │
      ▼
{ envelopeVersion, generator, source,
  database,   // canvas contract   (database.schema.json)
  tree,       // explorer contract (schema-tree.schema.json)
  sql,        // DDL + type info   (sql.schema.json)
  warnings }
```

Everything — the relationalization algorithm, `Schema`/choice-column handling,
the Postgres dialect, RTDB preprocessing, the UI tree builder, and envelope
validation — runs entirely in Node. There is **no Python dependency at
runtime**.

> The Python package at the repository root is kept as the reference
> implementation. `npm run parity` proves the two produce identical envelopes.

## Layout

| Path | Python counterpart |
|---|---|
| `src/relationalize/relationalize.ts` | `relationalize/relationalize.py` |
| `src/relationalize/schema.ts` | `relationalize/schema.py` |
| `src/relationalize/sqlDialects.ts` | `relationalize/sql_dialects.py` |
| `src/relationalize/types.ts` | `relationalize/types.py` |
| `src/relationalize/utils.ts` | `relationalize/utils.py` |
| `src/rtdb_bridge/contracts.ts` | `rtdb_bridge/contracts.py` |
| `src/rtdb_bridge/preprocess.ts` | `rtdb_bridge/preprocess.py` |
| `src/rtdb_bridge/pipeline.ts` | `rtdb_bridge/pipeline.py` |
| `src/rtdb_bridge/uiTree.ts` | `rtdb_bridge/ui_tree.py` |
| `src/rtdb_bridge/envelope.ts` | `rtdb_bridge/envelope.py` |
| `src/rtdb_bridge/schemas.ts` + `schemaData.ts` | `rtdb_bridge/schemas/` |
| `src/rtdb_bridge/cli.ts` | `rtdb_bridge/__main__.py` |
| `test/*.test.ts` | `test/*.test.py` |

The four canonical JSON Schemas are generated verbatim from
`rtdb_bridge/schemas/*.schema.json` by
`scripts/generate-schema-data.mjs` (run `npm run gen:schemas` to refresh), so
the two bridges validate against the exact same bytes.

## Getting started

```bash
cd node
npm install
npm run build
npm test          # 51 parity tests, ported from the Python suite
npm run parity    # diffs this bridge against Python (skips if Python absent)
```

### CLI

The `rtdb-bridge` binary speaks the same stdin/stdout contract as
`python -m rtdb_bridge` (stdout carries only JSON; diagnostics go to stderr):

```bash
# from a shell
node ./bin/rtdb-bridge.js --database-name my_db < export.json > envelope.json

# in-memory pipe
echo '{"users":{"u1":{"name":"A"}}}' | node ./bin/rtdb-bridge.js --database-name demo

# or via npm
npm run cli -- -i export.json -o envelope.json --no-validate
```

| Flag | Default | Meaning |
|---|---|---|
| `-i`, `--input FILE` | stdin | RTDB export JSON file |
| `-o`, `--output FILE` | stdout | Write the envelope here |
| `--database-name NAME` | `rtdb_to_sql` | Database/canvas root display name |
| `--source-name NAME` | database name | Original export name recorded in `source` |
| `--known-fields a,b,c` | package default | Fields that are keyed maps (RTDB sub-collections) |
| `--indent N` | `2` | JSON indentation; `0` emits compact JSON |
| `--no-validate` | off | Skip JSON-schema validation of the envelope |

Exit codes: `0` success, `1` bad usage / unreadable input, `2` conversion
failure.

## Library usage

```ts
import {
  Relationalize,
  Schema,
  createLocalBuffer,
} from '@relationalize/node/relationalize';

const schemas: Record<string, Schema> = {};
const onObjectWrite = (name: string, obj: Record<string, unknown>) => {
  (schemas[name] ??= new Schema()).readObject(obj);
};

const r = new Relationalize('users', createLocalBuffer(), onObjectWrite);
r.relationalize([
  { username: 'jsmith123', contact: { email_address: 'j@x.com' }, connections: ['jdoe456'] },
]);
r.closeIo();

for (const [table, schema] of Object.entries(schemas)) {
  console.log(schema.generateDdl(table));
}
```

Or go straight from an RTDB export to the envelope:

```ts
import { convertExportToEnvelope } from '@relationalize/node/rtdb_bridge';

const envelope = convertExportToEnvelope(exportJson, 'my_db', 'export.json');
console.log(envelope.sql);       // CREATE TABLE statements
console.log(envelope.tree[0]);   // explorer tree root
console.log(envelope.warnings);  // [] when the contract validates
```

## Documented differences from Python

These are inherent to running on JavaScript and do not affect RTDB data, but
they are worth knowing:

1. **NDJSON row formatting.** Rows are written with `JSON.stringify`, which
   emits compact separators (`{"a":1}`); Python's `json.dumps` emits
   `{"a": 1}`. The parsed content is identical. Envelope output with
   `--indent 2` matches Python byte-for-byte.
2. **Integer-like object keys.** JavaScript orders integer-like keys (`"1"`,
   `"2"`) ahead of other keys, whereas Python preserves insertion order. RTDB
   keys are collection names / push ids / business ids, so this does not occur
   in practice.
3. **`1.0` is an integer.** `JSON.parse` cannot distinguish `1.0` from `1`, so
   such a literal is typed `int` where Python would say `float`.
4. **Case folding** uses `toLowerCase()` rather than Python's `casefold()`
   (identical for ASCII column names).
5. **Validation** uses a bundled draft-07 subset validator (`jsonSchema.ts`)
   instead of the optional `jsonschema` package. It covers every keyword the
   canonical contracts use.

## License

[MIT](../LICENSE.md)
