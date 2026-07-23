# ☁️ Activer la synchro cloud (5 minutes, gratuit)

La synchro utilise **Supabase** (plan gratuit : 500 Mo, largement assez).
Pas de serveur à gérer, pas de domaine à acheter, pas de carte bancaire.

## 1. Créer le projet Supabase

1. Va sur **https://supabase.com** → *Start your project* → connecte-toi (GitHub ou email).
2. *New project* :
   - **Name** : `sport-salle`
   - **Database password** : génère-le et garde-le (tu n'en auras pas besoin au quotidien)
   - **Region** : *West EU (Paris)* ou *Central EU*
3. Attends ~1 minute que le projet soit prêt.

## 2. Installer le schéma

1. Menu de gauche → **SQL Editor** → *New query*.
2. Colle **tout** le contenu du fichier [`supabase/schema.sql`](supabase/schema.sql).
3. Bouton **Run**. Tu dois voir « Success. No rows returned ».

## 3. Récupérer les 2 valeurs pour l'app

Menu de gauche → **Project Settings** (roue dentée) → **API** :

- **Project URL** — ex. `https://abcdefgh.supabase.co`
- **anon public** (dans *Project API keys*) — une longue clé commençant par `eyJ…`

> La clé *anon public* est faite pour être mise dans une app cliente : côté serveur,
> personne ne peut lire quoi que ce soit sans le **code de groupe** (voir schema.sql).
> Ne partage jamais la clé `service_role`, elle, est secrète.

## 4. Brancher l'app

Colle ces deux valeurs dans [`js/sync-config.js`](js/sync-config.js) :

```js
export const SYNC_URL = 'https://abcdefgh.supabase.co';
export const SYNC_KEY = 'eyJ…';
```

Commit + push → GitHub Pages redéploie → la carte **« Synchronisation entre
téléphones »** apparaît dans l'onglet Profil.

## 5. Utilisation

- **Téléphone 1** : Profil → *Créer un groupe* → partage le code affiché.
- **Téléphone 2** : Profil → *Rejoindre avec un code* → colle le code.
- C'est tout. La synchro est ensuite automatique (à l'ouverture, toutes les
  90 s quand l'app est visible, et après chaque modification).

## Comment ça marche (résumé technique)

- L'app reste **local-first** : tout fonctionne hors-ligne, la synchro se fait
  quand le réseau est là.
- Un « groupe » est identifié par un code aléatoire long (~110 bits d'entropie) ;
  le serveur n'expose que deux fonctions (`sync_push`, `sync_pull`) qui exigent
  ce code — pas d'accès direct aux tables.
- Fusion : « le plus récent gagne » enregistrement par enregistrement, et les
  suppressions sont propagées via des *tombstones*.
- Les profils des autres membres du groupe apparaissent automatiquement sur ton
  téléphone (et réciproquement) — chacun voit la progression des autres.
