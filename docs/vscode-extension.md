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

---

## 1. Extension host: spawn the bridge

`src/bridge/runBridge.ts` — spawns the CLI, streams the export to stdin, and
resolves with the parsed envelope.

```ts
import { spawn } from "node:child_process";
import type { BridgeEnvelope } from "./types";

export interface RunBridgeOptions {
  /** `python` / `python3` / absolute interpreter path, OR a frozen binary. */
  executable: string;
  /** True when `executable` is the frozen `rtdb-bridge` binary. */
  isBinary?: boolean;
  databaseName?: string;
  sourceName?: string;
  /** Extra module lookup dirs so `import rtdb_bridge` resolves. */
  pythonPath?: string;
  cwd?: string;
  timeoutMs?: number;
}

export function runBridge(
  exportJson: unknown,
  opts: RunBridgeOptions,
): Promise<BridgeEnvelope> {
  const {
    executable,
    isBinary = false,
    databaseName = "rtdb_to_sql",
    sourceName,
    pythonPath,
    cwd,
    timeoutMs = 120_000,
  } = opts;

  const args = isBinary
    ? ["--database-name", databaseName, "--indent", "0"]
    : ["-m", "rtdb_bridge", "--database-name", databaseName, "--indent", "0"];
  if (sourceName) args.push("--source-name", sourceName);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (pythonPath) {
    const sep = process.platform === "win32" ? ";" : ":";
    env.PYTHONPATH = pythonPath + (env.PYTHONPATH ? sep + env.PYTHONPATH : "");
  }

  return new Promise<BridgeEnvelope>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true, // no console flash on Windows
      shell: false,      // never route through a shell
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`rtdb-bridge timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));

    // spawn() failures (e.g. ENOENT) arrive here, not as a thrown error.
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start rtdb-bridge (${executable}): ${err.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new Error(`rtdb-bridge exited with code ${exitCode}: ${stderr.trim()}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as BridgeEnvelope;
        if (envelope.envelopeVersion !== 1) {
          reject(new Error(`Unsupported envelope version: ${envelope.envelopeVersion}`));
          return;
        }
        resolve(envelope);
      } catch (e) {
        reject(new Error(`Invalid JSON from rtdb-bridge: ${(e as Error).message}`));
      }
    });

    // If the child dies early, writing to stdin emits EPIPE. Swallow it here;
    // the real failure is reported by the "error"/"close" handlers above.
    child.stdin.on("error", () => { /* no-op */ });

    // Send the export over stdin. NEVER use a command-line argument: Windows
    // caps command lines at ~32 KB and RTDB exports exceed that.
    child.stdin.end(JSON.stringify(exportJson));
  });
}
```

> Prefer `exitCode === 0` over `!exitCode` — a child killed by a signal can
> report `null`, which is falsy and would be misread as success.

## 2. Wire it to a command and send it to the webview

`src/extension.ts`:

```ts
import * as vscode from "vscode";
import { runBridge } from "./bridge/runBridge";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("dbchart.openRtdbBridge", async () => {
      const panel = vscode.window.createWebviewPanel(
        "dbchartBridge",
        "RTDB Bridge",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
        },
      );
      panel.webview.html = getHtml(panel.webview, context.extensionUri);

      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ["json"] },
      });
      if (!picked?.[0]) return;

      const raw = await vscode.workspace.fs.readFile(picked[0]);
      const exportJson = JSON.parse(Buffer.from(raw).toString("utf8"));

      const cfg = vscode.workspace.getConfiguration("rtdbBridge");
      const frozen = cfg.get<string>("binaryPath"); // bundled rtdb-bridge(.exe)
      const executable =
        frozen ||
        cfg.get<string>("pythonPath") ||
        vscode.workspace.getConfiguration("python").get<string>("defaultInterpreterPath") ||
        (process.platform === "win32" ? "python" : "python3");

      try {
        const envelope = await runBridge(exportJson, {
          executable,
          isBinary: Boolean(frozen),
          pythonPath: cfg.get<string>("modulePath"), // folder containing rtdb_bridge/
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          databaseName: cfg.get<string>("databaseName", "rtdb_to_sql"),
        });
        panel.webview.postMessage({ type: "envelope", payload: envelope });
      } catch (err) {
        vscode.window.showErrorMessage((err as Error).message);
      }
    }),
  );
}

function getHtml(webview: vscode.Webview, root: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(root, "media", "main.js"));
  const nonce = Array.from({ length: 16 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
      Math.floor(Math.random() * 62)
    ],
  ).join("");
  return `<!DOCTYPE html><html><head>
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
  </head><body><div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body></html>`;
}
```

`package.json` contributions:

```jsonc
"contributes": {
  "commands": [
    { "command": "dbchart.openRtdbBridge", "title": "RTDB: Convert Export" }
  ],
  "configuration": {
    "title": "RTDB Bridge",
    "properties": {
      "rtdbBridge.pythonPath": { "type": "string", "default": "" },
      "rtdbBridge.modulePath": { "type": "string", "default": "" },
      "rtdbBridge.binaryPath": { "type": "string", "default": "" },
      "rtdbBridge.databaseName": { "type": "string", "default": "rtdb_to_sql" }
    }
  }
}
```

## 3. Webview: receive, don't spawn

The webview only listens for the `envelope` message and renders the tree.

```tsx
// media/src/App.tsx
import { useEffect, useState } from "react";
import type { BridgeEnvelope } from "./types";
import { SchemaTree } from "./SchemaTree";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

export default function App() {
  const [envelope, setEnvelope] = useState<BridgeEnvelope | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === "envelope") setEnvelope(msg.payload as BridgeEnvelope);
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" }); // optional: pull on mount
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!envelope) return <p>Waiting for conversion…</p>;
  return (
    <div>
      <h3>
        {envelope.database.name} — {envelope.database.tables.length} tables
      </h3>
      {envelope.warnings.map((w) => (
        <p key={w.code}>⚠ {w.message}</p>
      ))}
      <SchemaTree forest={envelope.tree} />
    </div>
  );
}
```

`SchemaTree` is the recursive 4-key renderer (`{ kind, name, meta?, children? }`).
See `examples/rtdb_schema_tree_sample.json` for a ready-made fixture, and
`docs/` sibling files for the full `BridgeEnvelope` TypeScript types.

---

## 4. Choosing the interpreter vs. shipping a frozen binary

### Development — use the interpreter

`executable = "python"` (or your venv) and `args = ["-m", "rtdb_bridge", …]`.
The package must be importable. Either:

```bash
pip install -e .          # from this repo; installs relationalize + rtdb_bridge
```

or point `rtdbBridge.modulePath` at the folder that *contains* `rtdb_bridge/`
(the extension puts it on `PYTHONPATH`).

### Shipping — bundle a frozen binary

`scripts/rtdb_bridge_cli.py` is a ready-made PyInstaller entry point. Build per
platform on that platform:

```bash
pyinstaller --onefile --name rtdb-bridge scripts/rtdb_bridge_cli.py
# → dist/rtdb-bridge.exe (Windows) or dist/rtdb-bridge (macOS/Linux)
```

The schemas under `rtdb_bridge/schemas/*.json` are package data and are already
declared in `pyproject.toml`/`setup.py`, so the frozen binary can still load
them through `importlib.resources`.

Copy the binary into the extension and spawn it directly:

```ts
// context.asAbsolutePath gives an absolute path into the installed VSIX
const bin = context.asAbsolutePath(
  process.platform === "win32" ? "bin/rtdb-bridge.exe" : "bin/rtdb-bridge",
);
// also: chmod +x on macOS/Linux during packaging
```

Ship **one binary per platform** (`bin/win32-x64/`, `bin/darwin-arm64/`, …) and
select with `process.platform` + `process.arch`. Since the frozen binary needs
no `-m`, `isBinary: true` simply drops the interpreter args.

Finally, keep the binary out of `.vscodeignore`:

```
# .vscodeignore
!bin/**     # do not ignore the bundled binaries
```

---

## 5. The alternatives in detail

### Option 3 — pre-generated envelope files (fixtures)

Run the CLI at build time and ship the JSON:

```bash
python -m rtdb_bridge -i fixtures/export.json -o media/fixtures/envelope.json --no-validate
```

The webview `fetch`es it. Zero runtime Python, but the data is static — only
useful for demos, tests, and UI development against a known shape.

### Option 4 — local HTTP server

Only justified if you *also* ship a standalone web app. For an extension it adds
a port, a lifetime to manage, firewall prompts, and CORS. Skip it.

### Option 5 — Pyodide / WASM in the webview

You can run CPython in the webview via Pyodide and load `relationalize` +
`rtdb_bridge` as wheels. It removes the runtime Python dependency but costs a
multi-megabyte download, slow cold start, and packaging pain (the package must be
pure-Python — it is). Choose only if you cannot spawn processes at all.

### Option 6 — port the bridge to TypeScript

The contracts (`contracts.py`, `schemas/*.json`) already mirror the TS side, so
a port is possible. It duplicates the relationalization algorithm and must be
kept in sync forever. Not recommended.

---

## 6. Robustness notes

- **Spawn in the extension host only.** `child_process` does not exist in the webview.
- **Pass data on stdin, never `argv`.** Windows limits command lines to ~32 KB.
- **Force UTF-8 both directions.** The CLI reconfigures its stdio to UTF-8; the
  extension sets `setEncoding("utf8")`. Without this, non-ASCII values can be
  mangled by the Windows default code page.
- **`import rtdb_bridge` must resolve**, along with `relationalize`. Use a venv,
  `pip install -e .`, or `PYTHONPATH`.
- **Handle EPIPE** on `child.stdin` and set a timeout — a missing interpreter can
  kill the child before you finish writing.
- **Check `exitCode === 0`**, not `!exitCode` (signal death reports `null`).
- **Reuse a `cwd`** the user can see, so relative `PYTHONPATH`/config still works.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Failed to start rtdb-bridge (ENOENT)` | Interpreter/binary not found | Set `rtdbBridge.pythonPath` / `rtdbBridge.binaryPath` to an absolute path |
| Exit code `2`, `conversion failed` | Bridge raised on the export | Inspect `stderr`; reproduce with `python -m rtdb_bridge -i export.json` |
| Exit code `1`, `cannot read input` | Empty or invalid JSON on stdin | Ensure the export file parsed before spawning |
| `Invalid JSON from rtdb-bridge` | Something wrote to **stdout** | Never log to stdout in the CLI path; use stderr |
| `ModuleNotFoundError: relationalize` | Package not installed | `pip install -e .` or set `rtdbBridge.modulePath` |
| Unicode looks broken | Code-page mismatch | Keep UTF-8 on both ends (already handled by the CLI) |
| Webview shows nothing | Message sent before listener attached | Render HTML, then `postMessage`; or have the webview send `{type:"ready"}` and reply |
| `envelope.warnings` non-empty | Schema drift / validation issue | Inspect the warning `code` and `details.path` |

## Reference

- Contract schemas: `rtdb_bridge/schemas/*.schema.json`
- Tree preview / sample: `examples/rtdb_schema_tree.py`,
  `examples/rtdb_schema_tree_sample.json`
- Envelope builder: `rtdb_bridge/envelope.py` (`convert_export_to_envelope`)
- CLI: `rtdb_bridge/__main__.py` (`python -m rtdb_bridge`)
- PyInstaller shim: `scripts/rtdb_bridge_cli.py`

