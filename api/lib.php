<?php
/**
 * Sport Salle v2 — socle commun des endpoints API.
 * Auth par jeton (Authorization: Bearer <token>), PDO préparé, CORS restreint.
 */

declare(strict_types=1);

// ---- CORS : uniquement nos origines ----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = false;
if ($origin !== '') {
  $host = parse_url($origin, PHP_URL_HOST) ?: '';
  // liste blanche stricte (plus de *.odns.fr : sous-domaines partagés o2switch)
  $allowed = ($host === 'hbaillyg.fr') || str_ends_with($host, '.hbaillyg.fr')
    || $host === 'gogobailly-grandvaux.github.io';
}
if ($allowed) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: content-type, authorization');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

// jamais de détails techniques au client (une exception non catchée = 500 générique)
set_exception_handler(function ($e) {
  if (!headers_sent()) { http_response_code(500); }
  error_log('sport-salle: ' . $e->getMessage());
  echo json_encode(['error' => 'erreur serveur']);
  exit;
});

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { fail(405, 'POST uniquement'); }

// ---- limitation de débit (anti-brute-force, par IP + clé d'action) ----
// Le usleep seul est contournable en parallèle : ici on COMPTE les échecs
// récents dans un fichier et on bloque au-delà du seuil.
function client_ip(): string {
  $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '0';
  $ip = trim(explode(',', $ip)[0]);
  return substr(hash('sha256', $ip), 0, 24);
}
function rate_limit(string $key, int $max, int $windowSec): void {
  $dir = sys_get_temp_dir() . '/sportsalle_rl';
  @mkdir($dir, 0700, true);
  $file = $dir . '/' . preg_replace('/[^a-z0-9_]/i', '', $key) . '_' . client_ip();
  $now = time();
  $hits = [];
  if (is_file($file)) {
    $hits = array_filter(array_map('intval', explode("\n", (string)@file_get_contents($file))), fn($t) => $t > $now - $windowSec);
  }
  if (count($hits) >= $max) {
    header('Retry-After: ' . $windowSec);
    fail(429, 'trop de tentatives — réessaie dans un instant');
  }
  $hits[] = $now;
  @file_put_contents($file, implode("\n", $hits), LOCK_EX);
}

// ---- corps JSON (limite 6 Mo) ----
function read_body(): array {
  $raw = file_get_contents('php://input', false, null, 0, 6 * 1024 * 1024 + 1);
  if ($raw === false || strlen($raw) > 6 * 1024 * 1024) { fail(413, 'requête trop volumineuse'); }
  $b = json_decode($raw, true);
  if (!is_array($b)) { fail(400, 'JSON invalide'); }
  return $b;
}

// ---- base de données ----
function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $configFile = __DIR__ . '/config.php';
    if (!file_exists($configFile)) { fail(500, 'config.php manquant'); }
    $c = require $configFile;
    try {
      $pdo = new PDO(
        'mysql:host=' . $c['db_host'] . ';dbname=' . $c['db_name'] . ';charset=utf8mb4',
        $c['db_user'], $c['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
      );
    } catch (PDOException $e) {
      fail(500, 'connexion base impossible');
    }
  }
  return $pdo;
}

// ---- auth ----
function bearer_token(): ?string {
  $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if ($h === '' && function_exists('apache_request_headers')) {
    $ah = apache_request_headers();
    $h = $ah['Authorization'] ?? ($ah['authorization'] ?? '');
  }
  if (preg_match('/^Bearer\s+([a-f0-9]{64})$/i', trim($h), $m)) { return strtolower($m[1]); }
  return null;
}

