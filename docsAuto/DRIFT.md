# Divergences & actions

| Observation | Impact | Action proposée |
| --- | --- | --- |
| Écriture BigQuery absente (`save_bigquery` renvoie 501) | Limite fonctionnelle | Décider si l’écriture BQ est prioritaire (V2) |
| Pas de middleware `correlation_id` | Difficulté de corrélation des logs | Implémenter un middleware FastAPI / header standard |
| Clé d’embed statique sans expiration | Risque si fuite | Introduire liens signés courte durée (HMAC + TTL) |
| Pas de tests frontend automatisés | Risque de régression UI | Ajouter une suite `npm test` couvrant `state`, `api` |
| Processus incident non documenté | Temps de résolution allongé | Compléter `overview/processes.md` avec un scénario incident |

Mettre à jour ce fichier après chaque correction ou nouvelle divergence identifiée.
