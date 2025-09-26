# Éditeur Réseau – Portail de documentation

Bienvenue dans la base de connaissances de l’Éditeur Réseau. Ce projet remplace le backend Apps Script historique par une API FastAPI et un frontend D3/Leaflet empaqueté localement, embarquable dans Looker Studio ou Google Sites.

## Résumé produit
- **[Backend Python]** expose l’API `/api/graph` (lecture/écriture), le recalcul de branches et la page `/embed/editor`, avec CSP stricte et middleware dédié (`app/main.py:13-39`, `app/routers/api.py:12-68`, `app/routers/branch.py:11-22`, `app/routers/embed.py:14-46`).
- **[Frontend JS/TS]** fournit un éditeur autonome (bundles `app/static/bundle/*`) orchestré par `web/src/editor.boot.ts` et son magasin d’état (`web/src/state/index.js`).
- **Sources de données** interchangeables via `app/datasources/` : Google Sheets (par défaut), fichier JSON local/GCS, BigQuery (lecture seule).
- **Sécurité** : clé d’embed statique, contrôle du Referer (`app/auth_embed.py:8-49`), ADC/impersonation Google (`app/gcp_auth.py:8-44`), CSP calculée dynamiquement.

## Publics cibles
- **Exploitants métier** : manipulent le graphe via l’iframe, peuvent exporter/importe JSON.
- **Développeurs & DevOps** : maintiennent l’API, le build frontend et l’intégration Google Cloud/CI.

## Architecture en un coup d’œil
> Note : les diagrammes complets (C4 niveaux 1-3 et séquences clés) sont détaillés dans `docsAuto/overview/architecture.md` et `docsAuto/diagrams/`.

- Flux principal : navigateur → `/embed/editor` → bundles statiques → `/api/graph`.
- Les écritures se propagent vers Google Sheets ou GCS via `app/datasources/__init__.py:21-77`.
- Les identités machine proviennent d’ADC (`gcloud auth application-default login`) ou d’une impersonation de service account (`app/config.py:38-75`, `app/gcp_auth.py:8-44`).

## Parcours de lecture recommandé
1. **Vue d’ensemble** : `overview/architecture.md` pour comprendre les couches et dépendances.
2. **Tutoriels** : commencer par `tutorials/getting-started.md`, puis `tutorials/build-first-feature.md`.
3. **Guides opérationnels** : dossier `how-to/` (exécution locale, rotation de secrets, ajout d’endpoints).
4. **Références** : OpenAPI, schémas JSON, base de données et catalogue d’erreurs dans `reference/`.
5. **Explications** : décisions structurantes, modèle de sécurité, performance et limites dans `explanations/`.

## Liens rapides
- Vue architecture : [overview/architecture.md](overview/architecture.md)
- Démarrage rapide : [tutorials/getting-started.md](tutorials/getting-started.md)
- Spécification API : [reference/api/openapi.yaml](reference/api/openapi.yaml)
- Schémas JSON : [reference/schemas/](reference/schemas/)
- Catalogue des flux : [data-contracts/data-catalog.md](data-contracts/data-catalog.md)
- Observabilité & audit : [observability/logging-audit-map.md](observability/logging-audit-map.md)
- Traçabilité doc/code/tests : [TRACEABILITY.md](TRACEABILITY.md)

> Attention : ne jamais commiter de secrets (`.env`, clés d’embed, tokens ADC). Utiliser Google Secret Manager sur Cloud Run et vérifier les rôles IAM (`README.md`, `NOTICE_IMPLEMENTATION.md`).

## Support & suivi
- Feuille de route : `TASKS.md`.
- Plan de tests manuel : `TEST_PLAN.md`.
- ⚠️ TODO: Documenter le canal de support (Slack/Email) et le responsable produit pour la phase V2.
