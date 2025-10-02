# Notice d’implémentation et test local — Éditeur Réseau

Ce guide décrit, pas à pas, comment installer, configurer, tester en local, builder le frontend, et lancer l’application dans Docker. Il couvre aussi l’usage des différentes sources de données (Google Sheets, JSON sur GCS/fichier local, BigQuery).

## 1) Prérequis
- Python 3.11 ou 3.12
- Node.js 18+ (recommandé: 20+) et npm
- Google Cloud SDK (`gcloud`) connecté à votre compte
- Docker (pour les tests en conteneur)

## 2) Authentification Google (ADC)

Deux chemins sont possibles. En environnement d’entreprise, l’impersonation de Service Account est recommandée car elle évite la fenêtre OAuth.

### 2.A — RECOMMANDÉ: Impersonation d’un Service Account (sans clé JSON)
1. Choisir le projet et définir des variables:
   - `export PROJECT_ID="fr-tpd-sarpi-datagrs-dev"`
   - `gcloud config set project "$PROJECT_ID"`
   - `export SA_NAME=editeur-reseau-sa`
   - `export SA_EMAIL="$SA_NAME@${PROJECT_ID}.iam.gserviceaccount.com"`
   - `export USER_EMAIL="jsonnier@sarpindustries.fr"`
2. Créer (ou réutiliser) le Service Account:
   - `gcloud iam service-accounts create "$SA_NAME" --display-name="Éditeur Réseau SA" --project="$PROJECT_ID"`
3. Donner le droit d’impersonation à votre utilisateur:
   - `gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJECT_ID" --member="user:$USER_EMAIL" --role="roles/iam.serviceAccountTokenCreator"`
   - Si bloqué par la policy d’org, faire le binding au niveau projet: `gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="user:$USER_EMAIL" --role="roles/iam.serviceAccountTokenCreator"`
4. Activer les APIs nécessaires:
 - `gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sheets.googleapis.com drive.googleapis.com --project="$PROJECT_ID"`
5. Partager le Google Sheet avec l’adresse du SA (`$SA_EMAIL`) en Lecteur/Éditeur selon besoin.
6. Créer les ADC en mode impersonation (pas d’OAuth bloqué):
   - `gcloud auth application-default login --impersonate-service-account="$SA_EMAIL"`
   - (Optionnel) fixer le quota project: `gcloud auth application-default set-quota-project "$PROJECT_ID"`
7. Exporter la variable pour l’application:
   - `export IMPERSONATE_SERVICE_ACCOUNT="$SA_EMAIL"`
8. Vérifier:
   - `gcloud auth print-access-token --impersonate-service-account="$SA_EMAIL" | head -c 20; echo`

### 2.B — Alternative: ADC utilisateur avec scopes explicites (si OAuth autorisé)
- Révoquer puis se reconnecter avec scopes requis:
  - `gcloud auth application-default revoke || true`
  - `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.readonly`
- Pourquoi ces scopes ? `cloud-platform` est requis par gcloud, Sheets/Drive sont nécessaires pour l’API Sheets.

Notes:
- Fixer le projet par défaut (utile pour GCP CLIs): `gcloud config set project <GCP_PROJECT_ID>`
- Dans les fichiers `.env*` chargés par l'app (uvicorn `--env-file`), utilisez `GCP_PROJECT_ID` (l'app lit `GCP_PROJECT_ID` ou `GOOGLE_CLOUD_PROJECT`). La variable `PROJECT_ID` est gardée pour commodité avec les commandes `gcloud`.

APIs à activer côté GCP (si besoin):
- `gcloud services enable run.googleapis.com sheets.googleapis.com drive.googleapis.com secretmanager.googleapis.com bigquery.googleapis.com storage.googleapis.com iam.googleapis.com iamcredentials.googleapis.com --project=<GCP_PROJECT_ID>`

## 3) Préparer le Google Sheet
- Créer un spreadsheet avec 2 onglets: `Nodes` et `Edges`.
- Ligne d’entêtes (exact):
  - `Nodes`:
    - `id, nom, type, id_branche, diametre_mm, puits_amont, well_collector_id, well_pos_index, pm_collecteur_id, pm_pos_index, gps_lat, gps_lon, x, y`
  - `Edges`:
    - `id, source_id, cible_id, actif`
