# Plan de tests manuels — Éditeur Réseau (V1/V2)

## Lecture / Écriture — Sheets
- Lancer le backend (`uvicorn ... --env-file .env.dev`) avec `DATA_SOURCE=sheet`.
- GET `/api/graph` renvoie un graph JSON non vide (Nodes/Edges).
- UI: chargement via bouton « Charger » affiche le graphe.
- Modifier un nœud (nom, type, position), sauvegarder.
- Vérifier POST `/api/graph` → mise à jour dans le Google Sheet.

## Lecture / Écriture — GCS JSON (ou fichier local)
- Démarrer avec `DATA_SOURCE=gcs_json` ou passer `?source=gcs_json&gcs_uri=file:///ABS/graph.json`.
- GET rend le contenu du fichier.
- Modifier 1 nœud et sauvegarder; vérifier le fichier a changé.

## Lecture — BigQuery (RO V1)
- Démarrer avec `DATA_SOURCE=bigquery` ou query params `?source=bigquery&bq_project=...&bq_dataset=...`.
- GET renvoie un graphe conforme (tables Nodes/Edges mappées FR/EN).

## Layout (ELK + fallback)
- Cliquer « Agencer »: positions sont recalculées.
- En l’absence d’ELK (ou échec), fallback génère un layout et des logs sont visibles.

## Interactions principales
- Sélection / Connecter / Supprimer: boutons et raccourcis (C, Delete) fonctionnent.
- Drag & drop des nœuds avec snap à la grille.
- Multi‑sélection (marquee) et déplacement groupé.
- Suppression d’arête via bouton et via raccourci.

## Panneau Propriétés
- Affiche les champs selon le type (PUITS / CANALISATION / PM / VANNE).
- Séquence des puits dans la canalisation: réordonner et vérifier la mise à jour des positions.
- Inline (PM/Vanne): position/offset reflétés dans le graphe et la séquence.

## Exports
- Export JSON, JSON compact, et nœud/arête téléchargent des fichiers valides.

## Embed (sécurité)
- `ALLOWED_REFERER_HOSTS` restreint les requêtes (403 sinon).
- `ALLOWED_FRAME_ANCESTORS` bloque/autorise l’iframe selon l’origine.
- Clé statique `k` acceptée/refusée selon `EMBED_STATIC_KEY` (ou bypass si `DISABLE_*=1`).

## Santé / Observabilité
- `/healthz` renvoie 200.
- Journal (drawer) affiche warnings/erreurs de layout.

---

## V2 — Fond orthophoto + synchronisation

Préparation
- Définir dans `.env.dev`:
  - `MAP_TILES_URL` (IGN WMTS PM ou XYZ), `MAP_TILES_ATTRIBUTION`, éventuellement `MAP_TILES_API_KEY`.
- `npm install && npm run build` (Leaflet copié en local), puis `uvicorn ... --env-file .env.dev`.

Vérifications
- L’orthophoto s’affiche sous l’éditeur (bouton « Fond » actif). Le bouton « Fond » bascule l’affichage (préférence persiste).
- La molette et le drag sur le canvas pan/zooment la carte; les polylignes et nœuds GPS restent alignés (pas de décalage perceptible).
- `MAP_TILES_URL` vide → fond neutre, aucun appel réseau.
- CSP: pas d’erreur CSP en console; l’origine de tuiles est autorisée.

Cas d’erreurs
- URL invalide (401/403/404) → tuiles non chargées; pas de crash JS; overlay toujours rendu.
- Clé API manquante: ajouter `MAP_TILES_API_KEY` ou renseigner la clé dans l’URL.

## V2 — Géométrie d’arêtes (lecture)

Sources de test
- GCS JSON: fichier avec edges[].geometry: `[[lon,lat], ...]`.
- Sheets: colonnes `Geometry` et `PipeGroupId` (formats tolérés: « lon lat; … », GeoJSON stringifié, WKT LINESTRING).
- BigQuery: colonne `geometry_wkt` (ou `geometry` stringifiée WKT) dans `Edges`.

Vérifications
- Les arêtes avec `geometry` sont rendues en polyligne; sans `geometry`, fallback en courbe entre nœuds.
- Une flèche apparaît au milieu de chaque polyligne (masquée si très courte), orientée source→target.
- Pour Sheets, chacun des 3 formats de `Geometry` est accepté (au moins un exemple par format).
- Pour BigQuery, WKT est correctement converti en `geometry` JSON côté API.

## V2 — Nœuds GPS et verrouillage

Vérifications
- Un nœud avec `gps_lat/gps_lon` affiche la coche « Ancrer au GPS (verrouiller) » active; le nœud n’est pas déplaçable (drag ignoré).
- Décochez « Ancrer au GPS »: la position visuelle actuelle est gelée en `x/y`; le nœud redevient déplaçable.
- Recochez après avoir (ré)renseigné lat/lon: le nœud suit la carte; dragging à nouveau bloqué.

Régressions à éviter
- Les nœuds sans GPS restent déplaçables; la coche est désactivée.
- Les interactions existantes (sélection, menu, suppression) ne sont pas perturbées.
