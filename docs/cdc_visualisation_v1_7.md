# Cahier des charges — Visualisation & Interprétation (**v1.7**, complet)

**Mise à jour :** 2025-09-26  
**Produit :** Visualisation & Interprétation – Réseau Biogaz  
**Stack cible :** FastAPI (backend lecture), Cloud Run, BigQuery (lecture), D3/SVG + Leaflet (front), ELK (logs)  
**Audience :** régleurs terrain, exploitants réseau, data/qualité  
**But :** fournir une plateforme de **visualisation corrélée** (carte ↔ courbes ↔ tableaux) pour **diagnostiquer**, **prioriser** et **tracer** les actions de réglage.

---

## 🔁 Changelog v1.7 (vs v1.6/v1.5)
1. **Sémantique & Accessibilité** : landmarks (`header/nav/main/aside/footer`), hiérarchie de titres, labels pour tous les champs, **modal accessible** (trap focus, `Esc`, retour focus), lecteurs d’écran (aria-labels/desc).  
2. **Responsive** : 3 breakpoints (S≤640, M 641–1024, L>1024), grilles adaptatives (`auto-fit`), outils carte repliables en mobile.  
3. **Design system** : tokens étendus (espacements, échelles typographiques, rayons, durées, z-index) + **états** `:hover`/`:focus-visible`/`:disabled` + **prefers-reduced-motion**.  
4. **Courbes** : **3 axes visibles par défaut**, **2 axes activables** ; **légende intelligente** : au survol d’une série ⇒ sur‑surbrillance de **son axe** et **tick labels**.  
5. **Unités** : **stockage SI** (Pa, m/s, ppm, %) ; **affichage par défaut mbar** pour la dépression (toggle Pa). Règles d’arrondis harmonisées.  
6. **Sécurité** : clés via **KMS**, **rotation trimestrielle**, **rate‑limiting**, **audit** 90 jours ; V2 : **OIDC** (option).  
7. **CSP × Carto** : **WARNING** IGN Géoportail — nécessite **whitelist des domaines** tuiles ou **proxy/MBTiles**. Test d’acceptation dédié.  
8. **Performance** : budgets (CSS≤150 Ko gz/vue, JS≤100 Ko gz/vue, LCP≤2.5 s, TTI≤1.5 s), extraction **critical CSS**, **code‑split** par vue.  
9. **Chat LLM** : `aria-live="polite"`, envoi `Ctrl+Enter`, traçabilité prompts/sorties, ancrage « Voir sur la courbe ».  
10. **SEO/PWA** (option) : meta description, Open Graph, manifest.

---

## 0) Métadonnées
- **Version** : **v1.7** (complet)  
- **Périmètre V1** : carte glyphes (lecture), agrégations, **modal courbes multi‑axes**, modules tableaux (collecteurs, base DATA), inter‑points, planification, exports, chat LLM (lecture/guide), **contrôle qualité** basique, **audits et journaux**, **CSP stricte**.  
- **Hors périmètre V1** : saisie primaire (outil tiers), RBAC avancé, éditeur réseau (module séparé), écriture BigQuery.  
- **Environnements** : dev / staging / prod (domaines séparés, CSP et clés distinctes).

---

## 1) Principes UX
- **Orientation** : carte comme **vue maîtresse**, modal **Courbes** pour l’analyse fine, tableaux pour tri/priorisation.  
- **Densité** : afficher l’essentiel (≤ 3 axes visibles), détails à la demande (axes avancés, couches carto, info‑bulle riche).  
- **Consistance** : mêmes couleurs/unités/shorthands **partout** (carte, courbes, tableaux, exports).  
- **Clavier & Lecteurs d’écran** : tout est **utilisable au clavier** (tab order, roving tabindex pour légende), **focus visible**, textes alternatifs (aria).  
- **Mobile‑first** : composants empilables, cibles tactiles ≥ 44×44 px, panneaux repliables.

### 1bis) Couche produit — Personas, décisions, KPIs
**Régleur terrain** (opérateur mobile)  
- **Décisions** : choisir les points à visiter, fixer **nouvelle ouverture**, valider l’effet (Before/After).  
- **KPIs** : ΔCH₄, ΔO₂, Δvitesse, temps « arrivée→validation ».

**Exploitant réseau** (superviseur)  
- **Décisions** : équilibrer réseau, prioriser branches/collecteurs, piloter délais.  
- **KPIs** : O₂ moyen, CH₄ pondéré, respect **SLA** planif.

**Data/Qualité**  
- **Décisions** : valider mesures, détecter incohérences, produire rapports.  
- **KPIs** : #trous > X h, #doublons, #lignes rejetées QA.

