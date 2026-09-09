"""
Build the canonical Python -> TS envelope for the dbchart extension host.

The envelope mirrors the TypeScript contracts referenced by the VS Code
extension and is the single object returned by
:meth:`convert_export_to_envelope`:

    {
        "envelopeVersion": 1,
        "generator": { "name": "rtdb-bridge", "version": "0.1.0", "pipelineVersion": 1 },
        "source": { "format": "rtdb-export-json", "name": "...", ... },
        "database": DatabaseSchema,     # canvas contract
        "tree": [SchemaTreeNode],       # explorer tree
        "sql": { "dialect": "postgres", "tables": [...] },
        "warnings": [...]
    }
"""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any, Dict, Iterable, List, Optional

from relationalize import Schema
from relationalize.sql_dialects import PostgresDialect

from . import __version__
from .preprocess import DEFAULT_KNOWN_COLLECTION_FIELDS, extract_collection_records
from .pipeline import ExportPipelineResult, TableInfo, relationalize_export
from .schemas import load_schema
from .ui_tree import (
    build_database_tree,
    choice_parts,
    normalize_type_label,
)

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

ENVELOPE_VERSION: int = 1
PIPELINE_VERSION: int = 1
GENERATOR_NAME: str = "rtdb-bridge"
SOURCE_FORMAT: str = "rtdb-export-json"
DEFAULT_DIALECT: str = "postgres"
DEFAULT_SCHEMA_NAME: str = "public"

_POSTGRES_DIALECT = PostgresDialect()


# --------------------------------------------------------------------------- #
# DatabaseSchema canvas builders
# --------------------------------------------------------------------------- #


def _column_sql_type(raw_type: str) -> str:
    """Map a relationalize raw type to the dialect SQL column type."""
    if raw_type in _POSTGRES_DIALECT.type_column_mapping:
        return _POSTGRES_DIALECT.type_column_mapping[raw_type]
    return "VARCHAR(65535)"


def _build_choice_members(
    raw_rows: List[Dict[str, Any]], clean_schema: Schema, column: str, parts: List[str]
) -> List[Dict[str, Any]]:
    """Build the physical member objects for a logical choice/mixed column."""
    converted = [clean_schema.convert_object(row) for row in raw_rows]
    members = []
    for part in parts:
        if part == "none":
            continue
        phys_name = f"{column}_{part}"
        values = [row.get(phys_name) for row in converted]
        members.append(
            {
                "name": phys_name,
                "type": normalize_type_label(part),
                "sqlType": _column_sql_type(part),
                "nullable": any(v is None for v in values) if values else False,
                "partial": any(phys_name not in row for row in converted),
            }
        )
    return members


def _build_database_table(
    table_info: TableInfo,
    available_tables: set,
) -> Dict[str, Any]:
    """Convert one pipeline table into a DatabaseSchema table object."""
    clean = table_info.clean_schema()
    raw_rows = table_info.rows
    converted = [clean.convert_object(row) for row in raw_rows]

    columns: List[Dict[str, Any]] = []
    for column, raw_type in clean.schema.items():
        parts = choice_parts(raw_type)
        if parts:
            members = _build_choice_members(raw_rows, clean, column, parts)
            columns.append(
                {
                    "name": column,
                    "type": "mixed",
                    "uiType": "mixed",
                    "types": [normalize_type_label(p) for p in parts],
                    "sqlType": None,
                    "nullable": any(m["nullable"] for m in members) if members else False,
                    "partial": any(m["partial"] for m in members) if members else False,
                    "choiceOf": members,
                }
            )
            continue

        values = [row.get(column) for row in converted]
        ui_type = normalize_type_label(raw_type)
        columns.append(
            {
                "name": column,
                "type": ui_type,
                "uiType": ui_type,
                "sqlType": _column_sql_type(raw_type),
                "nullable": (any(v is None for v in values) or any(column not in row for row in converted)) if values else False,
                "partial": any(column not in row for row in converted),
            }
        )

    foreign_keys = []
    for col_obj in columns:
        col_name = col_obj["name"]
        child_name = f"{table_info.name}_{col_name}"
        if child_name in available_tables:
            foreign_keys.append(
                {
                    "name": f"{table_info.name}_{col_name}_fk",
                    "column": col_name,
                    "refTable": child_name,
                    "refColumn": "record_id",
                    "cardinality": "1:N",
                }
            )

    return {
        "name": table_info.name,
        "type": "table",
        "sourceCollection": None,
        "rowCount": len(raw_rows),
        "columnCount": len(columns),
        "columns": columns,
        "primaryKey": ["record_id"],
        "indexes": [],
        "foreignKeys": foreign_keys,
    }


