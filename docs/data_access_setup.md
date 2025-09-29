# Mise en place de l’accès données — Visualisation & Interprétation

Ces étapes permettent de préparer l’accès aux feuilles Google Sheets et aux tables BigQuery utilisées dans le Lot 0 (inventaire et qualité des données).

## 1. Variables d’environnement
Assure-toi que `.env.dev` contient :

```env
GCP_PROJECT_ID=fr-tpd-sarpi-datagrs-dev
SA_NAME=editeur-reseau-sa
SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
SURVEY_SHEET_ID=1Nf5zPrzV6nlYrWI8tqFCmBG3RX8w8rReQxZH8_sncyE
SURVEY_PRIMARY_TAB="R&T BIOGAZ || 965523"
SURVEY_SECONDARY_TAB="releve_biogaz"
SHEET_ID_DEFAULT=10y5y_3H-3qKzQmY8lx9wevIXXbkWfIU-Qx2uyaaw6Bg  # feuille réseau
```

Active ensuite l’environnement Python :
```bash
source .venv/bin/activate
set -a; source .env.dev; set +a
```

## 2. Autorisations Service Account
1. Donner à ton utilisateur le rôle `roles/iam.serviceAccountTokenCreator` :
   ```bash
   gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
     --project="$GCP_PROJECT_ID" \
     --member="user:$(gcloud config get-value account)" \
     --role=roles/iam.serviceAccountTokenCreator
   ```
2. Activer les APIs nécessaires :
   ```bash
   gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sheets.googleapis.com drive.googleapis.com \
     --project="$GCP_PROJECT_ID"
   ```
3. Partager les feuilles `SURVEY_SHEET_ID` et `SHEET_ID_DEFAULT` avec l’adresse du service account (`$SA_EMAIL`).

## 3. Authentification ADC avec impersonation

```bash
gcloud auth application-default login \
  --impersonate-service-account="$SA_EMAIL" \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/drive.readonly
```

> Les scopes `spreadsheets.readonly` et `drive.readonly` sont nécessaires pour récupérer les onglets via l’API. Sans eux, l’erreur `ACCESS_TOKEN_SCOPE_INSUFFICIENT` apparaîtra.

### Vérifications
```bash
python - <<'PY'
import google.auth
creds, project = google.auth.default()
print("ADC type:", type(creds).__name__)
print("Service account:", getattr(creds, 'service_account_email', 'n/a'))
print("Projet:", project)
PY

curl -s \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  "https://sheets.googleapis.com/v4/spreadsheets/$SURVEY_SHEET_ID" \
  | head
```

## 4. Scripts Lot 0
```bash
mkdir -p docs/samples

python scripts/lot0/analyze_sheet_links.py \
  --survey-sheet-id "$SURVEY_SHEET_ID" \
  --primary-tab "$SURVEY_PRIMARY_TAB" \
  --secondary-tab "$SURVEY_SECONDARY_TAB" \
  --network-sheet-id "$SHEET_ID_DEFAULT" \
  --out docs/samples/sheets_link_analysis.json

python scripts/lot0/fetch_sheets_inventory.py \
  --sheet-id "$SURVEY_SHEET_ID" \
  --out docs/samples/sheet_inventory_survey.json

python scripts/lot0/fetch_sheets_inventory.py \
  --sheet-id "$SHEET_ID_DEFAULT" \
  --out docs/samples/sheet_inventory_network.json

python scripts/lot0/sample_bigquery.py \
  --project "$GCP_PROJECT_ID" \
  --dataset <DATASET> \
  --table <TABLE> \
  --limit 5000 \
  --out data/samples/mesures.json

python scripts/lot0/validate_timeseries.py \
  --input data/samples/mesures.json \
  --output docs/samples/mesures_report.json
```
Remplace `<DATASET>`/`<TABLE>` par les identifiants BigQuery pertinents.

## 5. Documentation des analyses
- `docs/samples/sheets_link_analysis.json` : résultat des jointures (à archiver).
- `docs/data_model_visualisation.md` : compléter l’inventaire des sources et le mapping.
- `docs/data_quality_report.md` : consigner les anomalies détectées par `validate_timeseries.py`.

---
Mettre à jour ce document si de nouvelles sources ou scopes sont nécessaires.
