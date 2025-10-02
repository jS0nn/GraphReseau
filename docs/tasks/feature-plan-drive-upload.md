# Plan import depuis Drive - Suivi des taches

## Backend
- [x] Etendre le modele `PlanOverlayMedia` avec les identifiants PNG dedies.
- [x] Mettre en cache la preference pour les PNG stockes cote Drive.
- [x] Ajouter un client Drive generique et le service d'import (listage + conversion + upload).
- [x] Etendre la couche Sheets pour stocker les nouveaux identifiants et champs associes.
- [x] Exposer les routes API (`drive-files`, `import`, `upload`).
- [x] Ajouter des tests unitaires/mocks pour la logique d'import Sheets/Drive.

## Frontend
- [x] Ajouter les appels API pour Drive et l'upload local.
- [x] Integrer un bouton "Importer" avec un dialogue d'upload local clair.
- [x] Rafraichir le plan apres import et laisser l'UI accessible meme sans plan configure.
- [x] Ajouter un bouton de suppression du plan courant et retirer le slider d'echelle.
- [ ] Ajouter des tests cibles (composant modal / store).

## Documentation & validation
- [x] Creer ce fichier de suivi.
- [x] Documenter la procedure d'import dans `NOTICE_IMPLEMENTATION.md` / README.
- [ ] Preparer la checklist QA (tests manuels, scenarios d'erreur Drive/Sheets).
