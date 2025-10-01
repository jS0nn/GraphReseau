# AGENTS — Guide opératoire et contexte projet

Ce document compile tout le contexte utile pour développer, maintenir et déployer l’« Éditeur Réseau » (migration Apps Script → Python/Cloud Run). Il reprend les bases pour ne rien oublier quand on revient sur le projet (venv, libs, build frontend, variables d’environnement, auth Google, structure du code, workflows, dépannage) — et sert aussi de référence pour un agent d’automatisation.


## 1) Résumé et objectifs
- But: remplacer le backend Apps Script par une API FastAPI, avec un frontend D3/ELK sans CDN, intégrable en iframe (Looker Studio / Google Sites).
- Statut V1:
  - Backend FastAPI (GET/POST `/api/graph`), sources interchangeables: Google Sheets, GCS JSON (ou fichier local), BigQuery (lecture seule).
  - Page d’embed `/embed/editor` en lecture‑seule (clé statique `k` + CSP + vérification du Referer).
  - Frontend bundlé en local (esbuild), polices/icônes sans CDN.
- V2 à prévoir: liens d’embed signés court‑terme, RBAC côté API.


## 2) Prérequis (outillage)
- Python 3.11 ou 3.12
- Node.js 18+ (recommandé: 20+) et npm  - le code sera en typescript
- Google Cloud SDK (`gcloud`) connecté à votre compte
- Docker (facultatif, pour tester l’image)


## 3) Démarrage rapide (local)
1) Cloner et se placer dans le dossier
- `git clone <URL_DU_DEPOT> GraphReseau && cd GraphReseau`

2) Environnement Python (venv) et dépendances
- `python -m venv .venv`
- Linux/macOS: `source .venv/bin/activate`  |  Windows PowerShell: `.venv\Scripts\Activate.ps1`
- `pip install -U pip`
- `pip install -r requirements.txt`

3) Dépendances frontend et build
- `npm install`
- Build production: `npm run build`
- Build de dev (sourcemaps): `npm run build:dev`
  - Sorties: `app/static/bundle/*` (JS/CSS) et `app/static/vendor/*` (polices/icônes)

4) Variables d’environnement (copier l’exemple)
- Copier `.env.example` → `.env.dev` puis renseigner au minimum:
  - `SHEET_ID_DEFAULT` (ID du Google Sheet)
  - `EMBED_STATIC_KEY` (clé d’accès de l’embed en V1)
  - `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS` (pour tester l’embed en local)

5) Authentification Google (ADC)
- Rapide (utilisateur): `gcloud auth application-default login`
- Recommandé (impersonation de SA): voir section 7 pour tout automatiser proprement.

6) Lancer l’API
- `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`
- Vérifier: `http://127.0.0.1:8080/healthz`

7) Tester l’embed en local
- Servir la page de test: `python -m http.server 8000`
- Ouvrir: `http://localhost:8000/dev-embed.html`
- Renseigner Base URL (`http://127.0.0.1:8080`), la clé `k` (=`EMBED_STATIC_KEY`) et le `sheet_id`.


## 4) Variables d’environnement (référence)
Fichier d’exemple: `.env.example` (copiable en `.env.dev`).
- Générales
  - `DATA_SOURCE`: `sheet` | `gcs_json` | `bigquery` (défaut: `sheet`)
- Sheets
  - `SHEET_ID_DEFAULT`: ID du spreadsheet (onglets `Nodes` et `Edges`)
  - `SHEET_NODES_TAB` (défaut `Nodes`), `SHEET_EDGES_TAB` (défaut `Edges`)
- GCS JSON
  - `GCS_JSON_URI`: `gs://bucket/path/graph.json` ou `file:///ABS/PATH/graph.json`
- BigQuery (lecture V1)
  - `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_NODES_TABLE` (défaut `Nodes`), `BQ_EDGES_TABLE` (défaut `Edges`)
- Embed / sécurité
  - `EMBED_STATIC_KEY`: clé côté serveur (à passer aussi en query `k` sur `/embed/editor`)
  - `ALLOWED_REFERER_HOSTS`: hôtes autorisés comme Referer (ex: `localhost 127.0.0.1`)
  - `ALLOWED_FRAME_ANCESTORS`: origines autorisées à encapsuler l’iframe (ex: `http://localhost:8000 ...`)
  - Dev toggles: `DISABLE_EMBED_REFERER_CHECK=1`, `DISABLE_EMBED_KEY_CHECK=1` (local uniquement)
- Google Cloud
  - `GCP_PROJECT_ID`, `GCP_REGION` (utile pour CLI et déploiements)
  - `IMPERSONATE_SERVICE_ACCOUNT`: e‑mail du SA si l’app doit impersoner (voir 7)


