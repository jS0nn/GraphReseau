# Cahier des charges — Surcouche Plan géoréférencé

## 1. Contexte et vision
- L’éditeur réseau dispose déjà d’une carte Leaflet (fond IGN ou autre WMTS) activée lorsqu’une URL de tuiles est fournie.
- Les opérateurs souhaitent superposer un plan issu de documents PDF/PNG afin de redessiner le réseau en s’appuyant sur la cartographie métier.
- Les plans seront stockés dans Google Drive dans un premier temps (migration vers Cloud Storage envisagée par la suite).

## 2. Objectifs fonctionnels
1. Afficher une surcouche d’image par-dessus le fond Leaflet.
2. Permettre d’activer/désactiver indépendamment le fond IGN et le plan.
3. Ajuster dynamiquement l’opacité de la surcouche (0 % → 100 %).
4. Ajuster la rotation de l’image (uniquement la surcouche, la carte garde l’orientation Nord).
5. Conserver pan & zoom Leaflet pour le fond et l’overlay.
6. Enregistrer la configuration du plan (fichier et paramètres) dans Google Sheets pour chaque site.

## 3. Hypothèses et contraintes
- Leaflet ≥ 1.9.4 (déjà bundle local).
- Les plans sont raisonnablement légers (< 10 Mo) ; pas de découpe en tuiles pour V1.
- Le plan est géoréférencé au moyen de ses quatre coins (LatLng SW, SE, NW, NE). Un ajustement manuel hors application (GDAL, DistortableImage…) doit précéder l’import.
- L’application devra pouvoir télécharger le fichier depuis Drive via l’API (ADC impersonant un SA disposant de l’accès au fichier).
- À terme, le fichier sera hébergé sur Cloud Storage ; la conception doit isoler la logique d’accès pour limiter le refactor.

## 4. Données et configuration
### 4.1. Google Sheets — nouvel onglet
Dans le classeur Google Sheets principal (ex. `10y5y_3H-3qKzQmY8lx9wevIXXbkWfIU-Qx2uyaaw6Bg`), créer un onglet `PlanOverlay` avec les colonnes suivantes :
- `site_id` — identifiant du site (clé étrangère vers la topologie).
- `display_name` — libellé humain.
- `drive_file_id` — identifiant du fichier Google Drive (ou URL publique pour tests).
- `media_type` — `image/png`, `image/jpeg`… (utile quand on migrera vers GCS).
  - `media_type` — `image/png`, `image/jpeg`, ou `application/pdf` (les PDF sont convertis automatiquement en PNG côté API).
- `opacity` — valeur par défaut (0.0 → 1.0).
- `bearing_deg` — rotation initiale par défaut (en degrés, sens horaire).
- `corner_sw_lat`, `corner_sw_lon`, `corner_se_lat`, `corner_se_lon`, `corner_nw_lat`, `corner_nw_lon`, `corner_ne_lat`, `corner_ne_lon` — coordonnées GPS.
- `enabled` — booléen pour activer/désactiver le plan.

## 15) Édition interactive depuis l’UI

- L’onglet plan apparaît dans la barre d’outils dès qu’un plan actif est détecté (mode `rw`).
- Cliquer sur `Plan` pour afficher le plan, puis maintenir `Alt` enfoncé tout en faisant glisser la poignée centrale pour déplacer l’image sans déplacer la carte.
- Les quatre poignées d’angle (avec `Alt` maintenu) redimensionnent maintenant le plan de manière uniforme (pas de déformation). Les interactions sont indisponibles en mode lecture (`mode=ro`) ou si le plan est masqué.
- Utiliser le curseur d’échelle (25 % → 200 %) pour ajuster la taille globale du plan ; les valeurs sont rappelées tant que la session n’est pas rechargée.
- La rotation peut être saisie au dixième de degré via le champ numérique (le slider reste disponible pour un réglage rapide).
- Un indicateur “modifications non sauvegardées” apparaît tant que les coins n’ont pas été enregistrés.
- Le bouton `Sauver plan` persiste les nouvelles coordonnées (colonnes `corner_*_lat` / `corner_*_lon`) et la rotation (`bearing_deg`) dans l’onglet Google Sheets.
- Le bouton reste actif même si le plan est temporairement masqué, tant qu’il y a des modifications en attente.
- En cas d’erreur Sheets, le message s’affiche dans la barre de statut du plan sans bloquer les autres contrôles.

Exemple de ligne pour le plan fourni (`drive_file_id = 1L8UeFzpk2exb3PW4dk9mKQq76V5j2rk2`) :

| site_id | display_name | drive_file_id | media_type | opacity | bearing_deg | corner_nw_lat | corner_nw_lon | corner_ne_lat | corner_ne_lon | corner_sw_lat | corner_sw_lon | corner_se_lat | corner_se_lon | enabled |
| ------- | ------------- | ------------- | ---------- | ------- | ----------- | ------------- | ------------- | ------------- | ------------- | ------------- | ------------- | ------------- | ------------- | ------- |
| DER-001 | Plan réseaux 2024 | 1L8UeFzpk2exb3PW4dk9mKQq76V5j2rk2 | image/png | 0.7 | 0 | 48.8600 | 2.3300 | 48.8602 | 2.3356 | 48.8575 | 2.3298 | 48.8577 | 2.3354 | TRUE |

