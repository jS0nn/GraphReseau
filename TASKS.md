# Feuille de route V1 — Éditeur Réseau

Statut: à cocher au fur et à mesure. Cible: V1 fonctionnelle (embed RO), sources interchangeables (Sheets/GCS JSON/BQ), build sans CDN.

## TODO récents (demandes utilisateur)
- [x] Raccourci clavier: la touche Échap quitte le mode courant et repasse en mode « sélection ».
- [x] UI « élément général »: permettre l’ajout de CANALISATIONS (uniquement; pas de POINTS_DE_MESURE ni de VANNES), en réutilisant le même modèle/flux que l’ajout depuis les propriétés de canalisation.
- [x] Persistance des notes: les notes saisies dans l’UI doivent être lues/écrites dans Google Sheets (mapping colonnes + POST Sheets).

## Frontend (UI/UX)
- [x] Rendu SVG D3: nœuds/arêtes, couleurs par branche, markers
- [x] Modes: sélection / connecter / supprimer (nœud)
- [x] Drag + snap grille, multi‑sélection (marquee)
- [x] Panneau propriétés (PUITS / CANALISATION / PM / VANNE)
- [x] Séquence canalisation (chips) + ordre enfants
- [x] Aide (dialog) + Journal (drawer) + Export (JSON)
- [x] Auto‑layout: ELK + fallback avec logs
- [x] Suppression d’arête (bouton “Supprimer” edge) et raccourci (partiel – bouton)
- [x] Indicateur “N nœuds / M arêtes” (overlay)

