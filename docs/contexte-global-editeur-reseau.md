# Editeur Reseau - Note de contexte exhaustive

## 1. Vision et objectifs
- Remplacer le backend Apps Script historique par un service FastAPI deployable sur Cloud Run, tout en conservant la capacite a lire et ecrire le graphe depuis Google Sheets.
- Offrir un frontend autonome (D3 + Elkjs) integre en iframe dans Looker Studio / Google Sites, sans dependance CDN, capable d afficher et d editer le reseau.
- Centraliser la definition du format `Graph` (noeuds + aretes) afin que backend, frontend et scripts partagent le meme contrat de donnees.
- Etendre le systeme a d autres sources (JSON GCS, BigQuery) et preparer les evolutions V2 (liens signes court terme, RBAC API, orthophoto).

## 2. Architecture d ensemble
- **Clients**: iframe Looker Studio/Sites, page de dev `dev-embed.html`, outils internes qui consomment l API.
- **Frontend**: bundle esbuild situe dans `app/static/bundle`. Il interroge `GET /api/graph`, affiche le reseau via D3/Elkjs, et effectue les sauvegardes via `POST /api/graph` (mode `rw`).
- **Backend FastAPI** (`app/main.py`, `app/routers/*`): expose `/api/graph` et `/embed/editor`, sert les assets statiques et applique la CSP.
- **Couche de donnees** (`app/datasources/`): charge et sauvegarde le graphe depuis Sheets, JSON GCS/local, BigQuery (lecture seule). La sanitisation commune se trouve dans `app/shared/graph_transform.py` (via `app/services/graph_sanitizer.py`).
- **Authentification Google** (`app/gcp_auth.py`): obtention des credentials (ADC avec impersonation eventuelle) pour les appels Sheets, GCS ou BigQuery.
- **Infra cible**: Cloud Run pour l API, build source via Cloud Build. Les assets sont directement livres par le service FastAPI.

Flux type (lecture):
1. L iframe charge `/embed/editor?k=<cle>&sheet_id=<id>&mode=ro` -> Jinja rend `templates/index.html` avec la CSP.
2. Le frontend appelle `GET /api/graph` (source par defaut `sheet`) -> backend charge le graphe depuis la source configuree.
3. FastAPI renvoie un JSON valide au schema `Graph` -> frontend rend le graphe.
4. Sauvegarde (mode `rw` uniquement): `POST /api/graph` -> sanitisation -> ecriture de la source (Sheets/GCS JSON).

## 3. Backend FastAPI
- **Initialisation** (`app/main.py`): cree l app, monte `/static`, applique un middleware CSP (`CSPMiddleware`) qui supprime tout `X-Frame-Options`.
- **Configuration** (`app/config.py`): lecture des variables d environnement (DATA_SOURCE, SHEET_ID_DEFAULT, EMBED_STATIC_KEY, etc.), toggles dev (desactivation referer/cle), options carte (MAP_TILES_URL).
- **Endpoints API** (`app/routers/api.py`):
  - `GET /api/graph`: selectionne la source via `source=` ou `settings.data_source_default`, accepte les overrides (sheet_id, gcs_uri, bq_*). Filtre facultatif `site_id` pour Sheets.
  - `POST /api/graph`: meme signature; valide le payload `Graph`, sanitise les aretes, puis ecrit dans la source (sauf BigQuery -> 501).
- **Router embed** (`app/routers/embed.py`): verifie `mode` (ro/rw), controle la cle `k` et le referer via `check_embed_access`, puis rend `templates/index.html` avec les variables d environnement (tiles map).
- **Securite embed** (`app/auth_embed.py`):
  - `build_csp()`: compose la CSP, autorise `frame-ancestors`, `connect-src 'self'`, `img-src` pour les tuiles si configurees.
  - `check_embed_access`: compare la cle `k` a `EMBED_STATIC_KEY` (sauf override dev) et verifie que `Referer` fait partie de `ALLOWED_REFERER_HOSTS`.
