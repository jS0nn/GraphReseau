"""Utilities to exercise GET/POST round-trips for the QA campaign.

Usage examples:
    python scripts/qa_roundtrip.py json --path tests/fixtures/qa-modele/export_v2_sample.json
    python scripts/qa_roundtrip.py sheets --sheet-id $SHEET_ID --env-file .env.dev
    python scripts/qa_roundtrip.py bigquery --dataset my_dataset --nodes-table nodes --edges-table edges

For Sheets/BigQuery the script assumes that application default credentials are available.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict

from fastapi.testclient import TestClient

from app.main import app


def load_env_file(path: Path | None) -> None:
    if not path:
        return
    if not path.exists():
        raise FileNotFoundError(f"Env file not found: {path}")
    for line in path.read_text().splitlines():
        if not line or line.strip().startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def summary(message: str, payload: Dict[str, Any]) -> None:
    nodes = payload.get("nodes", [])
    edges = payload.get("edges", [])
    branches = payload.get("branches", [])
    crs = payload.get("crs", {})
    print(f"{message}: {len(nodes)} nodes, {len(edges)} edges, {len(branches)} branches, crs={crs}")


def roundtrip_json(path: Path) -> None:
    client = TestClient(app)
    uri = path.resolve().as_uri()
    params = {"source": "gcs_json", "gcs_uri": uri}

    get_resp = client.get("/api/graph", params=params)
    get_resp.raise_for_status()
    payload = get_resp.json()
    summary("GET gcs_json", payload)

    post_resp = client.post("/api/graph", params=params, json=payload)
    post_resp.raise_for_status()
    print("POST gcs_json succeeded")


def roundtrip_sheets(sheet_id: str, nodes_tab: str, edges_tab: str) -> None:
    client = TestClient(app)
    params = {
        "source": "sheet",
        "sheet_id": sheet_id,
        "nodes_tab": nodes_tab,
        "edges_tab": edges_tab,
    }

    print("Running Sheets GET...")
    get_resp = client.get("/api/graph", params=params)
    get_resp.raise_for_status()
    payload = get_resp.json()
    summary("GET sheet", payload)

    print("Running Sheets POST...")
    post_resp = client.post("/api/graph", params=params, json=payload)
    post_resp.raise_for_status()
    print("POST sheet succeeded")


def roundtrip_bigquery(project_id: str, dataset: str, nodes_table: str, edges_table: str) -> None:
    client = TestClient(app)
    params = {
        "source": "bigquery",
        "bq_project": project_id,
        "bq_dataset": dataset,
        "bq_nodes": nodes_table,
        "bq_edges": edges_table,
    }

    print("Running BigQuery GET...")
    get_resp = client.get("/api/graph", params=params)
    get_resp.raise_for_status()
    payload = get_resp.json()
    summary("GET bigquery", payload)

    print("Running BigQuery POST... (expected 501 if not implemented)")
    post_resp = client.post("/api/graph", params=params, json=payload)
    if post_resp.status_code == 501:
        print("POST bigquery returned 501 (expected for V1)")
    else:
        post_resp.raise_for_status()
        print("POST bigquery succeeded")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="QA round-trip helper")
    parser.add_argument("mode", choices=["json", "sheets", "bigquery"], help="Data source to exercise")
    parser.add_argument("--env-file", dest="env_file", help="Optional .env file to preload")
    parser.add_argument("--path", help="Path to JSON export (mode=json)")
    parser.add_argument("--sheet-id", dest="sheet_id", help="Google Sheet ID (mode=sheets)")
    parser.add_argument("--nodes-tab", dest="nodes_tab", default="Nodes", help="Sheet tab for nodes")
    parser.add_argument("--edges-tab", dest="edges_tab", default="Edges", help="Sheet tab for edges")
    parser.add_argument("--bq-project", dest="bq_project", help="BigQuery project (mode=bigquery)")
    parser.add_argument("--bq-dataset", dest="bq_dataset", help="BigQuery dataset (mode=bigquery)")
    parser.add_argument("--bq-nodes", dest="bq_nodes", default="nodes", help="BigQuery table for nodes")
    parser.add_argument("--bq-edges", dest="bq_edges", default="edges", help="BigQuery table for edges")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env_file = Path(args.env_file) if args.env_file else None
    load_env_file(env_file)

    if args.mode == "json":
        if not args.path:
            raise SystemExit("--path is required in json mode")
        roundtrip_json(Path(args.path))
    elif args.mode == "sheets":
        if not args.sheet_id:
            raise SystemExit("--sheet-id is required in sheets mode")
        roundtrip_sheets(args.sheet_id, args.nodes_tab, args.edges_tab)
    else:
        missing = [
            name for name in ("bq_project", "bq_dataset") if not getattr(args, name)
        ]
        if missing:
            raise SystemExit(f"Missing arguments for bigquery mode: {', '.join(missing)}")
        roundtrip_bigquery(args.bq_project, args.bq_dataset, args.bq_nodes, args.bq_edges)


if __name__ == "__main__":
    main()
