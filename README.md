# 🏋️ Sport Salle

Une application de suivi de musculation (PWA) : programmes personnalisés, suivi de séances en direct, records et progression. Fonctionne **hors-ligne**, s'installe sur l'écran d'accueil, et garde toutes tes données **sur ton téléphone** (aucun compte, aucun serveur).

## 📲 Installer sur ton téléphone

1. Ouvre le lien de l'application dans **Chrome** (Android) ou **Safari** (iPhone).
2. **Android** : menu ⋮ → « Ajouter à l'écran d'accueil » (ou la bannière d'installation).
3. **iPhone** : bouton Partager → « Sur l'écran d'accueil ».
4. L'app apparaît comme une vraie application. 💪

## ✨ Fonctionnalités

- **Multi-profil** — plusieurs personnes sur le même appareil, données séparées.
- **Bibliothèque de +870 exercices** avec images et instructions (via [free-exercise-db](https://github.com/yuhonas/free-exercise-db), domaine public).
- **Programmes / circuits personnalisés** — séries, reps, repos, objectifs.
- **Séance en direct** — logging série par série, colonne « précédent », minuteur de repos automatique.
- **Historique** complet des séances.
- **Progression** — 1RM estimé, volume, records (PR) automatiques, séries par muscle.
- **Suivi corporel** — poids, masse grasse, tour de taille avec courbes de tendance.
- **Thème clair / sombre**, kg / lb.
- **Sauvegarde / import** en un fichier `.json`.

## 🔒 Confidentialité

Tout est stocké localement (IndexedDB). Rien n'est envoyé sur Internet, à part le chargement des images d'exercices (mises en cache pour l'usage hors-ligne).

## 🛠️ Technique

Vanilla JS (modules ES), sans build. IndexedDB pour les données, Service Worker pour l'offline, `manifest` pour l'installation. Hébergé sur GitHub Pages.

*Ceci est une application de suivi sportif, pas un avis médical.*
