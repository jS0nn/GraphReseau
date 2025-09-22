# Modèle de sécurité

## Surfaces d’attaque
- Accès iframe `/embed/editor`.
- API publiques `/api/graph`, `/branch-recalc`.
- Accès aux APIs Google (Sheets, GCS, BQ).

## Authentification
- Clé statique `EMBED_STATIC_KEY` + Referer autorisés.
- Pas d’auth API dédiée en V1 (clé par obscurité).
- ADC/impersonation pour les services Google (`app/gcp_auth.py`).

## Autorisation
- Aucun RBAC en V1. ⚠️ TODO : introduire rôles (lecteur, éditeur, admin) côté API.

## Protection des données
- PII : coordonnées GPS, commentaires.
- HTTPS obligatoire (Cloud Run).
- Stockage sécurisé via GCP (Sheets/Drive, GCS, BigQuery).

## Secrets & rotation
- Gestion décrite dans `../how-to/rotate-secrets.md`.
- ⚠️ TODO : automatisation via Secret Manager + Cloud Scheduler.

## Logging & audit
- Recommandé : `correlation_id`, `site_id`, `source`.
- Masquer les PII (coords, commentaires) dans les logs.
- Voir `../observability/logging-audit-map.md`.

## Menaces & mitigations
| Risque | Mitigation |
| --- | --- |
| Fuite clé embed | Rotation régulière, liens signés (TODO) |
| Accès API non autorisé | Ajouter un proxy auth / token signé |
| Mauvaise config IAM | Vérifier `TokenCreator`, accès Sheets/Storage/BQ |
| Paramètres malveillants | FastAPI + Pydantic garantissent les types |

⚠️ TODO : politique de rétention des logs et procédure d’accès audit.
