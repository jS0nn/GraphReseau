# Guide pratique – Exécuter l’application en local

## 1. Préparer l’environnement
- Python 3.11/3.12 (`python --version`).
- Node.js ≥ 18 (`node -v`).
- `gcloud` connecté au bon projet (ADC).
- Variables d’environnement dans `.env.dev` (copie de `.env.example`).

## 2. Installer les dépendances
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
```

## 3. (Option) Régénérer les bundles frontend
```bash
npm run build        # production
npm run build:dev    # sourcemaps + logs
```

## 4. Lancer FastAPI avec rechargement
```bash
uvicorn app.main:app --reload --port 8080 --env-file .env.dev
```
- `--reload` recharge à chaud en dev.
- Vérifier `http://127.0.0.1:8080/healthz`.

## 5. Tester l’iframe d’embed
```bash
python -m http.server 8000
```
- Ouvrir `http://localhost:8000/dev-embed.html`, renseigner `k` et `sheet_id`.

## 6. Scénarios de test rapides
- `curl http://127.0.0.1:8080/api/graph | jq '.'`
- `curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" -H "Content-Type: application/json" --data-binary @graph.json`
- `curl -X POST "http://127.0.0.1:8080/api/graph/branch-recalc" -H "Content-Type: application/json" --data-binary @graph.json | jq '.branch_diagnostics'`

## 7. Nettoyer
- `CTRL+C` pour stopper uvicorn et http.server.
- `deactivate` la venv.
- Supprimer les fichiers temporaires sensibles (`graph.json`).
