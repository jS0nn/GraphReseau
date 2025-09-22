# Guide pratique – Diagnostiquer les pannes

## 1. Lire les codes HTTP
- **400** : paramètre manquant (ex: `sheet_id required`, `unknown data source`).
- **403** : clé d’embed ou Referer invalides (`app/auth_embed.py:39-49`).
- **422** : graphe invalide (`app/shared/graph_transform.py:1040-1299`).
- **501** : fonctionnalité non implémentée (BigQuery write, GCS hors-ligne).
- **500** : erreurs I/O locales (`read_local_json_failed`, `write_local_json_failed`).

## 2. Vérifier la source de données
- **Sheets** : `curl "/api/graph?source=sheet&sheet_id=..."`, vérifier le partage du Sheet.
- **GCS JSON** : `gsutil cat gs://bucket/path/graph.json`, confirmer les rôles Storage.
- **BigQuery** : `bq query --use_legacy_sql=false 'SELECT COUNT(*) FROM dataset.edges'`, comparer les colonnes.

## 3. Contrôler les validations backend
- `python -m unittest tests/test_graph_sanitizer.py`.
- Inspecter `HTTPException.detail` pour identifier le champ fautif.

## 4. Frontend
- `npm run build:dev`, recharger l’iframe et surveiller la console.
- `sanitizeGraphPayload` peut rejeter des champs non pris en charge.
- Utiliser le HUD (`web/src/ui/logs.js`).

## 5. Logs & observabilité
- Logger `correlation_id`, `site_id`, `source` (`../observability/logging-audit-map.md`).
- Sur Cloud Run : `gcloud logs read --limit 100 --service=<service>`.

## 6. Cas fréquents
| Symptôme | Diagnostic | Solution |
| --- | --- | --- |
| `sheet_id required` | `SHEET_ID_DEFAULT` absent | Renseigner `.env` ou query param |
| `edge geometry invalid` | Géométrie vide ou incorrecte | Vérifier `geometry_wkt` / JSON |
| `invalid referer` | Hôte non listé | Ajouter à `ALLOWED_REFERER_HOSTS` |
| `invalid key` | Clé `k` incorrecte | Régénérer `EMBED_STATIC_KEY` |

## 7. Escalade
- Collecter `correlation_id`, `site_id`, `source`.
- Vérifier la dernière sauvegarde JSON (`gcs_uri`).
- ⚠️ TODO : documenter la procédure d’astreinte.
