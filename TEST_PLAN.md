# Plan de tests manuels — Éditeur Réseau (V1/V2)

> Tests automatisés complémentaires : `python -m unittest discover -s tests -p "test_*.py"`

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
- Export JSON télécharge un fichier valide.

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

## Visualisation — Lot 0 (données)

Préparation
- Disposer d’un accès lecture aux sources : Sheets éditeur (ID), BigQuery (dataset mesures, métadonnées), exports terrain si disponibles.
- Configurer ADC (`gcloud auth application-default login --impersonate-service-account=...` si nécessaire).

Vérifications
- `python scripts/lot0/fetch_sheets_inventory.py --sheet-id $SHEET_ID_DEFAULT` retourne la liste des onglets et en-têtes attendus.
- `python scripts/lot0/analyze_sheet_links.py --survey-sheet-id 1Nf5zPrzV6nlYrWI8tqFCmBG3RX8w8rReQxZH8_sncyE --primary-tab "R&T BIOGAZ || 965523" --secondary-tab "releve_biogaz" --network-sheet-id 10y5y_3H-3qKzQmY8lx9wevIXXbkWfIU-Qx2uyaaw6Bg` synthétise la jointure (matchs / manquants).
- `python scripts/lot0/sample_bigquery.py --project $GCP_PROJECT_ID --dataset <dataset> --table <table>` extrait un échantillon sans erreur et respecte le `--limit`.
- Les fichiers générés dans `data/samples/` sont consignés et utilisés pour renseigner `docs/data_model_visualisation.md`.
- Les règles qualité (plages valeurs, somme gaz, discontinuités) sont vérifiées via les scripts Lot 0 ou un notebook associé; les anomalies sont reportées dans `docs/data_quality_report.md`.
- `python scripts/lot0/validate_timeseries.py --input data/samples/mesures.json` génère un rapport JSON des violations (paramétrable via les options de champ).

Sorties attendues
- `docs/data_model_visualisation.md` complété avec le mapping sources → champs.
- `docs/data_quality_report.md` renseigné pour la revue.
- Décisions/API `/v1/...` confirmées avant d’entamer le Lot A.
