"""
Core RTDB export -> relational tables pipeline.

Wraps :mod:`relationalize` and :class:`~relationalize.Schema` together with
in-memory buffers so a whole Firebase RTDB export can be processed into a
dict of SQL-ready tables without touching disk.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from relationalize import Relationalize, Schema
from relationalize.utils import create_local_buffer

from .preprocess import extract_collection_records, keyed_maps_to_arrays


# --------------------------------------------------------------------------- #
# Public result types
# --------------------------------------------------------------------------- #


@dataclass
class CollectionInfo:
    """Metadata about one top-level RTDB collection."""

    name: str
    recordCount: int = 0
    childTableCount: int = 0
    tableNames: List[str] = field(default_factory=list)


@dataclass
class TableInfo:
    """Schema + rows for one produced relational table."""

    name: str
    schema: Schema
    rows: List[Dict[str, Any]]

    def clean_schema(self) -> Schema:
        """Return a copy of the schema with null-only columns removed."""
        clean = Schema(schema=copy.deepcopy(self.schema.schema))
        clean.drop_null_columns()
        return clean


@dataclass
class RelationRef:
    """A detected 1:N relation between a parent column and a child table."""

    fromTable: str
    column: str
    toTable: str
    columnCount: int = 0


@dataclass
class ExportPipelineResult:
    """Everything produced by running the full RTDB export pipeline."""

    tables: Dict[str, TableInfo] = field(default_factory=dict)
    relations: List[RelationRef] = field(default_factory=list)
    collections: List[CollectionInfo] = field(default_factory=list)

    # Convenience lookups --------------------------------------------------- #

    @property
    def table_names(self) -> List[str]:
        return sorted(self.tables.keys())

    def table(self, name: str) -> Optional[TableInfo]:
        return self.tables.get(name)

    def merged_schemas(self) -> Dict[str, Schema]:
        return {name: info.schema for name, info in self.tables.items()}

    def merged_results(self) -> Dict[str, List[Dict[str, Any]]]:
        return {name: info.rows for name, info in self.tables.items()}


# --------------------------------------------------------------------------- #
# Pipeline helpers
# --------------------------------------------------------------------------- #


def _is_relation_id(value: Any) -> bool:
    """Detect an RID emitted by relationalize (e.g. R_2d0418f3b5de415086f1297cf0a9d9a5)."""
    return (
        isinstance(value, str)
        and value.startswith("R_")
        and len(value) == 34
    )


def _detect_relations(
    table_name: str, rows: List[Dict[str, Any]], available_tables: Set[str]
) -> List[RelationRef]:
    """
    Scan a parent table's rows for RID columns that point at child tables
    produced by relationalize (``<parent>_<column>``).
    """
    relations: List[RelationRef] = []
    if not rows:
        return relations
    candidate_cols = sorted({k for row in rows for k in row.keys()})
    for column in candidate_cols:
        values = [row[column] for row in rows if column in row]
        if not values:
            continue
        if not all(_is_relation_id(v) for v in values):
            continue
        target = f"{table_name}_{column}"
        if target in available_tables:
            relations.append(
                RelationRef(
                    fromTable=table_name,
                    column=column,
                    toTable=target,
                    columnCount=len(values),
                )
            )
    return relations


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def run_pipeline(
    collection_name: str,
    records: List[Dict[str, Any]],
) -> Tuple[Dict[str, Schema], Dict[str, List[Dict[str, Any]]]]:
    """Run relationalize + Schema over preprocessed records for one collection."""
    schemas: Dict[str, Schema] = {}

    def on_object_write(schema_name: str, obj: Dict[str, Any]) -> None:
        if schema_name not in schemas:
            schemas[schema_name] = Schema()
        schemas[schema_name].read_object(obj)

    results: Dict[str, List[Dict[str, Any]]] = {}
    with Relationalize(collection_name, create_local_buffer(), on_object_write) as r:
        r.relationalize(records)
        # Drain in-memory buffers BEFORE the context manager closes them.
        for schema_name, buffer in r.outputs.items():
            buffer.seek(0)
            results[schema_name] = [
                json.loads(line) for line in buffer.readlines()
            ]

    return schemas, results


def relationalize_export(
    export: Dict[str, Any],
    known_collection_fields: Optional[Iterable[str]] = None,
) -> ExportPipelineResult:
    """
    Convert a raw RTDB export tree into relational tables.

    Parameters
    ----------
    export:
        The parsed RTDB export JSON.  Each top-level key is a collection
        name whose value is a dict of Firebase key -> record.
    known_collection_fields:
        Optional field-name set marking keyed maps that are collections keyed
        by business ids (non push-id keys).  Defaults to
        :data:`~rtdb_bridge.preprocess.DEFAULT_KNOWN_COLLECTION_FIELDS`.

    Returns
    -------
    ExportPipelineResult
        with ``tables`` (schema + rows per produced table), detected
        ``relations``, and per-collection ``collections`` metadata.
    """
    known: Optional[Set[str]] = None
    if known_collection_fields is not None:
        known = set(known_collection_fields)

    result = ExportPipelineResult()

    for collection_name in export:
        if not isinstance(export[collection_name], dict):
            # Top-level primitive (e.g. {"version": 1}) - not a collection.
            continue

        records = extract_collection_records(
            collection_name,
            export,
            known_collection_fields=known,
        )
        schemas, results = run_pipeline(collection_name, records)

        collection_table_names = sorted(results.keys())
        child_table_names = [
            name for name in collection_table_names if name != collection_name
        ]

        result.collections.append(
            CollectionInfo(
                name=collection_name,
                recordCount=len(records),
                childTableCount=len(child_table_names),
                tableNames=collection_table_names,
            )
        )

        for table_name, rows in results.items():
            result.tables[table_name] = TableInfo(
                name=table_name,
                schema=schemas[table_name],
                rows=rows,
            )

    # Detect relations across all parent tables.
    available_tables = set(result.tables.keys())
    for table_name, info in result.tables.items():
        result.relations.extend(
            _detect_relations(table_name, info.rows, available_tables)
        )

    return result


__all__ = [
    "CollectionInfo",
    "ExportPipelineResult",
    "RelationRef",
    "TableInfo",
    "relationalize_export",
    "run_pipeline",
]