- **Sanitisation** (`app/shared/graph_transform.py`):
  - S assure que chaque arete a un ID unique (`E-<timestamp><random>`), ignore les aretes invalidees, nettoie `active/commentaire`.
- **Data sources** (`app/datasources/__init__.py`):
  - `sheet`: appel a `app/datasources/sheets.py` (lecture/ecriture), require `sheet_id` (query ou env). Filtre `site_id` lorsque `REQUIRE_SITE_ID=1`.
  - `gcs_json`: lit/ecrit un fichier JSON local (`file:///`) ou GCS (`gs://`). Preserve `x/y` existants lors de la sauvegarde.
  - `bigquery`: lecture via requetes SQL, mapping colonnes FR/EN. Ecriture non impl.
- **Google Sheets** (`app/sheets.py`): detection d entetes multiples (V1 -> V8 FR/EN), conversion types, mapping `extras`, formatage geometry (liste `[lon,lat]`). Lors de l ecriture, recupere `x/y` courants pour ne pas ecraser la position forcee.
- **GCS JSON** (`app/datasources/gcs_json.py`): support lecture/merge/ecriture locale ou GCS, merge les positions `x/y` existantes si fichier precedent.
- **BigQuery** (`app/datasources/bigquery.py`): requete `SELECT *`, conversion WKT -> LineString, convertion booleens, ecriture leve `501`.

## 4. Authentification Google et gestion des identites
- Credentials obtenus via `google.auth.default()` avec scopes cibles (Sheets, Drive, Storage, BigQuery).
- Possibilite d impersoner un Service Account cible via `IMPERSONATE_SERVICE_ACCOUNT` (le backend detecte si l ADC courant est deja impersonne pour eviter la double impersonation).
- Preconditions: roles `roles/iam.serviceAccountTokenCreator` pour l utilisateur, APIs IAM/SHEETS/DRIVE/BIGQUERY activees, partage du Sheet au SA.
- Mode operationnel recommande (Option A du guide): `gcloud auth application-default login --impersonate-service-account=<SA>` et ne pas definir `IMPERSONATE_SERVICE_ACCOUNT` dans `.env` (pour eviter double hop).

## 5. Frontend (bundle esbuild)
- **Sources**: `web/src/*` (modules ES). `editor.js` charge `editor.boot.js` qui instancie l application.
- **Libs**: D3 pour le rendu SVG, Elkjs pour la mise en page auto, Leaflet-like map maison pour superposer une orthophoto (optionnelle). `vendor.js` regroupe D3/Elkjs et icones Unicons.
- **Etat et interactions**:
  - `state/`: store reactif minimaliste (subscribe, history undo/redo, modes ro/rw).
  - `render/`: `render-nodes.js`, `render-edges.js`, `render-inline.js` pour dessiner le graphe.
  - `interactions/`: drag & drop, selection, creation d aretes, edition de geometrique, junction.
  - `ui/`: barres d outils, formulaires propriete, logs (console dev), support theme clair/sombre.
- **API client** (`web/src/api.js`): wrappers fetch pour GET/POST, injection des params `source`/`sheet_id` a partir de l URL de l iframe. Gestion mode lecture seule.
- **Exports** (`web/src/exports.js`): generation de JSON complet, compact, ou node-edge pour diagnostic.
- **Map** (`web/src/map.js`): active si `MAP_TILES_URL` non vide; s aligne sur le graphe, peut re-projeter les positions GPS.
- **Build**: `npm run build` appelle `build.mjs` -> esbuild (browser target moderne), minification, copy assets (`app/static/vendor/*`). Aucun CDN n est charge, ressources hebergees localement.
- **Compatibilite iframe**: l embed s adapte a la hauteur de la barre d outils et expose un bouton de bascule vue graphe/vues geographiques (dev).

