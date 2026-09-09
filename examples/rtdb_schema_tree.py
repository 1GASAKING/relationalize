r"""
Relationalize output  ->  UI schema-explorer tree.

This module is the thin UI-preview layer for the dbchart explorer hand-off.
The full bridge logic is owned by :mod:`rtdb_bridge` so the canonical tree
shape (validated against ``schemas/schema-tree.schema.json``) exists in
exactly one place.

    RTDB json  ->  rtdb_bridge.convert_export_to_envelope(...)
                ->  envelope["tree"][0]  (SchemaTreeNode database root)

The tree JSON has exactly four node keys so any platform (React TreeView,
Flutter, SwiftUI, TUI, JS lib ...) can render it recursively without custom
parsing:

    node = {
        "kind":     "...",     # database | table | columns | column |
                               # keys | key | references | reference | types
        "name":     "...",
        "meta":     { ... },   # title, row counts, type badges, nullable,
                               # partial, sample values, relation targets
        "children": [ ... ]    # optional nested nodes
    }

Convenience entry point
------------------------
    ui_tree = rtdb_to_ui_tree(
        export,                       # your RTDB export JSON (dict)
        database_name="my_rtdb",
        known_collection_fields={...} # field names that are keyed maps
    )
    json.dumps(ui_tree, indent=2)
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Optional

from rtdb_bridge import convert_export_to_envelope


def rtdb_to_ui_tree(
    export: Dict[str, Any],
    database_name: str = "rtdb_to_sql",
    known_collection_fields: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """
    Convenience shim: run the canonical rtdb_bridge envelope builder and
    return just the explorer tree root (``SchemaTreeNode`` database node).

    All preprocessing / relationalization / tree transformations are the
    single implementation living in :mod:`rtdb_bridge`.
    """
    envelope = convert_export_to_envelope(
        export,
        database_name=database_name,
        known_collection_fields=known_collection_fields,
        validate=False,
    )
    return envelope["tree"][0]


def print_text_tree(
    node: Dict[str, Any],
    prefix: str = "",
    is_last: bool = True,
    max_rows: Optional[int] = 40,
    _depth: int = 0,
) -> None:
    """Tiny renderer to preview the UI data locally."""
    if max_rows is not None and _depth > max_rows:
        return
    connector = "└─ " if is_last else "├─ "
    current = f"{prefix}{connector}{node['name']}"
    meta = node.get("meta") or {}
    details = []
    if "rowCount" in meta:
        details.append(f"table · {meta['rowCount']} rows")
    elif "tableCount" in meta:
        details.append(f"database · {meta['tableCount']} tables")
    elif "summary" in meta:
        details.append(meta["summary"])
    if "count" in meta:
        details.append(f"{meta['count']}")
    if "uiType" in meta:
        details.append(str(meta["uiType"]))
    if "refTable" in meta:
        details.append(f"→ {meta['refTable']}")
    if details:
        current += f"   [{', '.join(str(d) for d in details)}]"
    print(current)

    children = node.get("children", [])
    if children:
        for index, child in enumerate(children):
            next_prefix = prefix + ("    " if is_last else "│   ")
            print_text_tree(
                child,
                next_prefix,
                is_last=(index == len(children) - 1),
                max_rows=max_rows,
                _depth=_depth + 1,
            )


# --------------------------------------------------------------------------- #
# Tiny self-contained demo.
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    # Minimal smoke test with a representative export.
    DEMO_EXPORT = {
        "chat_rooms": {
            "room_alpha": {"identifier": "room_alpha", "title": "Lounge"},
            "room_beta": {"identifier": "room_beta", "title": "Gaming"},
        },
        "messages": {
            "msg_001": {
                "identifier": "msg_001",
                "chat_room": "room_alpha",
                "user": "u_01",
                "text": "Hello",
            }
        },
        "users": {
            "u_01": {
                "identifier": "u_01",
                "name": "Alice",
                "age": 30,
                "active": True,
                "prefs": {"theme": "dark", "notifications": True},
                "tags": ["gamer", "moderator"],
            },
            "u_02": {
                "identifier": "u_02",
                "name": "Bob",
                "age": "unknown",
                "bio": "hello",
            },
        },
    }

    demo_tree = rtdb_to_ui_tree(
        DEMO_EXPORT,
        database_name="demo",
        known_collection_fields={"chat_rooms", "messages", "users"},
    )
    with open("examples/rtdb_schema_tree_sample.json", "w", encoding="utf-8") as fh:
        json.dump(demo_tree, fh, indent=2, default=str)

    print("\nUI SCHEMA TREE PREVIEW\n=====================\n")
    print_text_tree(demo_tree, max_rows=100)
    print("\nFull JSON written to examples/rtdb_schema_tree_sample.json")