**Décisions & KPIs par module**  
- **Carte** : sélectionner points/branches prioritaires ; KPIs : % réseau contrôlé (30 j), #alertes O₂/équilibre, ΔCH₄ branche.  
- **Courbes (par point)** : confirmer anomalie, fixer ouverture, valider effet ; KPIs : ΔCH₄/ΔO₂/Δv, temps de validation.  
- **Inter‑points** : repérer non‑contributeurs, classer priorités ; KPIs : % v>0, % ouvertures dans [5 %; 50 %].  
- **Planification** : ordonnancer J+7/J+15/J+30/J+60 ; KPIs : #tâches à l’heure, Δj moyen, #re‑visites.  
- **Collecteurs (table)** : cibler collecteurs mal réglés ; KPIs : CH₄/O₂ moyens, Q total, % ouvertures hors plage.  
- **Base DATA** : valider séries avant export/rapport ; KPIs : #doublons, #trous, #rejets QA.  
- **Risque de compostage** : enclencher correctifs ; KPIs : #cas à risque, temps de résolution.

**Critère d’acceptation (Produit)** : chaque écran liste **3 décisions** et **2–3 KPIs** exposables (bannière, infobulle, légende).

---

## 2) Données (rappel & dérivées)
- **Mesures brutes** : CH₄ %, CO₂ %, O₂ %, H₂S ppm, CO ppm, H₂ ppm, **dépression P** (Pa), **vitesse v** (m/s) ou **débit Q** (Nm³/h), **ouverture vanne** %, **température flamme** T, **événements** (ouverture/fermeture/maintenance).  
- **Dérivées** : **balance** (distribution des contributeurs), **ratio** (CH₄/CO₂), **Δ** Before/After, **agrégats** (min/max/avg/percentiles).  
- **Agrégation temporelle** : règle par zoom (raw→1 min→15 min→1 h→1 j) avec **downsampling** Douglas‑Peucker côté front.  
- **Lacunes** : afficher discontinuités (hachures), ne **pas interpoler** O₂/CH₄, indiquer `gap>τ`.

### 2bis) Unités & temps
- **Stockage interne (canonique)** : **SI** — dépression en **Pa**, vitesse **m/s**, gaz en **%**, H₂S/CO/H₂ en **ppm**.  
- **Affichage** : **mbar** par défaut pour la dépression (toggle **Pa**). Conversion : `1 mbar = 100 Pa`.  
- **Arrondis** : mbar (entier), Pa (dizaines), % (0.1), ppm (entier).  
- **Fuseau & DST** : TZ du site ; afficher horodatage local avec date ISO + TZ.

---

## 3) Design cartes & glyphes
- **Objets** : puits, vannes, jonctions, drains, branches, collecteurs, capteurs spéciaux.  
- **Glyphes** : couleur = O₂/CH₄, taille = Q/v, pictos = état (OK/Alerte/Indispo). **Clusters** au zoom out.  
- **Couches** : base OpenStreetMap/IGN (cf. CSP), orthophoto (option), réseau (geojson).  
- **Tooltips** : métriques clés + liens « Ouvrir courbes », « Aller à la branche ».  
- **Mobile** : panneau latéral en accordéon, cibles tactiles ≥ 44×44.

---

## 4) Navigation & écrans
- **Vues** : Landing, **Carte** (maîtresse), **Branche**, **Collecteurs**, **Inter‑points**, **Base DATA**, **Planification**, **Stats**.  
- **Sémantique** : landmarks ; chaque vue a un **`<h1>`**, panneaux en **`<h2>`**.  
- **Clavier** : `Tab/Shift+Tab`, `?` pour aide, `Esc` pour fermer modal/chat, `Enter/Space` pour toggles.

---

## 5) Courbes **multi‑axes avancées** (Modal)
### 5.1 Axes & **présentation par défaut**
- **3 axes visibles** par défaut :  
  - **G1** : **CH₄ %** + **CO₂ %** (0→60 %).  
  - **G2** : **O₂ %** (0→5 %).  
  - **D1** : **Dépression [mbar]** (p.ex. −200→0).  
- **2 axes avancés (activables)** : **D2** = **Vitesse/Débit** (m/s ou Nm³/h), **D3** = **T_flamme [°C]** ou **H₂S [ppm]**.  
- **Bandeau bas** : **Ouverture de vanne %** (step).

### 5.2 Interaction & ergonomie
- **Crosshair**, **brushing**, **masquage** par légende, **drag‑&‑drop** de séries vers axes, **Before/After** (Δ), **seuils** et **zones de tolérance**.  
- **Légende intelligente** : au survol d’une série, l’**axe associé** et ses **graduations** sont **sur‑surbrillés** (classe `.axis--active`).  
- **Accessibilité** : navigation clavier dans la légende (roving tabindex), **focus management** de la modal (trap + `Esc`).

