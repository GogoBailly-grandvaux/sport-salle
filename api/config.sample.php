<?php
/**
 * Sport Salle — configuration base de données (o2switch).
 *
 * 1. Dans cPanel → « Bases de données MySQL » : crée une base + un utilisateur,
 *    associe l'utilisateur à la base avec TOUS LES PRIVILÈGES.
 *    (o2switch préfixe automatiquement : ex. `tonlogin_sportsalle`)
 * 2. Copie ce fichier en `config.php` (dans le même dossier api/).
 * 3. Renseigne les 4 valeurs ci-dessous.
 *
 * ⚠️ Ne commite JAMAIS config.php dans Git (il est dans .gitignore).
 */
return [
  'db_host' => 'localhost',
  'db_name' => 'tonlogin_sportsalle',
  'db_user' => 'tonlogin_sportsalle',
  'db_pass' => 'LE_MOT_DE_PASSE_DE_LA_BASE',

  // Optionnel — « Continuer avec Google » :
  // console.cloud.google.com → APIs & Services → Credentials →
  // Create OAuth client ID (Web) → Authorized JavaScript origins :
  // https://sportsalle.hbaillyg.fr — puis colle l'ID client ci-dessous.
  'google_client_id' => '',
];
