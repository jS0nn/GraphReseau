# Data model — Visualisation & Interprétation

> ⚠️ Document évolutif au fil du Lot 0. Compléter chaque fois qu’une nouvelle source ou règle est identifiée.

Référence des modèles applicatifs: `app/visualisation/models.py` (Pydantic).

## 1. Inventaire des sources
| Source | Localisation (Sheet/BQ/CSV) | Fréquence MAJ | Schémas/onglets | Remarques accès |
| --- | --- | --- | --- | --- |
| Sheets — Éditeur réseau | | | | |
| BigQuery — Mesures terrain | | | | |
| BigQuery — Métadonnées sites | | | | |
| Exports terrain (CSV/JSON) | | | | |

## 2. Entités & relations métier
| Entité | Description | Champs clés (SI) | Parent/relations | Utilisation produit |
| --- | --- | --- | --- | --- |
| Site | | | | |
| Branche / Collecteur | | | | |
| Point de mesure | | | | |
| Mesure (time series) | | | | |
| Événement (ouverture, maintenance) | | | | |
| Flag QA | | | | |

## 3. Dictionnaire des champs
| Champ | Source(s) | Type/Unité stockage | Conversion affichage | Notes (plages, dérivées) |
| --- | --- | --- | --- | --- |
| methane_pct | | `%` | `%` | |
| oxygen_pct | | `%` | `%` | |
| depression_pa | | `Pa` | `mbar` (÷100) | |
| flow_velocity_ms | | `m/s` | `m/s` ou `Nm³/h` | |
| valve_open_pct | | `%` | `%` | |
| ... | | | | |

## 4. Règles de qualité & dérivées
- **Somme gaz** : CH₄ + CO₂ + O₂ ∈ [95, 101].
- **Dépression** : [−30 000 Pa, 0 Pa].
- **Vitesse** : [0, 30] m/s.
- **Autres règles** : compléter.

Documenter ici les transformations calculées (Δ before/after, ratios, agrégats) et préciser où elles sont calculées (backend vs front).

## 5. Mapping vers API `/v1/...`
| Endpoint | Payload attendu | Sources alimentées | Champs obligatoires |
| --- | --- | --- | --- |
| `/v1/sites` | Liste sites avec coordonnées, statut, KPIs | | |
| `/v1/map/points` | Points carte + glyphes | | |
| `/v1/series` | Séries temps (multi axes) | | |
| `/v1/aggregates` | Agrégations temporelles (min/max/avg/percentiles) | | |
| `/v1/events` | Événements de réglage/maintenance | | |
| `/v1/export` | Lien export CSV/PNG | | |

## 6. Questions ouvertes & risques
- [ ] Données H₂S disponibles en continu ?
- [ ] Champ `traceId` présent dans les sources ?
- [ ] Granularité temporelle homogène sur toutes les séries ?
- Ajouter toute question bloquante ici.

---
Mainteneur : équipe Visualisation — tbd.
