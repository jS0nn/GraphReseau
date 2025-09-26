# V2 — Canalisations en arêtes (polylignes) et fond orthophoto

Ce document décrit la migration V2: passage des canalisations en arêtes géométriques (LineString) avec fond photo aérienne, tout en conservant une saisie fluide, une compatibilité V1 et un bundle 100% local (sans CDN). Il complète la feuille de route et sert de référence d’implémentation.

> **Note** : depuis la version 1.5 du modèle, l'identifiant fonctionnel des segments est `branch_id` (anciennement `pipe_group_id`). Les occurrences historiques de `pipe_group_id` dans ce document sont conservées uniquement pour le contexte de migration.

## 0) Contexte & objectifs
- Objectif: afficher un fond IGN (orthophoto), synchronisé avec le viewport et les positions GPS (WGS84) des entités; rendre les canalisations comme polylignes; dessiner des flèches au milieu des arêtes pour matérialiser le sens (source → target, contextuellement « puits → GENERAL »).
- Invariants V2: PM ancré à `(edge_id, edge_pos_m[, edge_pos_t])`; `pipe_group_id` conservé aux splits.
- Aucune dépendance CDN; CSP adaptée pour le domaine des tuiles.

## 1) Portée et non‑portée
Portée
- Frontend: modes Dessiner/Éditer/Jonction (inline PM), snapping, projection sur segments, split d’arêtes, fond orthophoto.
- Backend: schéma étendu (Node lon/lat, Edge geometry, pipe_group_id), I/O Sheets/GCS JSON/BQ compatibles V1.
- Migration douce: lecture/écriture tolérante (geometry optionnelle), conversions simples.

Hors portée immédiate
- RBAC/ACL et liens signés (repoussés V3).
- Écriture BigQuery (toujours 501 en V1/V2).
- Calculs hydro avancés.

## 2) Modèle de données
Node (ajouts)
- id: string (existant)
- kind: string (ouvrage | mesure | jonction | autre)
- lon: float | null (WGS84)
- lat: float | null (WGS84)
- props: dict (existant)

Edge (ajouts)
- id: string (existant)
- source: NodeID
- target: NodeID
- kind: string (canalisation | liaison | autre)
- geometry: LineString = liste de `[ [lon, lat], ... ]` (optionnelle; si absente: `[source, target]`)
- pipe_group_id: string | null (identité fonctionnelle partagée entre segments issus d’un split)
- props: dict (diamètre, matériau, date pose, sens, etc.)

Exemple JSON (GCS JSON / API)
{
  "nodes": [
    {"id":"N1","kind":"ouvrage","lon":2.35,"lat":48.86},
    {"id":"N2","kind":"jonction","lon":2.36,"lat":48.861}
  ],
  "edges": [
    {
      "id":"E1","kind":"canalisation","source":"N1","target":"N2",
      "geometry":[[2.35,48.86],[2.351,48.8605],[2.36,48.861]],
      "pipe_group_id":"P-001","props":{"diameter_mm":160,"material":"PVC"}
    }
  ]
}

Compatibilité V1
- Si `geometry` absente: polyligne minimale entre `source` et `target`.
- L’API accepte/retourne `geometry` quand présent; sinon comportement V1 inchangé.

## 3) Mapping stockage
Sheets
- Nodes: `Id`, `Kind`, `Lon`, `Lat`, `...props`
- Edges: `Id`, `Kind`, `Source`, `Target`, `Geometry`, `PipeGroupId`, `...props`
- `Geometry` (formats tolérés, ordre de priorité):
  1) `lon lat; lon lat; ...` (simple, recommandé)
  2) GeoJSON stringifié `{ "type":"LineString", "coordinates":[... ] }`
  3) WKT `LINESTRING(lon lat, lon lat, ...)`

GCS JSON
- Même schéma que l’API (pas de transformation).

