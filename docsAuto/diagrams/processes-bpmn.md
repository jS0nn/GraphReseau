# Processus (Mermaid BPMN simplifié)

```mermaid
flowchart LR
    start((Début)) --> prepare[Collecter accès ADC & Secrets]
    prepare --> configure[Configurer .env (.env.dev / prod)]
    configure --> launch[Lancer FastAPI (uvicorn)]
    launch --> loadGraph[GET /api/graph (source: sheet/gcs/bq)]
    loadGraph --> edit{Modifications nécessaires ?}
    edit -- Non --> view[Consultation simple]
    view --> finish((Fin))
    edit -- Oui --> recalc[POST /api/graph/branch-recalc]
    recalc --> save[POST /api/graph (sauvegarde)]
    save --> ok{Sauvegarde OK ?}
    ok -- Oui --> export[Export JSON (optionnel)]
    export --> finish
    ok -- Non --> diagnose[Diagnostiquer (logs/tests)]
    diagnose --> finish
```

⚠️ TODO : ajouter un processus incident (alerte, rollback) et un workflow de rotation automatique des secrets.
