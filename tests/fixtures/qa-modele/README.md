# Jeux d'essai QA — Modèle Réseau

Ce dossier rassemble les datasets nécessaires à la campagne QA décrite dans `docs/roadmap/qa-plan.md`.

## Contenu attendu
- `sheet_legacy/` : export CSV/JSON d'un Google Sheet pré-migration (colonnes historiques, `lat/lon`, `sdr` sur les nœuds).
- `sheet_v2/` : export du Google Sheet post-migration (feuilles `NODES`, `EDGES`, `BRANCHES`, `CONFIG`).
- `export_v2_sample.json` : graphe JSON issu de l'API (fichier d'exemple fourni).
- `bq_snapshot/` : dump BigQuery (par exemple `nodes.csv`, `edges.csv`) aligné sur le modèle actuel.

## Actions à mener
1. Déposer les exports Sheets dans les sous-dossiers dédiés (`sheet_legacy`, `sheet_v2`).
2. Documenter dans ce README la source et la date de chaque export.
3. Mettre à jour `docs/roadmap/qa-plan.md` dès qu'un dataset est disponible.

## Historique
- `export_v2_sample.json` : copie de `graph.json` (2025-XX-XX) pour tester la compatibilité JSON.
