# Migration saisie — Canalisations en arêtes (polyline)

Ce document sert de cahier des charges exhaustif pour faire évoluer le modèle et l’éditeur afin que les canalisations soient des arêtes géométriques (polylignes) dessinées sur fond photo aérienne, tout en gardant une création fluide et rapide.

Objectifs clés
- Canalisations = arêtes avec `geometry` (LineString) et jonctions explicites.
- Saisie rapide par modes et raccourcis simples, persistants jusqu’à Échap.
- Ajout d’ouvrages/points de mesure (PM) sur une canalisation (inline) ou en antenne.
- Compatibilité ascendante avec les données V1 (sans `geometry`).
- Aucune dépendance CDN (bundle local) et CSP ajustée.


## 1) Portée et non‑portée
Portée
- Frontend: nouveaux modes de saisie (Dessiner/Éditer/Jonction/Inline PM), snapping, projection sur segments, split d’arêtes, fond orthophoto.
- Backend: extension du schéma (Node lon/lat, Edge geometry, pipe_group_id), I/O Sheets/GCS JSON/BQ compatibles V1.
- Migration douce: lecture/écriture tolérante (geometry optionnelle), conversions simples.

Hors portée immédiate
- RBAC/ACL et liens signés (V2).
- Écriture BigQuery (toujours 501 en V1).
- Routage hydraulique avancé et calculs métiers (ultérieur).


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
- geometry: LineString = liste de coordonnées `[ [lon, lat], ... ]` (optionnelle; si absente: `[source, target]`)
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
- Si `geometry` est absente: on suppose une polyligne minimale entre `source` et `target`.
- Backend accepte/retourne `geometry` quand présent; sinon comportement V1 inchangé.


## 3) Mapping stockage
Sheets
- Nodes: Colonnes `Id`, `Kind`, `Lon`, `Lat`, `...props`
- Edges: Colonnes `Id`, `Kind`, `Source`, `Target`, `Geometry`, `PipeGroupId`, `...props`
- `Geometry` (format toléré, premier reconnu):
  1) `lon lat; lon lat; ...` (simple, recommandé)
  2) GeoJSON (stringifiée) `{"type":"LineString","coordinates":[... ]}`
  3) WKT `LINESTRING(lon lat, lon lat, ...)`

GCS JSON
- Même schéma que l’API (voir exemple). Pas de transformation.

BigQuery (lecture seule)
- Table `Edges` : colonne `geometry_wkt` (STRING, LINESTRING WKT) OU `geometry` (GEOGRAPHY). L’API convertit en `geometry` JSON.
- Table `Nodes` : `lon` FLOAT64, `lat` FLOAT64, `kind`, `props` (JSON).


## 4) UX et interactions
Principes
- Modes explicites, persistants jusqu’à changement de mode ou Échap.
- Snapping sur nœuds et segments, tolérance réglable (px ou m).
- Raccourcis cohérents multi‑OS (éviter Ctrl+clic primaire sur macOS).

Modes et raccourcis
- Sélection (V) : sélectionner/déplacer nœuds, sélectionner arêtes, panneaux d’attributs.
- Dessiner canalisation (D) :
  - Clic gauche: ajoute un sommet; double‑clic ou Entrée: termine; Échap: annule.
  - Shift: snapping forcé sur nœud/segment le plus proche.
  - Option: “enchaîner un tracé” à la fin (reste en mode D).
- Éditer géométrie (E) :
  - Alt+Drag sur sommet: déplacer; Alt+Clic sur segment: insérer un sommet; Suppr: supprimer sommet.
- Jonction/Inline (J) :
  - Clic sur un segment: insère un nœud et split l’arête; un menu rapide propose le type du nœud créé: `jonction` (par défaut) | `ouvrage` | `mesure`.
  - Option “démarrer une antenne”: bascule en mode D avec le nœud nouveau comme point de départ.
- Alias (optionnels, non essentiels):
  - Ctrl+clic gauche: équivalent à “ajouter un sommet” en mode D (Windows/Linux).
  - Ctrl+clic droit: équivalent “insérer jonction” (si OS le permet). Non recommandé comme seul chemin.

