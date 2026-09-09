"""
Relationalize output -> UI schema-explorer tree.

This module turns :class:`~rtdb_bridge.pipeline.TableInfo` results into the
recursive four-key UI node format:

    node = {
        "kind":     "...",     # database | table | columns | column |
                               # keys | key | references | reference | types
        "name":     "...",
        "meta":     { ... },   # title, row counts, type badges, nullable,
                               # partial, sample values, relation targets
        "children": [ ... ]    # optional nested nodes
    }

The same shape is the *tree* member of the bridge envelope and validates
against ``schemas/schema-tree.schema.json`` (SchemaTreeNode forest).
"""

from __future__ import annotations

import copy
import json
from typing import Any, Dict, List, Optional, Sequence, Set

from relationalize import Schema

from .pipeline import TableInfo

# --------------------------------------------------------------------------- #
# Type helpers
# --------------------------------------------------------------------------- #

_COLUMN_TYPE_LABELS: Dict[str, str] = {
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


def normalize_type_label(raw: str) -> str:
    return _COLUMN_TYPE_LABELS.get(raw, raw)


def choice_parts(column_type: str) -> Optional[List[str]]:
    """'c-int-str' -> ['int', 'str']; plain 'str' -> None."""
    if column_type.startswith("c-"):
        return [p for p in column_type[2:].split("-") if p != "none"]
    return None


def value_types(value: Any) -> Set[str]:
    if isinstance(value, bool):
        return {"boolean"}
    if isinstance(value, (int, float)):
        return {"number"}
    if isinstance(value, str):
        return {"string"}
    if isinstance(value, list):
        return {"list"}
    if isinstance(value, dict):
        return {"map"}
    if value is None:
        return {"null"}
    return {type(value).__name__}


def is_relation_id(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("R_") and len(value) == 34


# --------------------------------------------------------------------------- #
# Sample / metadata helpers
# --------------------------------------------------------------------------- #


def sample_distinct(
    rows: Sequence[Dict[str, Any]],
    columns: Sequence[str],
    limit: int = 4,
    skip_relation_ids: bool = True,
) -> List[Any]:
    """Distinct human-readable samples from the physical rows."""
    seen: Set[str] = set()
    samples: List[Any] = []
    for row in rows:
        for column in columns:
            value = row.get(column)
            if value is None or (skip_relation_ids and is_relation_id(value)):
                continue
            digest = json.dumps(value, sort_keys=True, default=str)
            if digest in seen:
                continue
            seen.add(digest)
            samples.append(value)
            if len(samples) >= limit:
                return samples
    return samples


def key_samples(rows: Sequence[Dict[str, Any]], limit: int = 12) -> List[Any]:
    return sample_distinct(rows, ("record_id",), limit=limit, skip_relation_ids=False)


def is_nullable(converted_rows: Sequence[Dict[str, Any]], columns: Sequence[str]) -> bool:
    return any(
        any(column not in row or row.get(column) is None for column in columns)
        for row in converted_rows
    )


def is_partial(converted_rows: Sequence[Dict[str, Any]], columns: Sequence[str]) -> bool:
    return any(
        any(column not in row for column in columns) for row in converted_rows
    )


# --------------------------------------------------------------------------- #
# Tree builders
# --------------------------------------------------------------------------- #


def _physical_names(column: str, parts: Optional[List[str]]) -> List[str]:
    """For a choice column the physical SQL names are column_int/str etc."""
    if parts:
        return [f"{column}_{part}" for part in parts]
    return [column]


def table_to_ui_tree(
    table: TableInfo,
    available_tables: Set[str],
) -> Dict[str, Any]:
    clean = table.clean_schema()
    raw_rows = table.rows
    converted = [clean.convert_object(row) for row in raw_rows]

    columns = build_columns_ui(
        table.name, clean.schema, raw_rows, converted, available_tables
    )
    keys = build_keys_ui(table.name, raw_rows, converted)
    refs = build_references_ui(table.name, raw_rows, available_tables)
    types = build_types_ui(columns)

    return {
        "kind": "table",
        "name": table.name,
        "meta": {
            "rowCount": len(raw_rows),
            "ddl": clean.generate_ddl(table=table.name),
        },
        "children": [columns, keys, refs, types],
    }


def build_columns_ui(
    table: str,
    schema_columns: Dict[str, str],
    raw_rows: Sequence[Dict[str, Any]],
    converted_rows: Sequence[Dict[str, Any]],
    available_tables: Set[str],
) -> Dict[str, Any]:
    children: List[Dict[str, Any]] = []
    physical_from_raw: Dict[str, List[Any]] = {
        col: [
            r[col]
            for r in raw_rows
            if col in r and r[col] is not None
        ]
        for col in schema_columns
    }

    for column, column_type in schema_columns.items():
        parts = choice_parts(column_type)
        physical = _physical_names(column, parts)

        # Relation column? Parent rows link to <table>_<column> child table.
        target_child = f"{table}_{column}"
        non_null_values = physical_from_raw.get(column, [])
        is_ref = (
            bool(non_null_values)
            and all(is_relation_id(v) for v in non_null_values)
            and target_child in available_tables
        )

        if parts:
            # choice -> logical mixed column with physical children
            leaf_ui = " · ".join(normalize_type_label(p) for p in parts)
            meta: Dict[str, Any] = {
                "uiType": "mixed",
                "typeSummary": leaf_ui,
                "types": [normalize_type_label(p) for p in parts],
                "sample": sample_distinct(
                    converted_rows, physical, skip_relation_ids=False
                ),
                "nullable": is_nullable(converted_rows, physical),
                "partial": is_partial(converted_rows, physical),
            }
            physical_children: Optional[List[Dict[str, Any]]] = [
                {
                    "kind": "column",
                    "name": phys_col,
                    "meta": {
                        "uiType": normalize_type_label(part),
                        "typeSummary": normalize_type_label(part),
                        "nullable": is_nullable(converted_rows, [phys_col]),
                        "partial": is_partial(converted_rows, [phys_col]),
                        "sample": sample_distinct(converted_rows, [phys_col]),
                    },
                }
                for phys_col, part in zip(physical, parts)
            ]
            children.append(
                {
                    "kind": "column",
                    "name": column,
                    "meta": meta,
                    "children": physical_children,
                }
            )
            continue

        # Non-choice column -------------------------------------------------
        if is_ref:
            meta = {
                "uiType": "ref",
                "refTable": target_child,
                "cardinality": "1:N",
                "sample": sample_distinct(
                    converted_rows, [column], skip_relation_ids=False
                ),
            }
        else:
            column_values_types: Set[str] = set()
            for value in physical_from_raw.get(column, []):
                column_values_types |= value_types(value)
            if not column_values_types:
                column_values_types = {normalize_type_label(column_type)}
            meta = {
                "uiType": normalize_type_label(column_type),
                "typeSummary": " · ".join(sorted(column_values_types)),
                "types": sorted(column_values_types),
                "nullable": is_nullable(converted_rows, [column]),
                "partial": is_partial(converted_rows, [column]),
                "sample": sample_distinct(converted_rows, [column]),
            }
        children.append({"kind": "column", "name": column, "meta": meta})

    children.sort(key=lambda n: n["name"])
    return {"kind": "columns", "name": "Columns", "children": children}


def build_keys_ui(
    table: str,
    raw_rows: Sequence[Dict[str, Any]],
    converted_rows: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    values = key_samples(raw_rows)
    if not values:
        return {
            "kind": "keys",
            "name": "Keys",
            "meta": {"count": 0, "empty": True},
            "children": [],
        }
    keys = [
        {
            "kind": "key",
            "name": str(value),
            "meta": {"column": "record_id", "value": value},
        }
        for value in values
    ]
    return {
        "kind": "keys",
        "name": "Keys",
        "meta": {"count": len(values), "column": "record_id"},
        "children": keys,
    }


def build_references_ui(
    table: str,
    raw_rows: Sequence[Dict[str, Any]],
    available_tables: Set[str],
) -> Dict[str, Any]:
    relation_ids: List[Dict[str, Any]] = []
    if raw_rows:
        for column in schema_columns_for_rows(raw_rows):
            values = [
                row[column]
                for row in raw_rows
                if column in row and is_relation_id(row.get(column))
            ]
            if not values:
                continue
            target = f"{table}_{column}"
            if target in available_tables:
                relation_ids.append(
                    {
                        "kind": "reference",
                        "name": f"{table}.{column} -> {target}",
                        "meta": {
                            "from": f"{table}.{column}",
                            "to": target,
                            "count": len(values),
                        },
                    }
                )
    return {
        "kind": "references",
        "name": "References",
        "meta": {"count": len(relation_ids)},
        "children": relation_ids,
    }


def schema_columns_for_rows(rows: Sequence[Dict[str, Any]]) -> List[str]:
    cols: Set[str] = set()
    for row in rows:
        cols.update(row.keys())
    return sorted(cols)


def build_types_ui(columns_node: Dict[str, Any]) -> Dict[str, Any]:
    def walk(node: Dict[str, Any], acc: Set[str]) -> None:
        meta = node.get("meta", {})
        ui_type = meta.get("uiType")
        if isinstance(ui_type, str):
            for part in ui_type.split(" · "):
                if part and part != "unknown":
                    acc.add(normalize_type_label(part))
        for child in node.get("children", []):
            walk(child, acc)

    acc: Set[str] = set()
    for child in columns_node.get("children", []):
        walk(child, acc)

    order = [
        "string",
        "number",
        "boolean",
        "timestamp",
        "ref",
        "list",
        "map",
        "null",
    ]
    typed = [t for t in order if t in acc]
    typed += sorted(acc - set(order))
    return {
        "kind": "types",
        "name": "Types",
        "meta": {
            "summary": " · ".join(typed) if typed else "unknown",
            "count": len(typed),
        },
    }


def build_database_tree(
    database_name: str,
    table_infos: Sequence[TableInfo],
) -> Dict[str, Any]:
    """Build the UI database root node from pipeline table outputs."""
    available_tables: Set[str] = {info.name for info in table_infos}
    tables = [
        table_to_ui_tree(info, available_tables)
        for info in sorted(table_infos, key=lambda t: t.name)
    ]
    return {
        "kind": "database",
        "name": database_name,
        "meta": {"tableCount": len(tables)},
        "children": tables,
    }


__all__ = [
    "build_database_tree",
    "build_keys_ui",
    "build_references_ui",
    "build_columns_ui",
    "build_types_ui",
    "normalize_type_label",
    "table_to_ui_tree",
]