## 5) API et sources de données
- `GET /api/graph` (réponse: `Graph`), `POST /api/graph` (écrit selon source)
- Paramètres de query (tous optionnels; sinon valeurs d’env par défaut):
  - `source=sheet|gcs_json|bigquery`
  - Sheets: `sheet_id`, `nodes_tab`, `edges_tab`
  - GCS JSON: `gcs_uri` (supporte `gs://` ou `file:///` en dev)
  - BigQuery: `bq_project`, `bq_dataset`, `bq_nodes`, `bq_edges`
- Compatibilité colonnes
  - Sheets et BigQuery acceptent des schémas FR/EN courants (voir mapping dans `app/sheets.py` et `app/datasources.py`).
- Écriture V1
  - Sheets, GCS JSON: supportés
  - BigQuery: non implémenté (501)


## 6) Frontend (build et usage)
- Code source: `web/`
  - `src/`: modules JS/TS (rendu SVG, interactions, état, exports, API client)
  - `styles/`: `app.css`, `editor.css`, thème de base
  - `index.html`: page de dev (charge `web/src/*` directement)
- Build (esbuild): `npm run build`
  - Entrées: `web/src/vendor.ts`, `polyfills.ts`, `main.ts`, `editor.ts`, `editor.boot.ts`
  - Sorties: `app/static/bundle/*.js|*.css`, assets `app/static/vendor/*`
- Pages servies par l’API (prod/dev): `app/templates/index.html` charge les bundles `/static/bundle/*`.


## 7) Authentification Google (ADC) et impersonation (recommandé)
Option A — RECOMMANDÉ: ADC déjà impersonés vers le SA cible (local + Cloud Run utilisent la même identité)
- Choisir le projet et le SA:
  - `export GCP_PROJECT_ID=<PROJET>`
  - `export SA_NAME=editeur-reseau-sa`
  - `export SA_EMAIL="$SA_NAME@${GCP_PROJECT_ID}.iam.gserviceaccount.com"`
- Donner à votre utilisateur le rôle TokenCreator sur ce SA:
  - `gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$GCP_PROJECT_ID" --member="user:$(gcloud config get-value account)" --role=roles/iam.serviceAccountTokenCreator`
- Activer les APIs (une fois):
  - `gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sheets.googleapis.com drive.googleapis.com --project="$GCP_PROJECT_ID"`
- Partager le Google Sheet avec `$SA_EMAIL` (lecture/écriture).
- Se connecter en ADC impersonés:
  - `gcloud auth application-default login --impersonate-service-account="$SA_EMAIL"`
- Lancer l’API SANS définir `IMPERSONATE_SERVICE_ACCOUNT` (évite une double‑impersonation).

Option B — Alternative: laisser l’app impersoner
- Garder des ADC utilisateur; définir `IMPERSONATE_SERVICE_ACCOUNT=$SA_EMAIL` dans `.env.dev`.
- Donner à votre utilisateur (ou au runtime Cloud Run) le rôle `roles/iam.serviceAccountTokenCreator` sur `$SA_EMAIL`.

Vérifications utiles
- `gcloud auth application-default print-access-token | head -c 20; echo`
- `curl http://127.0.0.1:8080/api/graph?sheet_id=$SHEET_ID_DEFAULT`


## 8) Structure du dépôt (fichiers clés)
- `app/` (backend FastAPI)
  - `main.py`: app FastAPI, middleware CSP, statiques `/static`, routeurs
  - `config.py`: lecture des variables d’environnement, options et toggles
  - `models.py`: modèles Pydantic (Graph, Node, Edge)
  - `datasources.py`: dispatch lecture/écriture selon source (Sheets, GCS JSON, BQ)
  - `sheets.py`: client Sheets (mapping d’entêtes FR/EN, sérialisation V1→V5)
  - `gcp_auth.py`: création des credentials (ADC + impersonation)
  - `auth_embed.py`: CSP et contrôles d’accès pour l’embed (clé `k`, Referer)
  - `shared/graph_transform.py`: sanitisation commune (réutilisée par les datasources/tests)
  - `routers/api.py`: endpoints `/api/graph`
  - `routers/embed.py`: endpoint `/embed/editor` (Jinja template)
  - `templates/index.html`: HTML d’embed qui charge les bundles
  - `static/`: bundles et assets copiés par le build
- `web/` (frontend source — dev)
  - `src/`: `editor.ts`, `editor.boot.ts`, `render/*`, `interactions/*`, `state/*`, `shared/*`, etc.
  - `styles/`: `app.css`, `editor.css`, `theme.css`, `base.css`
  - `index.html`: page de dev locale
  - `types/graph.d.ts`: types TypeScript générés à partir du schéma Pydantic (`npm run types:generate`)
