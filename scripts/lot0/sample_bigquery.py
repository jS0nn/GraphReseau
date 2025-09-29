"""Extracts a sample from a BigQuery table for Lot 0 data validation.

Usage example:
    python scripts/lot0/sample_bigquery.py \
        --project $GCP_PROJECT_ID \
        --dataset biogaz \
        --table mesures \
        --limit 5000 \
        --out data/samples/mesures.json

Requires application-default credentials (`gcloud auth application-default login`)
with sufficient permissions to read the target dataset.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable

from google.cloud import bigquery


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch a sample from BigQuery")
    parser.add_argument("--project", required=True, help="GCP project hosting the dataset")
    parser.add_argument("--dataset", required=True, help="BigQuery dataset id")
    parser.add_argument("--table", required=True, help="BigQuery table id")
    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Maximum rows to fetch (default: 1000)",
    )
    parser.add_argument(
        "--where",
        default=None,
        help="Optional WHERE clause to filter rows (without the word WHERE)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional output path (.json or .csv). If omitted, prints summary only.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the query without downloading data.",
    )
    return parser.parse_args()


def build_query(project: str, dataset: str, table: str, limit: int, where: str | None) -> str:
    table_ref = f"`{project}.{dataset}.{table}`"
    clauses: list[str] = [f"SELECT * FROM {table_ref}"]
    if where:
        clauses.append(f"WHERE {where}")
    clauses.append(f"LIMIT {limit}")
    return "\n".join(clauses)


def write_json(path: Path, rows: Iterable[dict]) -> None:
    data = list(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: Iterable[dict]) -> None:
    rows = list(rows)
    if not rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
        return
    fieldnames = list(rows[0].keys())
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    client = bigquery.Client(project=args.project)
    query = build_query(args.project, args.dataset, args.table, args.limit, args.where)

    job = client.query(query, job_config=bigquery.QueryJobConfig(dry_run=args.dry_run))
    if args.dry_run:
        print(
            "Dry run successful. Estimated bytes processed:",
            getattr(job, "total_bytes_processed", "unknown"),
        )
        return

    rows = [dict(row) for row in job.result()]
    print(f"Fetched {len(rows)} row(s) from {args.dataset}.{args.table}.")

    if args.out:
        suffix = args.out.suffix.lower()
        if suffix == ".json":
            write_json(args.out, rows)
        elif suffix == ".csv":
            write_csv(args.out, rows)
        else:
            raise ValueError("Output file must end with .json or .csv")
        print(f"Sample written to {args.out}")
    else:
        preview = rows[:5]
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        if len(rows) > len(preview):
            print("… (truncated)")


if __name__ == "__main__":
    main()
