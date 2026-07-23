# 🏋️ Sport Salle

Une application de suivi de musculation (PWA) **gratuite et sans compte** : programmes personnalisés, séances en direct, records et progression. Fonctionne **hors-ligne**, s'installe sur l'écran d'accueil, et garde toutes les données **sur le téléphone de chacun**.

**👉 App : https://gogobailly-grandvaux.github.io/sport-salle/**

Partage simplement ce lien à tes proches — chacun installe l'app et crée son profil.

## 📲 Installer sur son téléphone

1. Ouvre le lien dans **Chrome** (Android) ou **Safari** (iPhone).
2. **Android** : menu ⋮ → « Ajouter à l'écran d'accueil » (ou la bannière d'installation).
3. **iPhone** : bouton Partager → « Sur l'écran d'accueil ».
4. L'app apparaît comme une vraie application. 💪

## ✨ Fonctionnalités

- **Modèles prêts à l'emploi** — Full body, Push/Pull/Legs, Haut/Bas, séance maison… à ajouter en 1 tap puis personnaliser.
- **Programmes / circuits perso** — exercices, séries, reps, repos, objectifs.
- **Partage de programmes** — envoie ton programme à un proche (fichier), il l'importe en 1 tap.
- **Séance en direct** — logging série par série, colonne « précédent », minuteur de repos automatique.
- **Bibliothèque de +870 exercices** avec images, instructions, recherche et filtres.
- **Progression** — 1RM estimé, volume, records (PR) automatiques, séries par muscle.
- **Suivi corporel** — poids, masse grasse, tour de taille avec courbes de tendance.
- **Multi-profil** — plusieurs personnes sur le même appareil, données séparées ; couleur et avatar par profil.
- **Thème clair / sombre**, kg / lb, **sauvegarde / import** en un fichier.

## ☁️ Synchro entre téléphones (optionnelle)

L'app peut synchroniser les profils entre plusieurs téléphones via un « groupe » à code secret (backend Supabase gratuit). Voir [SYNC-SETUP.md](SYNC-SETUP.md) pour l'activer. Sans groupe, l'app reste 100 % locale.

## 🔒 Confidentialité

Aucun compte : tout est stocké localement (IndexedDB). Seules les images d'exercices sont chargées depuis un CDN (puis mises en cache pour l'usage hors-ligne). Si la synchro est activée, les données du groupe transitent par ton propre projet Supabase, accessibles uniquement avec le code du groupe.

## 🛠️ Technique

Vanilla JS (modules ES), sans build. IndexedDB pour les données, Service Worker pour l'offline, `manifest` pour l'installation. Hébergé sur GitHub Pages.

## 🙏 Données d'exercices (open source)

- [free-exercise-db](https://github.com/yuhonas/free-exercise-db) — base d'exercices et images, domaine public (Unlicense).
- [wger](https://github.com/wger-project/wger) — traductions françaises et exercices additionnels, licence [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

*Ceci est une application de suivi sportif, pas un avis médical.*
