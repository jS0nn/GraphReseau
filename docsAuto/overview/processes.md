# Processus métier

Cette section décrit les parcours métier cibles et leurs points de contrôle. Les diagrammes Mermaid utilisent une notation « BPMN allégée » : les nœuds ronds représentent des événements, les rectangles des tâches, les losanges des décisions. Les couleurs sont symbolisées via des libellés.

## Processus 1 — Mettre à jour un réseau via l’éditeur
1. L’exploitant ouvre le lien iframe (`/embed/editor?k=...`).
2. Le frontend charge le graphe (`GET /api/graph`).
3. L’opérateur modifie nœuds/arêtes, déclenche éventuellement un recalcul (`POST /api/graph/branch-recalc`).
4. Il sauvegarde (`POST /api/graph`), ce qui met à jour la source active (Sheets/GCS).
5. Un export JSON optionnel est généré côté frontend.

```mermaid
flowchart LR
    A((Début)) --> B[Ouvrir l'iframe /embed/editor]
    B --> C{Clé & Referer valides ?}
    C -- Non --> X[Refus HTTP 403]
    C -- Oui --> D[GET /api/graph]
    D --> E[Affichage du réseau]
    E --> F{Modification du graphe ?}
    F -- Non --> H[Fin (consultation)]
    F -- Oui --> G[POST /api/graph/branch-recalc (optionnel)]
    G --> I[POST /api/graph]
    I --> J{Écriture réussie ?}
    J -- Non --> K[Diagnostique / tests]
    J -- Oui --> L[Export JSON (facultatif)]
    L --> M((Fin sauvegarde))
```

## Processus 2 — Publier et auditer un graphe partagé
1. Un data steward prépare un environnement (ADC/impersonation, clé d’embed).
2. Il configure les variables (`.env`, Google Sheets partagé).
3. Il lance l’API FastAPI (`uvicorn ... --env-file .env.dev`).
4. Il met en place un référentiel d’audit (logs, sauvegarde GCS).
5. Les utilisateurs métier consomment l’iframe ; la supervision vérifie les journaux (`../observability/logging-audit-map.md`).

```mermaid
flowchart LR
    S((Start)) --> P1[Configurer ADC / IAM]
    P1 --> P2[Définir .env (SHEET_ID_DEFAULT, EMBED_STATIC_KEY)]
    P2 --> P3[Lancer uvicorn avec .env]
    P3 --> P4[Configurer sauvegarde GCS JSON / BigQuery lecture]
    P4 --> P5[Publier iframe dans Looker Studio / Sites]
    P5 --> P6{Logs complets ?}
    P6 -- Non --> P7[Adapter logging/audit map]
    P6 -- Oui --> P8((Fin publication))
```

⚠️ TODO: documenter un processus d’escalade incident (astreinte) lorsque l’API retourne des 5xx répétés.
