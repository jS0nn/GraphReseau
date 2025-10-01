# Matrice de traçabilité

| Artefact doc | Sources code (fichier:ligne) | Tests associés | Commentaires |
| --- | --- | --- | --- |
| README.md | app/main.py:13-39; app/routers/api.py:12-68; web/src/editor.boot.ts:1-200; app/auth_embed.py:8-49 | tests/test_api_contract.py:12-110 | Vue d’ensemble |
| overview/architecture.md | app/datasources/__init__.py:21-77; app/services/graph_sanitizer.py:12-165; build.mjs:1-88; package.json:1-24 | tests/test_datasource_dispatch.py:12-63 | Architecture |
| overview/processes.md | app/routers/api.py:12-68; app/routers/branch.py:11-22; web/src/api.js:1-86 | tests/test_graph_sanitizer.py:20-168 | Processus métier |
| tutorials/getting-started.md | README.md; requirements.txt; app/main.py:24-39; dev-embed.html | tests/test_api_contract.py:12-110 | Démarrage |
| tutorials/build-first-feature.md | app/models.py:58-149; app/services/graph_sanitizer.py; scripts/export_schema.py; web/src/shared/graph-transform.ts | tests/test_graph_sanitizer.py:20-168 | Extension champ |
| how-to/run-locally.md | README.md; app/main.py; web/src/api.js | tests/test_datasource_dispatch.py:12-63 | Exécution locale |
| how-to/diagnose-failures.md | app/auth_embed.py; app/datasources/gcs_json.py; app/shared/graph_transform.py | tests/test_api_contract.py; tests/test_graph_sanitizer.py | Dépannage |
| how-to/add-endpoint.md | app/routers/api.py; app/main.py; app/models.py | tests/test_api_contract.py | Ajout endpoint |
| how-to/add-ui-component.md | web/src/editor.boot.ts; web/src/state/index.js; web/src/render/render-nodes.js | ⚠️ TODO tests frontend | UI |
| how-to/rotate-secrets.md | app/auth_embed.py; app/config.py; app/gcp_auth.py | tests/test_datasource_dispatch.py | Secrets |
| how-to/upgrade-deps.md | requirements.txt; package.json; build.mjs | tests/test_api_contract.py | Dépendances |
| reference/api/openapi.yaml | app/routers/api.py; app/routers/branch.py; app/routers/embed.py | tests/test_api_contract.py | OpenAPI |
| reference/events/README.md | (absence d’événements) | — | TODO bus |
| reference/schemas/*.json | app/models.py; app/shared/graph_transform.py | tests/test_graph_sanitizer.py | Schémas |
| reference/db.md | app/datasources/sheets.py; app/datasources/bigquery.py; app/datasources/gcs_json.py | tests/test_datasource_dispatch.py | Données |
| reference/config.md | app/config.py | tests/test_datasource_dispatch.py | Variables |
| reference/cli.md | README.md; scripts/export_schema.py; package.json | tests/test_api_contract.py | CLI |
| reference/error-catalog.md | app/datasources/*; app/shared/graph_transform.py; app/auth_embed.py | tests/test_graph_sanitizer.py | Erreurs |
| explanations/architecture-decisions.md | app/main.py; app/datasources/__init__.py; app/shared/graph_transform.py; build.mjs | tests/test_api_contract.py | Décisions |
| explanations/security-model.md | app/auth_embed.py; app/gcp_auth.py; app/config.py | tests/test_datasource_dispatch.py | Sécurité |
| explanations/performance-scalability.md | app/shared/graph_transform.py; app/datasources/bigquery.py; build.mjs | tests/test_graph_sanitizer.py | Performance |
| explanations/limitations-future-work.md | app/datasources/bigquery.py; docs/handbook/agents.md; docs/roadmap/roadmap-v1.md | — | Roadmap |
| diagrams/* | app/main.py; app/routers/*; web/src state/render | tests/test_api_contract.py; tests/test_datasource_dispatch.py | Diagrammes |
| data-contracts/data-catalog.md | app/models.py; app/routers/api.py; app/routers/branch.py; web/src/shared/graph-transform.ts | tests/test_api_contract.py | DTO |
| observability/logging-audit-map.md | app/routers/api.py; app/datasources/__init__.py; app/auth_embed.py | ⚠️ TODO tests observabilité | Logging |
| TRACEABILITY.md | (auto) | — | Ce document |
| DRIFT.md | app/datasources/bigquery.py; how-to/rotate-secrets.md | — | Divergences |

⚠️ TODO : ajouter une suite de tests frontend pour couvrir les guides UI.
