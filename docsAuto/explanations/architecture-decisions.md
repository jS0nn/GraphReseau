# Décisions d’architecture (condensées)

## FastAPI + Pydantic
- Remplacement d’Apps Script par un framework asynchrone typé.
- Alternatives rejetées : Flask (validation limitée), Django (trop lourd), Node (perte cohérence Python).
- Conséquence : validation stricte, OpenAPI automatique, uvicorn.

## Adaptateurs de données séparés
- Gérer Sheets, GCS, BigQuery via `app/datasources/`.
- Simplifie les tests (`tests/test_datasource_dispatch.py`).

## Sanitisation centralisée
- `app/shared/graph_transform.py` appliqué à toutes les écritures.
- Garantit diamètres, géométrie, branches cohérents.

## Frontend sans CDN
- Bundles esbuild, assets locaux (`app/static/vendor`).
- Compatible CSP stricte (Looker/Sites).

## Clé d’embed statique (V1)
- Contrôle minimal viable de l’accès `/embed/editor`.
- ⚠️ TODO : liens signés courte durée (roadmap V2 RBAC).

## ADC + impersonation
- Unifier l’identité local/Cloud Run via `gcloud auth application-default login --impersonate-service-account`.
- Évite la distribution de clés JSON P12.
