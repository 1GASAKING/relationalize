"""Quick smoke test for the rtdb_bridge contract package after packaging changes."""

import rtdb_bridge
import rtdb_bridge.schemas
from rtdb_bridge import convert_export_to_envelope
from rtdb_bridge.schemas import load_schema

print("imports OK")
print("schema titles:", [load_schema(n)["title"] for n in ["database", "schema-tree", "sql", "rtdb-bridge"]])

envelope = convert_export_to_envelope(
    {"users": {"u1": {"name": "A"}}},
    validate=True,
)
print("warnings:", envelope["warnings"])
assert envelope["warnings"] == [], envelope["warnings"]
print("SMOKE TEST PASSED")
