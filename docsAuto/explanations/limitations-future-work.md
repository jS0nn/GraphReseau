# Limites & travaux futurs

## Limites actuelles
- Écriture BigQuery non implémentée (`save_bigquery` → 501).
- Pas de RBAC : toute personne avec la clé peut écrire.
- Clé d’embed statique sans expiration.
- Pas d’événements/asynchronisme.
- Logs limités (pas de corrélation automatique, PII non masquées par défaut).
- Schéma Graph figé en 1.5.
- Absence de tests frontend automatisés.
- Processus incident non documenté.

## Travaux planifiés (V2)
- Liens signés courte durée + RBAC.
- Rotation automatisée des secrets (Secret Manager).
- Pipeline CI (tests backend/frontend + build).
- Export CSV/GeoJSON.
- Gestion multi-sites (filtre `site_id` obligatoire).

⚠️ TODO : prioriser ces sujets dans `TASKS.md` et assigner des responsables.
