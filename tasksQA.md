# Plan QA & Revues — Éditeur Réseau

## Vue d'ensemble
- Objectif: sécuriser la livraison du modèle réseau révisé et valider la refonte front (post-refacto) avant passage à V3.
- Portée: QA modèle réseau (backend + UI) et revue visuelle refacto.
- Références: `taskModeleReseau.md`, `tasksrefactoring.md`, `TEST_PLAN.md`.
- Cadence: daily checkpoint rapide tant que des cases restent ouvertes.

## Pilotage
| Domaine | Responsable | Échéance cible | Statut | Dernière note |
|---------|-------------|----------------|--------|---------------|
| QA Modèle Réseau | Jeremie | Semaine+1 | En cours | Dossier fixtures créé; datasets à collecter |
| Revue visuelle refacto | Jeremie | Semaine+1 | À planifier | Parcours de démo à cadrer |

## QA Modèle Réseau (cf. `taskModeleReseau.md`)
- [ ] **Datasets de test**: rassembler Sheet legacy, Sheet V2, export JSON/BQ → stocker dans `tests/fixtures/qa-modele/` (dossier créé).
  - [x] Export JSON V2 copié dans `export_v2_sample.json`.
  - [ ] Exports Sheets legacy/V2 à déposer.
  - [ ] Snapshot BigQuery à récupérer.
- [ ] **Round-trip automatisé**: scripts GET/POST pour Sheets, JSON, BQ (vérifier `length_m`, `crs`, `branches`, nettoyage `lat/lon`).
  - [x] Script initial `scripts/qa_roundtrip.py` (TestClient) créé.
  - [ ] Paramétrer connecteurs Sheets (ADC) et dataset BigQuery.
- [ ] **Tests contractuels**: pytest (ou équivalent) validant l'acceptation des nouveaux champs et la persistance des longueurs.
  - [ ] Couvrir `export_v2_sample.json` via `TestClient` (GET puis POST) en vérifiant `crs` et `length_m`.
  - [ ] Ajouter test de rétro-compatibilité lat/lon (entrées anciennes).
- [ ] **Vérifications UI**: chargement + édition branches, suppression `sdr` sur nœuds, sauvegarde côté UI.
- [ ] **Rapport QA**: consigner résultats/anomalies, mettre à jour `taskModeleReseau.md` et `TEST_PLAN.md`.

### Risques & points d'attention
- Jeux d'essai Google Sheets doit rester stable (prévoir copies locales).
- Vérifier quotas Sheets/BigQuery pour éviter bloquages.

## Revue Visuelle Refacto (cf. `tasksrefactoring.md`)
- [ ] **Parcours de démo**: définir scénario complet (chargement, modes D/E/J, sauvegarde) + dataset de référence.
- [ ] **Captures & screencasts**: collecter avant/après sur écrans clés pour détecter régressions.
- [ ] **Interactions critiques**: revalider dessin, jonction, suppression, menu contextuel, logs.
- [ ] **Exports JSON**: comparer export UI avec modèle d'arête enrichie (diff JSON vs schéma).
- [ ] **Synthèse & checklist**: documenter observations, cocher `tasksrefactoring.md` phase 3 une fois validé.

### Risques & points d'attention
- Maintenir cohérence styles après bundling (vérifier `app/static/bundle`).
- Prévoir test sur différents ratios d'écran (desktop, 13", 27").

## Suivi quotidien
- Reporter toute anomalie en issue (ou section dédiée) avec capture + steps.
- Mettre à jour ce fichier dès qu'une case est cochée ou qu'un nouveau risque apparaît.