## 6. Format de donnees `Graph`
- Schema Pydantic (voir `app/models.py`):
  - `Graph`:
    - `nodes: List[Node]`
    - `edges: List[Edge]`
  - `Node` (attributs principaux): `id`, `name`, `type`, `branch_id`, `commentaire`, `collector_well_ids`, `well_collector_id`, `well_pos_index`, `pm_collector_id`, `pm_collector_edge_id`, `pm_pos_index`, `gps_lat`, `gps_lon`, `lat`, `lon`, `x`, `y`, `x_ui`, `y_ui`, `extras`.
    - Les champs `diameter_mm`, `sdr_ouvrage` et `material` ne sont renseignés que pour les nœuds de type `CANALISATION`. Pour les autres éléments (OUVRAGE, GENERAL, POINT_MESURE, VANNE, ...), ils sont laissés vides côté modèle et calculés à la volée dans l’UI à partir de la canalisation d’attache.
    - Validator `_sync_lon_lat` maintient la coherence `gps_lat/gps_lon` <-> `lat/lon`.
  - `Edge`: `id`, `from_id`, `to_id`, `active`, `commentaire`, `geometry` (LineString `[lon,lat]`), `pipe_group_id`, `branch_id`, `diameter_mm`, `length_m`, `material`, `sdr`.
- **Type de graphe**: graphe oriente representant un reseau de collecte (souvent quasi-arborescent). Les aretes `from_id -> to_id` materialisent le flux physique (ex: captage -> collecteur -> rejet). Le layout ELK produit un arbre dirige hierarchique, mais la structure supporte un DAG avec confluences.
- **Compatibilite colonnes**:
  - Sheets: detection entetes FR/EN versions V1 a V8 (ancien Apps Script). Colonnes metier additionnelles stockees dans `extras` (`idSite1`, `site`, `Regroupement`, etc.).
  - BigQuery: map colonnes FR/EN, WKT en geometry. Booleens `actif/active` convertis en bool.
  - JSON: strict respect du schema Pydantic, merge `x/y` existants avant ecriture.
- **Exemple JSON complet**:
```json
{
  "nodes": [
    {
      "id": "N-root",
      "name": "Station de pompage",
      "type": "OUVRAGE",
      "branch_id": "BR-001",
      "commentaire": "Noeud amont",
      "gps_lat": 44.9084,
      "gps_lon": 4.8721,
      "x": 120,
      "y": 80,
      "x_ui": 130,
      "y_ui": 90,
      "extras": {
        "idSite1": "site-rome",
        "site": "Rome",
        "Regroupement": "Collecteur Nord"
      }
    },
    {
      "id": "N-collecteur-1",
      "name": "Collecteur A",
      "type": "CANALISATION",
      "branch_id": "BR-001",
      "diameter_mm": 180,
      "sdr_ouvrage": "SDR-11",
      "material": "PEHD",
      "gps_lat": 44.9081,
      "gps_lon": 4.8735,
      "x": 220,
      "y": 180
    },
    {
      "id": "N-deversoir",
      "name": "Deversoir final",
      "type": "OUVRAGE",
      "branch_id": "BR-001",
      "gps_lat": 44.9091,
      "gps_lon": 4.8749,
      "x": 320,
      "y": 260
    }
  ],
  "edges": [
    {
      "id": "E-root-A",
      "from_id": "N-root",
      "to_id": "N-collecteur-1",
      "active": true,
      "commentaire": "Pompe -> canalisation",
      "geometry": [[4.8721,44.9084],[4.8730,44.9089],[4.8735,44.9081]]
    },
    {
      "id": "E-A-deversoir",
      "from_id": "N-collecteur-1",
      "to_id": "N-deversoir",
      "active": true
    }
  ]
}
```

## 7. Configuration et environnements
- `.env.example` -> copier en `.env.dev`. Variables clefs:
  - `SHEET_ID_DEFAULT`, `SHEET_NODES_TAB`, `SHEET_EDGES_TAB`.
  - `EMBED_STATIC_KEY`, `ALLOWED_REFERER_HOSTS`, `ALLOWED_FRAME_ANCESTORS`.
  - `DATA_SOURCE` (`sheet|gcs_json|bigquery`).
  - `GCS_JSON_URI`, `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_NODES_TABLE`, `BQ_EDGES_TABLE`.
  - Toggles: `DISABLE_EMBED_REFERER_CHECK`, `DISABLE_EMBED_KEY_CHECK`, `SITE_ID_FILTER_DEFAULT`, `REQUIRE_SITE_ID`.
  - Map: `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY`.
