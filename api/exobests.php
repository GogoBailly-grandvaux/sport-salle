<?php
// exobests.php — meilleures perfs par exercice, pour le classement entre amis.
// Le client pousse ses records en fin de séance (fire-and-forget) ; la fiche
// d'un exercice affiche le podium de mes amis (+ moi). Amis uniquement.
require __DIR__ . '/lib.php';

function ensure_exo_bests(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS exo_bests (
    user_id     INT UNSIGNED NOT NULL,
    exercise_id VARCHAR(80) NOT NULL,
    best_e1rm   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    best_weight SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, exercise_id),
    CONSTRAINT fk_eb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function with_exo_bests(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) {
    if ($e->getCode() !== '42S02') { throw $e; }
    ensure_exo_bests();
    return $fn();
  }
}

$b = read_body();
switch ($b['action'] ?? '') {

  // pousse mes records (fin de séance) — ne fait que s'améliorer
  case 'push': {
    $u = require_user();
    rate_limit('ebpush', 40, 900);
    $bests = array_slice((array)($b['bests'] ?? []), 0, 30);
    with_exo_bests(function () use ($u, $bests) {
      $st = db()->prepare('INSERT INTO exo_bests (user_id, exercise_id, best_e1rm, best_weight) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE best_e1rm = GREATEST(best_e1rm, VALUES(best_e1rm)), best_weight = GREATEST(best_weight, VALUES(best_weight))');
      foreach ($bests as $x) {
        $ex = mb_substr(trim((string)($x['exerciseId'] ?? '')), 0, 80);
        if ($ex === '') { continue; }
        $st->execute([$u['id'], $ex, max(0, min(2000, (int)round($x['e1rm'] ?? 0))), max(0, min(2000, (int)round($x['weight'] ?? 0)))]);
      }
    });
    ok(['ok' => true]);
  }

  // podium de mes amis (+ moi) sur un exercice
  case 'list': {
    $u = require_user();
    $ex = mb_substr(trim((string)($b['exerciseId'] ?? '')), 0, 80);
    if ($ex === '') { fail(400, 'exercice manquant'); }
    $ids = array_merge([$u['id']], friend_ids($u['id']));
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $rows = with_exo_bests(function () use ($ids, $ph, $ex) {
      $st = db()->prepare(
        "SELECT eb.best_e1rm, eb.best_weight,
                u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
         FROM exo_bests eb JOIN users u ON u.id = eb.user_id
         WHERE eb.exercise_id = ? AND eb.user_id IN ($ph) AND eb.best_e1rm > 0
         ORDER BY eb.best_e1rm DESC LIMIT 20");
      $st->execute(array_merge([$ex], $ids));
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $out = [];
    foreach ($rows as $r) {
      $out[] = ['user' => public_user($r), 'e1rm' => (int)$r['best_e1rm'], 'weight' => (int)$r['best_weight'], 'isMe' => (int)$r['id'] === $u['id']];
    }
    ok(['ranking' => $out]);
  }

  default: fail(400, 'action inconnue');
}
