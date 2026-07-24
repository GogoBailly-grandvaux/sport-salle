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
function ensure_live_sessions(): void {
  ensure_live_workouts();
  db()->exec("CREATE TABLE IF NOT EXISTS live_sessions (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    creator_id  INT UNSIGNED NOT NULL,
    name        VARCHAR(80) DEFAULT NULL,
    routine_payload MEDIUMTEXT DEFAULT NULL,
    created_at  BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_ls_user FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  foreach ([
    "ALTER TABLE live_workouts ADD COLUMN session_id INT UNSIGNED DEFAULT NULL",
    "ALTER TABLE notifs MODIFY kind ENUM('friend_req','friend_acc','react','comment','mention','challenge','livesession','cheer') NOT NULL",
  ] as $sql) {
    try { db()->exec($sql); }
    catch (PDOException $e) {
      $m = $e->getMessage();
      if ($e->getCode() !== '42S21' && strpos($m, '1060') === false && strpos($m, '1061') === false) { throw $e; }
    }
  }
}
function with_live_sessions(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) {
    if (!in_array($e->getCode(), ['42S02', '42S22'], true)) { throw $e; }
    ensure_live_sessions();
    return $fn();
  }
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
    $sess = (int)($b['sessionId'] ?? 0) ?: null;
    $isNew = with_live_sessions(function () use ($u, $name, $ex, $sets, $vol, $start, $sess) {
      $st = db()->prepare('SELECT user_id FROM live_workouts WHERE user_id = ?');
      $st->execute([$u['id']]);
      $existed = (bool)$st->fetch();
      db()->prepare('INSERT INTO live_workouts (user_id, name, current_ex, sets_done, volume_kg, started_at, session_id)
                     VALUES (?,?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE name = VALUES(name), current_ex = VALUES(current_ex),
                       sets_done = VALUES(sets_done), volume_kg = VALUES(volume_kg), started_at = VALUES(started_at), session_id = VALUES(session_id)')
        ->execute([$u['id'], $name !== '' ? $name : null, $ex !== '' ? $ex : null, $sets, $vol, $start, $sess]);
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

  // créer une séance de groupe : invite des amis (notif + push), programme optionnel
  case 'create_session': {
    $u = require_user();
    rate_limit('lwsess', 10, 900);
    $name = mb_substr(trim(str_replace(['<', '>'], '', (string)($b['name'] ?? ''))), 0, 80);
    $routine = null;
    if (isset($b['routine']) && is_array($b['routine'])) {
      $routine = json_encode($b['routine'], JSON_UNESCAPED_UNICODE);
      if (strlen($routine) > 200000) { fail(400, 'programme trop lourd'); }
    }
    $sid = with_live_sessions(function () use ($u, $name, $routine) {
      db()->prepare('INSERT INTO live_sessions (creator_id, name, routine_payload, created_at) VALUES (?,?,?,?)')
        ->execute([$u['id'], $name !== '' ? $name : null, $routine, (int)(microtime(true) * 1000)]);
      return (int)db()->lastInsertId();
    });
    $friends = friend_ids($u['id']);
    $invited = array_values(array_intersect(array_map('intval', (array)($b['friendIds'] ?? [])), $friends));
    foreach (array_slice($invited, 0, 20) as $fid) { notify($fid, $u['id'], 'livesession', $sid, $name !== '' ? $name : null); }
    if ($invited) { bump_live($invited); }
    ok(['sessionId' => $sid]);
  }

  // rejoindre : récupère le programme partagé (ou rien = séance libre)
  case 'join_session': {
    $u = require_user();
    $sid = (int)($b['sessionId'] ?? 0);
    $row = with_live_sessions(function () use ($sid) {
      $st = db()->prepare('SELECT ls.*, u.id AS uid, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
                           FROM live_sessions ls JOIN users u ON u.id = ls.creator_id WHERE ls.id = ?');
      $st->execute([$sid]);
      return $st->fetch(PDO::FETCH_ASSOC);
    });
    if (!$row) { fail(404, 'séance introuvable'); }
    if ((int)$row['creator_id'] !== $u['id'] && !are_friends($u['id'], (int)$row['creator_id'])) { fail(403, 'réservé aux amis'); }
    ok([
      'sessionId' => (int)$row['id'],
      'name'      => $row['name'],
      'creator'   => public_user(['id' => $row['uid'], 'username' => $row['username'], 'display_name' => $row['display_name'], 'avatar_emoji' => $row['avatar_emoji'], 'accent' => $row['accent'], 'avatar_photo' => $row['avatar_photo'] ?? null]),
      'routine'   => $row['routine_payload'] ? json_decode($row['routine_payload'], true) : null,
    ]);
  }

  // participants en direct d'une séance de groupe
  case 'session': {
    $u = require_user();
    $sid = (int)($b['sessionId'] ?? 0);
    $rows = with_live_sessions(function () use ($sid) {
      $st = db()->prepare(
        "SELECT lw.user_id, lw.name, lw.current_ex, lw.sets_done, lw.volume_kg, lw.started_at,
                TIMESTAMPDIFF(SECOND, lw.updated_at, NOW()) AS age_s,
                u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
         FROM live_workouts lw JOIN users u ON u.id = lw.user_id WHERE lw.session_id = ?");
      $st->execute([$sid]);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $out = [];
    foreach ($rows as $r) {
      if ((int)$r['age_s'] > 150) { continue; }
      $out[] = ['user' => public_user($r), 'currentEx' => $r['current_ex'], 'setsDone' => (int)$r['sets_done'], 'volumeKg' => (int)$r['volume_kg'], 'startedAt' => (int)$r['started_at']];
    }
    ok(['participants' => $out]);
  }

  // encourager un ami en pleine séance (notif + push)
  case 'cheer': {
    $u = require_user();
    rate_limit('lwcheer', 30, 900);
    $to = (int)($b['userId'] ?? 0);
    if (!$to || $to === $u['id'] || !are_friends($u['id'], $to)) { fail(403, 'réservé aux amis'); }
    with_live_sessions(function () {}); // garantit l'ENUM cheer avant le notify
    notify($to, $u['id'], 'cheer', null, null);
    bump_live([$to]);
    ok(['ok' => true]);
  }

  default: fail(400, 'action inconnue');
}
