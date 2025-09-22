# Catalogue des objets échangés

Cette section recense les DTO traversant les frontières (frontend ↔ backend ↔ sources externes). Les schémas complets sont dans `../reference/schemas/`.

## 1. Graph (`GET/POST /api/graph`)
### Métadonnées
| Champ | Valeur |
| --- | --- |
| Contexte | Chargement/sauvegarde du réseau |
| Direction | GET : API → Frontend, POST : Frontend → API |
| Producteur | Backend (GET), Frontend (POST) |
| Consommateur | Frontend, Backend, Datasources |
| Schéma JSON | `../reference/schemas/graph.schema.json` |
| Typage backend | `app/models.Graph`, `Node`, `Edge` |
| Typage frontend | `web/src/types/graph.d.ts` |
| Validation | Pydantic + `sanitize_graph`, `sanitizeGraphPayload` côté front |

### Exemple
```json
{
  "version": "1.5",
  "site_id": "SITE-TEST",
  "generated_at": "2025-01-01T00:00:00Z",
  "style_meta": {"mode": "continuous"},
  "branches": [{"id": "GENERAL-A", "is_trunk": true}],
  "nodes": [
    {"id": "N1", "type": "OUVRAGE", "x": 10, "y": 20, "gps_lat": 48.0, "gps_lon": 2.0},
    {"id": "PM-1", "type": "POINT_MESURE", "branch_id": "GENERAL-A", "pm_offset_m": 12.5}
  ],
  "edges": [
    {
      "id": "E1",
      "from_id": "N1",
      "to_id": "PM-1",
      "branch_id": "GENERAL-A",
      "diameter_mm": 75,
      "length_m": 120.4,
      "geometry": [[2.0, 48.0], [2.0005, 48.0005]],
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### Sensibilité & stratégie
- `gps_lat`, `gps_lon` : PII → masquer/arrondir dans les logs.
- `commentaire` : peut contenir des informations sensibles.
- `branch_changes`, `branch_diagnostics` : diagnostics, pas de PII directe.

### Log keys recommandées
- `correlation_id` (⚠️ TODO : middleware dédié).
- `site_id`, `source`, `operation` (`GET`, `POST`, `BRANCH_RECALC`).
- `event_id` (ID nœud/arête) pour les erreurs.

### Contrôles d’entrée/sortie
- Frontend : `sanitizeGraphPayload`.
- Backend : `sanitize_graph`.
- Datasources : validations propres (Sheets/GCS/BQ).

## 2. BranchRecalcResponse (`POST /api/graph/branch-recalc`)
### Métadonnées
| Champ | Valeur |
| --- | --- |
| Contexte | Diagnostics après normalisation |
| Direction | API → Frontend |
| Producteur | Backend (`app/routers/branch.py`) |
| Consommateur | Frontend |
| Schéma JSON | `../reference/schemas/branch-recalc-response.schema.json` |
| Typage frontend | `state.branchDiagnostics`, `state.branchChanges` |

### Exemple
```json
{
  "nodes": [...],
  "edges": [...],
  "branch_changes": [{"edge_id": "E42", "previous": "BR-OLD", "new": "BR-NEW", "reason": "junction_rule"}],
  "branch_diagnostics": [{"node_id": "J-1", "incoming_branch": "BR-A", "main_edge": "E1", "rule": "splitter", "new_branches": ["BR-A1"]}],
  "branch_conflicts": ["Edge E7 length_m missing"]
}
```

### Sensibilité & logs
- Même PII que `Graph`.
- Logger `branch_conflicts` au niveau WARN.
- Clés : `correlation_id`, `site_id`, `branch_changes[].edge_id`.

### Validation
- Backend : `sanitize_graph(strict=False)`.
- Frontend : mise à jour de l’état (`web/src/state/index.js`).

## 3. EmbedEditorRequest (`GET /embed/editor`)
### Métadonnées
| Champ | Valeur |
| --- | --- |
| Contexte | Chargement iframe |
| Paramètres | `k`, `sheet_id`, `mode`, `source`, `gcs_uri`, `bq_*` |
| Producteur | Integrator (Looker Studio, Sites) |
| Consommateur | Backend (FastAPI) |
| Validation | `app/routers/embed.py`, `app/auth_embed.py` |

### Exigences
- `k` doit correspondre à `EMBED_STATIC_KEY`.
- `mode` ∈ `{ro, rw}`.
- Referer dans `ALLOWED_REFERER_HOSTS`.
- ⚠️ TODO : ajouter signature courte durée.

### Exemple
```
https://<host>/embed/editor?k=abcdef123456&sheet_id=1AbCdEf&mode=ro
```

### Logs
- Logger `referer`, `mode`, hash anonymisé de `k`.
- WARN en cas de refus (403).

---

⚠️ TODO : compléter avec de nouveaux DTO (export CSV/GeoJSON, webhooks) lorsqu’ils seront introduits.
