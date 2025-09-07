import os
from typing import List


def getenv(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


class Settings:
    # Data source selection
    data_source_default: str = getenv("DATA_SOURCE", "sheet").lower()  # sheet | gcs_json | bigquery

    # Google Cloud / ADC
    gcp_project_id: str = getenv("GCP_PROJECT_ID", getenv("GOOGLE_CLOUD_PROJECT", ""))
    gcp_region: str = getenv("GCP_REGION", "europe-west1")

    # Sheets
    sheet_id_default: str = getenv("SHEET_ID_DEFAULT", getenv("SHEET_ID", ""))
    sheet_nodes_tab: str = getenv("SHEET_NODES_TAB", "Nodes")
    sheet_edges_tab: str = getenv("SHEET_EDGES_TAB", "Edges")

    # GCS JSON
    gcs_json_uri_default: str = getenv("GCS_JSON_URI", "")  # ex: gs://bucket/path/to/graph.json

    # BigQuery
    bq_project_id: str = getenv("BQ_PROJECT_ID", "")
    bq_dataset: str = getenv("BQ_DATASET", "")
    bq_nodes_table: str = getenv("BQ_NODES_TABLE", "nodes")
    bq_edges_table: str = getenv("BQ_EDGES_TABLE", "edges")

    # Embed
    embed_static_key: str = getenv("EMBED_STATIC_KEY", "")
    allowed_frame_ancestors: str = getenv(
        "ALLOWED_FRAME_ANCESTORS",
        "https://lookerstudio.google.com https://sites.google.com",
    )
    allowed_referer_hosts: List[str] = (
        getenv(
            "ALLOWED_REFERER_HOSTS",
            "lookerstudio.google.com datastudio.google.com sites.google.com",
        ).split()
    )

    # Static dirs
    static_root: str = os.path.join(os.path.dirname(__file__), "static")
    templates_root: str = os.path.join(os.path.dirname(__file__), "templates")


settings = Settings()