### 5.3 Détails de rendu (D3/SVG)
- **Downsampling** : Douglas‑Peucker ou LTTB selon zoom.  
- **Échelles** : synchronisées par métrique, axes secondaires pour unités différentes.  
- **Exports** : PNG + CSV + **lien partage** (état d’axes/période encodés).

### 5.4 Agrégation & lacunes
- **Fenêtre** adaptative ; **discontinuités** visibles ; pas d’interpolation sur gaz.

### 5.5 API & payloads (lecture)
- Paramètres : `siteId`, `pointId|branchId`, `from`, `to`, `metrics[]`, `agg`, `tz`, `unitPref` (mbar|Pa).  
- **Cache** : `ETag`/`If-None-Match`, `Cache-Control: max-age=30`.  
- **Pagination** : `limit` + `next_cursor` pour séries longues.

### 5.6 Couleurs / tokens
- Palette **CVD‑safe**, tokens CSS (voir §16).

---

## 6) Modules non‑cartes
### 6.1 Collecteurs (table)
- Tri multi‑colonnes, filtres (état, O₂/CH₄, plage d’ouverture), export CSV.  
- Cellules « sparkline » mini‑tendance 7 j.

### 6.2 Base DATA
- Liste de mesures, flags QA, filtres trous/doublons, export.

### 6.3 Par point
- Accès direct aux courbes, presets de période (24 h/7 j/30 j).

### 6.4 Inter‑points
- Comparatif de points, score de priorité.

### 6.5 Risque de compostage
- Règles (balance/ratio), niveau de confiance, lien vers période probante.

### 6.6 Planification / Bilan régleur
- Règles J+7/J+15/J+30/J+60, **export ICS**, **priorité** + **SLA**, vue collaborateurs, indicateur de retard (Δj).

### 6.7 Statistiques d’usage
- Relevés/mois, % réseau couvert, % réglages post‑mesure.

---

## 7) API (lecture V1) — OpenAPI (extraits)
- **Versionnement** : `/v1/...` (politique d’évolution documentée).  
- **Endpoints** : `/sites`, `/map/points`, `/series`, `/aggregates`, `/events`, `/export`.  
- **Erreurs** : schéma commun `{code, message, traceId, details[]}` ; 422/429/409/500.  
- **Limites** : `limit`/`next_cursor`, `Retry-After` (429).  
- **Sécurité** : clé `k` (header), vérification Referer (origin whitelist).

---

## 8) Sécurité & Embed (CSP)
### 8.1 Authentification, secrets, audit
- **V1** : clé `k` + **Referer check** + `frame-ancestors` (embed contrôlé).  
- **Secrets** : **KMS**, rotation ≥ trimestrielle, jamais côté front.  
- **Rate limiting** : par IP/clé (429) ; `traceId` systématique.  
- **Audit** : journaux consultables **90 jours** (accès, exports).  
- **V2** (option) : **OIDC** + **RBAC** fin.

### 8.2 CSP & tuiles carto (IGN Géoportail) — **WARNING**
- Politique stricte : `default-src 'none'` ; `script-src 'self'` ; `style-src 'self' 'unsafe-inline'` (temporaire) ; `img-src 'self' data:` ; `connect-src 'self'` ; `frame-ancestors 'none'`.  
- **IGN Géoportail** : peut exiger **whitelist** de domaines tuiles dans `img-src`/`connect-src` **ou** **auto‑hébergement** (MBTiles/proxy).  
- **Test d’acceptation** : carte **fonctionne CSP ON** avec la stratégie choisie (voir §12).

---

## 9) Performances & budgets
- **Budgets** : CSS≤150 Ko gz/vue ; JS≤100 Ko gz/vue ; LCP≤2.5 s ; TTI≤1.5 s ; interactivité courbes p95≤1 s ; carte p95≤200 ms (500–2000 obj).  
- **Build** : extraction **critical CSS**, **externalisation** des feuilles, `defer` JS, **code‑split** par vue.  
- **Mesure** : Lighthouse (CI) ≥ 90 Perf/A11y/Best Practices, Web Vitals (RUM).

---

## 10) Chat LLM (analyse & QA)
- **Portée** : analyse guidée, suggestions d’actions **non contraignantes**.  
- **Traçabilité** : stocker prompts & sorties (durée définie), **ancrage** « Voir sur la courbe » (scroll/zoom intervalle cité).  
- **A11y** : pile messages `aria-live="polite"`, champ avec label, envoi `Ctrl+Enter`.

