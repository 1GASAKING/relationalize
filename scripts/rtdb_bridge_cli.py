"""PyInstaller entry point for the rtdb_bridge CLI.

PyInstaller executes the entry script as top-level ``__main__``, which breaks
package-relative imports.  This shim imports the package first so the
``python -m rtdb_bridge`` behaviour is preserved inside a frozen binary.

    pyinstaller --onefile --name rtdb-bridge scripts/rtdb_bridge_cli.py

The resulting binary speaks the same stdin/stdout contract as
``python -m rtdb_bridge``, so a VS Code extension can spawn it without
requiring a system Python install:

    rtdb-bridge --database-name demo < export.json > envelope.json
"""

from rtdb_bridge.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
