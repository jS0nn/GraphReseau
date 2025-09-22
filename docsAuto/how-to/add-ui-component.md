# Guide pratique – Ajouter un composant UI

## 1. Identifier l’emplacement
- Barre d’outils (`web/src/modes.js`, `web/src/ui/forms.js`).
- Panneau latéral (`web/src/ui/forms.js`, `web/src/ui/mode-help.js`).
- Canvas (`web/src/render/render-nodes.js`, `render-edges.js`).

## 2. Créer le composant
- Ajouter un module dans `web/src/ui/` ou `web/src/render/`.
- Initialiser depuis `web/src/editor.boot.js`.

## 3. Brancher l’état
```javascript
import { state, subscribe } from '../state/index.js';
```
- Utiliser `subscribe` pour réagir aux changements.

## 4. Interactions
- Drag : `web/src/interactions/drag.js`.
- Sélection : `web/src/interactions/selection.js`.
- Créer un module dédié si besoin (ex: `interactions/measure.js`).

## 5. Styles
- Ajouter les règles CSS dans `web/styles/*.css`.
- `build.mjs` bundlera automatiquement.

## 6. Libellés & i18n
- Centraliser les textes (ex: `web/src/ui/mode-help.js`).
- ⚠️ TODO : fournir une base d’i18n si déploiement multilingue.

## 7. Tests & QA
- Vérifier avec `npm run build:dev` et l’iframe.
- Ajouter des tests Node (`web/tests`) – ⚠️ TODO : suite à compléter.

## 8. Documentation
- Mettre à jour `../tutorials/build-first-feature.md` si exemple pertinent.
- Ajouter la référence dans `../TRACEABILITY.md`.
- Documenter l’impact métier dans `../overview/processes.md` si nécessaire.

> Note : valider le rendu sur mobile (Leaflet + D3).
