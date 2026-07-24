<?php
/**
 * Sport Salle — défis entre amis (compétition hebdo).
 * Un défi porte sur la SEMAINE ISO courante et une métrique (séances ou volume).
 * Le score de chaque participant vient de user_stats (déjà synchronisé) → live.
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

function ensure_challenge_tables(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS challenges (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    creator_id INT UNSIGNED NOT NULL,
    metric     ENUM('workouts','volume') NOT NULL,
    week_start BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ch_creator (creator_id),
    CONSTRAINT fk_ch_creator FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  db()->exec("CREATE TABLE IF NOT EXISTS challenge_members (
    challenge_id INT UNSIGNED NOT NULL,
    user_id      INT UNSIGNED NOT NULL,
    status       ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
    joined_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (challenge_id, user_id),
    KEY idx_cm_user (user_id),
    CONSTRAINT fk_cm_ch   FOREIGN KEY (challenge_id) REFERENCES challenges (id) ON DELETE CASCADE,
    CONSTRAINT fk_cm_user FOREIGN KEY (user_id)      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  // étendre l'enum des notifs pour accepter 'challenge' (installs existantes).
  // ⚠ Doit rester IDENTIQUE à l'ENUM de lib.php (ensure_notifs_table) : y omettre
  // 'livesession'/'cheer' rétrécissait l'ENUM et cassait silencieusement ces notifs.
  try { db()->exec("ALTER TABLE notifs MODIFY COLUMN kind ENUM('friend_req','friend_acc','react','comment','mention','challenge','livesession','cheer') NOT NULL"); }
  catch (PDOException $e) { /* table absente ou déjà à jour — sans gravité */ }
}
function with_challenges(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) { if ($e->getCode() !== '42S02') { throw $e; } ensure_challenge_tables(); return $fn(); }
}

/** Classement d'un défi : membres acceptés triés par le score de la métrique (live). */
function challenge_ranking(int $chId, string $metric, int $weekStart): array {
  $st = db()->prepare(
    "SELECT u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
     FROM challenge_members m JOIN users u ON u.id = m.user_id
     WHERE m.challenge_id = ? AND m.status = 'accepted'");
  $st->execute([$chId]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  $stats = stats_for(array_map(fn($r) => (int)$r['id'], $rows));
  $cur = current_week_start_ms();
  $out = [];
  foreach ($rows as $r) {
    $s = $stats[(int)$r['id']] ?? null;
    // score : uniquement si les stats concernent la semaine du défi (sinon 0)
    $fresh = $weekStart === $cur; // le défi porte sur la semaine courante
    $score = 0;
    if ($fresh && $s) { $score = $metric === 'volume' ? (int)$s['weekVolume'] : (int)$s['weekCount']; }
    $u = public_user($r); $u['score'] = $score;
    $out[] = $u;
  }
  usort($out, fn($a, $b) => $b['score'] <=> $a['score']);
  return $out;
}

switch ($action) {

  case 'create': {
    rate_limit('chcreate', 15, 3600);
    $metric = in_array($b['metric'] ?? '', ['workouts', 'volume'], true) ? $b['metric'] : 'workouts';
    $ids = array_slice(array_values(array_unique(array_map('intval', (array)($b['friendIds'] ?? [])))), 0, 20);
    $ids = array_filter($ids, fn($id) => $id > 0 && $id !== $me['id'] && are_friends($me['id'], $id));
    if (!$ids) { fail(400, 'invite au moins un ami'); }
    $week = current_week_start_ms();
    $chId = with_challenges(function () use ($metric, $week, $me) {
      db()->prepare('INSERT INTO challenges (creator_id, metric, week_start) VALUES (?,?,?)')->execute([$me['id'], $metric, $week]);
      return (int)db()->lastInsertId();
    });
    // créateur = accepté d'office ; amis invités = pending + notif
    db()->prepare("INSERT INTO challenge_members (challenge_id, user_id, status) VALUES (?,?, 'accepted')")->execute([$chId, $me['id']]);
    $ins = db()->prepare("INSERT INTO challenge_members (challenge_id, user_id, status) VALUES (?,?, 'pending')");
    foreach ($ids as $id) {
      $ins->execute([$chId, $id]);
      notify($id, $me['id'], 'challenge', $chId, $metric === 'volume' ? 'volume' : 'séances');
      bump_live([$id]);
    }
    ok(['ok' => true, 'id' => $chId]);
  }

  case 'respond': {
    $chId = (int)($b['challengeId'] ?? 0);
    $accept = (bool)($b['accept'] ?? false);
    $n = with_challenges(function () use ($chId, $accept, $me) {
      $st = db()->prepare("UPDATE challenge_members SET status = ? WHERE challenge_id = ? AND user_id = ? AND status = 'pending'");
      $st->execute([$accept ? 'accepted' : 'declined', $chId, $me['id']]);
      return $st->rowCount();
    });
    if (!$n) { fail(404, 'invitation introuvable'); }
    // prévenir le créateur qu'on a rejoint
    if ($accept) {
      $st = db()->prepare('SELECT creator_id FROM challenges WHERE id = ?'); $st->execute([$chId]);
      $creator = (int)$st->fetchColumn();
      if ($creator && $creator !== $me['id']) { notify($creator, $me['id'], 'challenge', $chId, 'a rejoint'); bump_live([$creator]); }
    }
    ok(['ok' => true]);
  }

  case 'list': {
    // mes défis (créés ou invités), avec classement live + mon statut
    $rows = with_challenges(function () use ($me) {
      $st = db()->prepare(
        "SELECT c.id, c.metric, c.week_start, c.creator_id, cm.status AS my_status
         FROM challenge_members cm JOIN challenges c ON c.id = cm.challenge_id
         WHERE cm.user_id = ? ORDER BY c.id DESC LIMIT 30");
      $st->execute([$me['id']]);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $cur = current_week_start_ms();
    $out = [];
    foreach ($rows as $r) {
      $chId = (int)$r['id'];
      $ranking = challenge_ranking($chId, $r['metric'], (int)$r['week_start']);
      $out[] = [
        'id' => $chId, 'metric' => $r['metric'],
        'weekStart' => (int)$r['week_start'],
        'active' => (int)$r['week_start'] === $cur,   // défi de la semaine en cours ?
        'isCreator' => (int)$r['creator_id'] === $me['id'],
        'myStatus' => $r['my_status'],
        'ranking' => $ranking,
      ];
    }
    // en attente de MA réponse d'abord, puis actifs, puis terminés
    ok(['challenges' => $out]);
  }

  case 'leave': {
    $chId = (int)($b['challengeId'] ?? 0);
    with_challenges(function () use ($chId, $me) {
      // le créateur qui quitte supprime le défi (cascade) ; sinon on retire juste le membre
      $st = db()->prepare('SELECT creator_id FROM challenges WHERE id = ?'); $st->execute([$chId]);
      $creator = (int)$st->fetchColumn();
      if ($creator === $me['id']) { db()->prepare('DELETE FROM challenges WHERE id = ?')->execute([$chId]); }
      else { db()->prepare('DELETE FROM challenge_members WHERE challenge_id = ? AND user_id = ?')->execute([$chId, $me['id']]); }
    });
    ok(['ok' => true]);
  }

  default:
    fail(400, 'action inconnue');
}
