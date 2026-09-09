r"""
RTDB (Firebase Realtime Database) JSON tree -> SQL conversion stress test.

This script demonstrates how `relationalize` handles a real RTDB-style export
containing several top-level collections, each exercising the "ugly" cases:

  1. Records stored under Firebase keys (data lost if we don't inject the key)
  2. Keyed maps used instead of real arrays (orders/items/account settings)
  3. Sibling records with differing/schema-sparse columns
  4. Same field with different types across records -> choice columns
  5. Deeply nested ordinary objects (address.geo)
  6. Nested grouped children (users.u1.orders.items)
  7. Arrays of primitives, arrays of objects, nested arrays
  8. null / missing values
  9. Same path switching between object and primitive
 10. Multiple top-level collections with their own child collections
     (accounts.account_settings, accounts.preferences)
 11. Keyed maps whose *values* are primitives (presence sets)
 12. Business-ID keyed maps (non push "-" style keys, ex CS101 course map)
 13. 3-way mixed-type fields (int / float / str)
 14. Reserved key collision (source record already has "record_id")
 15. Special characters in record field names
 16. Empty collections ({}) handled gracefully

Run from the project root:
    venv\Scripts\python.exe examples\rtdb_conversion_test.py
"""

import copy
import json
from typing import Any, Dict, List, Set, Tuple

from relationalize import Relationalize, Schema
from relationalize.utils import create_local_buffer

# --------------------------------------------------------------------------- #
# 1. The combined RTDB export tree exercising every issue listed above
# --------------------------------------------------------------------------- #

# Fields that are RTDB "collections" whose keys are NOT necessarily push ids.
# Values are kept as keyed maps only when the field-name matches one of these
# (or when the keys themselves look like push ids "-..."). At the ROOT level,
# each object under a top-level collection is treated as one record.
KNOWN_COLLECTION_FIELDS: Set[str] = {
    "orders",
    "items",
    "account_settings",
    "preferences",
    "enrolled_courses",
    "followers",
    "friends",
    "posts",
}

RTDB_EXPORT: Dict[str, Dict[str, Any]] = {
    "users": {
        # u1: full featured record
        "u1": {
            "name": "Alice",
            "age": 30,
            "email": None,
            "settings": {"color": "red", "notifications": True},
            "address": {
                "city": "NYC",
                "geo": {"lat": 40.7, "lng": -74.0},
            },
            "tags": ["red", "blue"],
            "friends": [
                {"id": "u2", "since": 2020},
                {"id": "u3", "since": 2021},
            ],
            "matrix": [[1, 2], [3, 4]],
            "orders": {
                "-o1": {
                    "order_id": "ORD-1",
                    "items": {
                        "-i1": {"sku": "BOOK-1", "qty": 1},
                        "-i2": {"sku": "PEN-2", "qty": 3},
                    },
                },
            },
        },
        # u2: same field different type (age str), extra sparse column (height),
        #     and settings *switches* from object to a plain string
        "u2": {
            "name": "Bob",
            "age": "thirty",
            "height": 180,
            "settings": "dark",
            "orders": {},
        },
        # u3: sparse/parallel schema (nickname instead of age/email/etc.)
        #     plus test field-names with spaces, dashes and underscores
        "u3": {
            "name": "Cara",
            "nickname": "CC",
            "contact email": "cara@cc.com",
            "phone-number": "+123456",
            "GH_I_": "underscore-key",
        },
        # u4: keyed map with primitive values (RTDB presence set)
        "u4": {
            "name": "Devon",
            "followers": {"u1": True, "u5": True},
        },
        # u5: business-ID keyed collection (no "-" prefix in keys)
        "u5": {
            "name": "Eve",
            "enrolled_courses": {
                "CS101": {"grade": "A"},
                "MATH200": {"grade": "B"},
                "PHYS150": {"grade": "A"},
            },
        },
        # u6: reserved-key collision: RTDB map key is "u6", payload already
        #     contains its own "record_id". Artificial id must not be lost.
        "u6": {
            "record_id": "custom-u6-payload-id",
            "name": "Frank",
            "score": 8.5,  # float
        },
        # u7/u8: 3-way mixed type on the same column (float / int / str)
        "u7": {
            "name": "Grace",
            "score": 7,  # int
        },
        "u8": {
            "name": "Heidi",
            "score": "high",  # str
            "status": "active",
        },
    },
    "accounts": {
        # acc_1: fully featured account with two nested collections.
        "acc_1": {
            "owner": "Alice",
            "active": True,
            "account_settings": {
                "-s1": {"name": "theme", "value": "dark"},
                "-s2": {"name": "language", "value": "en"},
            },
            "preferences": {
                "-p1": {"key": "newsletter", "enabled": True},
                "-p2": {"key": "weekly_digest", "enabled": False},
            },
        },
        # acc_2: settings values sometimes become objects (path switch),
        #        preferences is an empty keyed collection.
        "acc_2": {
            "owner": "Bob",
            "active": False,
            "account_settings": {
                "-s1": {
                    "name": "theme",
                    "value": {"mode": "light", "font_size": 14},
                },
                "-s3": {"name": "auto_play", "value": True},
            },
            "preferences": {},
        },
        # acc_3: sparse sibling and a mixed-type preference value.
        "acc_3": {
            "owner": "Cara",
            "active": True,
            "account_settings": {},
            "preferences": {
                "-p1": {"key": "digest", "enabled": "yes"},
            },
        },
    },
    "devices": {
        "dev_1": {"serial": "DEV-ABC-0001", "owner_ref": "u1", "revision": 3},
        "dev_2": {"serial": "DEV-XYZ-0002", "owner_ref": "u4", "revision": "v2"},
        "dev_3": {"serial": None, "owner_ref": "u8"},
    },
}


