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
  $allowed = ($host === 'hbaillyg.fr')
    || str_ends_with($host, '.hbaillyg.fr')
    || str_ends_with($host, '.odns.fr');
}
if ($allowed) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: content-type, authorization');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { fail(405, 'POST uniquement'); }

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
  $st = db()->prepare(
    'SELECT u.id, u.username, u.display_name, u.avatar_emoji, u.accent
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()'
  );
  $st->execute([$th]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) { fail(401, 'session expirée — reconnecte-toi'); }
  db()->prepare('UPDATE sessions SET expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY) WHERE token_hash = ?')->execute([$th]);
  db()->prepare('UPDATE users SET last_seen_at = NOW() WHERE id = ?')->execute([$u['id']]);
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

function public_user(array $row): array {
  return [
    'id'          => (int)$row['id'],
    'username'    => $row['username'],
    'displayName' => $row['display_name'],
    'emoji'       => $row['avatar_emoji'],
    'accent'      => $row['accent'],
  ];
}

// ---- sorties ----
function ok($payload): void { echo json_encode($payload, JSON_UNESCAPED_UNICODE); exit; }
function fail(int $status, string $msg): void {
  http_response_code($status);
  echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
