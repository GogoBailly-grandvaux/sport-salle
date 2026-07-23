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
$__o = $_SERVER['HTTP_ORIGIN'] ?? '';
$__h = $__o ? (parse_url($__o, PHP_URL_HOST) ?: '') : '';
if ($__h === 'hbaillyg.fr' || str_ends_with($__h, '.hbaillyg.fr') || $__h === 'gogobailly-grandvaux.github.io') {
  header('Access-Control-Allow-Origin: ' . $__o); header('Vary: Origin');
}
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
  // La synchro par code (v1.3) n'est plus proposée dans l'app ; seul `ping`
  // (détection du serveur, traité plus haut) subsiste. pull/push sont retirés.
  case 'pull':
  case 'push':
    fail(410, 'la synchro par code a été retirée — utilise un compte');

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
