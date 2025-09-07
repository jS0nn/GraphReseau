# Notice d’implémentation et test local — Éditeur Réseau

Ce guide décrit, pas à pas, comment installer, configurer, tester en local, builder le frontend, et lancer l’application dans Docker. Il couvre aussi l’usage des différentes sources de données (Google Sheets, JSON sur GCS/fichier local, BigQuery).

## 1) Prérequis
- Python 3.11 ou 3.12
- Node.js 18+ (recommandé: 20+) et npm
- Google Cloud SDK (`gcloud`) connecté à votre compte
- Docker (pour les tests en conteneur)

## 2) Authentification Google (ADC)
- Initialiser les Application Default Credentials (ADC):
  - `gcloud auth application-default login`
- (Optionnel) fixer le projet par défaut: `gcloud config set project <GCP_PROJECT_ID>`
- APIs à activer côté GCP (si besoin):
  - `gcloud services enable run.googleapis.com sheets.googleapis.com drive.googleapis.com secretmanager.googleapis.com bigquery.googleapis.com storage.googleapis.com --project=<GCP_PROJECT_ID>`

## 3) Préparer le Google Sheet
- Créer un spreadsheet avec 2 onglets: `Nodes` et `Edges`.
- Ligne d’entêtes (exact):
  - `Nodes`:
    - `id, nom, type, id_branche, diametre_mm, puits_amont, well_collector_id, well_pos_index, pm_collecteur_id, pm_pos_index, gps_lat, gps_lon, x, y`
  - `Edges`:
    - `id, source_id, cible_id, actif`
- Récupérer l’ID du sheet (dans l’URL), par exemple `1AbC...XYZ`.
- En local (ADC via votre compte), aucun partage spécifique requis.

## 4) Variables d’environnement
- Minimales (Sheets):
  - `export SHEET_ID_DEFAULT=<SPREADSHEET_ID>`
  - `export EMBED_STATIC_KEY=dev-embed-key`
- (Embed local via iframe):
  - `export ALLOWED_REFERER_HOSTS="localhost 127.0.0.1"`
  - `export ALLOWED_FRAME_ANCESTORS="http://localhost:8000 http://127.0.0.1:8000"`
- (Sélection de source globale — sinon passer en query):
  - `export DATA_SOURCE=sheet`  # sheet | gcs_json | bigquery
- (GCS JSON en option):
  - `export GCS_JSON_URI=gs://mon-bucket/graph.json`  (ou `file:///chemin/absolu/graph.json` en dev)
- (BigQuery en option):
  - `export BQ_PROJECT_ID=<PROJET_BQ>` (sinon `GOOGLE_CLOUD_PROJECT`)
  - `export BQ_DATASET=<DATASET>`
  - `export BQ_NODES_TABLE=Nodes` (par défaut)
  - `export BQ_EDGES_TABLE=Edges` (par défaut)

## 5) Installation (backend + frontend)
- Créer l’environnement Python et installer:
  - `python -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt`
- Installer les dépendances frontend et builder les assets locaux (sans CDN):
  - `npm install`
  - `npm run build`
  - Résultat: `app/static/bundle/{app.js, app.css, legacy-editor.js, legacy.css}` et `app/static/vendor/{inter, unicons}`

## 6) Lancer l’API en local
- `uvicorn app.main:app --reload --port 8080`
- Contrôle santé:
  - `curl http://127.0.0.1:8080/healthz`

## 7) Tester l’API Graph (Sheets par défaut)
- Lecture:
  - `curl "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT"`
- Écriture (réécrit les onglets `Nodes`/`Edges` au format FR V5/FR V2):
  - `curl -s "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT" -o graph.json`
  - `curl -s -X POST "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT" -H "Content-Type: application/json" --data-binary @graph.json`
  - Relecture pour vérifier: idem GET ci‑dessus

## 8) Tester l’embed (iframe, CSP, clé `k`)
- Test HTTP direct (vérifie CSP et 200):
  - `curl -I -H "Referer: http://localhost:8000" "http://127.0.0.1:8080/embed/editor?k=$EMBED_STATIC_KEY&sheet_id=$SHEET_ID_DEFAULT&mode=ro"`
- Dans un vrai iframe local:
  - Créer un fichier `dev-embed.html` avec:
    - `<iframe src="http://127.0.0.1:8080/embed/editor?k=dev-embed-key&sheet_id=VOTRE_SHEET_ID&mode=ro" style="width:100%;height:80vh;border:1px solid #ccc;"></iframe>`
  - Servir ce fichier: `python -m http.server 8000`
  - Ouvrir: `http://localhost:8000/dev-embed.html`
  - Assurez-vous d’avoir exporté `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS` avec `localhost:8000`.

