# Guide pratique – Rotation des secrets

## 1. Inventorier les secrets
| Secret | Description | Emplacement |
| --- | --- | --- |
| `EMBED_STATIC_KEY` | Clé d’accès iframe `/embed/editor` | `.env`, Secret Manager |
| `MAP_TILES_API_KEY` | Accès aux tuiles cartographiques | `.env`, fournisseur de cartes |
| ADC / Token | `gcloud auth application-default login` | `$HOME/.config/gcloud` |
| Service Account | Adresse impersonée (`IMPERSONATE_SERVICE_ACCOUNT`) | IAM / Secret Manager |

## 2. Régénérer la clé d’embed
1. `openssl rand -hex 32`.
2. Mettre à jour `.env.dev`, Secret Manager (`gcloud secrets versions add`).
3. Mettre à jour les URL iframe (Looker Studio, Sites).
4. Redémarrer l’API.

## 3. Mettre à jour l’ADC / impersonation
- `gcloud auth application-default revoke`.
- `gcloud auth application-default login --impersonate-service-account=<SA_EMAIL>`.
- `gcloud auth application-default print-access-token` pour vérifier.

## 4. Map tiles
- Mettre à jour `MAP_TILES_URL`, `MAP_TILES_API_KEY`, `MAP_TILES_ATTRIBUTION`.
- Vérifier la CSP (`app/auth_embed.py:8-35`).
- Tester l’affichage Leaflet.

## 5. Secrets en production (Cloud Run)
```bash
gcloud run services update editeur-reseau-api \
  --set-secrets=EMBED_STATIC_KEY=projects/.../secrets/...:latest
```
- Vérifier les logs (`gcloud logs read`).

## 6. Audit & traçabilité
- Documenter la rotation (changelog, incident log).
- Mettre à jour `../TRACEABILITY.md` si doc modifiée.
- ⚠️ TODO : automatiser la rotation via Secret Manager + Cloud Scheduler.

> En cas de compromission : invalider immédiatement la clé, informer les parties prenantes.
