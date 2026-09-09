"""
Canonical JSON Schema contracts for the rtdb_bridge -> dbchart envelope.

Each `.schema.json` file is the single versioned source of truth for a
cross-package message type:

    database.schema.json     DatabaseSchema (canvas contract)
    schema-tree.schema.json  SchemaTreeNode recursive forest (explorer tree)
    sql.schema.json          DDL + type/choice-column metadata emitted by Python
    rtdb-bridge.schema.json  Full Python -> TS envelope

These files are intentionally plain JSON Schema (draft-07) with no Python
dependency so any other consumer (Python jsonschema, TypeScript ajv/zod,
web package, another worker) can validate against the exact same bytes.
"""

from __future__ import annotations

import json
from importlib import resources
from typing import Dict

SCHEMA_FILENAMES = {
    "database": "database.schema.json",
    "schema-tree": "schema-tree.schema.json",
    "sql": "sql.schema.json",
    "rtdb-bridge": "rtdb-bridge.schema.json",
}


def load_schema(name: str) -> dict:
    """
    Load a canonical schema by short name (``database``, ``schema-tree``,
    ``sql``, or ``rtdb-bridge``).

    Works from source checkouts and from PyInstaller frozen binaries because
    it reads through :func:`importlib.resources.files`.
    """
    if name not in SCHEMA_FILENAMES:
        raise ValueError(
            f"Unknown schema '{name}'. Expected one of: {sorted(SCHEMA_FILENAMES)}"
        )
    filename = SCHEMA_FILENAMES[name]
    try:
        # Python >= 3.9 / importlib_resources backport compatible.
        file_path = resources.files(__package__).joinpath(filename)
        with file_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except AttributeError:  # pragma: no cover - very old importlib.resources
        with resources.open_text(__package__, filename, encoding="utf-8") as fh:
            return json.load(fh)


def load_all_schemas() -> Dict[str, dict]:
    """Load every canonical schema keyed by short name."""
    return {name: load_schema(name) for name in SCHEMA_FILENAMES}


__all__ = [
    "SCHEMA_FILENAMES",
    "load_all_schemas",
    "load_schema",
]