---

## 11) Contrôle qualité (ingéré)
- **Bornes** : Dépression **[−300 mbar ; 0 mbar]** ≈ [−30 000 Pa ; 0 Pa], Vitesse [0–30] m/s, Gaz : CH₄ [0–70] %, CO₂ [0–70] %, O₂ [0–10] %.  
- **Somme gaz** : CH₄+CO₂+O₂ ∈ [95–101] → **warning**.  
- **Incohérences** : ouverture↑ & Q↓ sans ΔP, v≈0 prolongé, capteur “flat”.  
- **Flags** : par point `rule_id`, `evidence`, `confidence`, exportables.

---

## 12) Tests d’acceptation
1. **A11y sémantique** : landmarks, titres, labels présents ; tabbing complet (y c. modal) ; `Esc` ferme modal/chat ; focus retourné.  
2. **Responsive** : utilisable en 360×640, 768×1024, 1440×900 ; grilles auto‑fit.  
3. **Courbes** : 3 axes visibles par défaut (G1, G2, D1) ; D2/D3 activables ; légende intelligente sur‑surbrille l’axe.  
4. **Unités** : toggle mbar↔Pa cohérent (labels, tooltips, exports).  
5. **CSP×IGN** : la carte charge avec **CSP activée** via whitelist **ou** auto‑hébergement (preuve par capture & logs).  
6. **Perf** : budgets respectés (Lighthouse≥90, p95 latences).  
7. **Chat** : `aria-live`, `Ctrl+Enter`, ancrage « Voir sur la courbe ».

---

## 13) Backlog (lots & DoD)
- **Lot A – Fondations** : landmarks, labels, modal accessible. **DoD** : tabbing complet + `Esc`.  
- **Lot B – Carte** : outils accordéon mobile, test CSP×IGN. **DoD** : preuve de chargement CSP ON.  
- **Lot C – Courbes** : 3 axes par défaut + toggles + légende intelligente. **DoD** : test de survol/axe actif.  
- **Lot D – Layout** : grilles responsive 3 breakpoints. **DoD** : captures S/M/L.  
- **Lot E – Perf** : budgets + split + critical CSS. **DoD** : Lighthouse≥90 Perf.  
- **Lot F – Chat** : aria‑live + raccourcis. **DoD** : test clavier.  
- **Lot G – QA** : flags enrichis, export anomalies. **DoD** : CSV avec `rule_id/evidence/confidence`.

---

## 14) Annexes — Pseudocode D3
```css
/* Légende intelligente : axe actif */
.axis--active .tick text { font-weight: 700; }
.axis--active .domain, .axis--active .tick line { opacity: 1; }
```
```js
// Au survol d’une série, activer l’axe correspondant
function highlightAxis(axisId) {
  document.querySelectorAll('.axis').forEach(a => a.classList.remove('axis--active'));
  document.getElementById(axisId)?.classList.add('axis--active');
}
```

---

## 15) Notes d’intégration (FastAPI / Front)
- **Payload séries** : inclure `unit` (SI), `unitDisplayDefault`, `axis` suggéré, `tz`.  
- **Exports** : CSV/PNG + **lien partage** (état encodé).  
- **Journalisation** : `traceId` propagé front→API→logs.

---

## 16) Design system & tokens (détails)
```css
:root {
  /* Couleurs (exemple) */
  --bg: #0b0f14; --panel: #121821; --text: #e6edf3; --muted: #9fb0c0;
  --brand: #4f83ff; --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;

  /* Espacements */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 40px; --space-8: 48px;

  /* Typo scale */
  --fs-200: 12px; --fs-300: 14px; --fs-400: 16px; --fs-500: 18px;
  --fs-600: 20px; --fs-700: 24px; --fs-800: 28px; --fs-900: 32px;

  /* Divers */
  --r-1: 6px; --r-2: 10px; --r-3: 14px;
  --t-fast: 120ms; --t-med: 200ms; --t-slow: 320ms;
  --z-nav: 100; --z-modal: 1000;
}
/* États & accessibilité */
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

---

## 17) SEO & PWA (option)
- **Meta** description (≤ 160 caractères), **Open Graph** (titre/description), **favicon**, **manifest.json** (icônes, `theme_color`).

---

### ✅ Prochaines étapes
1. Implémenter **landmarks + labels + modal accessible** (Lot A).  
2. **Légende intelligente** & **toggle axes** (Lot C).  
3. **Grilles responsive** (Lot D).  
4. **CSP×IGN** : décider stratégie (whitelist vs MBTiles/proxy) & tester (Lot B).  
5. **Budgets & build** (Lot E).
