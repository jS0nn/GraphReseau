Salut Codex, j’ai besoin de ton aide pour intégrer une couche d’authentification Google notre une application déployée sur Cloud Run. L’objectif est que chaque utilisateur n’accède qu’aux données qui lui sont destinées. On va créer un fichier de tâches qui liste les étapes : implémenter l’authentification Google, configurer les autorisations IAM pour les utilisateurs non-Google, et vérifier que chaque utilisateur ne voit que les sites auxquels il a accès. Une fois ce fichier de tâches créé, on va suivre l’avancée et cocher les étapes au fur et à mesure. Allons-y étape par étape et de manière claire.

version ++:
Parfait, voici un **prompt prêt à copier-coller pour Codex**, ajusté à ton contexte exact. Il inclut la création d’un fichier de tâches que Codex devra générer et tenir à jour.

---

## Prompt pour Codex

Tu es pair‑programmeur sur un projet **Éditeur Réseau** qui migre d’Apps Script vers **FastAPI sur Cloud Run**. Objectif : intégrer **authentification** et **contrôles d’accès par site** tout en conservant un **embed iFrame en lecture seule** compatible **Looker Studio / Google Sites** (pas d’auth interactive dans l’iframe en V1).

### Contexte technique (à respecter)

* **Backend**: FastAPI (Cloud Run, scale-to-zero), accès Google Sheets via **ADC** (pas de JSON de SA).
* **Frontend**: JS vanilla (D3/ELK) bundlé par **esbuild**; assets locaux (pas de CDN).
* **iFrame (V1)**: page `/embed/editor` sécurisée par **clé statique** (`EMBED_STATIC_KEY`) + **vérif de Referer** + **CSP** (`frame-ancestors`), **lecture seule**.
* **Sources de données**: `sheet` (par défaut), `gcs_json`, `bigquery`, interchangeables via query/env.
* **Filtrage par site**: paramètre `site_id` (et `REQUIRE_SITE_ID=1` possible).
* **Arborescence cible** (à conserver) :

  ```
  app/
    main.py
    config.py
    models.py
    sheets.py
    auth_embed.py
    shared/graph_transform.py
    routers/
      api.py
      embed.py
    templates/index.html
    static/bundle/
    static/vendor/
  web/
    index.html
    styles/
    types/
    src/
      shared/
  ```
* **Déploiement**: Cloud Run (voir doc interne), CSP avec `frame-ancestors` et sans `X-Frame-Options`.

---

## Mission

1. **Finaliser V1 “embed sécurisé”** (clé statique + referer + CSP) côté backend et l’appliquer strictement à la route `/embed/editor` ET aux appels d’API déclenchés par cette page en mode lecture seule.

2. **Ajouter une Auth “utilisateur” hors iFrame** (pour l’éditeur complet) :

   * **Option A (recommandée court terme)**: Vérification côté backend d’un **ID token Google** (OAuth client côté front). Extraction email + domaine. Restriction optionnelle par domaine.
   * **Option B (préparer l’interface, implémentation ultérieure)**: Support **Identity Platform** (OIDC/email+password) pour clients non‑Google. L’interface doit être indépendante du fournisseur d’ID et reposer sur la vérification d’un JWT et l’extraction d’un `sub`/`email`.

3. \*\*Mettre en place l’\*\*autorisation par **site\_id** (RBAC minimal) :

   * Politique **User → Sites autorisés** (lecture / écriture).
   * V1 simple: mapping en **GCS JSON** (par défaut) + fallback **env JSON**; interface extensible vers **BigQuery** plus tard.
   * Enforcement côté **GET/POST /api/graph** :

     * Lecture: ne renvoyer que le sous‑ensemble du graphe pour `site_id` autorisé.
     * Écriture: refuser si `site_id` absent/non autorisé.

4. **Créer et tenir à jour un fichier de tâches** dédié à cette intégration.

---

## Contraintes & exigences

* **Pas d’auth interactive dans l’iFrame**. Le mode embed reste en lecture seule, protégé par `k=<EMBED_STATIC_KEY>` + Referer + CSP.
* Les endpoints d’édition restent **hors iFrame** et exigent un **JWT valide** (Option A Google OAuth en V1).
* **Cloud Run** peut rester `--allow-unauthenticated` ; l’app **doit** faire ses propres contrôles d’accès au niveau des routes.
* **Logs d’audit** (email/utilisateur, site\_id, action, statut) côté backend.
* **Tests unitaires** pour l’auth embed, la vérification de token, et l’enforcement par site.
* **Documentation** des variables d’environnement ajoutées et du flux d’auth.

---

## À produire (livrables concrets)

