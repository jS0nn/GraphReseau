# Feuille de route V1 — Éditeur Réseau

Statut: à cocher au fur et à mesure. Cible: V1 fonctionnelle (embed RO), sources interchangeables (Sheets/GCS JSON/BQ), build sans CDN.

## Frontend (UI/UX)
- [x] Rendu SVG D3: nœuds/arêtes, couleurs par branche, markers
- [x] Modes: sélection / connecter / supprimer (nœud)
- [x] Drag + snap grille, multi‑sélection (marquee)
- [x] Panneau propriétés (PUITS / CANALISATION / PM / VANNE)
- [x] Séquence canalisation (chips) + ordre enfants
- [x] Aide (dialog) + Journal (drawer) + Export (JSON/compact/node‑edge)
- [x] Auto‑layout: ELK + fallback avec logs
- [x] Suppression d’arête (bouton “Supprimer” edge) et raccourci (partiel – bouton)
- [x] Indicateur “N nœuds / M arêtes” (overlay)

## Backend (API/Données)
- [x] GET /api/graph — Sheets (ADC/impersonation), mapping FR/EN (V1→V5)
- [x] POST /api/graph — Sheets (écrit FR V5 / FR V2)
- [x] GET/POST — GCS JSON (gs:// ou file:/// en dev)
- [x] GET — BigQuery (tables compatibles FR/EN)
- [ ] POST — BigQuery (délibérément hors périmètre V1)

## Sécurité / Embed
- [x] CSP stricte + frame‑ancestors (Looker/Sites)
- [x] Enlever X‑Frame‑Options
- [x] Clé statique k (V1)
- [x] Dev toggles: DISABLE_EMBED_REFERER_CHECK / DISABLE_EMBED_KEY_CHECK
- [ ] V2: liens d’embed signés (JWT court‑terme)

## Sources & Bridge
- [x] Bridge “google.script.run” (transitoire) → API FastAPI
- [x] Client API natif (web/src/api.js), supprimer bridge‑gas

## Build / Infra
- [x] Build esbuild (bundle + vendor local)
- [x] Dockerfile multi‑stage (Node build → Python runtime)
- [x] .gitignore (secrets, artefacts)
- [ ] .env.example (variables clés doc)

## Documentation / Validation
- [x] README (diff API/front, embed, env, impersonation)
- [x] NOTICE_IMPLEMENTATION (pas‑à‑pas local/Docker/Cloud Run)
- [ ] Plan de tests manuels (lecture/écriture, layout, embed RO/RW)

Notes
- Les éléments “hors périmètre V1” restent listés ici pour suivi (V2/V3).
- Cette liste sera tenue à jour à mesure des validations et correctifs.
- V2 (métier): affichage des valeurs de qualité de gaz sur les nœuds (sourcing, mise à jour visuelle, légende/échelle).
