# Catalogue des erreurs

| Code | Source | Message (exemple) | Cause probable | Remédiation | Référence |
| --- | --- | --- | --- | --- | --- |
| 400 | Sheets datasource | `sheet_id required` | `SHEET_ID_DEFAULT` absent & param manquant | Renseigner `.env` ou ajouter le paramètre | `app/datasources/sheets.py:31-52` |
| 400 | Dispatcher | `unknown data source: foo` | Paramètre `source` invalide | Limiter aux valeurs supportées | `app/datasources/__init__.py:21-75` |
| 400 | Branch recalcul | `graph payload required` | Body JSON vide | Envoyer un Graph valide | `app/routers/branch.py:11-22` |
| 400 | Embed | `unsupported mode` | `mode` ≠ `ro`/`rw` | Corriger le paramètre | `app/routers/embed.py:27-28` |
| 403 | Embed | `invalid key` | Clé `k` incorrecte | Régénérer `EMBED_STATIC_KEY` | `app/auth_embed.py:39-44` |
| 403 | Embed | `invalid referer` | Referer non autorisé | Mettre à jour `ALLOWED_REFERER_HOSTS` | `app/auth_embed.py:45-49` |
| 422 | Sanitizer | `edge missing diameter_mm: E1` | Diamètre absent ou invalide | Corriger les données source | `app/shared/graph_transform.py:1068-1093` |
| 422 | Sanitizer | `edge geometry invalid or missing` | Géométrie insuffisante | Fournir une géométrie valide | `app/shared/graph_transform.py:1012-1040` |
| 422 | Sanitizer | `node POINT_MESURE-1 requires attach_edge_id` | Point de mesure sans ancrage | Renseigner `pm_collector_edge_id` | `app/shared/graph_transform.py:1186-1208` |
| 422 | Sanitizer | `pm_offset_m exceeds edge length` | Offset > longueur arête | Ajuster l’offset ou la géométrie | `app/shared/graph_transform.py:1209-1229` |
| 422 | Sanitizer | `duplicate node ids detected` | IDs dupliqués | Dé-doublonner la source | `app/shared/graph_transform.py:1258-1265` |
| 422 | Sanitizer | `node and edge ids must be unique ...` | Collision ID nœud/arête | Renommer les arêtes | `app/shared/graph_transform.py:1266-1272` |
| 500 | GCS JSON | `read_local_json_failed` | Fichier inaccessible | Vérifier chemin/permissions | `app/datasources/gcs_json.py:42-53` |
| 500 | GCS JSON | `write_local_json_failed` | Écriture impossible | Vérifier permissions | `app/datasources/gcs_json.py:100-116` |
| 501 | GCS JSON | `gcs_json_unavailable` | Credentials ou bucket manquant | Vérifier ADC/IAM | `app/datasources/gcs_json.py:73-92` |
| 400 | Datasource | `site_id required (set ...)` | `REQUIRE_SITE_ID` activé sans param | Fournir `site_id` | `app/datasources/__init__.py:24-63` |
| 400 | BigQuery | `bq project_id and dataset required` | Variables BQ absentes | Renseigner l’environnement | `app/datasources/bigquery.py:24-36` |
| 501 | BigQuery | `bigquery_unavailable: ...` | API indisponible / credentials | Vérifier `gcloud auth` & API activées | `app/datasources/bigquery.py:37-146` |
| 501 | BigQuery | `bigquery write not implemented` | Tentative d’écriture BQ | Non supporté V1 | `app/datasources/bigquery.py:148-149` |

> Les tests `tests/test_graph_sanitizer.py` et `tests/test_datasource_dispatch.py` couvrent la majorité des cas.
