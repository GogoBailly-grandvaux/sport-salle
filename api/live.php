<?php
/**
 * Sport Salle v2 — temps réel (poll léger).
 * Le client appelle `version` toutes les ~12 s : si `v` a bougé depuis la
 * dernière fois, quelque chose le concernant a changé (ami, programme, séance
 * d'un pote…) → il rafraîchit l'écran en place, sans recharger la page.
 * Réponse minuscule, requêtes indexées : conçu pour être appelé souvent.
 */
require __DIR__ . '/lib.php';

$b = read_body();
if (($b['action'] ?? '') !== 'version') { fail(400, 'action inconnue'); }
$me = require_user();

// version d'état (0 si jamais bumpé)
$v = 0;
try {
  $st = db()->prepare('SELECT v FROM live_v WHERE user_id = ?');
  $st->execute([$me['id']]);
  $v = (int)($st->fetchColumn() ?: 0);
} catch (PDOException $e) {
  if ($e->getCode() === '42S02') { ensure_live_table(); } else { throw $e; }
}

// demandes d'ami en attente (pour le badge de l'onglet Social)
$st = db()->prepare(
  "SELECT COUNT(*) FROM friendships
   WHERE status = 'pending' AND requester <> ? AND (user_lo = ? OR user_hi = ?)"
);
$st->execute([$me['id'], $me['id'], $me['id']]);
$reqs = (int)$st->fetchColumn();

// horodatage de mon instantané : s'il a changé sans que CET appareil ait
// poussé, un autre appareil a synchronisé → le client déclenche un pull
$st = db()->prepare('SELECT UNIX_TIMESTAMP(updated_at) FROM user_snapshots WHERE user_id = ?');
$st->execute([$me['id']]);
$snap = (int)($st->fetchColumn() ?: 0);

ok(['v' => $v, 'reqs' => $reqs, 'snap' => $snap]);
