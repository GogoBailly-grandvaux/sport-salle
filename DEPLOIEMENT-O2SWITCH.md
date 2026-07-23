# 🚀 Déployer Sport Salle sur o2switch (avec ton domaine)

Objectif : l'app **et** sa base de données chez toi — `https://hbaillyg.fr`
(ou le domaine que tu choisis), synchro incluse, zéro service tiers.

## 0. Commander l'hébergement (une fois)

1. Va sur **o2switch.fr** → choisis l'offre (l'« Offre Cloud » de base suffit très largement).
2. Pendant la commande, coche **« nom de domaine offert »** et saisis le domaine
   souhaité : `hbaillyg.fr` (ou `.com`). Il est inclus avec l'hébergement.
3. Termine la commande toi-même (paiement). Tu reçois ensuite un email avec
   l'accès à ton **cPanel**.

> 💡 Le certificat HTTPS (Let's Encrypt) est automatique chez o2switch,
> généralement actif quelques minutes après l'ouverture du compte.
> **HTTPS est obligatoire** pour installer une PWA — c'est géré tout seul.

## 1. Créer la base de données (2 min)

Dans cPanel → **Bases de données MySQL®** :

1. « Créer une nouvelle base » → nom : `sportsalle` (cPanel la préfixera : `tonlogin_sportsalle`).
2. « Ajouter un nouvel utilisateur » → même nom, génère un **mot de passe fort** (garde-le).
3. « Ajouter un utilisateur à la base » → sélectionne les deux → coche **TOUS LES PRIVILÈGES**.

Puis cPanel → **phpMyAdmin** → clique ta base à gauche → onglet **SQL** →
colle le contenu de [`api/schema.sql`](api/schema.sql) → **Exécuter**.

## 2. Déployer l'app depuis GitHub (3 min)

Dans cPanel → **Git™ Version Control** :

1. **Create** →
   - *Clone URL* : `https://github.com/GogoBailly-grandvaux/sport-salle.git`
   - *Repository Path* : `repositories/sport-salle`
   - **Create**.
2. Ouvre le dépôt créé → onglet **Pull or Deploy** →
   **Update from Remote** puis **Deploy HEAD Commit**.

Le fichier [`.cpanel.yml`](.cpanel.yml) copie automatiquement l'app dans
`public_html/` (racine du domaine). Pour chaque mise à jour future :
*Update from Remote* → *Deploy HEAD Commit*, c'est tout.

> Si tu préfères l'app sur un sous-domaine (ex. `salle.hbaillyg.fr`), crée le
> sous-domaine dans cPanel et change la ligne `DEPLOYPATH` de `.cpanel.yml`.

## 3. Brancher l'API à la base (1 min)

cPanel → **Gestionnaire de fichiers** → `public_html/api/` →
clic droit sur `config.php` → **Edit** → renseigne :

```php
return [
  'db_host' => 'localhost',
  'db_name' => 'tonlogin_sportsalle',
  'db_user' => 'tonlogin_sportsalle',
  'db_pass' => 'LE_MOT_DE_PASSE_DE_L_ETAPE_1',
];
```

*(Ce fichier n'est jamais écrasé par les déploiements et n'est pas dans Git.)*

## 4. Vérifier

- Ouvre `https://hbaillyg.fr` → l'app se charge.
- Onglet **Profil** → la carte **« Synchronisation entre téléphones »**
  apparaît automatiquement (l'app détecte son API sur le domaine).
- Crée un groupe sur ton téléphone, rejoins-le sur celui de ta copine. 💪

## ⚙️ CI/CD — déploiement automatique à chaque push

Le dépôt contient un pipeline GitHub Actions ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)) :

```
git push → Tests (syntaxe JS, moteur de synchro, données, lint PHP)
         → si verts : Pull + Deploy automatiques sur o2switch via l'API cPanel
```

Tant que les secrets ne sont pas configurés, la partie déploiement est
**sautée proprement** (les tests tournent quand même à chaque push/PR).

### Activer le déploiement automatique (après l'étape 2)

1. **Créer un jeton API cPanel** : cPanel → *Sécurité* → **Gérer les jetons d'API**
   (« Manage API Tokens ») → *Créer* → nom `github-deploy`, **sans expiration**
   (ou 1 an) → copie le jeton affiché (montré une seule fois).
2. **Ajouter 3 secrets dans GitHub** : dépôt `sport-salle` → *Settings* →
   *Secrets and variables* → *Actions* → **New repository secret** :
   | Nom | Valeur |
   |---|---|
   | `CPANEL_HOST` | le serveur de ton email de bienvenue (ex. `machin.o2switch.net`) |
   | `CPANEL_USER` | ton nom d'utilisateur cPanel |
   | `CPANEL_TOKEN` | le jeton créé à l'étape 1 |
3. C'est tout : le prochain push sur `main` teste puis déploie tout seul.
   (Onglet **Actions** du dépôt pour suivre les runs.)

> 🔐 Le jeton reste entre cPanel et GitHub : ne le colle nulle part ailleurs.
> Le déploiement manuel (cPanel → Git → *Pull* + *Deploy*) reste toujours possible.

## 📦 Migration depuis la version GitHub Pages

Les données locales sont liées au domaine. Si vous avez déjà des séances sur
`gogobailly-grandvaux.github.io` :

1. Ancienne app → Profil → **Exporter (sauvegarde .json)**.
2. Nouvelle app (sur ton domaine) → Profil → **Importer une sauvegarde**.
3. Réinstalle l'icône depuis le nouveau domaine (Ajouter à l'écran d'accueil).

## Notes techniques

- L'app est 100 % statique + une API PHP de ~150 lignes (`api/sync.php`) et
  une table MySQL. Rien d'autre à maintenir.
- Accès aux données uniquement via le **code de groupe** (~110 bits d'entropie).
  Requêtes préparées (PDO), garde-fous de taille, `config.php` inaccessible
  depuis le web (`api/.htaccess`).
- La version GitHub Pages continue de fonctionner (sans synchro) — tu peux la
  garder comme miroir ou la retirer.
