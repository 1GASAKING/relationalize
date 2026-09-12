"""
Command-line bridge: Firebase RTDB export JSON  ->  canonical bridge envelope.

This entry point exists so a **non-Python host** (a VS Code extension host, a
Node script, a CI job, a shell pipeline) can use :mod:`rtdb_bridge` without
importing Python.  The export is read from a file or stdin, and the envelope
is written to a file or stdout as JSON.

    python -m rtdb_bridge --database-name demo < export.json > envelope.json
    python -m rtdb_bridge -i export.json -o envelope.json --no-validate

Stdout carries *only* the envelope JSON so a caller can ``JSON.parse`` it
directly; every diagnostic goes to stderr.  Input and output are forced to
UTF-8 because Node's ``child.stdin``/``child.stdout`` are UTF-8 streams.

When frozen with PyInstaller, use ``scripts/rtdb_bridge_cli.py`` as the entry
script (it imports this module first so package-relative imports keep
working), then ship the binary with your extension:

    pyinstaller --onefile --name rtdb-bridge scripts/rtdb_bridge_cli.py

The frozen binary speaks the exact same stdin/stdout contract, so the caller
does not need a system Python install.

Exit codes:
    0   envelope written to stdout/output file
    1   bad usage, unreadable input, or invalid input JSON
    2   the bridge failed while converting the export
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, List, Optional, Sequence

from . import __version__, convert_export_to_envelope


def build_parser() -> argparse.ArgumentParser:
    """Construct the argument parser (exposed for tests / embedding)."""
    parser = argparse.ArgumentParser(
        prog="python -m rtdb_bridge",
        description=(
            "Convert a Firebase Realtime Database export JSON into the "
            "canonical rtdb-bridge envelope (database + tree + sql)."
        ),
    )
    parser.add_argument(
        "-i",
        "--input",
        metavar="FILE",
        help="RTDB export JSON file. Defaults to stdin.",
    )
    parser.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        help="Write the envelope here. Defaults to stdout.",
    )
    parser.add_argument(
        "--database-name",
        default="rtdb_to_sql",
        help="Display name for the database/canvas root (default: rtdb_to_sql).",
    )
    parser.add_argument(
        "--source-name",
        default=None,
        help=(
            "Original export/database name recorded in source "
            "(default: the database name)."
        ),
    )
    parser.add_argument(
        "--known-fields",
        default=None,
        help=(
            "Comma-separated field names that are keyed maps (RTDB "
            "sub-collections keyed by business ids). Defaults to "
            "rtdb_bridge.DEFAULT_KNOWN_COLLECTION_FIELDS."
        ),
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation. 0 emits compact JSON (default: 2).",
    )
    parser.add_argument(
        "--no-validate",
        action="store_true",
        help="Skip JSON-schema validation of the produced envelope.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    return parser


def _force_utf8(stream: Any) -> None:
    """Best-effort UTF-8 so unicode survives the Node <-> Python pipe."""
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8")
        except (ValueError, OSError):  # pragma: no cover - depends on host
            pass


def _read_export(path: Optional[str]) -> Any:
    """Read + parse the RTDB export from a path (or stdin when path is None/-)."""
    if path in (None, "-"):
        text = sys.stdin.read()
    else:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    if not text.strip():
        raise ValueError("empty input: no RTDB export JSON was provided")
    return json.loads(text)


def _parse_known_fields(raw: Optional[str]) -> Optional[List[str]]:
    if not raw:
        return None
    fields = [field.strip() for field in raw.split(",") if field.strip()]
    return fields or None


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Run the CLI. Returns the process exit code."""
    _force_utf8(sys.stdin)
    _force_utf8(sys.stdout)
    _force_utf8(sys.stderr)
    args = build_parser().parse_args(argv)

    try:
        export = _read_export(args.input)
    except (OSError, ValueError) as exc:
        print(f"rtdb-bridge: cannot read input: {exc}", file=sys.stderr)
        return 1

    if not isinstance(export, dict):
        print(
            "rtdb-bridge: input must be a JSON object (the RTDB export tree)",
            file=sys.stderr,
        )
        return 1

    try:
        envelope = convert_export_to_envelope(
            export,
            database_name=args.database_name,
            source_name=args.source_name,
            known_collection_fields=_parse_known_fields(args.known_fields),
            validate=not args.no_validate,
        )
    except Exception as exc:  # noqa: BLE001 - surface any bridge failure to the host
        print(f"rtdb-bridge: conversion failed: {exc}", file=sys.stderr)
        return 2

    dump_kwargs: dict = {"default": str, "ensure_ascii": False}
    if args.indent and args.indent > 0:
        dump_kwargs["indent"] = args.indent
    else:
        dump_kwargs["separators"] = (",", ":")
    payload = json.dumps(envelope, **dump_kwargs)

    try:
        if args.output:
            with open(args.output, "w", encoding="utf-8") as fh:
                fh.write(payload)
        else:
            sys.stdout.write(payload)
            sys.stdout.write("\n")
    except OSError as exc:
        print(f"rtdb-bridge: cannot write output: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