1. **Nouveaux modules / modifications**

   * `app/auth_embed.py`

     * Fonctions: `require_embed_key()`, `require_allowed_referer()`, `embed_guard(mode="ro")` (dépendance FastAPI).
   * `app/auth_user.py` (nouveau)

     * Interfaces communes: `verify_jwt(token) -> UserClaims`, `get_current_user()` (FastAPI dependency).
     * Implémentation Option A: vérif ID token Google via clé `GOOGLE_OAUTH_CLIENT_ID`.

       * Extraction `email`, `hd` (hosted domain), `sub`.
       * Filtrage optionnel par domaines (`ALLOWED_GOOGLE_DOMAINS`).
     * **Préparer** stub Option B (Identity Platform): `verify_jwt_idp(token, project_id, tenant)`.
   * `app/policy.py` (nouveau)

     * Interface `PolicyStore` + impl. V1 `GcsJsonPolicyStore`, `EnvJsonPolicyStore`.
     * API: `get_allowed_sites(email)->set[str]`, `get_role(email, site_id)->Literal["viewer","editor","none"]`.
   * `app/config.py`

     * Ajouter variables:

       * Auth user: `ENABLE_USER_AUTH=1`, `GOOGLE_OAUTH_CLIENT_ID`, `ALLOWED_GOOGLE_DOMAINS="acme.com example.org"`.
       * Identity Platform (facultatif pour plus tard): `IDP_AUDIENCE`, `IDP_TENANT`, `IDP_ISSUER`.
       * Policy: `POLICY_SOURCE=gcs_json|env_json`, `POLICY_GCS_URI=gs://.../policy.json`, `POLICY_ENV_JSON='{"user@acme.com":["356c469e"]}'`.
   * `app/routers/embed.py`

     * Protéger GET `/embed/editor` par `embed_guard(mode="ro")`.
   * `app/routers/api.py`

     * **Deux chemins**:

       * Mode embed (`mode=ro` ou header spécial) → **pas** de JWT, **exige** clé `k` + referer + CSP.
       * Mode app (éditeur) → **exige** JWT valide (Option A), extrait `email`.
     * Dans tous les cas: appliquer le **filtrage par `site_id`** et **REQUIRE\_SITE\_ID** si activé.
     * POST: refuser si rôle ≠ `editor` pour le `site_id` demandé.
   * `app/models.py`

     * Ajouter `UserClaims(email:str, sub:str, domain:Optional[str])` et `Role(str)`.
   * `app/main.py`

     * Middleware CSP déjà présent: ajouter `connect-src/img-src` dynamiques pour tuiles de fond si `MAP_TILES_URL` est défini.
     * Route `GET /whoami` (debug/dev) : renvoie identité détectée (embed vs user).

2. **Fichier de tâches**
   Créer `tasks/TASKS_AUTH.md` avec le contenu initial ci‑dessous et le **tenir à jour** (cocher `[x]` au fur et à mesure, ajouter liens PR/commits).

3. **Tests**

   * `tests/test_auth_embed.py` : clé + referer + CSP.
   * `tests/test_auth_user_google.py` : vérif ID token (mock), domaine autorisé.
   * `tests/test_policy_enforcement.py` : mapping email→sites, GET/POST conformes.
   * `tests/test_api_contract_auth.py` : réponses 401/403/200 selon cas.

4. **Docs**

   * Mettre à jour `docs/NOTICE_DEPLOIEMENT_CLOUD_RUN.md` : nouvelles env vars, exemples `--set-env-vars`, politique Policy GCS, exemple de JSON.
   * Ajouter `docs/auth-flows.md` (schémas de séquence simples).

---

## Contenu initial du fichier `tasks/TASKS_AUTH.md` (à créer)

```md
# Tâches – Auth & Autorisations (Éditeur Réseau)

## Contexte
- Embed iFrame lecture seule (/embed/editor) : clé statique + referer + CSP.
- Application éditeur hors iFrame : JWT utilisateur (Option A Google OAuth), authorization par site_id.
- Policy Store: V1 GCS JSON (fallback env JSON), extensible BQ.

## Backlog & Suivi

### Phase 1 — Embed sécurisé (RO)
- [ ] `auth_embed.py` : guards `require_embed_key`, `require_allowed_referer`, `embed_guard(mode="ro")`.
- [ ] `embed.py` : appliquer guard sur `/embed/editor`.
- [ ] CSP/headers : vérifier `frame-ancestors` + suppression `X-Frame-Options`.
- [ ] Tests `test_auth_embed.py`.
- [ ] Docs : section Embed dans `NOTICE_DEPLOIEMENT_CLOUD_RUN.md`.

### Phase 2 — Auth utilisateur (éditeur hors iFrame)
- [ ] `auth_user.py` : `verify_jwt_google(id_token, client_id)` + `get_current_user()`.
- [ ] `config.py` : `GOOGLE_OAUTH_CLIENT_ID`, `ALLOWED_GOOGLE_DOMAINS`.
- [ ] Route `GET /whoami` (dev).
- [ ] Tests `test_auth_user_google.py`.
- [ ] Docs : `docs/auth-flows.md` (diagramme + variables).

### Phase 3 — Autorisation par site
- [ ] `policy.py` : `PolicyStore` + `GcsJsonPolicyStore` + `EnvJsonPolicyStore`.
- [ ] `api.py` : enforcement GET/POST selon `site_id` + rôle (`viewer`/`editor`).
- [ ] `config.py` : `POLICY_SOURCE`, `POLICY_GCS_URI`, `POLICY_ENV_JSON`.
- [ ] Tests `test_policy_enforcement.py` + `test_api_contract_auth.py`.
- [ ] Logs d’audit (email, site_id, action, status).

### Phase 4 — Intégration & déploiement
- [ ] `.env.dev` : exemples variables (client_id, domains, policy env json).
- [ ] `NOTICE_DEPLOIEMENT_CLOUD_RUN.md` : MAJ `--set-env-vars`.
- [ ] Vérifs e2e : 
  - [ ] iFrame RO fonctionne (clé correcte + referer autorisé).
  - [ ] iFrame RO bloque en absence de clé ou referer.
  - [ ] Éditeur hors iFrame : JWT requis, domaine OK.
  - [ ] Filtrage par `site_id` appliqué (GET), écriture bloquée si non autorisée (POST).

## Notes / Liens
- PRs :
- Commits :
- Décisions :
```