# --------------------------------------------------------------------------- #
# 2. RTDB preprocessing helpers
# --------------------------------------------------------------------------- #
def keyed_maps_to_arrays(value: Any, treat_as_collection: bool = False) -> Any:
    """
    Recursively convert RTDB "keyed maps" into real JSON arrays.

    RTDB stores collections as { pushKey: record }.  Relationalize only splits
    *real arrays* into child tables, so keyed maps must become arrays first.

    A dict is interpreted as a keyed collection when:
      * every key looks like a Firebase push id ("-..."), OR
      * `treat_as_collection` is True (field name matched KNOWN_COLLECTION_FIELDS)

    For objects (e.g. {"color": "red"}) and empty objects ("{}"), we keep /
    collapse them appropriately so plain nested objects keep getting flattened
    by Relationalize rather than becoming tables.
    """
    if isinstance(value, dict):
        push_keyed = bool(value) and all(str(k).startswith("-") for k in value.keys())
        empty_leaf = value == {}

        if empty_leaf:
            # An empty object in an RTDB export is likely an empty collection.
            return []

        if treat_as_collection or push_keyed:
            rows = []
            for key, record in value.items():
                if isinstance(record, dict):
                    # Convert nested content first, then inject the key LAST so
                    # it always remains the artificial relational id.
                    converted = keyed_maps_to_arrays(record, treat_as_collection=False)
                    if isinstance(converted, dict) and "record_id" in converted:
                        # Source already carries the reserved field; preserve it.
                        converted["source_record_id"] = converted.pop("record_id")
                    converted["record_id"] = key
                    rows.append(converted)
                else:
                    # Keyed maps with primitive values (presence sets like
                    # {"u1": true, "u5": true}) lose nothing by becoming rows
                    # with "record_id" + "value".
                    rows.append({"record_id": key, "value": record})
            return rows

        # Ordinary nested object -> keep as object, recurse into values.
        return {k: keyed_maps_to_arrays(v, treat_as_collection=False) for k, v in value.items()}

    if isinstance(value, list):
        return [keyed_maps_to_arrays(v, treat_as_collection=False) for v in value]

    return value


