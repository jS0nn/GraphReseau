# Architecture applicative

## Panorama du système
L’Éditeur Réseau est une application Cloud Run composée d’un backend FastAPI (`app/main.py`) et d’un frontend D3/Leaflet bundlé via esbuild (`build.mjs`). Un navigateur charge `/embed/editor`, ce qui sert les bundles statiques puis dialogue avec `/api/graph` pour récupérer ou sauvegarder la structure du réseau (nœuds, arêtes, branches). Les données peuvent provenir de Google Sheets, de JSON stocké sur Google Cloud Storage (ou fichier local en dev) et de BigQuery (lecture seule).

## Diagrammes C4 disponibles
- **Contexte (L1)** : acteurs externes et dépendances (Google Sheets, GCS, BigQuery, ADC). Voir `../diagrams/c4-context.md`.
- **Conteneurs (L2)** : séparation backend/ frontend, adaptateurs de données, stockage. Voir `../diagrams/c4-container.md`.
- **Composants (L3)** : routers FastAPI, sanitizeurs, modules frontend (state, renderers, interactions). Voir `../diagrams/c4-component.md`.
- **Séquences clés** : chargement et sauvegarde d’un graphe, recalcul de branches. Voir `../diagrams/key-sequences.md`.

## Couches techniques

### [Frontend JS/TS]
- `web/src/editor.boot.ts:1-220` orchestration UI : initialise D3/Leaflet, l’historique (`createHistory`), les interactions (drag/draw) et appelle `web/src/api.js:1-86`.
- `web/src/state/` : magasin d’état centralisé, normalisation des graphes (`normalizeGraph`), règles de branche (`graph-rules.js`).
- `web/src/shared/graph-transform.ts:1-220` : nettoyage côté client (coercition numérique, gestion des branches, géométrie).
- Les bundles sont générés via `build.mjs:1-88` (JS + CSS + assets fonts/icônes). Aucun CDN n’est utilisé (`package.json`, `web/styles/*`).

### [Backend Python]
- Application FastAPI (`app/main.py:13-39`) avec middleware CSP personnalisé (`CSPMiddleware`).
- Routers :
  - `/api/graph` (`app/routers/api.py:12-68`) : lecture/écriture du modèle `Graph`.
  - `/api/graph/branch-recalc` (`app/routers/branch.py:11-22`) : recalcul des branches via `sanitize_graph`.
  - `/embed/editor` (`app/routers/embed.py:14-46`) : page HTML Jinja (templates `app/templates/index.html`).
- Sanitisation et normalisation côté serveur : `app/services/graph_sanitizer.py:12-165`, `app/shared/graph_transform.py:942-1318`.
- Support Google Cloud : `app/gcp_auth.py:8-44` (ADC/impersonation), `app/auth_embed.py:8-49` (CSP, clé, Referer).

### [API]
- Endpoints documentés dans `../reference/api/openapi.yaml`.
- Modèle `Graph` défini dans `app/models.py:37-151` (nœuds/arêtes/branches, calcul de longueurs).
- Tests de contrat : `tests/test_api_contract.py:12-110`, `tests/test_graph_sanitizer.py:20-168`.

### [DB]
- Google Sheets : adaptateur `app/datasources/sheets.py:17-63`, onglets `Nodes` et `Edges`.
- Google Cloud Storage JSON : `app/datasources/gcs_json.py:17-117`, merge des positions (x/y) lors des sauvegardes.
- BigQuery lecture : `app/datasources/bigquery.py:17-149` (mapping colonnes FR/EN, parsing WKT). Écriture non implémentée (`save_bigquery` → 501).

### [Messaging/Events]
- Aucun bus d’événements interne. La documentation `../reference/events/README.md` recense ce manque. ⚠️ TODO: définir des événements si un bus Pub/Sub est introduit (V2 RBAC).

### [Infra/CI]
- Build frontend : `npm run build` (esbuild).
- Tests backend : `python -m unittest` (`tests/`).
- Déploiement Cloud Run : commande type dans `README.md` et `NOTICE_IMPLEMENTATION.md`, utilisant `gcloud run deploy ...`.
- Auth Google : ADC + impersonation (`../overview/architecture.md` ↔ `app/config.py:38-75`).

### [Services externes]
- Google Sheets API, Drive API.
- Google Cloud Storage JSON (scopes read/write).
- BigQuery API (lecture).
- Map tiles optionnels (`settings.map_tiles_url`, `app/config.py:71-74`), CSP mis à jour dynamiquement.

## Sécurité & gouvernance
- Clé d’embed (`EMBED_STATIC_KEY`) + contrôle du Referer (`ALLOWED_REFERER_HOSTS`) (`app/auth_embed.py:39-49`).
- CSP stricte + suppression d’`X-Frame-Options` pour autoriser l’iframe (`app/main.py:13-33`).
- ADC/impersonation unique recommandée (éviter double impersonation), voir `../how-to/rotate-secrets.md`.
- Données sensibles : coordonnées GPS, diamètres, commentaires d’exploitation (PII potentielle). Voir `../data-contracts/data-catalog.md`.

## Flux principaux
1. **Chargement de graphe** : frontend `fetch('/api/graph')` → adaptateur (Sheets/GCS/BQ) → modèle `Graph`.
2. **Sauvegarde** : frontend `POST /api/graph` → `sanitize_graph_for_write` → `save_*`.
3. **Recalcul branche** : `POST /api/graph/branch-recalc` (strict=False) → diagnostics, renvoyés au client.
4. **Embed** : `GET /embed/editor?k=...` → contrôle clé + Referer + CSP → template `index.html`.

⚠️ TODO: ajouter un mécanisme de signature courte durée pour les liens d’embed (roadmap V2, `AGENTS.md`).
