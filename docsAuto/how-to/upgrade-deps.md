# Guide pratique – Mettre à jour les dépendances

## 1. Préparation
- Synchroniser la branche (`git pull`).
- Créer `upgrade/deps-YYYYMMDD`.

## 2. Dépendances Python
```bash
source .venv/bin/activate
pip install -U -r requirements.txt
pip freeze > requirements.lock.txt  # si utilisé
python -m unittest
```

## 3. Dépendances Node.js
```bash
npm install
npm outdated
npm update
npm install pkg@latest  # mise à jour ciblée
npm run build
```

## 4. Vérifications fonctionnelles
- Charger l’iframe, exécuter un cycle GET/POST.
- Vérifier la CSP et les connecteurs (Sheets/GCS/BQ).

## 5. Documentation
- Mettre à jour les versions citées dans `README.md` si nécessaire.
- Ajouter une entrée dans `../TRACEABILITY.md`.
- Documenter les risques éventuels dans `../DRIFT.md`.

## 6. Livraison
- Vérifier `npm run build` + `python -m unittest`.
- Préparer la PR (versions avant/après, tests, risques).
- ⚠️ TODO : pipeline CI pour automatiser tests + build.

> Pour les libs Google (`google-auth`, etc.), valider l’IAM (`app/gcp_auth.py`).