- Plan optionnel (surcouche PNG/PDF) :
  - Ajouter une feuille `PlanOverlay` avec une ligne par plan (généralement un plan par site).
  - Colonnes attendues : `site_id`, `display_name`, `drive_file_id` (ou `url` en dev), `media_type`, `cache_max_age_s`, les coins géoréférencés `corner_nw_lat|lon`, `corner_ne_lat|lon`, `corner_sw_lat|lon`, `corner_se_lat|lon`, les réglages par défaut `opacity` (0–1 ou 0–100) et `bearing_deg`, ainsi que `enabled` (TRUE/FALSE).
  - Pour les plans PDF (`media_type=application/pdf`), l’API télécharge le fichier sur Drive et convertit automatiquement la première page en PNG (rendu haute résolution via pypdfium2).
  - Le fichier Drive référencé doit être partagé en lecture avec le Service Account utilisé par l’API.
- Récupérer l’ID du sheet (dans l’URL), par exemple `1AbC...XYZ`.
- En local (ADC via votre compte), aucun partage spécifique requis.

### 2.C — Stratégies locales vs Cloud Run (recommandé)
- Objectif: éviter les surprises et les 403. Utilisez une seule identité SA partout.
- Local (recommandé): ADC déjà impersonés vers le même SA que celui utilisé en prod.
  - `gcloud auth application-default login --impersonate-service-account="$SA_EMAIL"`
  - Ne définissez pas `IMPERSONATE_SERVICE_ACCOUNT` côté app (laissez vide) pour éviter une ré‑impersonation.
- Cloud Run (prod): exécutez le service avec ce même SA (flag `--service-account="$SA_EMAIL"`).
- Alternative (si vous devez impersoner un autre SA):
  - Local: gardez des ADC utilisateur; donnez à votre user `roles/iam.serviceAccountTokenCreator` sur le SA cible; mettez `IMPERSONATE_SERVICE_ACCOUNT=$SA_EMAIL` dans `.env.dev`.
  - Cloud Run: donnez au runtime SA `roles/iam.serviceAccountTokenCreator` sur le SA cible; définissez `IMPERSONATE_SERVICE_ACCOUNT=$SA_EMAIL` dans les env.
- Toujours partager le Google Sheet avec `$SA_EMAIL` (lecture/écriture).

Notes:
- Les placeholders `<...>` sont des exemples: remplacez-les ou utilisez des variables (ex: `$GCP_PROJECT_ID`).
- `gcloud auth application-default set-quota-project` peut échouer si les ADC ne sont pas des credentials utilisateur — ce n’est pas bloquant pour Sheets.

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
  - Résultat: `app/static/bundle/{vendor.ts, polyfills.ts, editor.js, main.js, app.css, editor.css}` et `app/static/vendor/{inter, unicons}`

### 5bis) Fichier .env.dev (recommandé)
Créez un fichier `.env.dev` à la racine pour partager les variables entre terminaux:

```
IMPERSONATE_SERVICE_ACCOUNT=<votre-SA>@<PROJECT_ID>.iam.gserviceaccount.com  # si vous utilisez l’impersonation
SHEET_ID_DEFAULT=<SPREADSHEET_ID>
EMBED_STATIC_KEY=dev-embed-key
ALLOWED_REFERER_HOSTS="localhost 127.0.0.1"
ALLOWED_FRAME_ANCESTORS="http://localhost:8000 http://127.0.0.1:8000"
DATA_SOURCE=sheet
```

Chargez‑le côté shell quand vous en avez besoin: `set -a; source .env.dev; set +a`

## 6) Lancer l’API en local
- Avec env file: `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`
- Contrôle santé:
  - `curl http://127.0.0.1:8080/healthz`

Astuce: uvicorn occupe le terminal. Vous pouvez soit ouvrir un 2e terminal (et `source .env.dev`), soit lancer en arrière‑plan: `uvicorn app.main:app --reload --port 8080 --env-file .env.dev &`

## 7) Tester l’API Graph (Sheets par défaut)
- Lecture:
  - `curl "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT"`
- Écriture (réécrit les onglets `Nodes`/`Edges` au format FR V5/FR V2):
  - `curl -s "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT" -o graph.json`
  - `curl -s -X POST "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT" -H "Content-Type: application/json" --data-binary @graph.json`
  - Relecture pour vérifier: idem GET ci‑dessus
- Plan overlay (si configuré):
  - Config JSON: `curl "http://127.0.0.1:8080/api/plan-overlay/config?source=sheet&sheet_id=$SHEET_ID_DEFAULT"`
  - Image brute: `curl -s "http://127.0.0.1:8080/api/plan-overlay/media?source=sheet&sheet_id=$SHEET_ID_DEFAULT" -o plan.png`
  - Depuis l’UI, le bouton « Importer » permet de déposer un fichier local (PDF ou PNG). L’API convertit automatiquement le fichier en PNG (versions opaque & transparente) puis enregistre les médias dans `plans/<site_id>/` sur Drive. Les colonnes nécessaires (`source_drive_file_id`, `drive_png_*`) sont ajoutées à la feuille `PlanOverlay` si besoin.
  - Le bouton « Supprimer plan » retire ces identifiants et désactive la ligne correspondante, supprimant l’overlay côté front au prochain chargement.

