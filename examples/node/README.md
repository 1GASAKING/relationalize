# Node examples

Node/TypeScript ports of the Python examples in this folder. They exercise the
`node/` package (the TypeScript port of `relationalize` + `rtdb_bridge`) over
the **full** RTDB stress-test export, and write every artifact into
[`examples/node_output/`](../node_output).

## Prerequisites

Build the Node package once (the examples import from `node/dist`):

```bash
# from the repository root
npm --prefix node install
npm --prefix node run build
```

## Run

```bash
# from the repository root
npm --prefix node run examples       # the two RTDB reports (stress test + schema tree)
npm --prefix node run examples:all   # every example, with a pass/fail summary
```

Every script can also be run directly, e.g.:

```bash
node examples/node/memory_example.mjs
```

All scripts resolve their input/output paths relative to their own location, so
they work from any working directory.

## Examples

| Script | Python counterpart | Writes |
|---|---|---|
| `memory_example.mjs` | `memory_example.py` | `output/node/memory_example/final/*.json` + `DDL_*.sql` |
| `local_fs_example.mjs` | `local_fs_example.py` | `output/node/local_fs_example/{temp,final}/...` |
| `local_fs_example_csv_output.mjs` | `local_fs_example_csv_output.py` | `output/node/local_fs_example_csv/final/*.csv` + `DDL_*.sql` |
| `concurrency_example.mjs` | `concurrency_example.py` | `output/node/concurrency_example/{temp,final}/...` |
| `rtdb_conversion_test.mjs` | `rtdb_conversion_test.py` | `node_output/` (see below) |
| `rtdb_schema_tree.mjs` | `rtdb_schema_tree.py` | `node_output/rtdb_schema_tree_sample.json` |
| `full_pokemon_psql_pipeline.mjs` | `full_pokemon_psql_pipeline.py` | `output/node/full_pokemon_psql_pipeline/<RUN_ID>/...` |
| `full_mongodb_psql_pipeline.mjs` | `full_mongodb_psql_pipeline.py` | `output/node/full_mongodb_psql_pipeline/<RUN_ID>/...` |
| `s3_redshift_example.mjs` | `s3_redshift_example.py` | `output/node/s3_redshift_example/s3/...` |
| `full_pokemon_s3_redshift_pipeline.mjs` | `full_pokemon_s3_redshift_pipeline.py` | `output/node/full_pokemon_s3_redshift_pipeline/s3/...` |

`output/` is gitignored (the same convention as the Python examples); the
curated `node_output/` reports are tracked.

## External services

The four service examples are templates in Python (empty credentials) — they
cannot run as-is. The Node ports are runnable: they always execute the full
local pipeline, then act on the remote step only when it is configured.

| Step | Enable it with |
|---|---|
| Postgres copy | `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USERNAME`/`PG_PASSWORD` (optional `PG_SCHEMA`) and `npm install --no-save pg` |
| Redshift copy | `REDSHIFT_HOST`/`REDSHIFT_PORT`/`REDSHIFT_DB`/`REDSHIFT_USERNAME`/`REDSHIFT_PASSWORD` (optional `REDSHIFT_SCHEMA`, `REDSHIFT_IAM_ROLE`, `REDSHIFT_REGION`) and `npm install --no-save pg` |
| MongoDB export | `MONGO_URI`/`MONGO_DB` (optional `MONGO_COLLECTION`) and `npm install --no-save mongodb` |
| S3 | Emulated on the local filesystem (`examples/output/node/<example>/s3/`). Swap `wopen` in `lib/pipeline.mjs` for `@aws-sdk/client-s3` to go live. |
| pokeAPI | Fetched over HTTPS via `fetch`; set `POKEMON_LIMIT` to change the count (default 30). Falls back to bundled records when offline. |

When a service is not configured the example prints the exact SQL/COPY
statements it would run and continues, so `npm run examples:all` is always green.

## `rtdb_conversion_test.mjs`

A faithful port of the Python stress test. It runs the combined export fixture
twice:

- **Pipeline A** — the raw tree (keyed maps *not* converted to arrays). Shows
  how keyed data collapses into wide, key-dependent "polluted" columns.
- **Pipeline B** — the preprocessed tree (keyed maps → real arrays). Produces
  proper normalized child tables plus DDL.

Then it asserts all 19 scenarios and persists the results. Expected summary:

```
19/19 scenarios passed, 0 failed.
```

### Cases covered by the fixture

1. Records stored under Firebase keys (id preserved via `record_id`)
2. Keyed maps instead of real arrays (`orders`, `account_settings`, `preferences`)
3. Sibling records with differing / sparse columns
4. Same field, different types across records → choice columns (`age`)
5. Deeply nested ordinary objects (`address.geo` flattened)
6. Nested grouped children (`users.u1.orders.items`)
7. Arrays of primitives, arrays of objects, nested arrays (`matrix`)
8. `null` / missing values (`email` dropped as null-only)
9. A path switching between object and primitive (`settings`)
10. Multiple top-level collections with their own child collections
11. Keyed maps whose *values* are primitives — presence sets (`followers`)
12. Business-ID keyed maps (non push `-` keys) — `enrolled_courses` (`CS101` …)
13. 3-way mixed-type fields (`score` int / float / str)
14. Reserved key collision (payload already has `record_id` → `source_record_id`)
15. Special characters in field names (`contact email`, `phone-number`, `GH_I_`)
16. Empty collections (`{}`) handled gracefully

## `rtdb_schema_tree.mjs`

Builds the recursive four-key UI explorer tree (`kind` / `name` / `meta` /
`children`) for the same all-cases export and writes it to
`rtdb_schema_tree_sample.json`. It also prints a text preview of the tree.

> On Windows consoles the box-drawing characters in the text preview may look
> garbled depending on the active code page; the JSON file is UTF-8 and correct.

## Generated output (`examples/node_output/`)

| File | Description |
|---|---|
| `rtdb_conversion_report.txt` | The complete captured console report |
| `rtdb_conversion_result.json` | Tables (raw + clean schema, DDL, sample rows), Pipeline A summary, all scenarios |
| `rtdb_table_ddl.sql` | Every `CREATE TABLE` statement, one block per table |
| `rtdb_bridge_envelope.json` | The full canonical bridge envelope (`database` + `tree` + `sql` + `warnings`) |
| `rtdb_schema_tree_sample.json` | The UI explorer tree root for the stress-test export |
