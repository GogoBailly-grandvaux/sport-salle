<?php
/**
 * Sport Salle v2 — comptes : register / login / logout / me.
 * Mots de passe hachés (bcrypt), jetons de session 256 bits (hash SHA-256 en base).
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');

switch ($action) {

  case 'register': {
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $password = (string)($b['password'] ?? '');
    $displayName = trim((string)($b['displayName'] ?? ''));
    $emoji = substr(trim((string)($b['emoji'] ?? '')), 0, 16) ?: null;
    $accent = preg_match('/^[a-z]{3,10}$/', (string)($b['accent'] ?? '')) ? $b['accent'] : 'ember';

    if (!preg_match('/^[a-z0-9_.]{3,20}$/', $username)) {
      fail(400, 'pseudo invalide : 3-20 caractères, lettres/chiffres/_ /.');
    }
    if (strlen($password) < 8) { fail(400, 'mot de passe trop court (8 caractères minimum)'); }
    if ($displayName === '' || mb_strlen($displayName) > 40) { fail(400, 'prénom invalide'); }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    try {
      $st = db()->prepare('INSERT INTO users (username, display_name, pass_hash, avatar_emoji, accent) VALUES (?,?,?,?,?)');
      $st->execute([$username, $displayName, $hash, $emoji, $accent]);
    } catch (PDOException $e) {
      if ((int)$e->getCode() === 23000) { fail(409, 'ce pseudo est déjà pris'); }
      fail(500, 'erreur inscription');
    }
    $userId = (int)db()->lastInsertId();
    ok(issue_session($userId));
  }

  case 'login': {
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $password = (string)($b['password'] ?? '');
    $st = db()->prepare('SELECT id, pass_hash FROM users WHERE username = ?');
    $st->execute([$username]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row || !password_verify($password, $row['pass_hash'])) {
      usleep(350000); // freine le brute-force
      fail(401, 'pseudo ou mot de passe incorrect');
    }
    ok(issue_session((int)$row['id']));
  }

  case 'logout': {
    $tok = bearer_token();
    if ($tok !== null) {
      db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $tok)]);
    }
    ok(['ok' => true]);
  }

  case 'config': {
    // configuration publique du client (le bouton Google n'apparaît que si configuré)
    $c = file_exists(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];
    ok(['googleClientId' => (string)($c['google_client_id'] ?? '')]);
  }

  case 'google': {
    $c = require __DIR__ . '/config.php';
    $clientId = (string)($c['google_client_id'] ?? '');
    if ($clientId === '') { fail(501, 'connexion Google non configurée'); }
    $idToken = (string)($b['idToken'] ?? '');
    if ($idToken === '' || strlen($idToken) > 4096) { fail(400, 'jeton manquant'); }

    // validation du jeton auprès de Google
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken);
    $resp = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 8]]));
    if ($resp === false && function_exists('curl_init')) {
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
      $resp = curl_exec($ch);
      curl_close($ch);
    }
    $info = is_string($resp) ? json_decode($resp, true) : null;
    if (!is_array($info) || ($info['aud'] ?? '') !== $clientId || (int)($info['exp'] ?? 0) < time()) {
      fail(401, 'jeton Google invalide');
    }
    $sub = (string)($info['sub'] ?? '');
    if ($sub === '') { fail(401, 'jeton Google invalide'); }
    $email = isset($info['email']) ? substr((string)$info['email'], 0, 190) : null;
    $name = trim((string)($info['given_name'] ?? ($info['name'] ?? 'Athlète')));

    $st = db()->prepare('SELECT id FROM users WHERE google_sub = ?');
    $st->execute([$sub]);
    $uid = $st->fetchColumn();
    if ($uid) { ok(issue_session((int)$uid)); }

    // création : pseudo dérivé de l'email, unique
    $base = strtolower(preg_replace('/[^a-z0-9_.]/', '', explode('@', (string)($email ?? 'athlete'))[0]) ?: 'athlete');
    $base = substr($base, 0, 16) ?: 'athlete';
    $username = $base;
    for ($i = 0; $i < 20; $i++) {
      $st = db()->prepare('SELECT 1 FROM users WHERE username = ?');
      $st->execute([$username]);
      if (!$st->fetchColumn()) { break; }
      $username = substr($base, 0, 14) . random_int(10, 99);
    }
    db()->prepare('INSERT INTO users (username, display_name, pass_hash, google_sub, email) VALUES (?,?,?,?,?)')
      ->execute([$username, mb_substr($name ?: $username, 0, 40), password_hash(bin2hex(random_bytes(24)), PASSWORD_BCRYPT), $sub, $email]);
    ok(issue_session((int)db()->lastInsertId()));
  }

  case 'me': {
    $u = require_user();
    ok(['user' => public_user([
      'id' => $u['id'], 'username' => $u['username'], 'display_name' => $u['display_name'],
      'avatar_emoji' => $u['avatar_emoji'], 'accent' => $u['accent'],
    ])]);
  }

  default:
    fail(400, 'action inconnue');
}

function issue_session(int $userId): array {
  $token = bin2hex(random_bytes(32));
  db()->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))')
    ->execute([hash('sha256', $token), $userId]);
  // ménage léger : purge des sessions expirées de cet utilisateur
  db()->prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < NOW()')->execute([$userId]);
  $st = db()->prepare('SELECT id, username, display_name, avatar_emoji, accent FROM users WHERE id = ?');
  $st->execute([$userId]);
  return ['token' => $token, 'user' => public_user($st->fetch(PDO::FETCH_ASSOC))];
}
