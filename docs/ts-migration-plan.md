# Plan de migration TypeScript

## Objectifs
- Basculer progressivement le frontend `web/` de JavaScript vers TypeScript sans interrompre les builds existants (`npm run build`).
- Sécuriser les contrats de données (`Graph`, `Node`, `Edge`, etc.) en consommant les types générés via `npm run types:generate`.
- Couvrir les modules critiques (`state`, `api`, `render`) par des tests unitaires ou d’intégration adaptés.

## Pré-requis
- Ajouter un `tsconfig.json` avec `allowJs` et `checkJs` pour une migration incrémentale.
- Adapter `build.mjs` pour reconnaître les extensions `.ts` / `.tsx` et produire les bundles actuels.
- Conserver l’export des types Pydantic (`web/src/types/graph.d.ts`) comme source d’autorité.

## Découpage par phases

### Phase 0 — Préparation (terminée)
1. Créer la documentation de migration et le fichier de suivi. ✅
2. Introduire le support TypeScript dans l’outillage (tsconfig + esbuild). ✅
3. Mettre à jour les scripts npm (`npm run build`, `npm test`) pour supporter `.ts`. ✅
4. (Optionnel) Ajouter lint/format TS — à planifier avec l’équipe.

### Phase 1 — Modules de données et état (terminée)
1. Migrer `web/src/state/` (structures de graphe, normalisation). ✅
2. Migrer `web/src/api.ts` (client API) en s’appuyant sur les types générés. ✅
3. Ajouter/adapter les tests unitaires dans `web/tests/state.*`. ✅
4. Généraliser les helpers de typage partagés (`web/src/types/graph`, `web/src/shared`). ✅

### Phase 2 — Vue et interactions (terminée)
1. Migrer `web/src/render/` (rendu D3/ELK) en priorisant les fichiers consommés par `editor.ts`. ✅
2. Migrer `web/src/interactions/`, `web/src/ui/`, et `web/src/view/`. ✅ (`ui/forms.ts` reste à typer finement)
3. Ajouter des tests ciblés (DOM-lite ou mocks) pour les interactions majeures — à décider si besoin.

### Phase 3 — Entrées principales et build final (terminée)
1. Migrer les fichiers d’entrée (`main.ts`, `editor.ts`, `editor.boot.ts`). ✅
2. Désactiver `allowJs` une fois la migration achevée. ✅ (`tsconfig` mis à jour)
3. Nettoyer les JSDoc superflus et mettre à jour la documentation utilisateur (`README`, `NOTICE_IMPLEMENTATION`). ✅
4. Activer progressivement les options strictes (`noImplicitAny`, `strictNullChecks`, …). ⏳

## Stratégie de tests
- Continuer d’exécuter `npm test` après chaque lot migré.
- Introduire des tests supplémentaires pour les zones migrées (ex. invariants de `state`, parsing API).
- Ajouter, si nécessaire, des tests de type (`tsc --noEmit`) dans la CI une fois que la majorité des modules est migrée.
- Fournir un shim DOM minimal pour exécuter les tests dépendant de Leaflet côté Node (`web/tests/test-setup.ts`).

## Suivi et critères de done
- Chaque module migré doit être consigné dans `docs/roadmap/ts-migration-tracking.md` (statut, PR/commit, notes).
- Builds `npm run build` et `npm test` doivent passer après chaque lot.
- Documentation mise à jour au fur et à mesure des étapes clés.

## Risques et mitigations
- **Divergence des schémas** : régénérer les types à chaque évolution backend (`npm run types:generate`).
- **Dépendances sans types** : créer des fichiers `*.d.ts` locaux si nécessaire ou utiliser des wrappers typés.
- **Dette intermédiaire** : suivre les modules `@ts-nocheck` (`ui/forms.ts`, `style/pipes.ts`), consigner les TODO dans le fichier de suivi.

## Prochaines étapes
- Retirer les blocs `// @ts-nocheck` en introduisant des types précis sur les UI complexes (`ui/forms.ts`, `style/pipes.ts`).
- Activer `noImplicitAny` (puis le mode `strict`) pour renforcer la couverture de types.
  - Premier essai réalisé : expose des dépendances d3 non typées et plusieurs callbacks en `render/*` / `shared/graph-transform`. Voir `docs/roadmap/ts-migration-tracking.md` pour la liste.
  - `noImplicitAny` est maintenant activé ; poursuivre avec des options plus strictes (`strictNullChecks`, etc.) selon la roadmap.
- Convertir les tests restants en `.ts` si nécessaire et compléter la documentation CI.
