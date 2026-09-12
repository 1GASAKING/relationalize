# Using `rtdb_bridge` from a VS Code extension

`rtdb_bridge` converts a Firebase Realtime Database export JSON into the
canonical **bridge envelope** consumed by the dbchart UI:

```
RtdbBridgeEnvelope = {
  envelopeVersion, generator, source,
  database,    // canvas contract   (database.schema.json)
  tree,        // explorer contract (schema-tree.schema.json)
  sql,         // DDL + type info   (sql.schema.json)
  warnings
}
```

The bridge is **Python**. A VS Code extension has two JavaScript runtimes:

| Runtime | Can spawn processes? | Can run Python? | Role here |
|---|---|---|---|
| **Extension host** (Node.js) | Yes | No | Spawns the bridge, receives the envelope |
| **Webview** (sandboxed browser) | No | No | Renders the envelope |

So the webview never talks to Python. The extension host runs the bridge and
`postMessage`s the result inward.

---

## Do I need to host a local app / web server?

**No.** The bridge is a pure function. Run it as a short-lived child process
and pipe JSON through **stdin → stdout**.

| # | Option | Runs the bridge in | Needs Python at runtime? | When to use |
|---|---|---|---|---|
| 1 | **Spawn `python -m rtdb_bridge`** | Extension host child process | Yes (path configurable) | **Recommended for development** |
| 2 | **Spawn a frozen PyInstaller binary** | Extension host child process | No | **Recommended for shipped extensions** |
| 3 | Pre-generate envelope JSON at build time | CI / build script | No (build only) | Fixtures, tests, demos |
| 4 | Local HTTP server (FastAPI/Flask) | Separate process | Yes | Only if you also ship a real web app |
| 5 | Pyodide / WASM in the webview | Webview | No | Advanced; large payload, slow startup |
| 6 | Port the bridge to TypeScript | Webview / host | No | Highest maintenance cost |

Options 1 and 2 use the **exact same stdin/stdout contract**, so you can start
with 1 and switch to 2 later without changing the extension code beyond the
executable path.

---

## Architecture

```
RTDB export.json
      │
      ▼
Extension host (Node)  ──child_process.spawn──►  rtdb_bridge
      │                                            (stdin: export JSON)
      │  ◄──────────────  stdout: envelope JSON ──────────┘
      │
      ▼  panel.webview.postMessage({ type: "envelope", payload })
React webview  →  renders envelope.tree / envelope.database / envelope.sql
```

---

## The spawn contract (stdin/stdout)

The CLI reads the export from **stdin** (or `--input FILE`) and writes the
envelope to **stdout** (or `--output FILE`). Stdout carries *only* JSON so the
caller can `JSON.parse` it directly; all diagnostics go to **stderr**.

```bash
# from a shell
python -m rtdb_bridge --database-name my_db < export.json > envelope.json

# in-memory pipe (what the extension does)
echo '{"users":{"u1":{"name":"A"}}}' | python -m rtdb_bridge --database-name demo
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `-i`, `--input FILE` | stdin | RTDB export JSON file |
| `-o`, `--output FILE` | stdout | Write the envelope here |
| `--database-name NAME` | `rtdb_to_sql` | Database/canvas root display name |
| `--source-name NAME` | database name | Original export name recorded in `source` |
| `--known-fields a,b,c` | package default | Fields that are keyed maps (RTDB sub-collections) |
| `--indent N` | `2` | JSON indentation; `0` emits compact JSON |
| `--no-validate` | off | Skip JSON-schema validation of the envelope |
| `--version` | | Print the `rtdb_bridge` version |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Envelope written |
| `1` | Bad usage, unreadable input, or invalid input JSON |
| `2` | Bridge failed while converting |

<!-- docs:append -->
