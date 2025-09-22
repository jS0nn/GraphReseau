# Notice de déploiement Cloud Run – Éditeur Réseau

## 1. Objectif et périmètre
L'exécution locale se fait avec `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`, ce qui lit les variables dans un fichier `.env` et recharge le code à chaque modification. Le déploiement sur Cloud Run consiste à empaqueter la même application FastAPI dans un conteneur immuable (sans `--reload`) et à injecter les variables d'environnement directement dans le service. Cette notice détaille chaque commande, son objectif et l'équivalent dans l'interface Google Cloud.

## 2. Pré-requis
- **Accès GCP** : projet facturable, rôle `roles/editor` (ou équivalent) et autorisations sur Cloud Run, Cloud Build, Secret Manager, IAM.
- **Identifiants** : pouvoir exécuter `gcloud auth application-default login` et disposer (ou créer) d'un Service Account dédié `editeur-reseau-sa`.
- **Outils locaux** : Python 3.11/3.12, Node.js ≥ 18, npm, Google Cloud SDK (`gcloud`). Docker est optionnel (utile uniquement si vous construisez l'image en local).

## 3. Préparation du poste local avant le build
1. Créer/activer l'environnement Python :
   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
   Pourquoi : reproduire l'environnement d'exécution backend.
2. Installer et builder le frontend :
   ```bash
   npm install
   npm run build
   ```
   Pourquoi : le build place les bundles dans `app/static/bundle` et `app/static/vendor` (pas de CDN en production).
3. (Optionnel mais recommandé) Lancer les tests backend :
   ```bash
   python -m unittest discover -s tests -p "test_*.py"
   ```
   Pourquoi : s'assurer que la révision est stable avant de créer une révision Cloud Run.

## 4. Configuration du projet Google Cloud
- Sélectionner le projet cible :
  ```bash
  gcloud config set project <GCP_PROJECT_ID>
  ```
  Pourquoi : toutes les commandes suivantes agissent sur ce projet.
  Équivalent console : menu déroulant « Sélectionner un projet ».
- Définir la région Cloud Run par défaut :
  ```bash
  gcloud config set run/region <GCP_REGION>
  ```
  Pourquoi : évite de répéter `--region` sur chaque commande `gcloud run`.
  Équivalent console : `Cloud Run` → `Paramètres` → `Emplacement par défaut`.
- Activer les APIs nécessaires :
  ```bash
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    sheets.googleapis.com \
    drive.googleapis.com \
    storage.googleapis.com \
    bigquery.googleapis.com
  ```
  Pourquoi : Cloud Run/Cloud Build pour le déploiement, IAM/IAM Credentials pour l'impersonation, Sheets/Drive/Storage/BigQuery pour les différentes sources de données.
  Équivalent console : `API & Services` → `Activer des API`.

## 5. Service Account Cloud Run et IAM
1. Créer l'identité runtime (si nécessaire) :
   ```bash
   gcloud iam service-accounts create editeur-reseau-sa \
     --display-name="Éditeur Réseau"
   ```
   Pourquoi : donner une identité dédiée au service Cloud Run.
   Équivalent console : `IAM & Admin` → `Comptes de service` → `Créer un compte`.
2. Attribuer les rôles requis :
   ```bash
   export GCP_PROJECT_ID=<GCP_PROJECT_ID>
   export SA_EMAIL="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

   for ROLE in \
     roles/run.invoker \
     roles/iam.serviceAccountTokenCreator \
     roles/iam.serviceAccountUser \
     roles/sheets.reader \
     roles/drive.file \
     roles/storage.objectViewer \
     roles/bigquery.dataViewer; do
     gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
       --member="serviceAccount:${SA_EMAIL}" \
       --role="$ROLE"
   done
   ```
   Pourquoi :
   - `run.invoker` si d'autres services doivent appeler l'API.
   - `iam.serviceAccountTokenCreator` / `iam.serviceAccountUser` pour autoriser l'impersonation et l'attachement à Cloud Run.
   - Rôles Sheets/Drive/Storage/BigQuery pour les sources de données.
   Équivalent console : `IAM & Admin` → `IAM` → `Accorder l'accès`.
3. Autoriser votre compte humain (ou Cloud Build) à impersoner ce SA :
   ```bash
   gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
     --member="user:$(gcloud config get-value account)" \
     --role=roles/iam.serviceAccountTokenCreator
   ```
   Pourquoi : nécessaire si `IMPERSONATE_SERVICE_ACCOUNT` est utilisé en local ou par Cloud Build.
   Équivalent console : fiche du compte de service → onglet `Autorisations`.

## 6. Configurer l'accès aux données Google
- Partager le Google Sheet identifié par `SHEET_ID_DEFAULT` avec `editeur-reseau-sa@<PROJECT>.iam.gserviceaccount.com` (lecture et écriture si l'API doit sauvegarder).
- Pour GCS/BigQuery, attribuer les rôles `roles/storage.objectAdmin` ou `roles/bigquery.dataEditor` si l'écriture est nécessaire.
- Authentification locale pour tests :
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```
  Pourquoi : la première commande authentifie le CLI, la seconde fournit les ADC utilisés par FastAPI.
  Équivalent console : Cloud Shell (déjà authentifié) ou fenêtre OAuth.

## 7. Variables d'environnement Cloud Run
Ces variables remplacent le fichier `.env.dev` une fois le service déployé.

| Nom | Obligatoire | Description | Utilisation principale | Exemple |
| --- | --- | --- | --- | --- |
| `DATA_SOURCE` | Oui | Source par défaut (`sheet`, `gcs_json`, `bigquery`). | Choix du backend de données. | `sheet` |
| `SHEET_ID_DEFAULT` | Oui si `DATA_SOURCE=sheet` | Spreadsheet Google contenant `Nodes`/`Edges`. | Lecture/écriture Sheets. | `1AbC...` |
| `SHEET_NODES_TAB` / `SHEET_EDGES_TAB` | Non | Noms des onglets si différents. | Adapter à un sheet existant. | `Sommets` |
| `GCS_JSON_URI` | Oui si `DATA_SOURCE=gcs_json` | Emplacement du fichier JSON (GCS ou file:// en dev). | Source GCS. | `gs://bucket/graph.json` |
| `BQ_PROJECT_ID` | Oui si BigQuery hors projet courant | Projet des tables BigQuery. | Source BigQuery. | `reseau-prod` |
| `BQ_DATASET` | Oui si BigQuery | Dataset contenant les tables. | Source BigQuery. | `graphs` |
| `BQ_NODES_TABLE` / `BQ_EDGES_TABLE` | Non | Noms des tables (défaut `Nodes`/`Edges`). | Adapter au schéma BQ. | `graph_nodes` |
| `EMBED_STATIC_KEY` | Oui | Clé attendue sur `/embed/editor?k=...`. | Protection de l'iframe. | `prod-embed-2024` |
| `ALLOWED_REFERER_HOSTS` | Oui | Liste d'hôtes autorisés comme `Referer` (séparés par espaces). | Contrôle côté API. | `lookerstudio.google.com sites.google.com` |
| `ALLOWED_FRAME_ANCESTORS` | Oui | Valeurs CSP `frame-ancestors`. | Contrôle côté navigateur. | `https://lookerstudio.google.com https://sites.google.com` |
| `GCP_PROJECT_ID` / `GCP_REGION` | Recommandé | Renseignés dans les logs/scripts. | Observabilité. | `reseau-prod`, `europe-west1` |
| `IMPERSONATE_SERVICE_ACCOUNT` | Optionnel | Email du SA à impersoner. | ADC + impersonation côté API. | `editeur-reseau-sa@...` |
| `DISABLE_EMBED_REFERER_CHECK` / `DISABLE_EMBED_KEY_CHECK` | Dev uniquement | Mettre `1` pour désactiver les contrôles (ne pas utiliser en prod). | Tests locaux. | `1` |

## 8. Gestion des secrets
- Créer un secret pour la clé d'embed :
  ```bash
  echo -n "<CLE_EMBED>" | gcloud secrets create embed-static-key \
    --data-file=- \
    --replication-policy=automatic
  ```
  Pourquoi : éviter d'exposer la clé dans la configuration Cloud Run.
- Mettre à jour la valeur (si elle change) :
  ```bash
  echo -n "<NOUVELLE_CLE>" | gcloud secrets versions add embed-static-key --data-file=-
  ```
  Équivalent console : `Secret Manager` → `Créer un secret` puis `Ajouter une version`.

## 9. Construire et empaqueter l'application
- S'assurer que `npm run build` a été exécuté : Cloud Build copiera exactement les fichiers présents dans le dépôt.
- Nettoyer les fichiers temporaires (`.env.dev`, caches) avant de pousser une branche ou de lancer un build.

## 10. Déployer sur Cloud Run
### Option A — Build source via Cloud Build (recommandé)
```bash
export GCP_PROJECT_ID=<GCP_PROJECT_ID>
export GCP_REGION=<GCP_REGION>
export SERVICE_NAME=editeur-reseau-api
export SA_EMAIL="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --set-env-vars DATA_SOURCE=sheet,SHEET_ID_DEFAULT=<SHEET_ID>,ALLOWED_REFERER_HOSTS="lookerstudio.google.com sites.google.com",ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com" \
  --update-secrets EMBED_STATIC_KEY=embed-static-key:latest
```
Pourquoi :
- `--source .` déclenche Cloud Build pour générer l'image à partir du dépôt.
- `--service-account` attache `editeur-reseau-sa` à l'exécution.
- `--allow-unauthenticated` rend l'API accessible à l'iframe Looker/Sites.
- `--set-env-vars` injecte l'équivalent du `.env.dev` (hors secrets).
- `--update-secrets EMBED_STATIC_KEY=...` lie le secret créé précédemment.
Équivalent console : `Cloud Run` → `Créer un service` → onglet `Source` → renseigner les sections `Variables et secrets`.

### Option B — Image container pré-construite
1. Construire et pousser l'image :
   ```bash
   gcloud builds submit --tag "gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}:latest"
   ```
   Pourquoi : créer une image réutilisable (utile pour CI/CD).
2. Déployer l'image :
   ```bash
   gcloud run deploy "$SERVICE_NAME" \
     --image "gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}:latest" \
     --project "$GCP_PROJECT_ID" \
     --region "$GCP_REGION" \
     --service-account "$SA_EMAIL" \
     --allow-unauthenticated \
     --set-env-vars ... \
     --update-secrets EMBED_STATIC_KEY=embed-static-key:latest
   ```
   Pourquoi : séparer construction et déploiement.
   Équivalent console : `Cloud Run` → `Déployer un service` → option `Déployer une image conteneur`.

## 11. Vérifications post-déploiement
- Récupérer l'URL du service :
  ```bash
  gcloud run services describe "$SERVICE_NAME" --format='value(status.url)'
  ```
- Vérifier la santé :
  ```bash
  curl https://<SERVICE_URL>/healthz
  ```
  Résultat attendu : `{"status":"ok"}` (HTTP 200).
- Tester la lecture du graphe :
  ```bash
  curl "https://<SERVICE_URL>/api/graph?sheet_id=<SHEET_ID>"
  ```
  Pourquoi : valider l'accès aux données Google.
- Tester l'embed avec un Referer autorisé :
  ```bash
  curl -I -H "Referer: https://lookerstudio.google.com" \
    "https://<SERVICE_URL>/embed/editor?k=<CLE>&sheet_id=<SHEET_ID>&mode=ro"
  ```
  Résultat attendu : HTTP 200 et en-têtes CSP corrects.
  Équivalent console : onglet `Tester` de la fiche Cloud Run + test navigateur.

## 12. Observabilité et exploitation
- Logs temps réel :
  ```bash
  gcloud logs tail "projects/${GCP_PROJECT_ID}/logs/run.googleapis.com%2Fstdout" \
    --service="$SERVICE_NAME"
  ```
  Pourquoi : suivre les requêtes FastAPI.
  Équivalent console : `Cloud Run` → service → `Logs`.
- Logs d'erreur :
  ```bash
  gcloud logs tail "projects/${GCP_PROJECT_ID}/logs/run.googleapis.com%2Fstderr" \
    --service="$SERVICE_NAME"
  ```
- Monitoring : configurer des alertes dans `Monitoring` → `Alerting` (console) sur les erreurs 5xx ou la latence.

## 13. Itérations, mises à jour et rollback
- Redéployer après modification : relancer `gcloud run deploy ...` avec les mêmes drapeaux.
- Mettre à jour une variable :
  ```bash
  gcloud run services update "$SERVICE_NAME" \
    --set-env-vars NOUVELLE_CLE=valeur
  ```
- Mettre à jour un secret attaché :
  ```bash
  gcloud run services update "$SERVICE_NAME" \
    --update-secrets EMBED_STATIC_KEY=embed-static-key:latest
  ```
- Revenir à une révision antérieure :
  ```bash
  gcloud run revisions list --service="$SERVICE_NAME"
  gcloud run services update-traffic "$SERVICE_NAME" \
    --to-revisions <revision-name>=100
  ```
  Équivalent console : `Cloud Run` → service → `Révisions` → `Rediriger tout le trafic`.
- Supprimer le service (si nécessaire) :
  ```bash
  gcloud run services delete "$SERVICE_NAME" --region "$GCP_REGION"
  ```

## 14. Checklist finale avant mise en production
- [ ] Bundles frontend présents dans `app/static/bundle` et `app/static/vendor`.
- [ ] Tests unitaires `python -m unittest` réussis.
- [ ] Service Account Cloud Run autorisé sur Sheets/Drive (et GCS/BQ si applicable).
- [ ] Variables d'environnement et secrets saisis dans la configuration Cloud Run.
- [ ] URL `/healthz`, `/api/graph`, `/embed/editor` testées avec succès.
- [ ] Documentation interne mise à jour si le schéma ou la configuration change.

Cette notice peut servir de script opératoire manuel ou être traduite en pipeline CI/CD (Cloud Build Trigger) en réutilisant les mêmes commandes `gcloud`.
