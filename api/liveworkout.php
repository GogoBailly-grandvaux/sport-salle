<?php
// liveworkout.php — séances en direct : voir ses amis s'entraîner en temps réel.
// Le client envoie un « battement » au démarrage, toutes les ~45 s et à chaque
// série validée ; la ligne disparaît à la fin (ou devient périmée après 150 s).
// Visibilité : AMIS uniquement (jamais public — vie privée d'abord).
require __DIR__ . '/lib.php';

function ensure_live_workouts(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS live_workouts (
    user_id     INT UNSIGNED NOT NULL PRIMARY KEY,
    name        VARCHAR(80)  DEFAULT NULL,
    current_ex  VARCHAR(120) DEFAULT NULL,
    sets_done   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    volume_kg   INT UNSIGNED NOT NULL DEFAULT 0,
    started_at  BIGINT UNSIGNED NOT NULL,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function with_live_workouts(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) {
    if ($e->getCode() !== '42S02') { throw $e; }
    ensure_live_workouts();
    return $fn();
  }
}

$b = read_body();
switch ($b['action'] ?? '') {

  // battement : démarre ou met à jour ma séance en direct
  case 'beat': {
    $u = require_user();
    rate_limit('lwbeat', 120, 900); // large : 1 battement / série + pouls 45 s
    $name = mb_substr(trim(str_replace(['<', '>'], '', (string)($b['name'] ?? ''))), 0, 80);
    $ex   = mb_substr(trim(str_replace(['<', '>'], '', (string)($b['currentEx'] ?? ''))), 0, 120);
    $sets = max(0, min(500, (int)($b['setsDone'] ?? 0)));
    $vol  = max(0, min(2000000, (int)($b['volumeKg'] ?? 0)));
    $start = (int)($b['startedAt'] ?? 0);
    if ($start <= 0) { $start = (int)(microtime(true) * 1000); }
    $isNew = with_live_workouts(function () use ($u, $name, $ex, $sets, $vol, $start) {
      $st = db()->prepare('SELECT user_id FROM live_workouts WHERE user_id = ?');
      $st->execute([$u['id']]);
      $existed = (bool)$st->fetch();
      db()->prepare('INSERT INTO live_workouts (user_id, name, current_ex, sets_done, volume_kg, started_at)
                     VALUES (?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE name = VALUES(name), current_ex = VALUES(current_ex),
                       sets_done = VALUES(sets_done), volume_kg = VALUES(volume_kg), started_at = VALUES(started_at)')
        ->execute([$u['id'], $name !== '' ? $name : null, $ex !== '' ? $ex : null, $sets, $vol, $start]);
      return !$existed;
    });
    if ($isNew) { bump_live(friend_ids($u['id'])); } // leurs écrans montrent « en séance »
    ok(['ok' => true]);
  }

  // fin de séance (terminée ou abandonnée)
  case 'stop': {
    $u = require_user();
    with_live_workouts(function () use ($u) {
      db()->prepare('DELETE FROM live_workouts WHERE user_id = ?')->execute([$u['id']]);
    });
    bump_live(friend_ids($u['id']));
    ok(['ok' => true]);
  }

  // mes amis actuellement en séance (fraîcheur < 150 s)
  case 'friends': {
    $u = require_user();
    $ids = friend_ids($u['id']);
    if (!$ids) { ok(['live' => []]); }
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $rows = with_live_workouts(function () use ($ids, $ph) {
      $st = db()->prepare(
        "SELECT lw.user_id, lw.name, lw.current_ex, lw.sets_done, lw.volume_kg, lw.started_at,
                TIMESTAMPDIFF(SECOND, lw.updated_at, NOW()) AS age_s,
                u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
         FROM live_workouts lw JOIN users u ON u.id = lw.user_id
         WHERE lw.user_id IN ($ph)");
      $st->execute($ids);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $live = [];
    foreach ($rows as $r) {
      if ((int)$r['age_s'] > 150) { continue; } // périmé = séance morte
      $live[] = [
        'user'      => public_user($r),
        'name'      => $r['name'],
        'currentEx' => $r['current_ex'],
        'setsDone'  => (int)$r['sets_done'],
        'volumeKg'  => (int)$r['volume_kg'],
        'startedAt' => (int)$r['started_at'],
      ];
    }
    ok(['live' => $live]);
  }

  default: fail(400, 'action inconnue');
}
