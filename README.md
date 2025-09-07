# Éditeur Réseau – migration Apps Script → Python/Cloud Run

## Objectif V1

- Backend FastAPI sur Cloud Run (scale-to-zero, pay-per-use)
- Accès Google Sheets via ADC (pas de JSON de SA)
- Frontend D3/ELK sans CDN, bundle + assets locaux (esbuild)
- Intégration en iframe (Looker Studio, Google Sites) en lecture-seule

## Arborescence cible

```
app/
  main.py        # FastAPI, CSP middleware, static, routes
  config.py      # variables d'env (SHEET_ID_DEFAULT, EMBED_STATIC_KEY, ...)
  models.py      # Pydantic Graph/Node/Edge
  sheets.py      # read_nodes_edges / write_nodes_edges (ADC)
  auth_embed.py  # clé statique + référer + CSP
  routers/
    api.py       # GET/POST /api/graph
    embed.py     # GET /embed/editor
  templates/
    index.html   # charge /static/bundle/app.css|js, vendor.js
  static/
    bundle/      # généré par esbuild
    vendor/      # assets Inter + Unicons
web/
  index.html     # dev only
  styles/        # base.css, theme.css, app.css
  src/           # vendor.js, shim.js, main.js, modules
```

## Démarrage local

1. Python
   - `python -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
   - `gcloud auth application-default login` (ADC)
   - `export SHEET_ID_DEFAULT=<SPREADSHEET_ID>`
   - `export EMBED_STATIC_KEY=dev-embed-key`
2. Frontend
   - `npm install`
   - `npm run build` (génère `app/static/bundle/*` et copie `vendor/`)
3. API
   - `uvicorn app.main:app --reload --port 8080`

Endpoints:
- Santé: `GET /healthz`
- API: `GET /api/graph`, `POST /api/graph`
  - Sources interchangeables (query param `source` ou env `DATA_SOURCE`):
    - Sheets: `source=sheet&sheet_id=...&nodes_tab=nodes&edges_tab=edges`
    - GCS JSON: `source=gcs_json&gcs_uri=gs://bucket/path/graph.json` (ou `file:///path/graph.json` en dev)
    - BigQuery: `source=bigquery&bq_project=...&bq_dataset=...&bq_nodes=nodes&bq_edges=edges`
- Embed: `GET /embed/editor?k=dev-embed-key&sheet_id=...&mode=ro`

## Déploiement Cloud Run (source)

```
gcloud run deploy editeur-reseau-api \
  --source . \
  --region=$GCP_REGION \
  --project=$GCP_PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars=EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...,DATA_SOURCE=sheet
```

## Notes

- CSP inclut `frame-ancestors` (Looker/Sites) et enlève tout `X-Frame-Options`.
- A2 couvre la lecture/écriture Sheets avec correspondance d'entêtes FR/EN.
- V1 ne met pas en place l'écriture depuis l'UI; l'API POST est prête.
- Data source: par défaut `DATA_SOURCE=sheet`; possibles: `sheet`, `gcs_json`, `bigquery`.
- Env par source:
  - Sheets: `SHEET_ID_DEFAULT`, `SHEET_NODES_TAB`, `SHEET_EDGES_TAB`
  - GCS JSON: `GCS_JSON_URI`
  - BigQuery: `BQ_PROJECT_ID` (optionnel si `GOOGLE_CLOUD_PROJECT`), `BQ_DATASET`, `BQ_NODES_TABLE`, `BQ_EDGES_TABLE`
