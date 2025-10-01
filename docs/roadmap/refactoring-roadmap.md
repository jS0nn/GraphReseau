# Roadmap — Refactoring Éditeur Réseau

Cette feuille de route structure le chantier de nettoyage post‑migration (Apps Script ➜ FastAPI/D3) en privilégiant la stabilité métier. Chaque phase produit un incrément livrable, avec jalons de validation et dépendances explicites.

## Objectifs généraux
- Supprimer le code hérité du modèle « canalisations = nœuds » et stabiliser la représentation « canalisations = arêtes » dans toute la stack.
- Clarifier les responsabilités de chaque module (datasources, state frontend, UI) pour faciliter les évolutions V2 (RBAC, links signés).
- Réduire la duplication de logique entre frontend et backend (sanitisation, transformations, schéma).
- Mettre en place des garde‑fous (tests + génération de types) pour éviter les régressions futures.

## Phase 0 — Préparation & cadrage
- [ ] **Cartographier** les points d’entrée actuels: inventaire des routes, modules front, scripts build. 🔁 Revoir doc `README.md`/`NOTICE_IMPLEMENTATION.md` selon besoins.
- [ ] **Aligner la cible fonctionnelle** avec l’équipe: confirmer que le modèle « pipes = edges » est exclusif (pas de mode legacy).
- [ ] **Définir jeux d’essai** (Sheets, JSON, BQ) représentatifs: sauvegarder copies dans `tests/fixtures/`.

## Phase 1 — Backend : modèle & datasources unifiés
- [x] **Nettoyer `app/models.py`**: remplacer les listes par `Field(default_factory=list)`, introduire un objet `EdgeMetadata` pour les attributs pipeline (diamètre, pipe_group_id, devices).
- [x] **Adapter `app/datasources.py`**: extraire des modules `datasources/sheets.py`, `datasources/gcs.py`, `datasources/bigquery.py` avec interface `load/save`. Retirer la sanitation spécifique aux nœuds canals; déplacer `_sanitize_graph_for_write` dans `services/graph_sanitizer.py` commun.
- [x] **Mettre à jour `app/sheets.py`**: réduire le mapping aux champs réellement utilisés; migrer les anciennes colonnes `collector_well_ids`, `child_canal_ids` vers des métadonnées d’arête ou ignorer proprement.
- [x] **Tests**: ajouter tests unitaires (pytest) sur chaque datasource avec fixtures Phase 0. Vérifier round-trip GET+POST ➜ Sheets/JSON.
- [ ] **Documentation**: mettre à jour `.env.example`/`README` si de nouvelles variables apparaissent.

## Phase 2 — Frontend : état & interactions modularisés
- [x] **Supprimer `window.__PIPES_AS_EDGES__`** et toutes les branches associées (`state.js`, `forms.js`, `render-*`).
- [x] **Scinder `web/src/state.js`** en modules : `state/index.js` (store), `state/normalize.js`, `state/history.js`, `state/graph-rules.js`. Retirer fonctions `moveWellToCanal`, `child_canal_ids`, `connectByRules` devenues obsolètes.
- [x] **Nettoyer les interactions**: supprimer `web/src/interactions/connect.js` et ajuster `editor.boot.ts` pour ne plus l’importer; vérifier `draw.ts`/`junction.ts`.
- [x] **Couverture**: écrire tests unitaires front (vitest ou tiny runner) pour `normalizeGraph` et `sanitiseGraph`.
- [x] **Correctifs post-audit**: corriger le menu contextuel du mode dessin (`showMiniMenu`) et éliminer les arêtes orphelines à la suppression de nœuds.

## Phase 3 — UI & exports alignés sur le nouvel état
- [x] **Refondre `web/src/ui/forms.ts`**: simplifier les panneaux Propriétés en se basant sur les arêtes (sélection, affectations). Supprimer sections canal-specific obsolètes.
- [x] **Adapter `render-nodes.js` et `render-edges.js`**: déplacer les styles pipelines vers les arêtes (largeur, couleur) et retirer les attributs nœuds inutiles.
- [x] **Mettre à jour `exports.ts`** pour produire JSON cohérent avec le modèle d’arête enrichie (devices, ordres). Documenter le format dans `docs/`.
- [ ] **Revues visuelles**: scénario QA (chargement, édition, sauvegarde) sur dataset réel.

## Phase 4 — Schéma partagé & génération de types
- [x] **Exposer le schéma Pydantic** (`Graph.model_json_schema()`) via script `scripts/export_schema.py`.
- [x] **Générer les types TypeScript** (ex. `pydantic2ts` ou `datamodel-code-generator`) ➜ `web/src/types/graph.d.ts` et remplacer les `any` dans les modules front.
- [x] **Centraliser la sanitation**: créer un package `shared/graph_transform.py` + `web/src/shared/graph-transform.ts` dérivé du schéma pour éviter la duplication.
- [x] **Tests de compatibilité**: valider qu’un JSON produit côté front est accepté par l’API (contract tests).
- [x] **Mutualiser les helpers géométriques** (`draw.js`, `junction.js`, `edit-geometry.ts`) pour garantir un seul jeu de tolérances/splitting.

## Phase 5 — Nettoyage final & documentation
- [x] **Supprimer dossiers/artefacts legacy**: vérifier `frontend/`, scripts non utilisés, anciennes pages.
- [x] **Mettre à jour la doc** (`docs/handbook/agents.md`, `README`, `TEST_PLAN.md`) avec la nouvelle architecture et les scripts.
- [x] **Préparer changelog** et plan de migration (checklist pour production, re-déploiement Cloud Run, communication aux utilisateurs).

## Suivi & gouvernance
- **Tableau de bord**: reporter l’avancement dans `docs/roadmap/roadmap-v1.md` (section Refactoring) et/ou un board project.
- **Revue hebdo**: point rapide avec l’équipe pour débloquer dépendances et valider les incréments.
- **Critères de sortie**: tests verts (backend/frontend), QA validée, documentation à jour, absence de code heritage « canalisations = nœuds » détecté via `rg`.
