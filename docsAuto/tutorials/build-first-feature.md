# Tutoriel – Construire une première fonctionnalité

Objectif : ajouter un nouvel attribut métier (`pressure_kpa`) sur les arêtes, côté backend et frontend, afin de visualiser la pression estimée dans l’éditeur.

> Note : ce tutoriel illustre la marche à suivre. Ajustez le nom/format de l’attribut à votre contexte métier.

## Étape 0 – Préparer l’environnement
- Avoir suivi `getting-started.md`.
- Disposer d’un graphe de test (JSON ou Sheet) et des tests unitaires en état de marche (`python -m unittest`).

## Étape 1 – Comprendre le modèle
- Backend : `app/models.Edge`, `app/shared/graph_transform.py`.
- Frontend : `web/src/shared/graph-transform.ts`, `web/src/state/index.js`, `web/src/ui/forms.ts`.
- Tests : `tests/test_graph_sanitizer.py`.

## Étape 2 – Étendre le modèle Pydantic
1. Ajouter `pressure_kpa: Optional[float] = None` dans `app/models.Edge`.
2. Adapter `app/services/graph_sanitizer.py` pour normaliser la valeur (≥ 0, arrondi à 2 décimales).
3. Mettre à jour `graph_to_persistable_payload` pour sérialiser `pressure_kpa` uniquement si renseignée.

## Étape 3 – Exporter le schéma JSON / Typescript
```bash
python scripts/export_schema.py --out docs/reference/schemas/graph.schema.json \
       --ts-out web/src/types/graph.d.ts
```

## Étape 4 – Adapter le frontend
1. Normalisation : `web/src/shared/graph-transform.ts` et `web/src/state/index.js`.
2. UI : ajouter le champ dans `web/src/ui/forms.ts` et l’affichage (ex: `render/render-edges.js`).
3. Valider la contrainte (valeur ≥ 0, nullable).

## Étape 5 – Exposer l’attribut via l’API
- Vérifier la sérialisation automatique (`Graph.model_dump`).
- Ajouter un test dédié dans `tests/test_api_contract.py`.

## Étape 6 – Tests & QA
- `python -m unittest tests/test_graph_sanitizer.py`.
- `npm run build:dev` et vérification manuelle via l’iframe.
- `curl http://127.0.0.1:8080/api/graph | jq '.edges[0].pressure_kpa'`.

## Étape 7 – Documentation
- Mettre à jour `../reference/schemas/graph.schema.json` (auto-généré) et `../data-contracts/data-catalog.md`.
- Ajouter la modification dans `../TRACEABILITY.md`.

## Étape 8 – Livraison
- Vérifier `npm run build` + `python -m unittest`.
- Préparer une PR documentant l’impact métier et les migrations (ex: colonne Sheets).
- ⚠️ TODO : script d’ajout de colonne Sheets si le champ devient obligatoire.

Félicitations, votre première fonctionnalité est en production ! Pensez à synchroniser avec les équipes métier pour la qualification.
