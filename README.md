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
  shared/
    graph_transform.py  # sanitisation commune (backend)
  routers/
    api.py       # GET/POST /api/graph
    embed.py     # GET /embed/editor
  templates/
    index.html   # charge /static/bundle/app.css|js, vendor.ts
  static/
    bundle/      # généré par esbuild
    vendor/      # assets Inter + Unicons
web/
  index.html     # dev only
  styles/        # base.css, theme.css, app.css
  types/         # graph.d.ts (types TS générés depuis le schéma Pydantic)
  src/           # vendor.ts, shim.js, main.ts, modules
    shared/      # helpers communs (géométrie, sanitation front)
```

## Démarrage local

0. Cloner le dépôt
   - `git clone <VOTRE_REPO_GITHUB_URL> editeur-reseau && cd editeur-reseau`
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
  - Filtrage optionnel par site (si la colonne `idSite1` est présente dans le Sheet): `&site_id=<ID_SITE>`
  - Contrôle strict (recommandé): définir `REQUIRE_SITE_ID=1` pour exiger qu'un `site_id` soit fourni (ou via `SITE_ID_FILTER_DEFAULT`).

### Migration depuis un Sheet existant (colonnes métier)
- Script: `scripts/migrate_nodes_from_sheet.py`
- Utilisation (Linux/macOS):
  - `SOURCE_SHEET_ID=1gDB6Y8NbaNl_ZWgAlrdMlAQ41AekYdIca6eexkzxQkw SITE_ID_FILTER=356c469e npm run migrate:nodes`
  - ou directement: `python scripts/migrate_nodes_from_sheet.py --source-sheet-id <SRC_ID> --dest-sheet-id "$SHEET_ID_DEFAULT" --site-id-filter 356c469e`
- Le script écrit l’onglet `Nodes` au format FR V5 et ajoute à droite les colonnes métiers: `idOuvragReseauBiogaz,idSite1,site,Regroupement,Canalisation,Casier,emplacement,typeDePointDeMesure,commentaire,diametreExterieur,diametreInterieur,sdrOuvrage,actif,lat,long,dateAjoutligne`.
- Pour les tests de dev, vous pouvez définir `SITE_ID_FILTER_DEFAULT=356c469e` dans `.env.dev` (utilisé comme filtre par défaut si aucun `site_id` n’est fourni).
  - En dev, vous pouvez aussi mettre `REQUIRE_SITE_ID=1` dans `.env.dev` pour obliger la sélection d'un site à la lecture/écriture Sheets.

Note: les sauvegardes depuis l’UI écrivent l’onglet `Nodes` au format FR V5 (en-têtes normalisés) et n’incluent pas les colonnes métiers ajoutées par le script de migration. Évitez d’écraser ces colonnes ou travaillez sur une copie dédiée si nécessaire.
- Embed: `GET /embed/editor?k=dev-embed-key&sheet_id=...&mode=ro`

## Tests

- Activer la venv et installer les dépendances (`pip install -r requirements.txt`).
- Lancer tous les tests backend :
  - `python -m unittest discover -s tests -p "test_*.py"`
- Les tests couvrent la sanitisation (`app/shared`), les datasources et les contrats FastAPI (mock `save_graph`).

## Déploiement Cloud Run (source)

Consultez `docs/NOTICE_DEPLOIEMENT_CLOUD_RUN.md` pour une notice détaillée (prérequis, IAM, variables d'environnement, secrets et vérifications).

```
gcloud run deploy editeur-reseau-api \
  --source . \
  --region=$GCP_REGION \
  --project=$GCP_PROJECT_ID \
  --service-account="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --set-env-vars=EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...,DATA_SOURCE=sheet
