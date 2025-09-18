# Changelog — Migration V2 (pipes = edges)

## 2024-XX-XX

### Backend
- Déplacement de la sanitisation dans `app/shared/graph_transform.py` + alias `app/services/graph_sanitizer.py`.
- Ajout de tests de contrat FastAPI (`tests/test_api_contract.py`) pour valider GET/POST `/api/graph`.

### Frontend
- Mutualisation des helpers géométriques (`web/src/shared/geometry.js`) utilisés par toutes les interactions.
- Sanitation/normalisation front rassemblée dans `web/src/shared/graph-transform.js` et consommée par `api.js` / `state/normalize.js`.
- Types TypeScript générés automatiquement dans `web/src/types/graph.d.ts` (commande `npm run types:generate`).

### Documentation / Outillage
- README & AGENTS mis à jour (structure du dépôt, commande de génération de types, tests).
- Suppression du dossier legacy `frontend/`.

### Points de vigilance pour le déploiement
1. Regénérer les assets : `npm install && npm run build`.
2. Regénérer les types si le schéma a évolué : `npm run types:generate`.
3. Lancer la suite de tests : `python -m unittest discover -s tests -p "test_*.py"` (venv + dépendances installées).
4. Vérifier la QA visuelle (scénario complet de chargement/édition/sauvegarde) sur un jeu de données réel.