## 8) Tester l’embed (iframe, CSP, clé `k`)
- Test HTTP direct (vérifie CSP et 200):
  - `curl -I -H "Referer: http://localhost:8000" "http://127.0.0.1:8080/embed/editor?k=$EMBED_STATIC_KEY&sheet_id=$SHEET_ID_DEFAULT&mode=ro"`
- Dans un vrai iframe local:
  - Créer un fichier `dev-embed.html` avec:
    - `<iframe src="http://127.0.0.1:8080/embed/editor?k=dev-embed-key&sheet_id=VOTRE_SHEET_ID&mode=ro" style="width:100%;height:80vh;border:1px solid #ccc;"></iframe>`
  - Servir ce fichier: `python -m http.server 8000`
  - Ouvrir: `http://localhost:8000/dev-embed.html`
  - Assurez-vous d’avoir exporté `ALLOWED_REFERER_HOSTS` et `ALLOWED_FRAME_ANCESTORS` avec `localhost:8000`.

Note: `dev-embed.html` fonctionne même sans variables shell; le formulaire construit l’URL de l’iframe.

Mode dev (bypass contrôles embed)
- Pour ouvrir directement l’URL `/embed/editor?...` sans passer par l’iframe locale, vous pouvez désactiver des vérifications en local:
  - `DISABLE_EMBED_REFERER_CHECK=1` (bypass du Referer)
  - `DISABLE_EMBED_KEY_CHECK=1` (bypass de la clé `k`) — à éviter sauf debug local
- Ajoutez ces variables dans `.env.dev` et relancez uvicorn avec `--env-file .env.dev`.

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
  - Si impersonation: vérifier les bindings IAM (TokenCreator sur le SA), la présence du fichier ADC, et que le Sheet est partagé au SA.
  - Si ADC utilisateur: refaire `gcloud auth application-default login` avec les scopes requis.
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

## 13) Validation impersonation (récap)
1. `gcloud config get-value account && gcloud config get-value project`
2. `gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID"`
3. `gcloud iam service-accounts get-iam-policy "$SA_EMAIL" --project="$PROJECT_ID" | sed -n '1,120p'` (doit contenir `roles/iam.serviceAccountTokenCreator` avec votre user)
4. `gcloud auth print-access-token --impersonate-service-account="$SA_EMAIL" | head -c 20; echo`
5. `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`
6. `curl "http://127.0.0.1:8080/api/graph?source=sheet&sheet_id=$SHEET_ID_DEFAULT"`

## 12) (Bonus) Déploiement Cloud Run (source)
- `gcloud run deploy editeur-reseau-api \
    --source . \
    --region=$GCP_REGION \
    --project=$GCP_PROJECT_ID \
    --service-account="$SA_EMAIL" \
    --allow-unauthenticated \
    --set-env-vars=DATA_SOURCE=sheet,EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...`
- Pour utiliser GCS JSON ou BQ par défaut, ajuster `DATA_SOURCE` et variables associées.

Référence fichiers
- Backend: `app/main.py`, `app/routers/{api.py,embed.py}`, `app/sheets.py`, `app/datasources.py`, `app/auth_embed.py`, `app/models.py`
- Frontend: `web/src/*`, build `build.mjs` → `app/static/{bundle,vendor}`
- Docker: `deploy/Dockerfile`
### Alternative recommandée (entreprise) — Impersonation du Service Account
Si votre organisation bloque la fenêtre d’autorisation OAuth (“Accès bloqué”), utilisez l’impersonation de Service Account — aucune fenêtre d’autorisation, pas de JSON de clé:

1. Créez (ou réutilisez) un Service Account (ex: `editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com`).
2. Partagez le Google Sheet avec cet email (lecture/écriture selon besoin).
3. Donnez à votre compte humain le rôle `roles/iam.serviceAccountTokenCreator` sur ce SA.
4. Connectez l’ADC simple (sans scopes custom): `gcloud auth application-default login`.
5. Exportez: `export IMPERSONATE_SERVICE_ACCOUNT=editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com`
6. Relancez l’API; les clients GCP (Sheets, GCS, BigQuery) minton des jetons via IAM avec les bons scopes automatiquement.
