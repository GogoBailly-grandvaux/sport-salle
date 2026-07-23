<?php
/**
 * Sport Salle v2 — synchro des données PAR COMPTE (multi-appareils).
 * Un instantané JSON par utilisateur ; le client fait la fusion (LWW + tombstones)
 * et envoie aussi ses stats publiques (affichées aux amis / groupes).
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

switch ($action) {

  case 'pull': {
    $st = db()->prepare('SELECT data, UNIX_TIMESTAMP(updated_at) AS updated_at FROM user_snapshots WHERE user_id = ?');
    $st->execute([$me['id']]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    ok($r ? ['data' => json_decode($r['data'], true), 'updated_at' => (int)$r['updated_at']] : ['data' => null]);
  }

  case 'push': {
    $data = $b['data'] ?? null;
    if (!is_array($data)) { fail(400, 'données invalides'); }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 5 * 1024 * 1024) { fail(413, 'instantané trop volumineux'); }
    db()->prepare(
      'INSERT INTO user_snapshots (user_id, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP'
    )->execute([$me['id'], $json]);

    // stats publiques envoyées par le client (résumé, pas les données complètes)
    $s = $b['stats'] ?? null;
    if (is_array($s)) {
      db()->prepare(
        'INSERT INTO user_stats (user_id, last_workout_at, last_workout, week_start, week_count, week_volume, streak, total_workouts)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE last_workout_at = VALUES(last_workout_at), last_workout = VALUES(last_workout),
           week_start = VALUES(week_start), week_count = VALUES(week_count), week_volume = VALUES(week_volume),
           streak = VALUES(streak), total_workouts = VALUES(total_workouts)'
      )->execute([
        $me['id'],
        isset($s['lastWorkoutAt']) ? (int)$s['lastWorkoutAt'] : null,
        isset($s['lastWorkout']) ? substr((string)$s['lastWorkout'], 0, 120) : null,
        (int)($s['weekStart'] ?? 0),
        max(0, (int)($s['weekCount'] ?? 0)),
        max(0, (int)($s['weekVolume'] ?? 0)),
        max(0, (int)($s['streak'] ?? 0)),
        max(0, (int)($s['totalWorkouts'] ?? 0)),
      ]);
    }
    ok(['ok' => true, 'updated_at' => time()]);
  }

  default:
    fail(400, 'action inconnue');
}
