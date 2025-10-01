# Modèle Réseau – Cahier des charges révisé

## 1. Contexte et objectifs
- Remplacer l’ancien backend Apps Script par l’API FastAPI qui lit/écrit dans Google Sheets et expose un JSON pour l’UI.
- Faire évoluer le modèle "réseau de canalisations" tout en restant rétro-compatible avec les jeux de données existants.
- Les recalculs géométriques complets (EPSG:2154, reprojections fines, etc.) restent optionnels pour une itération ultérieure, mais chaque canalisation doit toujours disposer d’une longueur calculée et cohérente avec l’UI actuelle.

## 2. Exigences fonctionnelles révisées
- **R1 — Calculs géométriques :** conserver le calcul systématique des longueurs `length_m` pour toutes les arêtes. L’algorithme de recalcul « nouvelle génération » (Lambert-93, proj4, fallback Turf) est placé dans une itération optionnelle ultérieure.
- **R2 — Métadonnées CRS :** enrichir le JSON avec un bloc racine `crs` de la forme `{ code: "EPSG:4326", projected_for_lengths: "EPSG:2154" }` et conserver ce bloc à l’identique côté backend, stockage et UI.
- **R3 — Branches explicites :** exposer à la racine du JSON un tableau `branches[]` (`id`, `name`, `parent_id`, `is_trunk`) issu d’une feuille dédiée dans Google Sheets. Les données existantes doivent initialiser `name = id` tant que l’utilisateur ne les renomme pas.
- **R4 — SDR côté canalisations uniquement :** retirer toute occurrence de `sdr`/`sdr_ouvrage` sur les nœuds (lecture, écriture, UI). Les arêtes conservent le champ `sdr`.
- **R5 — Coordonnées sans doublon :** ne sérialiser que `gps_lat` / `gps_lon`. Accepter `lat` / `lon` en entrée pour rétro-compatibilité mais ne plus les émettre dans les réponses JSON.
- **R6 — Google Sheets :** ajuster le schéma pour gérer les feuilles `NODES`, `EDGES`, `BRANCHES`, `CONFIG`, avec `geometry.tson` (LineString WGS84) et `length_m` calculés côté application. Les anciennes colonnes restantes doivent être ignorées sans casser la lecture.
- **R7 — UI & branches :** afficher les noms des branches (`name`) partout où l’UI affiche aujourd’hui les `branch_id`. Permettre l’édition du nom qui persiste dans la feuille `BRANCHES`.

## 3. Orientations de mise en œuvre
### Backend / API
- Étendre les modèles Pydantic (`Graph`, `Edge`, `Node`) pour intégrer `crs`, `branches` et exclure `sdr` des nœuds lors de la sérialisation.
- Adapter `sanitize_graph` pour accepter les nouveaux champs racine, continuer à valider les longueurs existantes et nettoyer `lat`/`lon` des sorties.
- Mettre à jour `graph_to_persistable_payload` afin de conserver les longueurs calculées en amont (pas de recalcul Haversine à la volée) et propager `crs` + `branches`.

### Google Sheets
- Lire/écrire les feuilles supplémentaires :
  - `EDGES` : `id, from_id, to_id, branch_id, geometry.tson, diameter_mm, material, sdr, length_m, ...`
  - `NODES` : `id, name, type, branch_id, gps_lat, gps_lon, ...` (sans colonne `sdr`).
  - `BRANCHES` : `id, name, parent_id, is_trunk`.
  - `CONFIG` : `crs_code`, `projected_for_lengths` (valeurs par défaut `EPSG:4326` / `EPSG:2154`).
- Conserver la compatibilité avec les fichiers existants (colonnes supplémentaires ou anciennes nomenclatures).

### Frontend / UI
- Étendre le store (`state`) et les types pour embarquer `graph.branches` et `graph.crs`.
- Modifier les formulaires et composants qui listent les branches pour afficher `branch.name` tout en conservant `branch.id` comme clé.
- Retirer les champs `sdr` sur les nœuds (formulaire, normalisation, affichage) ; garantir que seuls les edges manipulent ce champ.
- Lorsque l’utilisateur renomme une branche, déclencher l’écriture dans la feuille `BRANCHES` via l’API.

## 4. Suivi d’avancement
| Item | Description | Statut | Notes |
|------|-------------|--------|-------|
| DOC | Création du cahier des charges révisé (`docs/specs/modele-reseau.md`). | ✅ Terminé | Point de référence pour l’équipe. |
| BE-1 | Mise à jour des modèles / sanitisation (`crs`, `branches`, retrait `sdr` nœuds, GPS only). | ✅ Terminé | |
| BE-2 | Lecture/écriture Sheets avec `BRANCHES`, `CONFIG`, `geometry.tson`, `length_m`. | ✅ Terminé | Compat rétro NODES/EDGES à vérifier. |
| BE-3 | Persistable payload & API : conserver longueurs pré-calculées, propager `crs`/`branches`. | ✅ Terminé | |
| FE-1 | Extensions `state`/types + ingestion `crs`/`branches`. | ✅ Terminé | |
| FE-2 | UI branches : affichage `name`, édition persistée, retrait `sdr` nœuds. | ✅ Terminé | |
| QA | Tests manuels/automatisés (backend + UI) couvrant les nouveaux flux. | ⬜ À faire | Inclure scénarios rétro-compatibilité. |

---
_Mise à jour : 2025-09-21._