- Lancement local: venv Python 3.11+, `pip install -r requirements.txt`, `npm install`, `npm run build`, `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`.
- Test embed: `python -m http.server 8000` puis `http://localhost:8000/dev-embed.html` (simule le Referer autorise).

## 8. Outils et scripts
- `npm run build` / `npm run build:dev` pour bundler le frontend.
- `npm run types:generate` (si schema Graph evolue) -> met a jour `web/types/graph.d.ts`.
- Script migration Sheets -> `scripts/migrate_nodes_from_sheet.py` (aligne un onglet existant sur le format V5/V8 et conserve les colonnes metier).
- Tests backend: `python -m unittest discover -s tests -p "test_*.py"`.
- Sauvegarde JSON local: `curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" -H "Content-Type: application/json" --data-binary @graph.json`.

## 9. Deploiement Cloud Run
- Commande type (Cloud Build source):
```
gcloud run deploy editeur-reseau-api \
  --source . \
  --region=$GCP_REGION \
  --project=$GCP_PROJECT_ID \
  --service-account="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --set-env-vars=EMBED_STATIC_KEY=...,SHEET_ID_DEFAULT=...,DATA_SOURCE=sheet,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com"
```
- Preconditions: projet GCP cible, SA deploye, secrets (EMBED_STATIC_KEY) configures. Partager le Sheet avec le SA Cloud Run.
- Observations: Cloud Run gere la scalabilite; stocker les bundles dans l image evite la dependance a un CDN externe.

## 10. Securite et conformite
- **CSP** stricte avec `default-src 'none'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `frame-ancestors` conforme a l environnement cible.
- **Controle embed**: combinaison cle statique + referer; toggles dev pour bypass local. V2: signatures court terme (Cloud Tasks / IAM) envisagees.
- **Acces donnees**: ADC + impersonation; aucun secret en clair dans le repo. Favoriser Secret Manager pour les cles en prod.
- **Sauvegarde Sheets**: ecritures idempotentes, efface la plage avant ecriture (evite residus). Maintien `x/y` existants pour ne pas bouleverser la cartographie officielle.

## 11. Maintenance et depannage
- Logs FastAPI (uvicorn) detailent les requetes. Ajouter `--reload` en local pour hot reload.
- Erreurs Google API (401/403): verifier impersonation, partage du Sheet, activation API.
- Erreur 403 `invalid referer`: ajuster `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS`.
- `ModuleNotFoundError: googleapiclient`: s assurer que venv actif et `pip install -r requirements.txt` execute.
- Build frontend: verifier version Node >= 18, re-executer `npm install` puis `npm run build`.

## 12. Roadmap et evolutions
- **V2** (prioritaires):
  - Liens d embed signes a duree limitee (remplacer `EMBED_STATIC_KEY`).
  - RBAC cote API (lecture seule vs edition, tokens specifiques).
  - Gestion cartes orthophoto amelioree (tuiles WMTS + cache service).
- **Autres pistes**:
  - Support ecriture BigQuery.
  - Validation schema Graph versionnee (ajout champs metiers, typage Pydantic).
  - Tests end-to-end (Playwright) pour l embed.
  - Monitoring Cloud Run (erreurs 5xx, latences) via Cloud Logging + alerts.

## 13. Resume operationnel
1. Configurer `.env.dev`, activer la venv, `npm run build`.
2. `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`.
3. Tester `GET /healthz`, `GET /api/graph`.
4. Verifier l embed via `dev-embed.html`.
5. Pour deployer: `gcloud run deploy` (apres commit des bundles).
6. Documenter toute evolution (schema Graph, sources) dans `README.md`, `TEST_PLAN.md`, et mettre a jour la presente note si la structure change.
