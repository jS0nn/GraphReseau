# Plan global — Module Visualisation & Interprétation

## 0. Vision & Portée
- **Objectif** : livrer le module utilisateur « Visualisation & Interprétation » décrit dans `docs/cdc_visualisation_v1_7.md`, sans régresser l’éditeur réseau V1.
- **Environnements** : dev, staging, prod (CSP/clés distinctes).
- **Livrables principaux** :
  - API `/v1/...` lecture (sites, carte, séries, agrégats, événements, exports).
  - Frontend « viewer » (Leaflet + D3) avec code‑split, a11y, budgets perf.
  - Documentation et jeux de tests (unitaires, manuels, rapports qualité données).

## 1. Découpage en lots
| Lot | Nom | Objectifs clés | Dépendances |
| --- | --- | --- | --- |
| 0 | **Fondations données** | Comprendre, valider et standardiser les sources (Sheets, BigQuery, relevés terrain). | aucune |
| A | A11y & structure | Landmarks, labels, modal accessible, navigation clavier. | Lot 0 |
| B | Carte & CSP | Leaflet/IGN, responsive panneau, stratégie CSP validée. | Lot 0 |
| C | Courbes multi‑axes | Séries temps, conversions unités, légende intelligente. | Lot 0 |
| D | Layout responsive | Grilles 3 breakpoints, tokens design system. | A |
| E | Performance build | Code split, critical CSS, budgets Lighthouse. | A, B, C, D |
| F | Chat LLM | Intégration UI + traçabilité prompts. | C, E |
| G | QA avancée | Flags qualité, exports anomalies. | C |

## 2. Lot 0 — Détails & livrables
### 2.1 Inventaire des sources
- **Actions**
  - Recenser onglets Sheets actuels (éditeur réseau) avec schémas & types.
  - Recenser tables BigQuery & vues destinées aux relevés terrain (structure, partitions, naming).
  - Identifier éventuels exports CSV/JSON terrain.
  - Lancer `scripts/lot0/analyze_sheet_links.py` pour cartographier les clés primaires/secondaires.
- **Livrables**
  - Tableau de mapping `source → tables/onglets → description`.
  - Notes sur fréquences de mise à jour, latence, droits d’accès.

### 2.2 Analyse de données
- **Actions**
  - Charger un échantillon représentatif depuis chacune des sources (via scripts Python/Notebook ou API existante).
  - Vérifier intégrité : colonnes manquantes, plages valeurs (cf. §11 CDC), formats timestamp, unités.
  - Documenter conversions déjà appliquées (ex: mbar↔Pa, %).
  - Utiliser `validate_timeseries.py` pour synthétiser les anomalies et compléter le rapport qualité.
- **Livrables**
  - Rapport `docs/data_quality_report.md` (statistiques, anomalies, besoins de cleansing).
  - Fichiers échantillons anonymisés (`data/samples/` si possible).

### 2.3 Cartographie métier & gap analysis
- **Actions**
  - Mapper entités (sites, branches, points, mesures, événements, QA) et relations (PK/FK, contraintes).
  - Relier chaque champ aux besoins du CDC (KPIs, axes, filtres, exports).
  - Identifier manques (ex: Δ calculable ? flags QA disponibles ?).
- **Livrables**
  - Diagramme ou table `docs/data_model_visualisation.md`.
  - Liste des transformations à implémenter (backend ou ETL).

### 2.4 Contrat API initial
- **Actions**
  - Proposer spécification `/v1/...` : routes, paramètres, payloads, pagination, headers (`k`, `ETag`).
  - Définir unités canoniques (SI) + affichage par défaut, métadonnées (`axis`, `unitDisplayDefault`).
  - Prévoir champs audit (`traceId`, `rate-limit` headers).
- **Livrables**
  - Brouillon OpenAPI (peut être Markdown/JSON) `docs/api_v1_draft.yaml`.
  - Checklist d’implémentation pour `app/datasources.py` et nouveaux routeurs.

### 2.5 Outils & tests de lecture
- **Actions**
  - Créer scripts Python (`scripts/lot0/`) pour lecture BQ/Sheets avec credentials ADC.
  - Vérifier conversions et contraintes (plages, somme gaz, discontinuités) ; produire un résumé JSON/CSV.
  - Ajouter entrée `TEST_PLAN.md` pour validation Lot 0.
- **Livrables**
  - Scripts exécutables documentés.
  - Rapport de tests/data checks versionné.

### 2.6 Validation
- Point de revue avec stakeholders pour confirmer :
  - Les données couvrent bien les KPIs & modules.
  - Le contrat API est compris et accepté.
  - Les risques identifiés (ex: manques, latence) sont arbitrés.

## 3. Gouvernance & outillage
- **Branches Git** : `feature/visualisation-usagers` (développement), sous-branches par lot (`lot0-data`, `lotA-a11y`, etc.) pour PR ciblées.
- **CI/CD** : ajuster pipeline (tests, linters, Lighthouse) à mesure des lots.
- **Documentation** : conserver toutes les découvertes Lot 0 dans `docs/` pour onboarding.
- **Suivi** : Kanban ou issues GitHub/Linear alignées sur lots.

## 4. Prochaines actions immédiates
1. Récolter extracts ou accès lecture (Sheets/BQ/relevés).
2. Remplir l’inventaire des sources (section 2.1) dans `docs/data_model_visualisation.md`.
3. Écrire script(s) de lecture et vérification Lot 0.
4. Relire et ajuster le brouillon `docs/api_v1_draft.yaml` (ébauche initiale prête).
5. Mettre à jour `TEST_PLAN.md` avec les cas de validation Lot 0.

## 5. Risques & mitigations
- **CSP Carto** : dépendances IGN non whitelisted → prévoir option proxy/MBTiles dès Lot B.
- **Qualité données** : valeurs hors plage, timestamps non uniformes → automatiser checks Lot 0.
- **Performance** : volumes séries élevés → planifier agrégations côté backend + downsampling front.
- **Sécurité** : gestion des clés via KMS à anticiper avant staging.

---
Mis à jour automatiquement par Lot 0 (à affiner selon découvertes).
