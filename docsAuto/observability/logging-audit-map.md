# Logging & audit

## Principes
- Utiliser un logger structuré (JSON) incluant `timestamp`, `severity`, `service`.
- Propager un `correlation_id` (header `X-Correlation-Id`). ⚠️ TODO : middleware automatique.
- Masquer les PII (coords GPS, commentaires) dans les journaux.

## Cartographie

| Flux | Évènements à journaliser | Niveau | PII | Rétention | Notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/graph` | `correlation_id`, `site_id`, `source`, `duration_ms`, `normalize` | INFO | Faible | 30 j | Ajouter `data_source` |
| `POST /api/graph` | `correlation_id`, `site_id`, `branch_changes_count`, `nodes_count`, `edges_count`, `status` | INFO/WARN | Éviter graphe complet | 1 an | WARN si `branch_conflicts` |
| `POST /api/graph/branch-recalc` | `correlation_id`, `diagnostics_count`, `conflicts_count` | INFO | N/A | 6 mois | Suivi qualité données |
| `load_sheet/save_sheet` | `sheet_id`, `range`, `rows`, `duration_ms` | DEBUG/INFO | Non | 90 j | Pour debug quotas |
| `gcs_json` | `gcs_uri`, `action`, `size_bytes`, `duration_ms` | INFO | Non | 6 mois | Vérifier storage client |
| `bigquery` | `project`, `dataset`, `table`, `rows_fetched`, `duration_ms` | INFO | Non | 6 mois | WARN si volume élevé |
| Embed refusé | `referer`, `mode`, `reason` | WARN | Hachage clé | 1 an | Détection tentative intrusion |
| Sanitizer 422 | `edge_id`/`node_id`, `error`, `site_id` | WARN | Masquer PII | 1 an | Audit qualité données |

## Instrumentation recommandée
- Middleware FastAPI pour `correlation_id` (⚠️ TODO).
- `logging.config` JSON pour Cloud Logging.
- Vérifier `trace/span` Cloud Run.

## Masquage PII
- Arrondir/supprimer `gps_lat/gps_lon`.
- Éviter d’enregistrer `commentaire` en clair.

## Alerting
- Taux d’erreur 5xx > 1 % (5 min).
- Pic d’erreurs 422 (qualité données).
- Multiples `invalid referer`/`invalid key`.

⚠️ TODO : politique de rétention et procédure d’accès aux logs (audit interne).