def build_database_schema(
    database_name: str,
    pipeline_result: ExportPipelineResult,
) -> Dict[str, Any]:
    """Build the DatabaseSchema canvas contract from pipeline table outputs."""
    available_tables = set(pipeline_result.tables.keys())
    tables = [
        _build_database_table(info, available_tables)
        for info in pipeline_result.tables.values()
    ]
    tables.sort(key=lambda t: t["name"])
    return {
        "name": database_name,
        "tables": tables,
    }


# --------------------------------------------------------------------------- #
# SQL contract builders
# --------------------------------------------------------------------------- #


def _build_sql_table(table_info: TableInfo) -> Dict[str, Any]:
    """Build one table object within the SQL contract."""
    clean = table_info.clean_schema()
    ddl = clean.generate_ddl(table=table_info.name)

    columns = []
    for column, raw_type in clean.schema.items():
        parts = choice_parts(raw_type)
        if parts:
            sql_type = None
            choice_of = []
            for part in parts:
                if part == "none":
                    continue
                phys_name = f"{column}_{part}"
                choice_of.append(
                    {
                        "type": part,
                        "sqlType": _column_sql_type(part),
                        "columnName": phys_name,
                        "nullable": True,
                        "partial": True,
                    }
                )
            columns.append(
                {
                    "name": column,
                    "rawType": raw_type,
                    "sqlType": sql_type,
                    "choiceOf": choice_of,
                }
            )
        else:
            columns.append(
                {
                    "name": column,
                    "rawType": raw_type,
                    "sqlType": _column_sql_type(raw_type),
                }
            )

    columns.sort(key=lambda c: c["name"])
    return {
        "name": table_info.name,
        "schemaName": DEFAULT_SCHEMA_NAME,
        "ddl": ddl,
        "rowCount": len(table_info.rows),
        "columns": columns,
    }


def build_sql_contract(
    pipeline_result: ExportPipelineResult,
) -> Dict[str, Any]:
    """Build SQL DDL metadata contract from pipeline schema outputs."""
    return {
        "dialect": DEFAULT_DIALECT,
        "tables": [
            _build_sql_table(info)
            for info in sorted(pipeline_result.tables.values(), key=lambda t: t.name)
        ],
    }


# --------------------------------------------------------------------------- #
# Envelope assembly & validation
# --------------------------------------------------------------------------- #


def _build_source_info(
    source_name: Optional[str],
    pipeline_result: ExportPipelineResult,
) -> Dict[str, Any]:
    record_count = sum(c.recordCount for c in pipeline_result.collections)
    return {
        "format": SOURCE_FORMAT,
        "name": source_name,
        "recordCount": record_count,
        "collectionCount": len(pipeline_result.collections),
    }