> Ajuster les coordonnées (`corner_*`) et l’orientation (`bearing_deg`) d’après le géoréférencement réel du plan.

### 4.2. Backend — modèle de configuration
- Lire l’onglet `PlanOverlay` lors du chargement du graph (GET `/api/graph`).
- Retourner un objet `plan_overlay` contenant :
  ```json
  {
    "enabled": true,
    "display_name": "Plan 2024",
    "media": {
      "type": "image/png",
      "source": "drive",
      "drive_file_id": "..."
    },
    "bounds": {
      "sw": {"lat": 48.123, "lon": 2.456},
      "se": {"lat": 48.120, "lon": 2.462},
      "nw": {"lat": 48.129, "lon": 2.451},
      "ne": {"lat": 48.126, "lon": 2.457}
    },
    "defaults": {
      "opacity": 0.7,
      "bearing_deg": 12
    }
  }
  ```
- Implémenter un fetch Drive simple (download binaire via `googleapiclient.discovery`) avec cache en mémoire (TTL configuré) pour limiter les allers/retours.
- Prévoir déjà une abstraction `PlanMediaFetcher` pour remplacer Drive par GCS ultérieurement.

## 5. Architecture côté frontend
1. **Chargement** : au boot, si `plan_overlay.enabled` est vrai, déclencher une requête `GET /api/plan-overlay/media` (nouvel endpoint, voir §6) pour récupérer l’image en binaire (ou URL signée) puis la convertir en blob URL.
2. **Affichage** : créer un `L.ImageOverlay` (ou plugin `leaflet-rotatedimage`) appliqué aux coins fournis. Stocker la couche dans `L.LayerGroup` distincte du fond.
3. **Rotation** : utiliser un plugin de rotation sur image overlay ; si indisponible, fallback en repositionnant l’overlay via transformation affine (calcul depuis coins).
4. **Opacité** : slider UI (0 → 100 %) connecté à `overlay.setOpacity(value)` et persisté en `localStorage`.
5. **Contrôles UI** : ajouter à la toolbar existante un bouton « Plan » (toggle) + slider opacité + champ rotation (boutons ±1° et reset). Les contrôles doivent rester accessibles clavier.
6. **Sync événements** : sur `map.move`/`map.zoom`, l’overlay Leaflet suit nativement ; aucune action supplémentaire nécessaire.
7. **Interdépendance** : le bouton « Fond » existant doit simplement masquer le `tileLayer`. Le plan doit pouvoir rester visible même si le fond est masqué.

## 6. API backend
- `GET /api/plan-overlay/config` — renvoie le JSON décrit §4.2 pour le site courant.
- `GET /api/plan-overlay/media` — stream du fichier image (MIME correct, cache HTTP). Possibilité de renvoyer une URL signée lors du passage à GCS.
- Les deux endpoints respectent `mode=ro|rw` et les mêmes règles d’authentification que `/api/graph`.
- Gérer les erreurs : 404 si plan non configuré, 502 si téléchargement Drive échoue.

## 7. Sécurité & conformité
- Autoriser le domaine Drive (ou GCS) dans la CSP (`img-src` & `connect-src`).
- Ajouter une limite de taille sur le téléchargement Drive (ex. 20 Mo) et logs en cas de dépassement.
- Vérifier l’ACL du fichier Drive : il doit être partagé avec le Service Account utilisé par l’API.

## 8. Expérience utilisateur
- Indiquer l’état du plan (activé/désactivé) dans l’UI, avec le nom du plan.
- Sauvegarder les préférences UI (opacité, rotation) côté navigateur, avec option « rétablir valeurs par défaut ».
- Lorsque l’overlay n’a pas pu se charger, afficher un toast/log explicite.

## 9. Tests & validation
- **Unitaires** :
  - Parser la nouvelle feuille `PlanOverlay` et produire le JSON attendu.
  - Télécharger un fichier Drive factice (mock) et vérifier la mise en cache.
- **Intégration** :
  - Vérifier l’alignement des quatre coins sur des points de repère.
  - Contrôler que la rotation du plan n’affecte ni la carte Leaflet ni les projections des nœuds.
  - Test d’opacité (0 %, 50 %, 100 %) et persistance via rechargements.
- **Non régression** :
  - Map + graph rendent toujours correctement sans plan configuré.
  - Le bouton « Fond » continue de fonctionner comme aujourd’hui.

## 10. Évolutions futures (hors V1)
- Remplacement de Drive par Cloud Storage (upload automatisé, URL signée).
- Outil d’alignement manuel intégré (Leaflet.DistortableImage) pour calculer les coins.
- Support de plans tuilés (gros fichiers) via `gdal2tiles` + CDN.
- Association de plusieurs plans par site avec gestion de l’ordre d’empilement.