/** Retourne l'utilisateur authentifié (ou 401). Prolonge la session (expiration glissante). */
function require_user(): array {
  $tok = bearer_token();
  if ($tok === null) { fail(401, 'authentification requise'); }
  $th = hash('sha256', $tok);
  $u = with_profile_cols(function () use ($th) {
    $st = db()->prepare(
      'SELECT u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW()'
    );
    $st->execute([$th]);
    return $st->fetch(PDO::FETCH_ASSOC);
  });
  if (!$u) { fail(401, 'session expirée — reconnecte-toi'); }
  // écritures conditionnelles : le poll temps réel passe ici toutes les ~12 s,
  // on ne réécrit la session/présence que quand ça change vraiment quelque chose
  db()->prepare('UPDATE sessions SET expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY)
                 WHERE token_hash = ? AND expires_at < DATE_ADD(NOW(), INTERVAL 89 DAY)')->execute([$th]);
  db()->prepare('UPDATE users SET last_seen_at = NOW()
                 WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(NOW(), INTERVAL 60 SECOND))')->execute([$u['id']]);
  $u['id'] = (int)$u['id'];
  return $u;
}

// ---- helpers amitiés ----
function friend_pair(int $a, int $b): array { return $a < $b ? [$a, $b] : [$b, $a]; }

function are_friends(int $a, int $b): bool {
  [$lo, $hi] = friend_pair($a, $b);
  $st = db()->prepare("SELECT 1 FROM friendships WHERE user_lo = ? AND user_hi = ? AND status = 'accepted'");
  $st->execute([$lo, $hi]);
  return (bool)$st->fetchColumn();
}

function is_group_member(int $groupId, int $userId): bool {
  $st = db()->prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?');
  $st->execute([$groupId, $userId]);
  return (bool)$st->fetchColumn();
}

/** Stats publiques d'une liste d'utilisateurs, indexées par user_id. */
function stats_for(array $userIds): array {
  if (!$userIds) { return []; }
  $ph = implode(',', array_fill(0, count($userIds), '?'));
  $st = db()->prepare("SELECT * FROM user_stats WHERE user_id IN ($ph)");
  $st->execute(array_values($userIds));
  $out = [];
  $weekStart = current_week_start_ms();
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $fresh = ((int)($r['week_start'] ?? 0)) === $weekStart;
    $out[(int)$r['user_id']] = [
      'lastWorkoutAt' => $r['last_workout_at'] !== null ? (int)$r['last_workout_at'] : null,
      'lastWorkout'   => $r['last_workout'],
      'weekCount'     => $fresh ? (int)$r['week_count'] : 0,
      'weekVolume'    => $fresh ? (int)$r['week_volume'] : 0,
      'streak'        => (int)$r['streak'],
      'totalWorkouts' => (int)$r['total_workouts'],
    ];
  }
  return $out;
}

/** Début de la semaine ISO courante (lundi 00:00, Europe/Paris) en millisecondes. */
function current_week_start_ms(): int {
  $tz = new DateTimeZone('Europe/Paris');
  $d = new DateTime('now', $tz);
  $d->setTime(0, 0, 0);
  $dow = (int)$d->format('N'); // 1 = lundi
  if ($dow > 1) { $d->modify('-' . ($dow - 1) . ' days'); }
  return $d->getTimestamp() * 1000;
}

// ---- temps réel (poll léger) ----
// Chaque utilisateur a une « version d'état » : on l'incrémente dès qu'un
// événement le concerne (demande d'ami, programme publié, séance d'un ami…).
// Le client compare la version à chaque poll → re-rendu en place si elle bouge.