```

## Notes

- CSP inclut `frame-ancestors` (Looker/Sites) et enlève tout `X-Frame-Options`.
- A2 couvre la lecture/écriture Sheets avec correspondance d'entêtes FR/EN.
- Sauvegarde: l’UI permet la sauvegarde en mode `rw`; l’embed de prod reste en `ro` par défaut. L’API POST est en place (Sheets/GCS JSON).
- Data source: par défaut `DATA_SOURCE=sheet`; possibles: `sheet`, `gcs_json`, `bigquery`.
- Env par source:
  - Sheets: `SHEET_ID_DEFAULT`, `SHEET_NODES_TAB`, `SHEET_EDGES_TAB`
  - GCS JSON: `GCS_JSON_URI`
  - BigQuery: `BQ_PROJECT_ID` (optionnel si `GOOGLE_CLOUD_PROJECT`), `BQ_DATASET`, `BQ_NODES_TABLE`, `BQ_EDGES_TABLE`
- Contexte global détaillé: [`docs/contexte-global-editeur-reseau.md`](docs/contexte-global-editeur-reseau.md)

## Documentation Diátaxis auto-générée

Un corpus complet destiné aux développeurs et aux non-techniciens est disponible dans `docsAuto/`. Il est organisé selon le cadre Diátaxis :

- **Overview** : `docsAuto/overview/architecture.md` et `docsAuto/overview/processes.md` (C4 L1/L2/L3, BPMN, flux principaux).
- **Tutoriels** : `docsAuto/tutorials/getting-started.md`, `docsAuto/tutorials/build-first-feature.md`.
- **Guides How-to** : `docsAuto/how-to/*.md` (exécution locale, ajout d’endpoint ou de composant UI, rotation de secrets, upgrade dépendances…).
- **Références** : `docsAuto/reference/` (OpenAPI 3.1, JSON Schema, variables d’env, CLI, catalogues d’erreurs, schéma de données).
- **Explications** : `docsAuto/explanations/*.md` (décisions d’architecture, sécurité, performance, limites).
- **Diagrams** : `docsAuto/diagrams/*.md` (Mermaid C4, séquences, BPMN) et `docsAuto/data-contracts/data-catalog.md` pour les DTO.
- **Traçabilité & audit** : `docsAuto/TRACEABILITY.md`, `docsAuto/DRIFT.md`, `docsAuto/observability/logging-audit-map.md`.

> Les éléments marqués `⚠️ TODO` dans ces fichiers signalent les chantiers à prioriser (ex. middleware `correlation_id`, incidents runbook, rotation automatique des secrets, suite de tests frontend Node.js à ajouter pour couvrir `how-to/add-ui-component.md`).

## API vs Frontend (rôles et périmètre)
- API (backend FastAPI):
  - Sert les endpoints `/api/graph` (GET/POST) et la page d’embed `/embed/editor`.
  - Parle à la source de données (Google Sheets via ADC/impersonation, GCS JSON, BigQuery).
  - Applique la sécurité V1 côté embed: clé statique `k`, CSP stricte, vérification du `Referer`.
  - Sert les assets locaux (sans CDN) depuis `/static`.
- Frontend (build local, sans CDN):
  - Code source dans `web/`, bundlé par `esbuild` dans `app/static/bundle`.
  - `vendor.ts` expose D3/ELK sans CDN; polices et icônes copiées en local (`app/static/vendor`).
  - Entrées JS bundlées:
    - `editor.ts` (éditeur modulaire — UI principale, bundlé en `editor.js`).
    - `main.ts` (viewer minimal pour tests de bout‑en‑bout).
  - L’éditeur modulaire est complet (rendu SVG, interactions, formulaires, layout, exports) — aucun fallback legacy.

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

# Fond de plan (orthophoto) — optionnel
# Exemple IGN (WMTS GetTile, Web Mercator PM)
# MAP_TILES_URL="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
# MAP_TILES_ATTRIBUTION="© IGN – Orthophotographies"
# Exemple MapTiler (XYZ)
# MAP_TILES_URL="https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key={apiKey}"
# MAP_TILES_ATTRIBUTION="© MapTiler © OpenStreetMap contributors"
# MAP_TILES_API_KEY=VOTRE_CLE
```
Lancer l’API avec: `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`.

### Fond orthophoto (Leaflet, sans CDN)
- Que faire: définir `MAP_TILES_URL` et `MAP_TILES_ATTRIBUTION` dans `.env.dev`. Si la source demande une clé, utilisez `MAP_TILES_API_KEY`.
- Formats acceptés:
  - XYZ: `{z}/{x}/{y}.(png|jpg)`
  - WMTS GetTile: `...&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}` (IGN PM)
- Clés API: si l’URL contient `{apiKey}` / `{apikey}` / `${API_KEY}` / `${MAP_TILES_API_KEY}`, la clé est substituée; sinon `?key=...` est ajouté si absent.
- CSP: l’origine des tuiles est automatiquement autorisée (img-src/connect-src) via `MAP_TILES_URL`.
- Build: `npm install && npm run build` (copie Leaflet dans `/static/vendor/leaflet`).
- Utilisation: l’orthophoto s’affiche sous le SVG; la molette et le drag synchronisent la carte et l’overlay. Le bouton « Fond » bascule l’affichage; préférence mémorisée.

### V2 (aperçu) — géométrie d’arêtes et flèches
- Si `edges[i].geometry` est présent (liste `[lon,lat]`), l’arête est rendue en polyligne sur l’orthophoto, avec une flèche au milieu orientée amont→aval.
- Sinon, fallback visuel (courbe) entre nœuds.
- Les nœuds avec GPS (lat/lon) peuvent être « ancrés »: coche « Ancrer au GPS » dans Propriétés pour empêcher le déplacement (déverrouiller pour repasser en XY libres).

### Génération des types TypeScript
- Le schéma Pydantic peut être exporté vers JSON et TypeScript via `scripts/export_schema.py`.
- Exemple : `python scripts/export_schema.py --out docs/graph.schema.json --ts-out web/src/types/graph.d.ts`
- Ou via npm : `npm run types:generate`
- Le fichier `web/src/types/graph.d.ts` est auto-généré ; ne pas l’éditer à la main.

## Impersonation (résumé)
### Stratégie recommandée (local + Cloud Run)
- Utiliser une seule identité SA partout.
  - Local: ADC déjà impersonés vers le SA cible.
    - `gcloud auth application-default login --impersonate-service-account="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"`
    - Ne définissez PAS `IMPERSONATE_SERVICE_ACCOUNT` (laissez vide) pour éviter une ré‑impersonation côté app.
  - Cloud Run: exécuter le service avec ce même SA (`--service-account=...`).
  - Partager le Google Sheet avec ce SA (lecture/écriture).

### Alternative (impersonation dans l’app)
- Garder des ADC utilisateur classiques et laisser l’app impersoner.
  - Donner à votre utilisateur le rôle `roles/iam.serviceAccountTokenCreator` sur le SA cible:
    - `gcloud iam service-accounts add-iam-policy-binding "editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --project "$GCP_PROJECT_ID" --member "user:$(gcloud config get-value account)" --role roles/iam.serviceAccountTokenCreator`
  - Définir `IMPERSONATE_SERVICE_ACCOUNT=editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com` dans `.env.dev`.
  - Cloud Run: si vous utilisez aussi l’impersonation, donner le rôle TokenCreator au runtime SA sur le SA cible et définir la même variable d’env.

### Rôles & APIs
- APIs à activer (une fois): `iam.googleapis.com`, `iamcredentials.googleapis.com`, `sheets.googleapis.com`, `drive.googleapis.com`.
- Rôle requis: `roles/iam.serviceAccountTokenCreator` (sur le SA ciblé) pour l’identité qui mint le token (votre user local ou le runtime SA Cloud Run).

### Notes pratiques
- Placeholders `<...>`: remplacez-les, ou utilisez des variables shell (ex: `$GCP_PROJECT_ID`). Ne laissez pas les chevrons.
- Quota project: `gcloud auth application-default set-quota-project "$GCP_PROJECT_ID"` peut échouer si vos ADC ne sont pas des credentials utilisateur — ce n’est pas bloquant pour Sheets.

## Deux serveurs en dev: qui fait quoi ?
- Uvicorn (port 8080): votre application (API + embed + assets).
- http.server (port 8000): ne sert que la page `dev-embed.html` pour simuler un site hôte (Referer) en iframe.
  - En prod, `http.server` n’existe pas; l’iframe sera intégrée dans Looker Studio / Google Sites.
