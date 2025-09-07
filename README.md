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

## API vs Frontend (rôles et périmètre)
- API (backend FastAPI):
  - Sert les endpoints `/api/graph` (GET/POST) et la page d’embed `/embed/editor`.
  - Parle à la source de données (Google Sheets via ADC/impersonation, GCS JSON, BigQuery).
  - Applique la sécurité V1 côté embed: clé statique `k`, CSP stricte, vérification du `Referer`.
  - Sert les assets locaux (sans CDN) depuis `/static`.
- Frontend (build local, sans CDN):
  - Code source dans `web/`, bundlé par `esbuild` dans `app/static/bundle`.
  - `vendor.js` expose D3/ELK sans CDN; polices et icônes copiées en local (`app/static/vendor`).
  - Deux entrées:
    - `legacy-editor.js` (portage progressif de l’éditeur Apps Script).
    - `app.js` (viewer minimal pour tests de bout‑en‑bout).
  - En V1 du portage, l’embed affiche un statut et charge les données; le rendu complet (SVG, modes…) arrive par étapes.

## L’embed, simplement
- Quoi: une page HTML spécifique, intégrable en iframe (Looker Studio, Google Sites) pour consulter l’éditeur en lecture seule.
- URL: `/embed/editor?k=...&sheet_id=...&mode=ro[&source=sheet|gcs_json|bigquery]`.
- Pourquoi la clé `k` ?
  - Pas d’auth interactive possible dans une iframe en V1; on utilise une clé statique côté serveur (`EMBED_STATIC_KEY`) et on exige la même en query (`k`).
  - Combine avec une CSP stricte (`frame-ancestors`) et une vérification du `Referer` (uniquement Looker/Sites/localhost en dev).
  - V2: liens signés court‑terme remplaceront la clé statique.
- Tester l’embed en local:
  - Lance l’API: `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`.
  - Sert la page parent (Referer): `python -m http.server 8000` puis ouvre `http://localhost:8000/dev-embed.html`.
  - Renseigne Base URL (`http://127.0.0.1:8080`), la clé `k` (identique à `EMBED_STATIC_KEY`), le `sheet_id`.
  - Astuce: cette page ne sert qu’à simuler un Referer autorisé; l’appli tourne sur le port 8080.

- Mode dev (bypass contrôles embed):
  - `DISABLE_EMBED_REFERER_CHECK=1` désactive la vérif du Referer (ouvre directement `/embed/editor?...`).
  - `DISABLE_EMBED_KEY_CHECK=1` désactive la vérif de la clé `k` (à réserver au local).
  - Exemple `.env.dev` ci‑dessous.

## Fichier `.env.dev` (exemple)
```
IMPERSONATE_SERVICE_ACCOUNT=<votre-SA>@<PROJECT_ID>.iam.gserviceaccount.com  # recommandé en entreprise
SHEET_ID_DEFAULT=<SPREADSHEET_ID>
EMBED_STATIC_KEY=dev-embed-key
ALLOWED_REFERER_HOSTS="localhost 127.0.0.1"
ALLOWED_FRAME_ANCESTORS="http://localhost:8000 http://127.0.0.1:8000"
DATA_SOURCE=sheet
# Dev toggles
DISABLE_EMBED_REFERER_CHECK=1
# DISABLE_EMBED_KEY_CHECK=1
```
Lancer l’API avec: `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`.

## Impersonation (résumé)
- Créez un Service Account et autorisez votre utilisateur à l’impersoner:
  - `gcloud iam service-accounts create editeur-reseau-sa --display-name="Éditeur Réseau SA"`
  - `gcloud iam service-accounts add-iam-policy-binding editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com --member="user:<you@domain>" --role="roles/iam.serviceAccountTokenCreator"`
  - `gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sheets.googleapis.com drive.googleapis.com`
  - Partagez le Sheet avec le SA.
  - `gcloud auth application-default login --impersonate-service-account=editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com`
  - `export IMPERSONATE_SERVICE_ACCOUNT=editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com`
  - Test: `curl "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT"`

## Deux serveurs en dev: qui fait quoi ?
- Uvicorn (port 8080): votre application (API + embed + assets).
- http.server (port 8000): ne sert que la page `dev-embed.html` pour simuler un site hôte (Referer) en iframe.
  - En prod, `http.server` n’existe pas; l’iframe sera intégrée dans Looker Studio / Google Sites.