Cas d’usage demandés
- Ajouter un ouvrage/PM à une canalisation: mode J, clic sur le segment, choisir `ouvrage` ou `mesure`. Le nœud est inséré inline, l’arête est scindée en deux et hérite `pipe_group_id`.
- Rester en mode édition canalisation: le mode D reste actif jusqu’à Échap ou changement manuel.

Fonctionnalités complémentaires proposées
- Mesure dynamique (longueur cumulée) et affichage segmentaire pendant le tracé.
- Simplification à la sauvegarde (Douglas‑Peucker, tolérance paramétrable) pour lisser les clics.
- Outils d’alignement: “rectifier segment” (horizontal/vertical) si utile hors carto.
- Validation réseau: boucles fermées involontaires, degrés isolés, duplicats.
- Styles par attributs (diamètre, matériau) + légende.
- Export/Import GeoJSON; import CSV de points GPS pour pré‑positionner nœuds.
- Undo/Redo complet (s’appuie sur `web/src/history.js`).

Fond de plan (orthophoto)
- Moteur: Leaflet (bundle local) avec tuiles raster. Alternative: MapLibre GL.
- Fournisseur: IGN (FR) ou MapTiler (clé API). Variables d’env: `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY` (optionnelle si incluse dans l’URL).
- Fallback: fond neutre si pas de clé réseau; l’éditeur reste fonctionnel.


## 5) Algorithmes clés (frontend)
Snapping et recherche proche
- Index spatial `rbush` sur nœuds (points) et segments (boîtes englobantes).
- Stratégie: proposer le plus proche sous un seuil, sinon libre.

Projection sur segment (point → polyline)
- Pour chaque segment [A,B], calculer t=(AP·AB)/|AB|², p=A+t·AB borné [0,1]; garder la distance minimale.
- Retourner (edgeId, segmentIndex, t, pointProjected).

Split d’arête
- Entrée: edge E, (segmentIndex, t, pointProjected), nouveau nodeId.
- Sortie: deux arêtes E1, E2 avec `geometry` coupée et `pipe_group_id` hérité; mise à jour `source/target` si split en extrémité (t≈0/1).

Calculs géo
- Projection cartes → lat/lon via `leaflet` (WebMercator). Longueurs en mètres via haversine simple par segment.


## 6) Backend — impacts et tâches
app/models.py
- Ajouter `lon: float|None`, `lat: float|None` à Node.
- Ajouter `geometry: list[list[float]]|None`, `pipe_group_id: str|None` à Edge.
- Validation: si `geometry` absente → fallback sur coordonnées des extrémités si disponibles.

app/datasources.py
- GET: sérialiser `geometry` si présent; si stockage Sheets/BQ utilise WKT/STRING, convertir → liste de coords.
- POST: accepter `geometry`; si `source=sheet`, encoder selon le format choisi (priorité “lon lat; ...”).

app/sheets.py
- Mapping colonnes Node/Edge (lecture/écriture) + parse/format `Geometry`.
- Tolérance formats: “lon lat; …” > GeoJSON > WKT.

app/config.py
- Nouvelles env vars carte: `MAP_TILES_URL`, `MAP_TILES_ATTRIBUTION`, `MAP_TILES_API_KEY` (optionnelle).

app/auth_embed.py
- `build_csp()`: autoriser le domaine des tuiles en `img-src` et `style-src`/`connect-src` si nécessaire.

app/routers/api.py
- Inchangé fonctionnellement; vérifier que Pydantic permet le champ optionnel `geometry`.


## 7) Frontend — impacts et tâches
web/src/vendor.js
- Ajouter Leaflet (ou MapLibre) et éventuellement `rbush`.

web/src/geo.js
- Ajouter utilitaires: haversine, encode/decode geometry (string ⇄ coords), helpers Leaflet project/unproject.

web/src/state.js
- Étendre le state: `mode`, `snapTolerancePx`, `drawInProgress`, `currentPolyline`, `selectedEdgeId`, `selectedNodeId`.

web/src/modes.js
- Définir les modes: SELECT, DRAW, EDIT, JUNCTION. Raccourcis: V/D/E/J, Échap, Entrée, Shift.