BigQuery (lecture seule)
- `Edges`: `geometry_wkt` (STRING, LINESTRING) ou `geometry` (GEOGRAPHY). Conversion → `geometry` JSON.
- `Nodes`: `lon` FLOAT64, `lat` FLOAT64, `kind`, `props` (JSON).

## 4) UX et interactions
Principes
- Modes explicites, persistants jusqu’à changement de mode ou Échap.
- Snapping sur nœuds/segments, tolérance réglable.
- Raccourcis cohérents multi‑OS (éviter Ctrl+clic primaire macOS).

Modes et raccourcis
- Sélection (V): sélectionner/déplacer nœuds, sélectionner arêtes, panneaux d’attributs.
- Dessiner (D): clic = sommet; double‑clic/Entrée = terminer; Échap = annuler; Shift = snapping forcé.
- Éditer géométrie (E): Alt+Drag sommet; Alt+Clic sur segment = insérer; Suppr = supprimer sommet.
- Jonction/Inline (J): clic sur segment = insérer nœud + split; menu rapide (`jonction` par défaut | `ouvrage` | `mesure`); option « démarrer une antenne ».

Cas d’usage
- Insertion ouvrage/PM inline avec split; héritage `pipe_group_id`.
- Rester en mode D jusqu’à Échap/changement manuel.

Compléments
- Mesure dynamique; simplification Douglas‑Peucker (tolérance configurable) avant sauvegarde; validation réseau; styles par attribut.
- Export/Import GeoJSON; import CSV points GPS; Undo/Redo complet.

Fond de plan (orthophoto)
- Leaflet (bundle local), tuiles raster IGN/MapTiler via env vars `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY` (facultatif).
- Fallback fond neutre si pas de clé réseau.

## 5) Algorithmes clés (frontend)
- Snapping via index spatial `rbush` sur nœuds et segments.
- Projection point → segment: t=(AP·AB)/|AB|² borné [0,1].
- Split d’arête: découpe `geometry` en E1/E2, héritage `pipe_group_id`, MAJ `source/target` si extrémité.
- Calculs géo: project/unproject Leaflet (WebMercator), longueurs via haversine.

## 6) Backend — impacts et tâches
- `app/models.py`: `Node.lon/lat`, `Edge.geometry`, `Edge.pipe_group_id`; validation fallback.
- `app/datasources.py`: GET: sérialiser `geometry`; conversion WKT/GEOGRAPHY → coords. POST: accepter `geometry` et encoder pour Sheets.
- `app/sheets.py`: mapping colonnes + parse/format `Geometry` (« lon lat; … » > GeoJSON > WKT).
- `app/config.py`: env `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY`.
- `app/auth_embed.py`: CSP mise à jour pour domaine des tuiles (img-src, et connect-src/style-src si requis).

## 7) Frontend — impacts et tâches
- `web/src/vendor.ts`: ajouter Leaflet (ou MapLibre) et `rbush` si utilisé.
- `web/src/geo.ts`: haversine, encode/decode geometry, helpers project/unproject.
- `web/src/state.js`: `mode`, `snapTolerancePx`, `drawInProgress`, `currentPolyline`, `selectedEdgeId`, `selectedNodeId`.
- `web/src/modes.ts`: SELECT, DRAW, EDIT, JUNCTION; raccourcis V/D/E/J, Échap, Entrée, Shift.
- `web/src/interactions/*`: `draw.js`, `edit-geometry.ts`, `junction.js` (nouveaux) + Undo/Redo via `history.js`.
- `web/src/render/*`: polylignes SVG (paths), styles hover/sélection; longueur dynamique pendant le dessin.
- `web/src/ui/toolbar.js`: boutons modes + réglages snapping + bascule fond.
- `web/styles/editor.css`: curseurs par mode; handles sommets.
- `build.mjs`: inclure CSS Leaflet; copier assets; pas de CDN.
- `app/templates/index.html`: conteneur carte + calques; charger bundles.

