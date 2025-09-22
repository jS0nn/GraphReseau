# Variables d’environnement

| Variable | Description | Défaut | Obligatoire | Notes |
| --- | --- | --- | --- | --- |
| `DATA_SOURCE` | Source par défaut (`sheet`, `gcs_json`, `bigquery`) | `sheet` | Non | `app/config.py:18` |
| `SHEET_ID_DEFAULT` | Sheet ID utilisé si param absent | `""` | Oui (source sheet) | `app/config.py:25` |
| `SHEET_NODES_TAB` | Onglet nœuds | `Nodes` | Non | |
| `SHEET_EDGES_TAB` | Onglet arêtes | `Edges` | Non | |
| `GCS_JSON_URI` | URI JSON par défaut | `""` | Oui (source gcs_json) | `app/config.py:30` |
| `BQ_PROJECT_ID` | Projet BigQuery | `""` | Oui (source bigquery) | |
| `BQ_DATASET` | Dataset BigQuery | `""` | Oui (bigquery) | |
| `BQ_NODES_TABLE` | Table nœuds | `nodes` | Non | |
| `BQ_EDGES_TABLE` | Table arêtes | `edges` | Non | |
| `IMPERSONATE_SERVICE_ACCOUNT` | SA à impersoner | `""` | Non | `app/config.py:38-42` |
| `EMBED_STATIC_KEY` | Clé iframe `/embed/editor` | `""` | Oui | `app/auth_embed.py` |
| `ALLOWED_REFERER_HOSTS` | Referer autorisés | `lookerstudio.google.com ...` | Oui | Séparés par espaces |
| `ALLOWED_FRAME_ANCESTORS` | Origines iframe | `https://lookerstudio.google.com https://sites.google.com` | Oui | CSP `frame-ancestors` |
| `DISABLE_EMBED_REFERER_CHECK` | Bypass referer (dev) | `False` | Non | Local uniquement |
| `DISABLE_EMBED_KEY_CHECK` | Bypass clé (dev) | `False` | Non | |
| `SITE_ID_FILTER_DEFAULT` | Filtre `site_id` | `""` | Non | |
| `REQUIRE_SITE_ID` | Obligation de `site_id` | `False` | Non | `save_graph` → 400 si absent |
| `MAP_TILES_URL` | URL tuiles | `""` | Non | Ajoute host à la CSP |
| `MAP_TILES_ATTRIBUTION` | Attribution carte | `""` | Non | |
| `MAP_TILES_API_KEY` | Clé carte | `""` | Non | |
| `GCP_PROJECT_ID` | Projet GCP | `GOOGLE_CLOUD_PROJECT` ou `""` | Non | |
| `GCP_REGION` | Région Cloud Run | `europe-west1` | Non | |

> Stocker les secrets dans Secret Manager en production.

⚠️ TODO : ajouter `LOG_LEVEL` et options de tracing si observabilité étendue.
