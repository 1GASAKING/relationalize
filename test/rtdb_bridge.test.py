import unittest

from setup_tests import setup_tests

setup_tests()

import jsonschema  # noqa: E402

from rtdb_bridge import (  # noqa: E402
    CollectionInfo,
    DEFAULT_KNOWN_COLLECTION_FIELDS,
    ExportPipelineResult,
    RelationRef,
    convert_export_to_envelope,
    extract_collection_records,
    keyed_maps_to_arrays,
    normalize_type_label,
    relationalize_export,
    run_pipeline,
)
from rtdb_bridge.pipeline import TableInfo  # noqa: E402
from rtdb_bridge.schemas import SCHEMA_FILENAMES, load_all_schemas, load_schema  # noqa: E402

# A representative RTDB export exercising choice columns, nested keyed maps,
# arrays of primitives, and sparse records.
SAMPLE_EXPORT = {
    "users": {
        "u1": {
            "name": "Alice",
            "age": 30,
            "prefs": {"theme": "dark", "notifications": True},
            "tags": ["admin", "mod"],
            "orders": {
                "-o1": {"order_id": "ORD-1"},
            },
        },
        "u2": {
            "name": "Bob",
            "age": "thirty",
            "prefs": {"theme": "light"},
            "tags": ["guest"],
        },
    },
    "chat": {
        "m1": {"text": "hi", "user": "u1"},
    },
}


class SchemaLoaderTest(unittest.TestCase):
    def test_load_all_schemas_returns_four_contracts(self):
        schemas = load_all_schemas()
        self.assertEqual(
            sorted(schemas.keys()),
            sorted(SCHEMA_FILENAMES.keys()),
        )

    def test_schema_titles_and_versions(self):
        expected = {
            "database": ("DatabaseSchema", 1),
            "schema-tree": ("SchemaTreeNode", 1),
            "sql": ("SqlContract", 1),
            "rtdb-bridge": ("RtdbBridgeEnvelope", 1),
        }
        for name, (title, version) in expected.items():
            schema = load_schema(name)
            self.assertEqual(schema["title"], title, name)
            self.assertEqual(schema["version"], version, name)

    def test_unknown_schema_raises(self):
        with self.assertRaises(ValueError):
            load_schema("does-not-exist")


class PreprocessTest(unittest.TestCase):
    def test_keyed_maps_presence_set_becomes_rows(self):
        converted = keyed_maps_to_arrays({"u1": True, "u5": True})  # it stays object
        # Without known_collection_fields the keys are not push ids -> object.
        self.assertIsInstance(converted, dict)
        # Treating it as a collection converts to rows with value.
        converted2 = keyed_maps_to_arrays({"u1": True, "u5": True}, treat_as_collection=True)
        self.assertEqual(
            converted2,
            [
                {"record_id": "u1", "value": True},
                {"record_id": "u5", "value": True},
            ],
        )

    def test_empty_object_becomes_empty_array(self):
        self.assertEqual(keyed_maps_to_arrays({}), [])
        self.assertEqual(
            keyed_maps_to_arrays({"preferences": {}}),
            {"preferences": []},
        )

    def test_extract_collection_records_injects_rtdb_key(self):
        records = extract_collection_records(
            "users", SAMPLE_EXPORT, known_collection_fields=["friends"]
        )
        self.assertEqual([r["record_id"] for r in records], ["u1", "u2"])
        u1 = next(r for r in records if r["record_id"] == "u1")
        # orders is not in the passed known fields nor DEFAULT? it is in DEFAULT,
        # so supplying a non-empty set REPLACES the default entirely: orders is
        # not known -> push-keyed maps still arrayify, but the business-key map
        # stays a map. users has no business-key fields; prefs is a plain object.
        # orders has push-id keys "-o1", so it always converts to a real array.
        self.assertEqual(u1["orders"], [{"order_id": "ORD-1", "record_id": "-o1"}])
        self.assertIsInstance(u1["prefs"], dict)

    def test_extract_collection_records_arrayifies_known_fields(self):
        records = extract_collection_records(
            "users", SAMPLE_EXPORT, known_collection_fields=["orders"]
        )
        u1 = next(r for r in records if r["record_id"] == "u1")
        self.assertEqual(u1["orders"], [{"order_id": "ORD-1", "record_id": "-o1"}])
        # prefs is a plain object - flatten, not split.
        self.assertIsInstance(u1["prefs"], dict)

    def test_missing_collection_raises(self):
        with self.assertRaises(KeyError):
            extract_collection_records("nope", SAMPLE_EXPORT)