## 8) Migration et compatibilité
- Lecture: données V1 sans `geometry` restent valides (segment simple entre nœuds).
- Écriture: toujours écrire `geometry` si polyligne saisie/éditée; option de simplification.
- Conversion: script optionnel pour compléter les arêtes sans `geometry` (2 points) afin d’homogénéiser les exports.

## 9) Tests et validation (micro‑lots)
- Dessin simple (2–3 sommets), Échap/Entrée/double‑clic.
- Split arête (milieu et extrémités t≈0/1); insertion ouvrage/PM inline; création antenne.
- Undo/Redo split puis déplacement de sommet.
- Sauvegarde/chargement Sheets (3 formats `Geometry`) et GCS JSON.
- CSP: embed OK avec tuiles et fond neutre sans réseau.

## 10) Sécurité et performance
- CSP minimale pour domaine tuiles (img-src; connect-src si MapLibre).
- Index spatial `rbush` pour garder l’UI fluide (>5k sommets).
- Debounce des recalculs hover/longueur.

## 11) Variables d’environnement (nouvelles)
- `MAP_TILES_URL`: modèle tuiles (IGN WMTS GetTile ou raster XYZ/WMTS proxy).
- `MAP_TILES_ATTRIBUTION`: texte d’attribution légal.
- `MAP_TILES_API_KEY`: optionnelle (si non incluse dans l’URL).

## 12) Plan de livraison (itératif)
- Étape 1: Backend (modèle + parsing geometry) — lecture seule testée.
- Étape 2: Fond de plan en lecture seule + rendu polylignes.
- Étape 3: Mode D (dessin) + snapping + Undo.
- Étape 4: Mode E (édition) + handles + suppression sommets.
- Étape 5: Mode J (jonction/inline + split) + antenne.
- Étape 6: Exports Sheets/BQ complets + QA.

## 13) Branching et conventions
- Branche: `feature/pipes-as-edges-geometry`
- Conventional Commits: ex. `feat(editor): add polyline drawing with snapping`
- PR: checklist tests manuels, MAJ CSP, validation sur données réelles.

## 14) Checklist fichiers à modifier
Backend
- `app/models.py`, `app/datasources.py`, `app/sheets.py`, `app/config.py`, `app/auth_embed.py`

Frontend
- `web/src/vendor.ts`, `web/src/geo.ts`, `web/src/state.js`, `web/src/modes.ts`
- `web/src/interactions/draw.js`, `web/src/interactions/edit-geometry.ts`, `web/src/interactions/junction.js`
- `web/src/render/render-edges.js`, `web/src/ui/toolbar.js`, `web/styles/editor.css`
- `build.mjs`, `app/templates/index.html`

Docs
- `TEST_PLAN.md` (ajouts), `README.md` (variables carte)

---

### Annexe A — Orthophoto IGN (WMTS) et intégration Leaflet
- Fournisseur: IGN Géoplateforme, WMTS public « Essentiels » — couche `ORTHOIMAGERY.ORTHOPHOTOS`, TMS `PM` (Web Mercator), niveaux ~0..18.
- Capabilities: https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities
- Intégration Leaflet via modèle URL GetTile (WMTS ou proxy XYZ). Les variables d’env `MAP_TILES_URL` et `MAP_TILES_ATTRIBUTION` définissent la source. Si clé requise, `MAP_TILES_API_KEY` peut être concaténée.
- Synchronisation: fitBounds au chargement; pan/zoom bidirectionnels carte ↔ rendu SVG.
- CSP: autoriser le domaine des tuiles en `img-src` (et `connect-src` si nécessaire).

### Annexe B — Flèches directionnelles (sens d’écoulement)
- Rendu: une flèche au milieu de chaque arête, orientée selon la tangente locale de la polyligne (source → target).
- Calcul: trouver le point médian par longueur cumulée; orienter un marker SVG le long du segment local; style conforme au thème.
- Cas particuliers: arêtes très courtes → masquer le marker; arêtes multi‑segments → choisir le segment contenant le milieu.
