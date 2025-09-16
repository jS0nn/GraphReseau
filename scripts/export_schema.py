#!/usr/bin/env python3
"""Export the Graph Pydantic schema to a JSON file.

Usage:
    python scripts/export_schema.py [--out docs/graph.schema.json] [--indent 2]

The script resolves the repository root automatically so it can be run from
any working directory inside the project.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure the repository root is on sys.path when running from arbitrary dirs.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.models import Graph  # noqa: E402


def export_schema(output_path: Path, indent: int | None = 2) -> None:
    schema = Graph.model_json_schema()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=indent if indent and indent > 0 else None)
        fh.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export Graph model JSON schema")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "docs" / "graph.schema.json",
        help="Output path for the schema JSON file (default: docs/graph.schema.json)",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indentation to use when writing JSON (default: 2, use 0 for compact)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    export_schema(args.out, indent=args.indent if args.indent is not None else 2)
    print(f"Schema exported to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