def build_envelope(
    database_name: str,
    pipeline_result: ExportPipelineResult,
    source_name: Optional[str] = None,
    validate: bool = True,
) -> Dict[str, Any]:
    """
    Assemble the full Python -> TS envelope from pipeline outputs.

    Parameters
    ----------
    database_name:
        Display name for the database/canvas root.
    pipeline_result:
        Output of :meth:`~rtdb_bridge.pipeline.relationalize_export`.
    source_name:
        Optional original database/export name for the ``source`` member.
    validate:
        When True, validate against ``schemas/rtdb-bridge.schema.json``
        using the optional ``jsonschema`` package.  If the package is not
        installed a ``schema-validation-unavailable`` warning is appended and
        no exception is raised.  When False no validation is performed.
    """
    warnings: List[Dict[str, Any]] = []

    envelope: Dict[str, Any] = {
        "envelopeVersion": ENVELOPE_VERSION,
        "generator": {
            "name": GENERATOR_NAME,
            "version": __version__,
            "pipelineVersion": PIPELINE_VERSION,
        },
        "source": _build_source_info(source_name, pipeline_result),
        "database": build_database_schema(database_name, pipeline_result),
        "tree": [build_database_tree(database_name, list(pipeline_result.tables.values()))],
        "sql": build_sql_contract(pipeline_result),
        "warnings": warnings,
    }

    if validate:
        _validate_envelope(envelope, warnings)

    return envelope


def _validate_envelope(
    envelope: Dict[str, Any], warnings: List[Dict[str, Any]]
) -> None:
    """Validate the envelope against the canonical schema when possible."""
    try:
        import jsonschema
        from jsonschema import RefResolver
    except ImportError:  # pragma: no cover - optional dependency
        warnings.append(
            {
                "code": "schema-validation-unavailable",
                "message": (
                    "The 'jsonschema' package is not installed.  The envelope "
                    "was produced but could not be validated against "
                    "rtdb-bridge.schema.json.  Install jsonschema to enable "
                    "contract validation."
                ),
            }
        )
        return

    schema = load_schema("rtdb-bridge")

    # Load every sibling canonical schema so cross-file $refs resolve.
    store = {
        "https://dbchart.dev/contracts/database.schema.json": load_schema("database"),
        "https://dbchart.dev/contracts/schema-tree.schema.json": load_schema("schema-tree"),
        "https://dbchart.dev/contracts/sql.schema.json": load_schema("sql"),
    }
    resolver = RefResolver.from_schema(schema, store=store)

    try:
        jsonschema.validate(envelope, schema, resolver=resolver)
    except jsonschema.ValidationError as exc:
        # Best-effort: surface schema drift as a warning rather than a crash.
        warnings.append(
            {
                "code": "schema-validation-failed",
                "message": f"Envelope failed validation against rtdb-bridge.schema.json: {exc.message}",
                "details": {"path": list(exc.absolute_path), "validator": exc.validator},
            }
        )


def convert_export_to_envelope(
    export: Dict[str, Any],
    database_name: Optional[str] = None,
    source_name: Optional[str] = None,
    known_collection_fields: Optional[Iterable[str]] = None,
    validate: bool = True,
) -> Dict[str, Any]:
    """
    Full bridge: raw RTDB export JSON -> the canonical UI envelope.

    This is the primary entry point for the dbchart extension host and for
    the Python worker.

    Parameters
    ----------
    export:
        Parsed Firebase RTDB export JSON.  Each top-level key is a collection
        name whose value is a dict of Firebase key -> record.
    database_name:
        Display name for the database/canvas root.  Defaults to
        ``"rtdb_to_sql"``.
    source_name:
        Optional original export / database name recorded in ``source``.
        Defaults to ``database_name``.
    known_collection_fields:
        Optional field-name set marking keyed maps collections keyed by
        business ids.  Defaults to
        :data:`~rtdb_bridge.preprocess.DEFAULT_KNOWN_COLLECTION_FIELDS`.
    validate:
        Pass-through to :meth:`build_envelope` controlling optional
        JSON-schema validation (see there for semantics).
    """
    if database_name is None:
        database_name = "rtdb_to_sql"
    if source_name is None:
        source_name = database_name

    pipeline_result = relationalize_export(
        export,
        known_collection_fields=known_collection_fields,
    )
    return build_envelope(
        database_name=database_name,
        pipeline_result=pipeline_result,
        source_name=source_name,
        validate=validate,
    )


__all__ = [
    "ENVELOPE_VERSION",
    "GENERATOR_NAME",
    "PIPELINE_VERSION",
    "SOURCE_FORMAT",
    "build_database_schema",
    "build_envelope",
    "build_sql_contract",
    "convert_export_to_envelope",
]


