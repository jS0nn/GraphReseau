# Commandes & scripts utiles

## Backend (Python)
- Lancer l’API : `uvicorn app.main:app --reload --port 8080 --env-file .env.dev`
- Tests unitaires : `python -m unittest`
- Export schéma & types :
  ```bash
  python scripts/export_schema.py --out docs/reference/schemas/graph.schema.json \
         --ts-out web/src/types/graph.d.ts
  ```

## Frontend (Node.js)
- Installer : `npm install`
- Build production : `npm run build`
- Build dev : `npm run build:dev`
- Tests (placeholder) : `npm test` (`node --test web/tests/**/*.mjs`) ⚠️ TODO.

## Outils JSON / diagnostic
- Lire un JSON local :
  ```bash
  curl "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json"
  ```
- Sauvegarder vers JSON :
  ```bash
  curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" \
       -H "Content-Type: application/json" --data-binary @graph.json
  ```

## Déploiement Cloud Run
```bash
gcloud run deploy editeur-reseau-api \
  --source . \
  --region=$GCP_REGION \
  --project=$GCP_PROJECT_ID \
  --service-account="editeur-reseau-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --set-env-vars=EMBED_STATIC_KEY=...,ALLOWED_FRAME_ANCESTORS="https://lookerstudio.google.com https://sites.google.com",SHEET_ID_DEFAULT=...,DATA_SOURCE=sheet
```

## Authentification
- `gcloud auth application-default login`
- `gcloud auth application-default login --impersonate-service-account=$SA_EMAIL`
- `gcloud auth application-default print-access-token | head -c 20`

## Services auxiliaires
- Serveur statique : `python -m http.server 8000`
- Formatter JSON : `jq '.'`
- ⚠️ TODO : scripts de migration Sheets si colonnes évolutives.
