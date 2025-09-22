# Tutoriel – Prendre en main l’Éditeur Réseau

Objectif : passer d’un dépôt cloné à un éditeur fonctionnel en local, prêt à intégrer un Google Sheet. Ce tutoriel suppose que vous n’avez jamais lancé le projet.

## 1. Prérequis
- Python 3.11 ou 3.12 (`python --version`).
- Node.js ≥ 18 (recommandé : 20+) (`node -v`).
- Google Cloud SDK (`gcloud --version`) configuré sur le projet cible.
- Accès au Google Sheet du réseau (onglets `Nodes` et `Edges`).

> Attention : utilisez un environnement virtuel Python pour isoler les dépendances (`requirements.txt`).

## 2. Cloner le dépôt et créer l’environnement Python
```bash
git clone <URL_DU_DEPOT> GraphReseau
cd GraphReseau
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -U pip
pip install -r requirements.txt
```
Références : `requirements.txt`, `README.md`.

## 3. Installer les dépendances frontend et construire les bundles
```bash
npm install
npm run build       # build production (esbuild, `build.mjs:1-88`)
```
> Note : `npm run build:dev` ajoute des sourcemaps et active les logs dev (`BUILD_DEV=1`).

## 4. Configurer l’environnement
1. Dupliquer `.env.example` en `.env.dev`.
2. Renseigner :
   - `SHEET_ID_DEFAULT`
   - `EMBED_STATIC_KEY`
   - `ALLOWED_REFERER_HOSTS` (ex: `localhost 127.0.0.1`)
   - `ALLOWED_FRAME_ANCESTORS` (ex: `http://localhost:8000`)
3. Optionnel : `DATA_SOURCE`, `GCS_JSON_URI`, `BQ_*`.

> Attention : ne commitez jamais `.env.dev`. Ajoutez-le à `.gitignore` si nécessaire.

## 5. Authentification Google Cloud (ADC)
- Solution rapide : `gcloud auth application-default login`.
- Recommandé : impersonation d’un compte de service (`../how-to/rotate-secrets.md`, `app/gcp_auth.py:8-44`).
- Vérifiez avec `gcloud auth application-default print-access-token`.

## 6. Lancer l’API FastAPI
```bash
uvicorn app.main:app --reload --port 8080 --env-file .env.dev
```
- Vérifiez `http://127.0.0.1:8080/healthz` → `{"ok": true}`.
- En cas d’erreur, consultez `../how-to/diagnose-failures.md`.

## 7. Tester l’embed localement
1. Servir la page utilitaire : `python -m http.server 8000`.
2. Ouvrir `http://localhost:8000/dev-embed.html`.
3. Renseigner :
   - Base URL : `http://127.0.0.1:8080`
   - Clé `k` : valeur `EMBED_STATIC_KEY`
   - `sheet_id` : ID configuré.
4. Charger le graphe. Vérifiez la console navigateur pour les éventuels `fetch` en erreur.

## 8. (Option) Sauvegarder vers un JSON local
```bash
curl -X POST "http://127.0.0.1:8080/api/graph?source=gcs_json&gcs_uri=file:///ABS/PATH/graph.json" \
     -H "Content-Type: application/json" \
     --data-binary @graph.json
```

## 9. Nettoyage
- `deactivate` la venv si vous quittez le projet.
- Supprimer les branches de travail obsolètes.
- Documenter tout paramètre spécifique dans `../TRACEABILITY.md` si nécessaire.

🎉 Vous pouvez maintenant suivre `build-first-feature.md` pour réaliser une première évolution fonctionnelle.
