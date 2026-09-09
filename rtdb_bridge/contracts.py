"""
Shared contracts mirrored 1:1 from the dbchart VS Code extension.

These constants must stay in lock-step with the TypeScript package:

    packages/schema/src/tree/tree-node.ts       -> SCHEMA_NODE_KINDS
    packages/schema/src/tree/tree-node-meta.ts  -> KIND_ICONS / KIND_LABELS
    packages/schema/src/database.ts             -> SCHEMA_TABLE_TYPES

Any node kind / origin / icon emitted here that the renderer does not know
silently loses its icon or is rejected, so do not add values without also
adding them to the TypeScript package.
"""

from __future__ import annotations

from typing import Optional

# --------------------------------------------------------------------------- #
# Envelope / generator metadata
# --------------------------------------------------------------------------- #

ENVELOPE_VERSION: int = 1
GENERATOR_NAME: str = "rtdb-bridge"

# --------------------------------------------------------------------------- #
# SchemaTreeNode contract (tree-node.ts / tree-node-meta.ts)
# --------------------------------------------------------------------------- #

SCHEMA_NODE_KINDS = frozenset(
    {
        "connection",
        "database",
        "section",
        "table",
        "view",
        "collection",
        "row",
        "schema",
        "column",
        "index",
        "foreignKey",
        "uniqueConstraint",
        "trigger",
        "type",
        "note",
    }
)

SCHEMA_NODE_ORIGINS = frozenset({"static", "metadata", "user"})

# Codicon names without the "codicon-" prefix (must match tree-node-meta.ts).
KIND_ICONS = {
    "connection": "server-process",
    "database": "database",
    "section": "folder",
    "table": "table",
    "view": "eye",
    "collection": "folder-library",
    "row": "git-commit",
    "schema": "symbol-struct",
    "column": "symbol-field",
    "index": "list-ordered",
    "foreignKey": "link",
    "uniqueConstraint": "check",
    "trigger": "zap",
    "type": "symbol-enum",
    "note": "note",
}


def kind_icon(kind: str) -> str:
    """Codicon for a SchemaNodeKind (safe fallback for unknown kinds)."""
    return KIND_ICONS.get(kind, "question")


# --------------------------------------------------------------------------- #
# DatabaseSchema contract (database.ts)
# --------------------------------------------------------------------------- #

SCHEMA_TABLE_TYPES = frozenset({"table", "view", "collection", "stream", "queue"})

# Postgres types emitted by the default relationalize dialect.  Mirrors
# sql_dialects.PostgresDialect.type_column_mapping and is used to fill
# SchemaColumn.type on the canvas contract without reparsing DDL text.
POSTGRES_TYPE_MAPPING = {
    "int": "BIGINT",
    "datetime": "TIMESTAMP",
    "float": "FLOAT",
    "str": "VARCHAR(65535)",
    "bool": "BOOLEAN",
    "none": "BOOLEAN",
}

# --------------------------------------------------------------------------- #
# Type vocabulary
# --------------------------------------------------------------------------- #

# relationalize label -> explorer / UI vocabulary
UI_TYPE_LABELS = {
    "str": "string",
    "string": "string",
    "int": "number",
    "float": "number",
    "number": "number",
    "bool": "boolean",
    "boolean": "boolean",
    "none": "null",
    "null": "null",
    "datetime": "timestamp",
    "timestamp": "timestamp",
    "list": "list",
    "array": "list",
    "map": "map",
    "dict": "map",
    "object": "map",
}

# Preferred display order for the per-table "Types" summaries.
UI_TYPE_ORDER = [
    "string",
    "number",
    "boolean",
    "timestamp",
    "ref",
    "list",
    "map",
    "null",
    "mixed",
]


def normalize_type_label(raw: str) -> str:
    """'str' -> 'string', 'c-int-str' stays as-is (handled by callers)."""
    return UI_TYPE_LABELS.get(raw, raw)


def choice_parts(column_type: str) -> Optional[list]:
    """
    'c-int-str' -> ['int', 'str']; plain 'str' -> None.

    `none` members are stripped (they are dropped before DDL generation).
    """
    if not isinstance(column_type, str) or not column_type.startswith("c-"):
        return None
    parts = [p for p in column_type[2:].split("-") if p and p != "none"]
    return parts or None