function ensure_live_table(): void {
  db()->exec('CREATE TABLE IF NOT EXISTS live_v (
    user_id    INT UNSIGNED NOT NULL,
    v          INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_live_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

/** Incrémente la version d'état des utilisateurs donnés (création lazy de la table). */
function bump_live(array $userIds): void {
  $ids = array_values(array_unique(array_filter(array_map('intval', $userIds))));
  if (!$ids) { return; }
  $sql = 'INSERT INTO live_v (user_id, v) VALUES '
       . implode(',', array_fill(0, count($ids), '(?,1)'))
       . ' ON DUPLICATE KEY UPDATE v = v + 1';
  try {
    db()->prepare($sql)->execute($ids);
  } catch (PDOException $e) {
    if ($e->getCode() === '42S02') { ensure_live_table(); db()->prepare($sql)->execute($ids); }
    else { error_log('bump_live: ' . $e->getMessage()); } // jamais bloquant pour l'action principale
  }
}

/** Ids des amis acceptés d'un utilisateur. */
function friend_ids(int $userId): array {
  $st = db()->prepare(
    "SELECT IF(user_lo = ?, user_hi, user_lo) FROM friendships
     WHERE (user_lo = ? OR user_hi = ?) AND status = 'accepted'"
  );
  $st->execute([$userId, $userId, $userId]);
  return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Ids des co-membres de tous les groupes d'un utilisateur (lui exclu). */
function group_comember_ids(int $userId): array {
  $st = db()->prepare(
    'SELECT DISTINCT m2.user_id FROM group_members m
     JOIN group_members m2 ON m2.group_id = m.group_id AND m2.user_id <> ?
     WHERE m.user_id = ?'
  );
  $st->execute([$userId, $userId]);
  return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Colonnes profil v3.2 (bio, confidentialité) — création lazy. */
function ensure_profile_cols(): void {
  foreach ([
    "ALTER TABLE users ADD COLUMN bio VARCHAR(200) DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN privacy ENUM('friends','public') NOT NULL DEFAULT 'friends'",
    "ALTER TABLE users ADD COLUMN gym VARCHAR(80) DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN gym_key VARCHAR(80) DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN avatar_photo MEDIUMTEXT DEFAULT NULL",
    "ALTER TABLE users ADD KEY idx_gym (gym_key)",
  ] as $sql) {
    try { db()->exec($sql); }
    catch (PDOException $e) {
      // 42S21 / 1060 : colonne déjà là — ok
      $m = $e->getMessage();
      // colonne (1060/42S21) ou index (1061) déjà présents -> on ignore
      if ($e->getCode() !== '42S21' && strpos($m, '1060') === false && strpos($m, '1061') === false) { throw $e; }
    }
  }
}

/** Exécute $fn ; si bio/privacy n'existent pas encore (42S22), migre et réessaie. */
function with_profile_cols(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) {
    if ($e->getCode() !== '42S22') { throw $e; }
    ensure_profile_cols();
    return $fn();
  }
}

/** L'utilisateur $viewer peut-il voir le contenu (posts/stats/programmes) de $owner ?
 *  Règle : soi-même, ami accepté, ou compte public. Appliquée CÔTÉ SERVEUR partout. */
function can_view_content(int $viewer, int $ownerId, ?string $ownerPrivacy): bool {
  if ($viewer === $ownerId) { return true; }
  if (($ownerPrivacy ?? 'friends') === 'public') { return true; }
  return are_friends($viewer, $ownerId);
}

// ---- notifications (onglet Activité ; alimentera les push) ----
function ensure_notifs_table(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS notifs (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    INT UNSIGNED NOT NULL,
    actor_id   INT UNSIGNED NOT NULL,
    kind       ENUM('friend_req','friend_acc','react','comment','mention','challenge') NOT NULL,
    ref_id     INT UNSIGNED DEFAULT NULL,
    meta       VARCHAR(120) DEFAULT NULL,
    seen       TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_notif_user (user_id, id),
    CONSTRAINT fk_n_user  FOREIGN KEY (user_id)  REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_n_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

/** Dépose une notification (jamais à soi-même). Ne bloque jamais l'action principale. */
function notify(int $to, int $actor, string $kind, ?int $refId = null, ?string $meta = null): void {
  if ($to === $actor || $to <= 0) { return; }
  $ins = function () use ($to, $actor, $kind, $refId, $meta) {
    db()->prepare('INSERT INTO notifs (user_id, actor_id, kind, ref_id, meta) VALUES (?,?,?,?,?)')
      ->execute([$to, $actor, $kind, $refId, $meta !== null ? mb_substr($meta, 0, 120) : null]);
  };
  try { $ins(); }
  catch (PDOException $e) {
    if ($e->getCode() !== '42S02') { error_log('notify: ' . $e->getMessage()); return; }
    try { ensure_notifs_table(); $ins(); } catch (PDOException $e2) { error_log('notify2: ' . $e2->getMessage()); }
  }
  try { db()->exec('DELETE FROM notifs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY) LIMIT 30'); } catch (PDOException $e) {}
  if (function_exists('push_enqueue')) { push_enqueue($to, $kind, $actor, $meta); } // notification push (best-effort)
}

/** Notifie les @mentions d'un texte (amis de l'auteur uniquement, hors $skip). */
function notify_mentions(string $text, int $actor, ?int $refId, array $skip = []): void {
  if (!preg_match_all('/(^|\s)@([a-z0-9_.]{3,20})/i', $text, $m)) { return; }
  $names = array_slice(array_unique(array_map('strtolower', $m[2])), 0, 5);
  foreach ($names as $name) {
    $st = db()->prepare('SELECT id FROM users WHERE username = ?');
    $st->execute([$name]);
    $uid = (int)($st->fetchColumn() ?: 0);
    if (!$uid || $uid === $actor || in_array($uid, $skip, true)) { continue; }
    if (!are_friends($actor, $uid)) { continue; } // on ne mentionne-notifie que ses amis
    notify($uid, $actor, 'mention', $refId, mb_substr($text, 0, 80));
    bump_live([$uid]);
  }
}

/** Clé normalisée d'un nom de salle (minuscules, sans accents/ponctuation) pour regrouper. */
function gym_key(string $name): string {
  $n = mb_strtolower(trim($name));
  $n = strtr($n, ['à'=>'a','â'=>'a','ä'=>'a','é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','î'=>'i','ï'=>'i','ô'=>'o','ö'=>'o','û'=>'u','ù'=>'u','ü'=>'u','ç'=>'c','œ'=>'oe']);
  $n = preg_replace('/[^a-z0-9]+/', '', $n);
  return mb_substr($n, 0, 80);
}

function public_user(array $row): array {
  return [
    'id'          => (int)$row['id'],
    'username'    => $row['username'],
    'displayName' => $row['display_name'],
    'emoji'       => $row['avatar_emoji'],
    'accent'      => $row['accent'],
    'avatar'      => $row['avatar_photo'] ?? null,
  ];
}

// ---- sorties ----
function ok($payload): void { echo json_encode($payload, JSON_UNESCAPED_UNICODE); exit; }
function fail(int $status, string $msg): void {
  http_response_code($status);
  echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

// Web Push (crypto + envoi) — chargé en dernier : ses fonctions sont dispo au runtime.
require __DIR__ . '/webpush.php';