## Backend (API/Données)
- [x] GET /api/graph — Sheets (ADC/impersonation), mapping FR/EN (V1→V5)
- [x] POST /api/graph — Sheets (écrit FR V5 / FR V2)
- [x] GET/POST — GCS JSON (gs:// ou file:/// en dev)
- [x] GET — BigQuery (tables compatibles FR/EN)
- [x] Correction filtre arêtes BigQuery (from_id/to_id)
- [ ] POST — BigQuery (délibérément hors périmètre V1)

## Sécurité / Embed
- [x] CSP stricte + frame‑ancestors (Looker/Sites)
- [x] Enlever X‑Frame‑Options
- [x] Clé statique k (V1)
- [x] Dev toggles: DISABLE_EMBED_REFERER_CHECK / DISABLE_EMBED_KEY_CHECK
- [ ] V3: liens d’embed signés (JWT court‑terme) + RBAC côté API

## Sources & Bridge
- [x] Bridge “google.script.run” (transitoire) → API FastAPI
- [x] Client API natif (web/src/api.js), supprimer bridge‑gas
 - [x] Retirer backend legacy initial (`backend/`)

## Refactor legacy → modules (frontend)
- [x] Extraire helpers génériques (utils): `$$`, `vn`, `snap`, `genId`, `incrementName`, `isCanal`
- [x] État + historique: `state` (sélection, clipboard), `history` (snapshot/undo/redo)
- [x] Rendu SVG: `render/canvas`, `render/edges`, `render/inline`, `render/colors`
- [x] Interactions: drag, multi‑sélection, raccourcis, modes (`modes`, `interactions/*`)
- [x] Propriétés: formulaires nœud/arête/canal (`ui/forms/*`) + callbacks → state+render
- [x] Exports: JSON (`exports.ts`)
- [x] Layout: consolider `layout.ts` (ELK + fallback) + journaux (`ui/logs`)
- [x] Entrée unique propre: `editor.ts` assemble les modules; déprécier puis supprimer `legacy-editor.js`
- [x] CSS: renommer `web/styles/legacy.css` → `editor.css` (maj `build.mjs` + `app/templates/index.html`)

## Docs & DX
- [x] Ajouter `.env.example` minimal (copiable en `.env.dev`)
- [x] README: “Quickstart” clonage + étapes (ok)
- [x] NOTICE: sorties build corrigées (ok)
- [x] Plan de tests manuels (lecture/écriture, layout, embed RO/RW)

## Build / Infra
- [x] Build esbuild (bundle + vendor local)
- [x] Dockerfile multi‑stage (Node build → Python runtime)
- [x] .gitignore (secrets, artefacts)
- [x] .env.example (variables clés doc)

## Documentation / Validation
- [x] README (diff API/front, embed, env, impersonation)
- [x] NOTICE_IMPLEMENTATION (pas‑à‑pas local/Docker/Cloud Run)
- [x] Plan de tests manuels (lecture/écriture, layout, embed RO/RW)

## V2 — Canalisations en arêtes (polylignes) + orthophoto (IGN WMTS)

Contexte et objectifs
- Passer les canalisations en arêtes géométriques (LineString) avec `pipe_group_id` conservé aux splits.
- Afficher un fond orthophoto IGN (WMTS) synchronisé avec le viewport (Leaflet en bundle local, pas de CDN).
- Dessiner une flèche au milieu de chaque arête orientée source→target (sens d’écoulement).
- Rester compatible V1 (données sans `geometry`).

Référence détaillée
- Voir `docs/migration-v2-pipes-as-edges.md` (chapitres Portée, Modèle, Backend/Frontend, Plan de livraison, Annexes IGN/Flèches).

Tâches (par étapes de livraison)
- [x] Étape 1 — Backend (lecture + formats)
  - [x] `app/models.py`: `Node.lat/lon` (alias) + `Edge.geometry`, `Edge.pipe_group_id` (optionnels).
  - [x] `app/datasources.py`: GET sérialise `geometry`; conversion BQ `geometry_wkt` → coords.
  - [x] `app/sheets.py`: parse `Geometry` ("lon lat; …" > GeoJSON > WKT) et `PipeGroupId` (lecture).
  - [x] Tests manuels lecture V1/V2 (GCS JSON, Sheets, BQ).
- [x] Étape 2 — Fond de plan + rendu polylignes
  - [x] `web/src/vendor.ts`: Leaflet (bundle local).
  - [x] `web/src/geo.ts`: project/unproject exact via Leaflet (containerPoint), zéro drift.
  - [x] `web/src/render/render-edges.js`: polylignes SVG; flèche directionnelle au milieu.
  - [x] `app/config.py`: env `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY`.
  - [x] `app/auth_embed.py`: CSP dynamique pour l’origine des tuiles (img-src/connect-src).
  - [x] UX zoom/pan: molette `setZoomAround`, boutons ± (±1 niveau), overlay stabilisé (SVG plein écran, coords Leaflet).
- [x] Étape 3 — Mode D (dessin) + snapping + Undo
  - [x] `web/src/state.js`, `web/src/modes.ts` (V/D/E/J; Échap/Entrée/Shift).
  - [x] `web/src/interactions/draw.js`: clics, prévisualisation, terminer; snapping sur nœuds.
  - [x] Undo/Redo via `history.js`.
- [x] Étape 4 — Mode E (édition)
  - [x] `web/src/interactions/edit-geometry.ts`: handles, drag vertex; Alt+clic insert; Delete retire sommet.
- [x] Étape 5 — Mode J (jonction/split)
  - [x] `web/src/interactions/junction.js`: pick segment, split; nouveau nœud ancré GPS; héritage `pipe_group_id`.
  - [x] Option « démarrer une antenne » et choix du type inséré (jonction/ouvrage/PM/vanne).
- [x] Étape 6 — Exports + QA
  - [x] Sauvegarde Sheets: `Geometry` ("lon lat; …") + `PipeGroupId` (écriture).
  - [x] Docs `README.md`, `TEST_PLAN.md` mis à jour (fond, V2 tests, GPS lock).

Critères d’acceptation
- [x] Données V1 sans `geometry` → courbe simple; V2 avec `geometry` → polylignes correctes.
- [x] Fond IGN visible/synchronisé; CSP conforme; zéro CDN; zoom molette/boutons OK; pas de drift.
- [x] Flèche directionnelle bien orientée; masquée si arête très courte.
- [x] Split conserve `pipe_group_id`; PM/vanne/puits ancrables au GPS.

## V3 — Affichage progressif des nœuds (dépliage par canalisation)

Contexte et objectifs
- Afficher par défaut uniquement les canalisations et les éléments non raccordés; permettre un dépliage ciblé par canalisation.
- Disposer d’un layout lisible de gauche à droite (parents → enfants → petits‑enfants), tri vertical par ordre défini, sans chevauchements.

Définitions (confirmées)
- Éléments non raccordés: nœuds avec degré 0 (aucune arête entrante ni sortante). Inclus: tous types (PUITS, CANALISATION, POINT_MESURE, VANNE, PLATEFORME).
- Enfants directs d’une canalisation: (1) canalisations filles (arêtes sortantes vers des canalisations), (2) puits raccordés (arêtes sortantes vers PUITS), (3) éléments inline (POINT_MESURE / VANNE) dont `pm_collector_id` = id de la canalisation.
- Descendants (tous niveaux): fermeture transitive des enfants directs (incluant inline, puits, canalisations filles et leurs propres enfants, etc.).
- Ordre vertical: 
  - Puits: `collector_well_ids`/`well_pos_index` sur la canalisation parente.
  - Inline (PM/Vanne): `pm_pos_index` relatif aux puits (avant #1, entre #k–#k+1, après #N).
  - Canalisations filles: ordre explicite via `child_canal_ids` (fallback sur Y si manquant).

Tâches
- [ ] État d’affichage: `visibleNodeIds:Set`, `visibleEdgeIds:Set`, `expandedByCanal:Map<id,'direct'|'deep'>` + helpers (BFS/DFS descendants).
- [ ] Filtre par défaut: `visibleNodeIds := canalisations ∪ non‑raccordés`; `visibleEdgeIds := arêtes dont les deux extrémités sont visibles`.
- [ ] Menu contextuel (clic droit) sur une canalisation:
  - [ ] « Afficher enfants directs » → `expandedByCanal.set(id,'direct')`
  - [ ] « Afficher descendants (tous niveaux) » → `expandedByCanal.set(id,'deep')`
  - [ ] (Optionnel) « Masquer descendants » → retrait de l’entrée dans `expandedByCanal`.
- [ ] Rendu filtré: lier `visibleNodes/visibleEdges` (pas l’ensemble complet) dans `render()`; conserver `nodes/edges` pour l’édition.
- [ ] Layout L→R du sous‑graphe visible:
  - [ ] Niveaux par distance topologique (parents → enfants) avec `elk.direction='RIGHT'` si ELK; sinon fallback.
  - [ ] Tri vertical intra‑niveau par ordre défini (puits, inline, canalisations filles) avec espacement constant.
  - [ ] Mise à jour visuelle immédiate quand l’ordre change (ex. réordonnancement des puits).
- [ ] Anti‑chevauchement:
  - [ ] Espacement vertical ≥ hauteur nœud + marge; horizon X fixe par niveau.
  - [ ] Décalage des blocs d’enfants à l’expansion; détection d’overlaps + ajustements.
- [ ] Logs/observabilité: traces des expansions, du layout (ELK/fallback), et des résolutions d’overlaps.
- [ ] DX: flags dev (reset/clear expansions), HUD: n visibles / m arêtes visibles.

Critères d’acceptation
- Par défaut: seules les canalisations et les nœuds isolés sont visibles; aucun chevauchement.
- Clic droit canalisation: « enfants » affiche uniquement le niveau direct; « descendants » affiche toute la branche.
- Ordre vertical conforme aux indices définis (puits/inline/child canals); changer l’ordre met à jour le rendu.
- Aucun chevauchement après expansions successives; zoom/drag/sélection restent fonctionnels.

Tests (à ajouter dans TEST_PLAN)
- Scénarios d’expansion (enfants/descendants), réordonnancements, anti‑chevauchement, zoomFit après expansion, bascule thème.

Notes
- Les éléments “hors périmètre V1” restent listés ici pour suivi (V2/V3).
- Cette liste sera tenue à jour à mesure des validations et correctifs.
- V3 (métier): affichage des valeurs de qualité de gaz sur les nœuds (sourcing, mise à jour visuelle, légende/échelle).
  
Remplacé: la note libre sur l’affichage par défaut / clic droit canalisation est désormais formalisée ci‑dessus (section V3).
