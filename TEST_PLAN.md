# Plan de tests manuels — Éditeur Réseau (V1)

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