- `build.mjs`: script esbuild (bundle JS/CSS + copie des vendors)
- `dev-embed.html`: page utilitaire pour tester l’embed (sert de parent pour le Referer)
- `.env.example` / `.env.dev`: variables d’environnement (exemple / dev local)
- `requirements.txt`: dépendances Python runtime
- `package.json`: dépendances Node (runtime et dev), scripts de build
- `README.md`, `NOTICE_IMPLEMENTATION.md`, `TEST_PLAN.md`, `docs/roadmap/roadmap-v1.md`: documentation principale, notice détaillée, plan de test, feuille de route
- `agent.config.yaml`: modèle de cadrage « agent » (peut référencer un layout antérieur — privilégier la structure `app/` telle qu’implémentée ici)


## 9) Déploiement (aperçu Cloud Run)
- Build source (Cloud Build) direct depuis le repo:
  - `gcloud run deploy editeur-reseau-api --source . --region=$GCP_REGION --project=$GCP_PROJECT_ID \
     --service-account="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --allow-unauthenticated \
     --set-env-vars=EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...,DATA_SOURCE=sheet`
- Points d’attention:
  - L’iframe doit être autorisée via `ALLOWED_FRAME_ANCESTORS`.
  - Partager le Sheet avec le SA du service Cloud Run.


## 10) Tâches fréquentes (checklist)
- Mettre à jour les dépendances Python: `pip install -U -r requirements.txt`
- Rebuilder le frontend: `npm run build`
- Régénérer les types TS (si schéma Graph modifié): `npm run types:generate`
- Lancer les tests backend: `python -m unittest discover -s tests -p "test_*.py"`
- Prévisualiser un JSON local: `curl "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json"`
- Sauvegarder vers JSON local: `curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" -H "Content-Type: application/json" --data-binary @graph.json`
- Vérifier l’embed: `curl -I -H "Referer: http://localhost:8000" "http://127.0.0.1:8080/embed/editor?k=$EMBED_STATIC_KEY&sheet_id=$SHEET_ID_DEFAULT&mode=ro"`


## 11) Évolutions et maintenabilité (guides rapides)
- Ajouter une nouvelle source de données
  - Étendre `app/datasources.py` (chargement/sauvegarde) + variables d’env correspondantes + tests manuels dans `TEST_PLAN.md`.
- Étendre le schéma `Graph`
  - Ajuster `app/models.py`, les mappings Sheets/BQ dans `app/sheets.py`/`app/datasources.py`, et l’UI si champs visibles.
- Ajouter un module UI
  - Créer un fichier dans `web/src/*`, l’importer depuis `editor.ts` (ou `editor.boot.ts`), puis `npm run build`.
- Sécurité/CSP
  - Adapter `build_csp()` dans `app/auth_embed.py` (garder `frame-ancestors` en phase avec l’environnement cible).
- Organisation des secrets
  - Préférer des variables d’environnement; pour la prod, utiliser Secret Manager et les injecter lors du déploiement.


## 12) Dépannage (FAQ)
- 401/403 Google API (Sheets/GCS/BQ)
  - Vérifier ADC/impersonation (section 7), partage du Sheet, et APIs activées.
- 400 `sheet_id required`
  - Définir `SHEET_ID_DEFAULT` ou passer `?sheet_id=...`.
- 403 `invalid referer` (embed)
  - Ajuster `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS`.
- Iframe bloquée
  - `ALLOWED_FRAME_ANCESTORS` doit inclure l’origine hôte (Looker/Sites ou localhost:8000 en dev).
- `ModuleNotFoundError: googleapiclient`
  - `pip install -r requirements.txt` (et activer la venv).
- Build frontend échoue
  - Vérifier `node -v` (≥18), puis `npm install && npm run build`.


## 13) Bibliothèques utilisées (référence rapide)
- Python (requirements.txt)
  - `fastapi`, `uvicorn[standard]`, `pydantic` (API et validation)
  - `jinja2` (templates embed)
  - `google-api-python-client`, `google-auth`, `google-auth-httplib2` (Sheets/Drive, ADC)
  - `google-cloud-storage`, `google-cloud-bigquery` (sources alternatives)
- Node (package.json)
  - `esbuild` (bundle), `d3`, `elkjs`, `@fontsource/inter`, `@iconscout/unicons`


## 14) Références utiles
- Démarrage rapide et détails complémentaires: `README.md`
- Notice pas‑à‑pas (auth, Docker, tests manuels): `NOTICE_IMPLEMENTATION.md`
- Plan de tests manuels: `TEST_PLAN.md`
- Feuille de route: `docs/roadmap/roadmap-v1.md`
- Configuration « agent »: `agent.config.yaml` (attention: certaines sections reflètent un layout antérieur; se référer à la structure `app/` actuelle)
- Note de contexte exhaustive (architecture + flux): [`docs/contexte-global-editeur-reseau.md`](docs/contexte-global-editeur-reseau.md)


---
Dernière mise à jour: généré automatiquement; adapter si la structure évolue.
