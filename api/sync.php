<?php
/**
 * Sport Salle — API de synchronisation (hébergement o2switch / cPanel).
 *
 * Un « groupe » = un code secret long généré par l'app (>= 16 caractères).
 * Le serveur ne stocke qu'un instantané JSON par (groupe, profil).
 * Actions (POST JSON) : ping | pull | push
 *
 * Sécurité : accès uniquement via le code du groupe (équivalent d'un bearer
 * token à ~110 bits d'entropie), requêtes préparées PDO, garde-fous de taille.
 */

declare(strict_types=1);

// ---- CORS (l'app peut être servie depuis le même domaine ou GitHub Pages) ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: content-type');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
// ping en GET : certains réseaux mobiles/bloqueurs laissent passer les GET mais pas
// les POST — ce ping permet à l'app de savoir que le serveur EXISTE malgré tout.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && isset($_GET['ping'])) {
  ok(['ok' => true, 'service' => 'sport-salle-sync', 'v' => 1, 'via' => 'get']);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { fail(405, 'POST uniquement'); }

// ---- lecture du corps (limite 6 Mo) ----
$raw = file_get_contents('php://input', false, null, 0, 6 * 1024 * 1024 + 1);
if ($raw === false || strlen($raw) > 6 * 1024 * 1024) { fail(413, 'requête trop volumineuse'); }
$body = json_decode($raw, true);
if (!is_array($body)) { fail(400, 'JSON invalide'); }

$action = (string)($body['action'] ?? '');

// ping répond AVANT la config : il signifie « l'API est installée ici »
// (la base peut être configurée après — les vraies actions la vérifient).
if ($action === 'ping') { ok(['ok' => true, 'service' => 'sport-salle-sync', 'v' => 1]); }

// ---- config ----
$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) { fail(500, 'config.php manquant — copie config.sample.php en config.php et renseigne la base'); }
$config = require $configFile;

// ---- validation du code de groupe ----
$code = (string)($body['code'] ?? '');
if (strlen($code) < 16 || strlen($code) > 64 || !preg_match('/^[A-Z0-9\-]+$/', $code)) {
  usleep(300000); // freine l'énumération
  fail(403, 'code de groupe invalide');
}

// ---- connexion base ----
try {
  $pdo = new PDO(
    'mysql:host=' . $config['db_host'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4',
    $config['db_user'],
    $config['db_pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
  );
} catch (PDOException $e) {
  fail(500, 'connexion base impossible — vérifie api/config.php');
}

// Rétention RGPD : l'ancienne synchro par code n'est plus proposée dans l'app ;
// on purge les instantanés inactifs depuis 180 jours (les groupes actifs se
// rafraîchissent à chaque push et ne sont jamais concernés).
try { $pdo->exec("DELETE FROM sync_profiles WHERE updated_at < DATE_SUB(NOW(), INTERVAL 180 DAY)"); } catch (Throwable $e) { /* purge opportuniste */ }

switch ($action) {
  case 'pull': {
    $st = $pdo->prepare('SELECT profile_id, device_id, data, UNIX_TIMESTAMP(updated_at) AS updated_at FROM sync_profiles WHERE code = ?');
    $st->execute([$code]);
    $out = [];
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
      $out[] = [
        'profile_id' => $row['profile_id'],
        'device_id'  => $row['device_id'],
        'data'       => json_decode($row['data'], true),
        'updated_at' => (int)$row['updated_at'],
      ];
    }
    ok($out);
  }

  case 'push': {
    $profile = (string)($body['profile'] ?? '');
    $device  = substr((string)($body['device'] ?? ''), 0, 64);
    $data    = $body['data'] ?? null;
    if ($profile === '' || strlen($profile) > 64) { fail(400, 'profil invalide'); }
    if (!is_array($data)) { fail(400, 'données invalides'); }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 5 * 1024 * 1024) { fail(413, 'instantané trop volumineux'); }
    $st = $pdo->prepare(
      'INSERT INTO sync_profiles (code, profile_id, device_id, data)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), device_id = VALUES(device_id), updated_at = CURRENT_TIMESTAMP'
    );
    $st->execute([$code, $profile, $device, $json]);
    ok(['ok' => true, 'updated_at' => time()]);
  }

  default:
    fail(400, 'action inconnue');
}

// ---- helpers ----
function ok($payload): void { echo json_encode($payload, JSON_UNESCAPED_UNICODE); exit; }
function fail(int $status, string $msg): void {
  http_response_code($status);
  echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
