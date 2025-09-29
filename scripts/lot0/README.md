# Scripts Lot 0 — Visualisation

Scripts utilitaires pour explorer et valider les données en amont des développements UI.

## Pré-requis
- Python 3.11+
- Variables d’environnement Google (`GOOGLE_APPLICATION_CREDENTIALS` ou ADC via `gcloud auth application-default login`).
- Dépendances `requirements.txt` installées.

## Scripts disponibles
| Script | Description | Statut |
| --- | --- | --- |
| `fetch_sheets_inventory.py` | Liste les onglets, colonnes et types détectés pour les Sheets existants. | prêt |
| `sample_bigquery.py` | Extrait un échantillon des mesures & métadonnées depuis BigQuery. | prêt |
| `validate_timeseries.py` | Vérifie plages, somme gaz et gaps temporels sur un échantillon JSON/CSV. | prêt |
| `analyze_sheet_links.py` | Analyse les colonnes et la jointure entre onglets/tables, synthèse JSON optionnelle. | prêt |

## Exécution (exemples)
```bash
python scripts/lot0/sample_bigquery.py \
  --project $GCP_PROJECT_ID \
  --dataset biogaz \
  --table mesures \
  --limit 5000 \
  --out data/samples/mesures.json

python scripts/lot0/fetch_sheets_inventory.py \
  --sheet-id $SHEET_ID_DEFAULT \
  --out docs/samples/sheet_inventory.json

python scripts/lot0/validate_timeseries.py \
  --input data/samples/mesures.json \
  --output docs/samples/mesures_report.json

python scripts/lot0/analyze_sheet_links.py \
  --survey-sheet-id 1Nf5zPrzV6nlYrWI8tqFCmBG3RX8w8rReQxZH8_sncyE \
  --primary-tab "R&T BIOGAZ || 965523" \
  --secondary-tab "releve_biogaz" \
  --network-sheet-id 10y5y_3H-3qKzQmY8lx9wevIXXbkWfIU-Qx2uyaaw6Bg
```

Compléter chaque script avec un `README` ou docstring détaillant les options.