web/src/interactions/*
- Nouveau `draw.js`: gestion clics, sommets, terminer/annuler, snapping.
- Nouveau `edit-geometry.js`: Alt+Drag, insert/remove vertex, Suppr.
- Nouveau `junction.js`: pick segment, project, split edge, créer nœud.
- Réutiliser `history.js` pour undo/redo.

web/src/render/*
- Adapter rendu des arêtes pour polylignes (SVG path). Gérer styles en hover/sélection.
- Affichage longueur dynamique pendant le dessin (overlay texte).

web/src/ui/toolbar.js
- Boutons modes V/D/E/J + réglages snapping + bascule fond de plan.

web/styles/editor.css
- Cursors par mode; style des sommets (handles) en édition.

build.mjs
- Inclure CSS Leaflet si utilisé; copier assets si requis. Pas de CDN.

app/templates/index.html
- Ajouter conteneur carte + calques; charger bundles.


## 8) Migration et compatibilité
Lecture
- Anciennes données sans `geometry` restent valides. L’UI dessine un segment simple entre nœuds.

Écriture
- Toujours écrire `geometry` si une polyligne a été saisie/éditée.
- Option de “simplifier avant sauvegarde” (tolérance configurable).

Conversion
- Script optionnel pour convertir toutes arêtes sans `geometry` en polylignes minimales (2 points) pour homogénéiser les exports.


## 9) Tests et validation
TEST_PLAN.md (ajouter cas)
- Dessin simple (2–3 sommets), Échap/Entrée/double‑clic.
- Split arête au milieu; split en extrémité (t≈0/1).
- Insertion ouvrage/PM inline; création antenne depuis une jonction.
- Undo/Redo d’un split puis déplacement de sommet.
- Sauvegarde/chargement Sheets (3 formats `Geometry`) et GCS JSON.
- CSP: embed avec tuiles actives et fond neutre sans réseau.


## 10) Sécurité et performance
- CSP minimale pour domaine tuiles (img-src; éventuellement connect-src pour MapLibre).
- Index spatial `rbush` pour garder une UI fluide même avec >5k sommets.
- Debounce des recalculs de longueur/hover.


## 11) Variables d’environnement (nouvelles)
- MAP_TILES_URL: URL modèle tuiles (ex: https://wxs.ign.fr/KEY/ortho/WMTS?... ou https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=KEY)
- MAP_TILES_ATTRIBUTION: texte d’attribution légal.
- MAP_TILES_API_KEY: optionnelle si l’URL ne l’embarque pas.


## 12) Plan de livraison (itératif)
- Étape 1: Backend (modèle + parsing geometry) sans UI carte — lecture seule testée.
- Étape 2: Fond de plan en lecture seule + rendu polylignes.
- Étape 3: Mode D (dessin) + snapping + Undo.
- Étape 4: Mode E (édition) + handles + suppression sommets.
- Étape 5: Mode J (jonction/inline + split) + antenne.
- Étape 6: Exports Sheets/BQ complets + QA.


## 13) Branching et conventions
- Branche: feature/pipes-as-edges-geometry
- Commits: Conventional Commits (ex: feat(editor): add polyline drawing with snapping)
- PR: checklist incluant tests manuels, MAJ CSP, et validation sur données réelles.


## 14) Checklist fichiers à modifier
Backend
- app/models.py
- app/datasources.py
- app/sheets.py
- app/config.py
- app/auth_embed.py

Frontend
- web/src/vendor.js
- web/src/geo.js
- web/src/state.js
- web/src/modes.js
- web/src/interactions/draw.js (nouveau)
- web/src/interactions/edit-geometry.js (nouveau)
- web/src/interactions/junction.js (nouveau)
- web/src/render/render-edges.js
- web/src/ui/toolbar.js
- web/styles/editor.css
- build.mjs
- app/templates/index.html

Scripts/Docs
- TEST_PLAN.md (ajouts)
- README.md (variables carte)


## 15) Notes de conception
- Mac: Ctrl+clic = clic droit; éviter d’en dépendre. Modes + clic gauche par défaut; garder les alias en option.
- `pipe_group_id`: utile pour suivre l’identité d’une canalisation lors des splits successifs (analyse, styles). Non obligatoire mais recommandé.
- Choix format `Geometry` dans Sheets: “lon lat; …” est le plus simple pour l’utilisateur et les formules; on tolère GeoJSON/WKT pour compat SIG.
- Désactiver ELK auto si des coordonnées GPS existent (ne jamais relayout sans action explicite).

Fin du document.