## 9) Utiliser une autre source de données
- GCS JSON (ou fichier local):
  - Exemple de fichier minimal `graph.json`:
    - `{ "nodes": [{"id":"N1","name":"P-001","type":"PUITS"}], "edges": [] }`
  - Lecture via fichier local: `curl "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json"`
  - Écriture: `curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" -H "Content-Type: application/json" --data-binary @graph.json`
- BigQuery (lecture seule V1):
  - Préparer tables compatibles (FR ou EN) dans `<BQ_PROJECT_ID>.<BQ_DATASET>`:
    - `Nodes`: colonnes `id, nom|name, type, id_branche|branch_id, diametre_mm|diameter_mm, puits_amont|collector_well_ids, well_collector_id, well_pos_index, pm_collecteur_id|pm_collector_id, pm_pos_index, gps_lat, gps_lon, x, y`
    - `Edges`: colonnes `id, source_id|from_id, cible_id|to_id, actif|active`
  - Lecture: `curl "http://127.0.0.1:8080/api/graph?source=bigquery&bq_project=$BQ_PROJECT_ID&bq_dataset=$BQ_DATASET&bq_nodes=Nodes&bq_edges=Edges"`
  - Écriture: non implémentée (501)

## 10) Lancer via Docker (local)
- Builder l’image multi‑stage (frontend Node → runtime Python):
  - `docker build -t editeur-reseau:dev -f deploy/Dockerfile .`
- Lancer en important les ADC locaux et les variables nécessaires:
  - macOS/Linux:
    - `docker run --rm -p 8080:8080 \
       -e SHEET_ID_DEFAULT=$SHEET_ID_DEFAULT -e EMBED_STATIC_KEY=$EMBED_STATIC_KEY \
       -e ALLOWED_REFERER_HOSTS="localhost 127.0.0.1" -e ALLOWED_FRAME_ANCESTORS="http://localhost:8000 http://127.0.0.1:8000" \
       -e GOOGLE_APPLICATION_CREDENTIALS=/gcloud/adc.json \
       -v $HOME/.config/gcloud/application_default_credentials.json:/gcloud/adc.json:ro \
       editeur-reseau:dev`
  - Windows (PowerShell): adapter le chemin de montage des ADC.
- Tester comme en local: `http://127.0.0.1:8080/healthz`, `/api/graph`, `/embed/editor?...`.

## 11) Dépannage
- 401/403 Google API (Sheets/GCS/BQ):
  - Relancer `gcloud auth application-default login` et vérifier droits sur la ressource (Sheet partagé avec le compte/SA, GCS OAuth porté sur le projet, BQ dataset autorisé).
- 400 `sheet_id required`:
  - Définir `SHEET_ID_DEFAULT` ou passer `?sheet_id=...`.
- 403 `invalid referer` sur `/embed/editor`:
  - Ajuster `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS`.
- Iframe bloquée:
  - `ALLOWED_FRAME_ANCESTORS` doit inclure l’origine qui intègre l’iframe.
- `ModuleNotFoundError: googleapiclient`:
  - `pip install -r requirements.txt`.
- Build frontend échoue:
  - Vérifier `node -v` (≥18), puis `npm install && npm run build`.
- BigQuery 404/permission:
  - Vérifier dataset/table et IAM du compte ADC.
- GCS JSON 404/permission:
  - Vérifier `gs://bucket/chemin`, IAM, et que l’URI est correct. En dev: `file:///ABS/PATH/graph.json`.

## 12) (Bonus) Déploiement Cloud Run (source)
- `gcloud run deploy editeur-reseau-api \
    --source . \
    --region=$GCP_REGION \
    --project=$GCP_PROJECT_ID \
    --allow-unauthenticated \
    --set-env-vars=DATA_SOURCE=sheet,EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...`
- Pour utiliser GCS JSON ou BQ par défaut, ajuster `DATA_SOURCE` et variables associées.

Référence fichiers
- Backend: `app/main.py`, `app/routers/{api.py,embed.py}`, `app/sheets.py`, `app/datasources.py`, `app/auth_embed.py`, `app/models.py`
- Frontend: `web/src/*`, build `build.mjs` → `app/static/{bundle,vendor}`
- Docker: `deploy/Dockerfile`