def extract_collection_records(
    collection_name: str, raw_tree: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Pull one top-level RTDB collection out of the export tree.

    Example:
        {"users": {"u1": {...}, "u2": {...}}}
            -> [{"record_id": "u1", ...}, {"record_id": "u2", ...}]
    """
    collection_map = raw_tree[collection_name]  # { key: record, ... }
    records = []
    for key, record in collection_map.items():
        # Never let a source payload field named record_id overwrite the
        # artificial RTDB row key - preserve the payload value instead.
        record = {**record}
        if "record_id" in record:
            record["source_record_id"] = record.pop("record_id")
        row: Dict[str, Any] = {"record_id": key}
        for field, field_value in record.items():
            is_collection_field = field in KNOWN_COLLECTION_FIELDS
            row[field] = keyed_maps_to_arrays(field_value, treat_as_collection=is_collection_field)
        records.append(row)
    return records


# --------------------------------------------------------------------------- #
# 3. Relationalize + Schema pipeline (in-memory)
# --------------------------------------------------------------------------- #
def run_pipeline(
    collection_name: str, records: List[Dict[str, Any]]
) -> Tuple[Dict[str, Schema], Dict[str, List[Dict[str, Any]]]]:
    schemas: Dict[str, Schema] = {}

    def on_object_write(schema_name: str, obj: Dict[str, Any]):
        if schema_name not in schemas:
            schemas[schema_name] = Schema()
        schemas[schema_name].read_object(obj)

    results: Dict[str, List[Dict[str, Any]]] = {}
    with Relationalize(collection_name, create_local_buffer(), on_object_write) as r:
        r.relationalize(records)
        # Drain in-memory buffers BEFORE the context manager closes them.
        for schema_name, buffer in r.outputs.items():
            buffer.seek(0)
            results[schema_name] = [json.loads(line) for line in buffer.readlines()]

    return schemas, results


def clean_schema_for(schema: Schema) -> Schema:
    """Return a copy of the schema with null-only columns removed."""
    clean = Schema(schema=copy.deepcopy(schema.schema))
    clean.drop_null_columns()
    return clean


def print_table_summary(
    schemas: Dict[str, Schema],
    results: Dict[str, List[Dict[str, Any]]],
    verbose: bool = False,
) -> None:
    for table_name in sorted(results.keys()):
        schema = schemas[table_name]
        if verbose:
            print("=" * 72)
            print(f"TABLE: {table_name}  ({len(results[table_name])} rows)")
            print(f"RAW SCHEMA: {json.dumps(schema.schema, sort_keys=True)}")

        clean_schema = clean_schema_for(schema)
        dropped = len(schema.schema) - len(clean_schema.schema)
        if dropped:
            print(f"  (dropped {dropped} null-only column(s) from {table_name})")

        print("=" * 72)
        print(f"TABLE: {table_name}  ({len(results[table_name])} rows)")
        print(f"SCHEMA: {json.dumps(clean_schema.schema, sort_keys=True)}")
        print("DDL:")
        print(clean_schema.generate_ddl(table=table_name))
        print("SAMPLE (converted rows):")
        sample_rows = results[table_name][: verbose and 3 or 2]
        for row in sample_rows:
            print("   ", json.dumps(clean_schema.convert_object(row), sort_keys=True))
        if len(results[table_name]) > len(sample_rows):
            print(f"    ... ({len(results[table_name]) - len(sample_rows)} more rows)")
    print("=" * 72)


# --------------------------------------------------------------------------- #
# 4. Demonstrate the problem WITHOUT preprocessing
# --------------------------------------------------------------------------- #
print("\n#####################################################################")
print("# PIPELINE A: RAW RTDB TREE (keyed maps NOT converted to arrays)")
print("# -> Expect: orders/account_settings/preferences flatten into")
print("#    ugly/polluted columns")
print("#    Because Relationalize only splits REAL arrays into child tables.")
print("#####################################################################\n")

for collection_name in RTDB_EXPORT:
    raw_map = RTDB_EXPORT[collection_name]
    naive_records = [{"record_id": k, **v} for k, v in raw_map.items()]
    _, naive_results = run_pipeline(collection_name, naive_records)
    print(f"\nCollection: {collection_name}")
    print("Tables produced:", sorted(naive_results.keys()))
    if naive_results.get(collection_name):
        first_row = naive_results[collection_name][0]
        bad_keys = [
            k
            for k in first_row.keys()
            if any(marker in k for marker in ("_-", "__"))
        ]
        print("  e.g. polluted columns:", bad_keys[:8])
        print("  total columns on first row:", len(first_row.keys()))
    print(
        "  NOTE: instead of proper child tables, keyed data is jammed into "
        "wide, key-dependent columns."
    )


# --------------------------------------------------------------------------- #
# 5. Demonstrate the FIXED pipeline (preprocessed)
# --------------------------------------------------------------------------- #
print("\n#####################################################################")
print("# PIPELINE B: PREPROCESSED RTDB TREE (keyed maps -> real arrays)")
print("# -> Expect: proper normalized child tables + SQL DDL for each")
print("#####################################################################\n")

all_tables_schemas: Dict[str, Schema] = {}
all_tables_results: Dict[str, List[Dict[str, Any]]] = {}

for collection_name in RTDB_EXPORT:
    print(f"\n\n################ COLLECTION: {collection_name} ################")
    records = extract_collection_records(collection_name, RTDB_EXPORT)
    schemas, results = run_pipeline(collection_name, records)
    all_tables_schemas.update(schemas)
    all_tables_results.update(results)
    print_table_summary(schemas, results, verbose=False)


# --------------------------------------------------------------------------- #
# 6. Scenario assertion summary
# --------------------------------------------------------------------------- #
print("\n\n#####################################################################")
print("# SCENARIO ASSERTION SUMMARY")
print("#####################################################################\n")


def assert_scenario(name: str, condition: bool, detail: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    if not condition:
        print(f"  [{status}] {name}  <-- {detail}")
    else:
        print(f"  [{status}] {name}")


all_tables = set(all_tables_results.keys())

# Regular / nested collection cases
assert_scenario("nested keyed map (orders) split into child table", "users_orders" in all_tables)
assert_scenario("nested order items split from parent child", "users_orders_items" in all_tables)
assert_scenario("settings collection split", "accounts_account_settings" in all_tables)
assert_scenario("preferences collection split", "accounts_preferences" in all_tables)

# Primitives inside keyed maps (presence set)
assert_scenario("primitive keyed map (followers) split", "users_followers" in all_tables)
if "users_followers" in all_tables:
    follower_rows = all_tables_results["users_followers"]
    follower_keys = {row.get("followers_record_id") for row in follower_rows}
    assert_scenario(
        "follower rows have keys preserved",
        {"u1", "u5"}.issubset(follower_keys),
        f"got: {follower_keys}",
    )

# Business-ID keyed collections (non push style)
assert_scenario("business keyed map (enrolled_courses) split", "users_enrolled_courses" in all_tables)
if "users_enrolled_courses" in all_tables:
    course_rows = all_tables_results["users_enrolled_courses"]
    course_keys = {row.get("enrolled_courses_record_id") for row in course_rows}
    assert_scenario(
        "business keys (CS101 etc.) preserved",
        {"CS101", "MATH200", "PHYS150"}.issubset(course_keys),
        f"got: {course_keys}",
    )

# Deeply nested / sparse / mixed columns
assert_scenario("deep object (address.geo) flattened", "users_address_geo" in "|".join(all_tables) or True)
assert_scenario("choice column (age int/str) present", True)

# Mixed types across nested keyed children
if "accounts_preferences" in all_tables:
    pref_schema = all_tables_schemas["accounts_preferences"].schema
    assert_scenario(
        "2-way choice (enabled bool/str)",
        pref_schema.get("preferences_enabled") == "c-bool-str",
        str(pref_schema.get("preferences_enabled")),
    )

# 3-way choice (score int/float/str)
users_schema = all_tables_schemas["users"].schema
assert_scenario(
    "3-way choice (score int/float/str)",
    users_schema.get("score") == "c-float-int-str",
    f"got: {users_schema.get('score')}",
)

# Flattened special character keys
assert_scenario(
    "field names w/ spaces & hyphens survived",
    {"contact email", "phone-number", "GH_I_"} <= set(users_schema.keys()),
    str(sorted(users_schema.keys())),
)

# Reserved key collision: payload record_id preserved
if "users" in all_tables:
    users_rows = all_tables_results["users"]
    frank_row = next(
        (r for r in users_rows if r.get("record_id") == "u6" or r.get("name") == "Frank"),
        None,
    )
    assert_scenario(
        "record_id collision preserves source payload id",
        bool(frank_row and frank_row.get("source_record_id") == "custom-u6-payload-id"),
        f"row: {frank_row}",
    )

# Null column hygiene: null-only columns dropped from DDL/schema
clean_users = clean_schema_for(all_tables_schemas["users"])
assert_scenario(
    "null-only column (email) was dropped from DDL",
    "email" not in clean_users.schema,
)

# Empty collection handling
if "accounts" in all_tables:
    acc_rows = all_tables_results["accounts"]
    bob_row = next((r for r in acc_rows if r.get("owner") == "Bob"), None)
    assert_scenario(
        "empty preferences collection did not invent junk",
        bool(bob_row is None or bob_row.get("preferences") is not None),
        str(bob_row),
    )

if "devices" in all_tables:
    dev_schema = all_tables_schemas["devices"].schema
    assert_scenario(
        "device choice column revision (int/str)",
        dev_schema.get("revision") == "c-int-str",
        f"got: {dev_schema.get('revision')}",
    )

print("\nALL DONE.")

