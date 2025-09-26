# taskDiagramme

## Progression compréhension
- [x] Cartographie des routes FastAPI (`/api/graph`, `/api/graph/branch-recalc`, `/embed/editor`)
- [x] Analyse des data sources (Sheets, GCS JSON, BigQuery lecture)
- [x] Lecture du pipeline frontend (`api.js` → `state` → `render`/`interactions`)
- [x] Revue des modules UI secondaires (logs, formulaires, carte, interactions principales)
- [ ] Validation des scénarios d'erreurs côté backend (tests unitaires/HTTP)

## Résumé des fonctionnalités clefs
- Backend FastAPI : exposition REST du graphe, recalcul branches, middleware CSP, contrôle d'embed, normalisation stricte (`sanitize_graph`).
- Data sources : lecture/écriture Google Sheets (synchronisation de positions UI), lecture/écriture JSON (GCS ou disque), lecture BigQuery (RO, WKT → GeoJSON).
- Frontend : éditeur D3/ELK sans CDN, gestion d'état centralisée, layout auto, sauvegarde JSON, recalcul branches via API, instrumentation logs.
- Sécurité embed : clé statique `k`, filtrage Referer, CSP strict, option orthophoto configurée via attributs de template.

## Flux détaillés supplémentaires
- **Logs UI** (`ui/logs.ts`): souscription globale aux événements `state` -> append DOM, export, toggle dev logs; utile pour tracer actions utilisateur.
- **Formulaire propriétés** (`ui/forms.ts`): lit la sélection `state.selection`, remplit panneaux nœud/arête, applique patches via `updateNode`/`updateEdge`, pilote flip arête, enregistrement des diamètres manuels.
- **Carte Leaflet** (`map.ts`): injectée si `data-tiles-url` défini; synchronise zoom/centre avec projection interne (`geo.ts`), recalcule padding en fonction du panneau propriétés / tiroir logs.
- **Interactions & layout**: `layout.ts` filtre arêtes invalides avant ELK, `state.normalizeGraph` enrichit les nœuds avec `site_effective`, `ui_diameter_mm`, etc. Ces propriétés ne sont pas persistées (retirées par `graph_to_persistable_payload`).
- **Branch recalculation**: `state.scheduleBranchRecalc` déclenche `POST /api/graph/branch-recalc`, réinjecte `branch_diagnostics`, `branch_changes`, `branch_conflicts` dans l'état pour affichage UI / logs.

## Objets de données suivis
- `Graph` (version 1.5, `site_id`, `generated_at`, `style_meta`, `crs`, `branches`, `nodes`, `edges`, diagnostics de branches).
- `Node` (identifiants, type, branche, coordonnées UI/GPS, informations PM/Vanne, `extras`, champs dérivés UI: `site_effective`, `site_effective_is_fallback`).
- `Edge` (id, extrémités, `branch_id`, diamètre, longueur, géométrie, matériau/SDR, `site_id`, `created_at`, champs UI: `ui_diameter_mm`, `site_effective`).
- `BranchInfo` (id, nom, parent, drapeau `is_trunk`).
- Diagnostics : `branch_changes`, `branch_diagnostics` (junction decisions), `branch_conflicts`.

## Pistes suivantes
- Approfondir la gestion d'erreurs: scénarios Sheets hors ligne, BigQuery non disponible, validation stricte (`strict=True`) pour détecter les champs transitoires.
- Documenter les conversions unités (mètres ↔ coordonnées) et la reprojection carte (`geo.ts`, `map.ts`).
- Ajouter un tableau de correspondance colonnes Sheets ↔ modèles pour audit futur.
