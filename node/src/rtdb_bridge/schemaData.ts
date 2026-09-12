// AUTO-GENERATED FILE - do not edit by hand.
// Run `npm run gen:schemas` (scripts/generate-schema-data.mjs) to refresh.
//
// These are the canonical JSON Schema contracts copied verbatim from
// rtdb_bridge/schemas/*.schema.json so the Node port ships the exact same
// bytes as the Python package without any runtime filesystem access.

/** Short name -> canonical filename (mirrors rtdb_bridge/schemas/__init__.py). */
export const SCHEMA_FILENAMES = {
  "database": "database.schema.json",
  "schema-tree": "schema-tree.schema.json",
  "sql": "sql.schema.json",
  "rtdb-bridge": "rtdb-bridge.schema.json",
} as const;

export type SchemaName = keyof typeof SCHEMA_FILENAMES;

/** The canonical draft-07 JSON Schema documents, keyed by short name. */
export const SCHEMA_DOCUMENTS: Record<SchemaName, Record<string, unknown>> = {
  "database": {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://dbchart.dev/contracts/database.schema.json",
  "title": "DatabaseSchema",
  "description": "Canonical canvas contract: normalized tables, columns, and relationships produced by relationalize and consumed by the dbchart extension host. Mirrors packages/schema/src/database.ts (DatabaseSchema / SchemaTable / SchemaColumn / SchemaRelationship).",
  "version": 1,
  "definitions": {
    "SchemaTableType": {
      "type": "string",
      "enum": [
        "table",
        "view",
        "collection",
        "stream",
        "queue"
      ],
      "description": "Must stay in lock-step with SCHEMA_TABLE_TYPES in rtdb_bridge/contracts.py."
    },
    "SchemaColumnType": {
      "type": "string",
      "description": "UI type vocabulary: string | number | boolean | timestamp | ref | list | map | null | mixed. Also accepts a relationalize raw label (str/int/float/bool/none/datetime/list/map/object) for bridge-internal use."
    },
    "SchemaColumn": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string"
        },
        "type": {
          "$ref": "#/definitions/SchemaColumnType"
        },
        "sqlType": {
          "type": [
            "string",
            "null"
          ],
          "description": "Dialect SQL type (e.g. BIGINT, TIMESTAMP, VARCHAR(65535), BOOLEAN, FLOAT). Null on logical mixed columns - see choiceOf for physical member types."
        },
        "nullable": {
          "type": "boolean"
        },
        "partial": {
          "type": "boolean"
        },
        "uiType": {
          "$ref": "#/definitions/SchemaColumnType"
        },
        "typeSummary": {
          "type": "string"
        },
        "types": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Choices for a mixed column: original language types detected (e.g. [\"number\", \"string\"])."
        },
        "sample": {
          "type": "array",
          "items": {},
          "description": "Up to N distinct human-readable sample values for this column."
        },
        "refTable": {
          "type": "string",
          "description": "Present only when column is a relation id (1:N child table name)."
        },
        "cardinality": {
          "type": "string",
          "enum": [
            "1:1",
            "1:N",
            "N:1",
            "N:N"
          ]
        },
        "choiceOf": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/SchemaColumn"
          },
          "description": "Physical member columns backing a logical mixed column (e.g. age_int / age_str with their concrete SQL types)."
        }
      },
      "required": [
        "name",
        "type"
      ]
    },
    "SchemaTable": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string"
        },
        "type": {
          "$ref": "#/definitions/SchemaTableType"
        },
        "sourceCollection": {
          "type": [
            "string",
            "null"
          ],
          "description": "Original RTDB top-level collection this table was derived from, or null when unknown."
        },
        "rowCount": {
          "type": "integer",
          "minimum": 0
        },
        "columnCount": {
          "type": "integer",
          "minimum": 0
        },
        "columns": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/SchemaColumn"
          }
        },
        "primaryKey": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Column name(s) forming the primary key (usually [\"record_id\"])."
        },
        "indexes": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "name": {
                "type": "string"
              },
              "columns": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "unique": {
                "type": "boolean"
              }
            },
            "required": [
              "name",
              "columns"
            ]
          }
        },
        "foreignKeys": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "name": {
                "type": "string"
              },
              "column": {
                "type": "string"
              },
              "refTable": {
                "type": "string"
              },
              "refColumn": {
                "type": "string"
              },
              "cardinality": {
                "type": "string",
                "enum": [
                  "1:1",
                  "1:N",
                  "N:1",
                  "N:N"
                ]
              }
            },
            "required": [
              "column",
              "refTable"
            ]
          }
        }
      },
      "required": [
        "name",
        "columns"
      ]
    }
  },
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "name": {
      "type": "string",
      "description": "Database / project display name."
    },
    "tables": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/SchemaTable"
      }
    }
  },
  "required": [
    "name",
    "tables"
  ]
},
  "schema-tree": {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://dbchart.dev/contracts/schema-tree.schema.json",
  "title": "SchemaTreeNode",
  "description": "A forest of SchemaTreeNode roots. When a single-database bridge emits a tree, the array holds one root node with kind=database.",
  "version": 1,
  "definitions": {
    "SchemaNodeKind": {
      "type": "string",
      "enum": [
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
        "columns",
        "keys",
        "key",
        "references",
        "reference",
        "types"
      ],
      "description": "Must stay in lock-step with SCHEMA_NODE_KINDS in rtdb_bridge/contracts.py, PLUS the composite container kinds emitted by the UI tree layer (columns/keys/references/types) and their children (key/reference)."
    },
    "SchemaNodeOrigin": {
      "type": "string",
      "enum": [
        "static",
        "metadata",
        "user"
      ]
    },
    "SchemaTreeNodeMeta": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "title": {
          "type": "string"
        },
        "icon": {
          "type": "string",
          "description": "Codicon name without the codicon- prefix (e.g. table, link, symbol-field)."
        },
        "label": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "origin": {
          "$ref": "#/definitions/SchemaNodeOrigin"
        },
        "rowCount": {
          "type": "integer",
          "minimum": 0
        },
        "tableCount": {
          "type": "integer",
          "minimum": 0
        },
        "column": {
          "type": "string"
        },
        "value": {},
        "count": {
          "type": "integer",
          "minimum": 0
        },
        "empty": {
          "type": "boolean"
        },
        "uiType": {
          "type": "string"
        },
        "typeSummary": {
          "type": "string"
        },
        "types": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summary": {
          "type": "string"
        },
        "nullable": {
          "type": "boolean"
        },
        "partial": {
          "type": "boolean"
        },
        "sample": {
          "type": "array",
          "items": {}
        },
        "refTable": {
          "type": "string"
        },
        "cardinality": {
          "type": "string"
        },
        "from": {
          "type": "string"
        },
        "to": {
          "type": "string"
        },
        "ddl": {
          "type": "string"
        }
      }
    },
    "SchemaTreeNode": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "$ref": "#/definitions/SchemaNodeKind"
        },
        "name": {
          "type": "string"
        },
        "meta": {
          "$ref": "#/definitions/SchemaTreeNodeMeta"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/SchemaTreeNode"
          }
        }
      },
      "required": [
        "kind",
        "name"
      ]
    }
  },
  "type": "array",
  "items": {
    "$ref": "#/definitions/SchemaTreeNode"
  }
},
  "sql": {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://dbchart.dev/contracts/sql.schema.json",
  "title": "SqlContract",
  "description": "DDL + type/choice-column metadata emitted by the Python bridge. Consumed by the dbchart extension host to render SQL previews and drive dialect-aware features.",
  "version": 1,
  "definitions": {
    "SqlDialect": {
      "type": "string",
      "enum": [
        "postgres",
        "postgresql",
        "mysql",
        "sqlite",
        "redshift",
        "bigquery"
      ],
      "description": "Dialect identifier. postgres is the default relationalize dialect."
    },
    "ColumnTypeInfo": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "Logical column name as seen in the source schema."
        },
        "rawType": {
          "type": "string",
          "description": "relationalize raw label: str | int | float | bool | none | datetime | unsupported:<python-type> | c-<dash-delimited choices>."
        },
        "sqlType": {
          "type": [
            "string",
            "null"
          ],
          "description": "Physical SQL column type emitted for this column. Null for logical mixed choice columns - see choiceOf."
        },
        "choiceOf": {
          "type": "array",
          "description": "Present only for choice columns: the physical SQL names mapped to each member type.",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "description": "Member type label (e.g. int, str)."
              },
              "sqlType": {
                "type": "string",
                "description": "Physical SQL type for this member (e.g. BIGINT)."
              },
              "columnName": {
                "type": "string",
                "description": "Physical SQL column name (e.g. age_int)."
              },
              "nullable": {
                "type": "boolean"
              },
              "partial": {
                "type": "boolean"
              }
            },
            "required": [
              "type",
              "sqlType",
              "columnName"
            ]
          }
        }
      },
      "required": [
        "name",
        "rawType",
        "sqlType"
      ]
    },
    "SqlTable": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "SQL table name."
        },
        "schemaName": {
          "type": "string",
          "description": "SQL schema/namespace (defaults to public)."
        },
        "ddl": {
          "type": "string",
          "description": "Full CREATE TABLE statement generated by the dialect."
        },
        "rowCount": {
          "type": "integer",
          "minimum": 0
        },
        "columns": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/ColumnTypeInfo"
          }
        }
      },
      "required": [
        "name",
        "ddl",
        "columns"
      ]
    }
  },
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "dialect": {
      "$ref": "#/definitions/SqlDialect"
    },
    "tables": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/SqlTable"
      }
    }
  },
  "required": [
    "dialect",
    "tables"
  ]
},
  "rtdb-bridge": {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://dbchart.dev/contracts/rtdb-bridge.schema.json",
  "title": "RtdbBridgeEnvelope",
  "description": "The canonical Python -> TS envelope. A complete bridge output MUST validate against this file before being emitted to the dbchart extension host.",
  "version": 1,
  "definitions": {
    "GeneratorInfo": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "const": "rtdb-bridge"
        },
        "version": {
          "type": "string",
          "description": "rtdb_bridge package version (__version__)."
        },
        "pipelineVersion": {
          "type": "integer",
          "description": "Schema pipeline version. Mirrors rtdb_bridge.file_version."
        }
      },
      "required": [
        "name",
        "version"
      ]
    },
    "SourceInfo": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "rtdb-export-json",
            "firebase-rtdb-json",
            "generic-json"
          ]
        },
        "name": {
          "type": "string",
          "description": "Original database/export name when known."
        },
        "recordCount": {
          "type": "integer",
          "minimum": 0
        },
        "collectionCount": {
          "type": "integer",
          "minimum": 0
        },
        "exportedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "Warning": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "code": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "collection": {
          "type": "string"
        },
        "recordId": {
          "type": "string"
        },
        "field": {
          "type": "string"
        },
        "details": {
          "type": "object"
        }
      },
      "required": [
        "code",
        "message"
      ]
    }
  },
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "envelopeVersion": {
      "type": "integer",
      "const": 1
    },
    "generator": {
      "$ref": "#/definitions/GeneratorInfo"
    },
    "source": {
      "$ref": "#/definitions/SourceInfo"
    },
    "database": {
      "$ref": "https://dbchart.dev/contracts/database.schema.json"
    },
    "tree": {
      "$ref": "https://dbchart.dev/contracts/schema-tree.schema.json"
    },
    "sql": {
      "$ref": "https://dbchart.dev/contracts/sql.schema.json"
    },
    "warnings": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/Warning"
      }
    }
  },
  "required": [
    "envelopeVersion",
    "generator",
    "database",
    "tree",
    "sql",
    "warnings"
  ]
},
};