---

## Détails d’implémentation (précis)

* **Vérification Google ID Token (Option A)**

  * Côté front (éditeur hors iFrame) : obtenir un **ID token Google** via le client OAuth (`GOOGLE_OAUTH_CLIENT_ID`).
  * Côté backend : `verify_jwt_google(token, client_id)` (lib Python Google) → `email`, `hd` (domaine), `sub`.
  * Refuser si `ALLOWED_GOOGLE_DOMAINS` est défini et ne matche pas.
  * Endpoint protégé : `Depends(get_current_user)`.

* **Policy Store (V1 GCS JSON)**

  * Format JSON simple :

    ```json
    {
      "user1@acme.com": { "viewer": ["356c469e"], "editor": ["abc123"] },
      "client@ext.org": { "viewer": ["xyz789"], "editor": [] }
    }
    ```
  * Chargement au démarrage + rafraîchissement périodique optionnel (TTL simple).

* **Enforcement /api/graph**

  * Lecture (`GET`) :

    * Si **mode embed** (détecté par présence de clé `k` et guard): bypass JWT, **forcer `mode=ro`**.
    * Sinon: JWT requis, `email` extrait.
    * Appliquer filtre `site_id` (requis si `REQUIRE_SITE_ID=1`, sinon `SITE_ID_FILTER_DEFAULT` possible).
    * Si `site_id` non autorisé pour l’utilisateur: `403`.
  * Écriture (`POST`) :

    * JWT requis.
    * `site_id` requis et dans la liste `editor`. Sinon `403`.

* **CSP / Headers**

  * `frame-ancestors` configuré via `ALLOWED_FRAME_ANCESTORS`.
  * Autoriser dynamiquement les origines tuiles (`MAP_TILES_URL`) pour `img-src`/`connect-src`.
  * `X-Frame-Options` supprimé.

* **Variables d’environnement (nouvelles)**

  * `ENABLE_USER_AUTH=1`
  * `GOOGLE_OAUTH_CLIENT_ID=`
  * `ALLOWED_GOOGLE_DOMAINS="exemple.com autre.org"` (optionnel)
  * `POLICY_SOURCE=gcs_json|env_json`
  * `POLICY_GCS_URI=gs://bucket/policy.json`
  * `POLICY_ENV_JSON='{"user@ex.com":{"viewer":["356c469e"],"editor":[]}}'`

* **Diagnostics**

  * `GET /whoami` : renvoie `{ "mode": "embed|user|anon", "email": "...", "domain": "...", "sites": ["..."], "roles": {...} }` en dev uniquement (désactivable en prod).

---

## Tests à écrire (résumés)

* `test_auth_embed.py` :

  * OK si `k` correcte + Referer autorisé.
  * 403 si `k` absente/mauvaise, ou Referer non autorisé.
* `test_auth_user_google.py` :

  * 401 si pas de token.
  * 403 si domaine non autorisé.
  * 200 si token valide + domaine OK.
* `test_policy_enforcement.py` :

  * GET filtré au bon `site_id`.
  * POST refusé si rôle viewer / site non autorisé.
* `test_api_contract_auth.py` :

  * Matrice de cas (embed vs user, GET/POST, site\_id présent/absent).

---

## Acceptation (Definition of Done)

* iFrame `/embed/editor` fonctionne en **RO** dans Looker/Sites avec clé et referer valides.
* Endpoints d’édition refusent les requêtes sans JWT valide.
* Filtrage par `site_id` effectif pour toutes les sources (`sheet/gcs_json/bigquery`).
* `tasks/TASKS_AUTH.md` **créé et coché** au fil des PRs.
* Documentation et exemples d’env mis à jour.

---

**À exécuter maintenant :**

1. Créer `tasks/TASKS_AUTH.md` avec le contenu fourni.
2. Ajouter `auth_user.py`, `policy.py`, et modifier `api.py`/`embed.py`/`config.py`/`main.py` selon les points ci‑dessus.
3. Ajouter les tests et les faire passer.
4. Mettre à jour la doc de déploiement avec les nouvelles env vars.

---

Fin du prompt.





