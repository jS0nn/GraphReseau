# Suivi migration TypeScript

| Module / dossier | Statut | Tests associés | Notes |
| ---------------- | ------ | -------------- | ----- |
| Support TypeScript (tsconfig + build) | ✅ Fait | `npm run build`, `npm test` | `tsconfig`, esbuild `tsconfig`, scripts npm |
| web/src/state | ✅ Fait | `web/tests/state.*` | `graph-rules.ts`, `normalize.ts`, `index.ts` convertis (+ tests adaptés) |
| web/src/api.ts | ✅ Fait | `web/tests/api.test.ts` | Client TS + stubs fetch/query |
| web/src/render | ✅ Fait | Tests DOM/mocks (à définir) | Tous les modules render* convertis en TS |
| web/src/interactions | ✅ Fait | À définir | Tous migrés (draw/geometry nettoyés, reste à typer finement les handlers avancés) |
| web/src/view | ✅ Fait | À définir | `view-mode.ts` migré (layout, positionnement) |
| web/src/shared & modes | ✅ Fait | À définir | utils, geo, graph-transform (typé sans implicites), branch assign/colors, modes |
| web/src/ui | ✅ Fait | À définir | tooltips/mini-menu/logs/forms (`forms.ts` sous `ts-nocheck`) |
| web/src/style | ✅ Fait | À définir | `style/pipes.ts` (à typer finement) |
| Entrées (main/editor/editor.boot) | ✅ Fait | Tests d’intégration | `main.ts`, `editor.ts`, `editor.boot.ts` convertis |
| Options strictes TypeScript | ✅ Fait | `npm run typecheck` | `noImplicitAny` activé : state/normalize, style/pipes, ui/forms et tests mis à jour |
| Environnement de tests Node | ✅ Fait | `npm test` | Shim DOM `web/tests/test-setup.ts` pour Leaflet/requestAnimationFrame |

Légende : ✅ fait · 🚧 en cours · ⏳ à faire · ⚠️ bloqué.

Historique des jalons :
- [x] Initialisation — support TS opérationnel (tsconfig + esbuild).
- [x] Phase 1 complétée (state + api).
- [x] Phase 2 complétée (render + interactions + view).
- [x] Phase 3 complétée (entrées principales, validations strictes).
