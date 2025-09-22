# Guide pratique – Ajouter un endpoint API

## 1. Définir le besoin
- Choisir le verbe HTTP et la ressource.
- Identifier les données manipulées et les permissions.

## 2. Créer/étendre un routeur
```python
router = APIRouter(prefix="/api/graph", tags=["graph"])

@router.post("/my-feature", response_model=MyResponseModel)
def my_feature(payload: MyPayload):
    ...
```
- Enregistrer le routeur dans `app/main.py` via `app.include_router`.

## 3. Modèles & validation
- Définir les modèles Pydantic (`app/models.py` ou module dédié).
- Réutiliser `Graph` si pertinent.
- Ajouter la logique de validation dans `app/shared/graph_transform.py` si nécessaire.

## 4. Logique métier
- S’appuyer sur `app/datasources/` ou un service dédié (`app/services/`).

## 5. Documentation
- Mettre à jour `../reference/api/openapi.yaml`.
- Créer/mettre à jour le JSON Schema dans `../reference/schemas/`.

## 6. Tests
- Ajouter un test API (`tests/test_api_contract.py`).
- `python -m unittest` + tests manuels (`curl`).

## 7. Documentation complémentaire
- Mettre à jour `../data-contracts/data-catalog.md`.
- Ajouter la référence dans `../TRACEABILITY.md`.

## 8. Livraison
- Vérifier `uvicorn` en local.
- Préparer la PR (impacts, migrations, doc).

⚠️ TODO : intégrer un middleware d’autorisation (RBAC V2).