class PipelineTest(unittest.TestCase):
    def test_run_pipeline_produces_schemas_and_rows(self):
        records = extract_collection_records(
            "users", SAMPLE_EXPORT, known_collection_fields=["orders"]
        )
        schemas, results = run_pipeline("users", records)
        # users + users_orders + users_tags
        self.assertIn("users", results)
        self.assertIn("users_orders", results)
        self.assertIn("users_tags", results)
        self.assertGreaterEqual(len(results["users"]), 2)

    def test_relationalize_export_detects_child_tables_and_relations(self):
        result = relationalize_export(
            SAMPLE_EXPORT, known_collection_fields=["orders", "users"]
        )
        self.assertIsInstance(result, ExportPipelineResult)
        self.assertIn("users_tags", result.tables)
        self.assertIn("users_orders", result.tables)
        self.assertIsInstance(result.relations, list)
        # users.tags -> users_tags should be detected.
        relation_targets = {(r.fromTable, r.column, r.toTable) for r in result.relations}
        self.assertIn(("users", "tags", "users_tags"), relation_targets)
        self.assertIsInstance(result.collections[0], CollectionInfo)


class UiContractsTest(unittest.TestCase):
    def test_normalize_type_label_maps_primitive_labels(self):
        self.assertEqual(normalize_type_label("str"), "string")
        self.assertEqual(normalize_type_label("int"), "number")
        self.assertEqual(normalize_type_label("float"), "number")
        self.assertEqual(normalize_type_label("bool"), "boolean")
        self.assertEqual(normalize_type_label("datetime"), "timestamp")
        self.assertEqual(normalize_type_label("map"), "map")


class EnvelopeContractTest(unittest.TestCase):
    def test_known_good_export_validates_with_zero_warnings(self):
        env = convert_export_to_envelope(
            SAMPLE_EXPORT,
            database_name="demo",
            source_name="demo-export",
            validate=True,
        )
        self.assertEqual(env["envelopeVersion"], 1)
        self.assertEqual(env["generator"]["name"], "rtdb-bridge")
        self.assertEqual(env["database"]["name"], "demo")
        self.assertEqual(env["source"]["name"], "demo-export")
        self.assertEqual(env["tree"][0]["kind"], "database")
        self.assertEqual(env["warnings"], [])

    def test_sql_contract_mixed_columns_have_null_sqltype_and_members(self):
        env = convert_export_to_envelope(
            SAMPLE_EXPORT,
            validate=False,
        )
        users_sql = next(t for t in env["sql"]["tables"] if t["name"] == "users")
        age = next(c for c in users_sql["columns"] if c["name"] == "age")
        self.assertIsNone(age["sqlType"])
        self.assertEqual(
            [(m["type"], m["columnName"]) for m in age["choiceOf"]],
            [("int", "age_int"), ("str", "age_str")],
        )

    def test_canvas_mixed_column_carries_null_sqltype_and_child_members(self):
        env = convert_export_to_envelope(
            SAMPLE_EXPORT,
            validate=False,
        )
        users_table = next(t for t in env["database"]["tables"] if t["name"] == "users")
        age = next(c for c in users_table["columns"] if c["name"] == "age")
        self.assertIsNone(age["sqlType"])
        self.assertEqual(
            [(m["name"], m["sqlType"]) for m in age["choiceOf"]],
            [("age_int", "BIGINT"), ("age_str", "VARCHAR(65535)")],
        )

    def test_ui_tree_matches_canonical_schema_tree_shape(self):
        env = convert_export_to_envelope(
            SAMPLE_EXPORT,
            validate=False,
        )
        root = env["tree"][0]
        # Validate the whole tree array against the full schema-tree document,
        # so the internal #/definitions refs resolve against the whole document.
        jsonschema.validate(env["tree"], load_schema("schema-tree"))
        # Pseudo-node root kind sanity check.
        self.assertEqual(root["kind"], "database")

    def test_invalid_envelope_emits_schema_validation_warning(self):
        from rtdb_bridge.envelope import _validate_envelope

        good = convert_export_to_envelope(SAMPLE_EXPORT, validate=False)
        good["envelopeVersion"] = 99  # deliberately break the contract
        warnings = []
        _validate_envelope(good, warnings)
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["code"], "schema-validation-failed")

    def test_jsonschema_is_available(self):
        # This test only makes sense when run through the test venv that
        # installs the [contracts] extra.
        import jsonschema  # noqa: F401


if __name__ == "__main__":
    unittest.main()


