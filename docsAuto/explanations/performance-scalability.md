# Performance & Scalabilité

## Charge attendue
- Graphe de quelques centaines de nœuds/arêtes.
- Faible concurrence (1–10 exploitants).
- Objectif < 500 ms (Sheets) / < 2 s (BigQuery).

## Points sensibles
- Sanitisation (`app/shared/graph_transform.py`) : calculs Haversine.
- Google Sheets : quotas et latence réseau.
- BigQuery : requêtes `SELECT *` sans filtre (`site_id`).
- Frontend : rendu D3/Leaflet pour grands graphes.

## Pratiques actuelles
- Normalisation systématique avant écriture.
- Bundles minifiés (`npm run build`).
- CSP stricte avec whitelist réduite.

## Pistes d’amélioration
- Caching (en mémoire/Redis) pour `/api/graph?normalize=1`.
- Paramétrer les requêtes BigQuery (`LIMIT`, filtre `site_id`).
- Instrumenter le sanitizer (profiling).
- Rendu progressif côté frontend (>5 000 éléments). ⚠️ TODO.
- Compression GCS (GZIP) pour le JSON.

## Scalabilité horizontale
- Cloud Run auto-scale; surveiller quotas Sheets.
- Prévoir un circuit breaker / retry si source indisponible. ⚠️ TODO.

## Tests de performance
- Aucun test automatisé. Recommandation : script locust/k6 ciblant `/api/graph`. ⚠️ TODO.
