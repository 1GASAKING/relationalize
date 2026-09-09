"""
RTDB (Firebase Realtime Database) export preprocessing helpers.

These functions turn the raw Firebase JSON tree into arrays relationalize
understands.  Firebase stores collections as *keyed maps* (`{ "-pushKey": record }`),
but relationalize only splits *real arrays* into child tables.  Therefore every
keyed collection must first become an array, with the Firebase key injected as
the artificial `record_id` (a reserved key that pipelines use for joins).
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set

# Field names inside records that are (or can be) RTDB sub-collections keyed
# by business ids rather than Firebase push ids (e.g. "CS101").  These are
# converted to arrays even when their keys do not start with "-".
DEFAULT_KNOWN_COLLECTION_FIELDS: frozenset = frozenset(
    {
        "orders",
        "items",
        "account_settings",
        "preferences",
        "enrolled_courses",
        "followers",
        "friends",
        "posts",
    }
)


def keyed_maps_to_arrays(
    value: Any, treat_as_collection: bool = False
) -> Any:
    """
    Recursively convert RTDB "keyed maps" into real JSON arrays.

    RTDB stores collections as `{ pushKey: record }`.  Relationalize only
    splits *real arrays* into child tables, so keyed maps must become arrays
    first.

    A dict is interpreted as a keyed collection when:

    * it is empty (an empty Firebase collection -> `[]`), OR
    * every key looks like a Firebase push id ("-..."), OR
    * `treat_as_collection` is True (the field matched a known collection
      field).

    For ordinary nested objects (e.g. ``{"color": "red"}``) the dict is kept
    as an object so Relationalize continues to flatten it rather than
    inventing a child table.
    """
    if isinstance(value, dict):
        push_keyed = bool(value) and all(
            str(k).startswith("-") for k in value.keys()
        )

        if value == {}:
            # An empty object in an RTDB export is almost always an empty
            # collection.  Convert to [] so it cannot pollute parent columns.
            return []

        if treat_as_collection or push_keyed:
            rows: List[Dict[str, Any]] = []
            for key, record in value.items():
                if isinstance(record, dict):
                    # Convert nested content first, then inject the key LAST
                    # so it always remains the artificial relational id.
                    converted = keyed_maps_to_arrays(
                        record, treat_as_collection=False
                    )
                    if isinstance(converted, dict) and "record_id" in converted:
                        # Source content already carries the reserved field;
                        # preserve it under a sibling key.
                        converted["source_record_id"] = converted.pop(
                            "record_id"
                        )
                    converted["record_id"] = key
                    rows.append(converted)
                else:
                    # Keyed maps with primitive values (presence sets like
                    # {"u1": true, "u5": true}) become rows with a "value".
                    rows.append({"record_id": key, "value": record})
            return rows

        # Ordinary nested object -> keep as an object, recurse into values.
        return {
            k: keyed_maps_to_arrays(v, treat_as_collection=False)
            for k, v in value.items()
        }

    if isinstance(value, list):
        return [
            keyed_maps_to_arrays(v, treat_as_collection=False) for v in value
        ]

    return value


def extract_collection_records(
    collection_name: str,
    raw_tree: Dict[str, Any],
    known_collection_fields: Iterable[str] | None = None,
) -> List[Dict[str, Any]]:
    """
    Pull one top-level RTDB collection out of the export tree and turn it
    into an array of flat-ish records ready for Relationalize.

    Example:
        {"users": {"u1": {...}, "u2": {...}}}
            -> [{"record_id": "u1", ...}, {"record_id": "u2", ...}]

    ``collection_name`` must be one of the top-level keys in ``raw_tree``.
    The optional ``known_collection_fields`` set (defaults to
    :data:`DEFAULT_KNOWN_COLLECTION_FIELDS`) marks record fields whose values
    are business-id keyed collections that must be array-ified.
    """
    known_fields: Set[str] = set(known_collection_fields or DEFAULT_KNOWN_COLLECTION_FIELDS)

    try:
        collection_map: Dict[str, Any] = raw_tree[collection_name]
    except KeyError as exc:  # pragma: no cover - explicit missing key
        raise KeyError(
            f"Collection '{collection_name}' not found in export tree. "
            f"Available top-level collections: {sorted(raw_tree)}"
        ) from exc

    if not isinstance(collection_map, dict):
        raise TypeError(
            f"Expected collection '{collection_name}' to be a keyed map "
            f"(dict of Firebase key -> record), got {type(collection_map).__name__}."
        )

    records: List[Dict[str, Any]] = []
    for key, record in collection_map.items():
        # Never let a source payload field named record_id overwrite the
        # artificial RTDB row key - preserve the payload value instead.
        record = {**record} if isinstance(record, dict) else {"value": record}
        if "record_id" in record:
            record["source_record_id"] = record.pop("record_id")

        row: Dict[str, Any] = {"record_id": key}
        for field, field_value in record.items():
            is_collection_field = field in known_fields
            row[field] = keyed_maps_to_arrays(
                field_value, treat_as_collection=is_collection_field
            )
        records.append(row)

    return records


__all__ = [
    "DEFAULT_KNOWN_COLLECTION_FIELDS",
    "extract_collection_records",
    "keyed_maps_to_arrays",
]
