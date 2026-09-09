"""
rtdb_bridge
===========

Frozen-binary friendly bridge: Firebase RTDB export JSON -> SQL-ready,
normalized tables (via `relationalize`) -> one UI envelope containing both
`DatabaseSchema` (canvas contract) and `SchemaTreeNode` forest (explorer
tree contract) consumed by the dbchart VS Code extension.

High level flow
---------------
    rtdb export.json  ->  rtdb_bridge.convert_export_to_envelope(...)
                       ->  {
                             "envelopeVersion": 1,
                             "generator": {...},
                             "source":     {...},
                             "database":   DatabaseSchema,   # canvas
                             "tree":       [SchemaTreeNode], # explorer
                             "sql":        {"dialect", "ddl"},
                             "warnings":   [...]
                           }

The envelope JSON mirrors the canonical contract schemas shipped under
``rtdb_bridge/schemas/``:

    database.schema.json     DatabaseSchema   (canvas contract)
    schema-tree.schema.json  SchemaTreeNode   (explorer contract)
    sql.schema.json          DDL + type metadata
    rtdb-bridge.schema.json  Full Python -> TS envelope

Those files are the single versioned source of truth for every message type
crossing the Python / TypeScript boundary, so any worker, future web
package, or the VS Code extension validates against the same bytes.
"""

from .__version__ import __version__
from .contracts import (
    ENVELOPE_VERSION,
    GENERATOR_NAME,
    KIND_ICONS,
    POSTGRES_TYPE_MAPPING,
    SCHEMA_NODE_KINDS,
    SCHEMA_NODE_ORIGINS,
    SCHEMA_TABLE_TYPES,
    UI_TYPE_LABELS,
    UI_TYPE_ORDER,
    choice_parts,
    kind_icon,
    normalize_type_label,
)
from .envelope import (
    build_database_schema,
    build_envelope,
    build_sql_contract,
    convert_export_to_envelope,
)
from .preprocess import (
    DEFAULT_KNOWN_COLLECTION_FIELDS,
    extract_collection_records,
    keyed_maps_to_arrays,
)
from .pipeline import (
    CollectionInfo,
    ExportPipelineResult,
    RelationRef,
    TableInfo,
    relationalize_export,
    run_pipeline,
)
from .schemas import (
    SCHEMA_FILENAMES,
    load_all_schemas,
    load_schema,
)
from .ui_tree import (
    build_database_tree,
    build_keys_ui,
    build_references_ui,
    build_columns_ui,
    build_types_ui,
    table_to_ui_tree,
)

__all__ = [
    "__version__",
    # contracts
    "ENVELOPE_VERSION",
    "GENERATOR_NAME",
    "KIND_ICONS",
    "POSTGRES_TYPE_MAPPING",
    "SCHEMA_NODE_KINDS",
    "SCHEMA_NODE_ORIGINS",
    "SCHEMA_TABLE_TYPES",
    "UI_TYPE_LABELS",
    "UI_TYPE_ORDER",
    "choice_parts",
    "kind_icon",
    "normalize_type_label",
    # envelope
    "build_database_schema",
    "build_envelope",
    "build_sql_contract",
    "convert_export_to_envelope",
    # preprocess
    "DEFAULT_KNOWN_COLLECTION_FIELDS",
    "extract_collection_records",
    "keyed_maps_to_arrays",
    # pipeline
    "CollectionInfo",
    "ExportPipelineResult",
    "RelationRef",
    "TableInfo",
    "relationalize_export",
    "run_pipeline",
    # schemas
    "SCHEMA_FILENAMES",
    "load_all_schemas",
    "load_schema",
    # ui_tree
    "build_database_tree",
    "build_keys_ui",
    "build_references_ui",
    "build_columns_ui",
    "build_types_ui",
    "table_to_ui_tree",
]
