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
    rate_limit('register', 10, 3600); // max 10 créations/h par IP
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $password = (string)($b['password'] ?? '');
    $displayName = trim(str_replace(['<', '>'], '', (string)($b['displayName'] ?? '')));
    $emoji = substr(trim((string)($b['emoji'] ?? '')), 0, 16) ?: null;
    $accent = preg_match('/^[a-z]{3,10}$/', (string)($b['accent'] ?? '')) ? $b['accent'] : 'ember';

    if (!preg_match('/^[a-z0-9_.]{3,20}$/', $username)) {
      fail(400, 'pseudo invalide : 3-20 caractères, lettres/chiffres/_ /.');
    }
    if (strlen($password) < 8) { fail(400, 'mot de passe trop court (8 caractères minimum)'); }
    if ($displayName === '' || mb_strlen($displayName) > 40) { fail(400, 'prénom invalide'); }

    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 11]);
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
    rate_limit('login', 8, 900); // max 8 échecs/15 min par IP
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $password = (string)($b['password'] ?? '');
    $st = db()->prepare('SELECT id, pass_hash FROM users WHERE username = ?');
    $st->execute([$username]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    // toujours un password_verify (même si l'utilisateur n'existe pas) : temps
    // de réponse constant → pas d'oracle temporel d'énumération de comptes.
    $hash = $row['pass_hash'] ?? '$2y$11$CNZ5BGFTtOxSFQpqF6nAXu25iEAv5E2O9rc4Q6OmLFgXIBW0lJd4G';
    $okpw = password_verify($password, $hash);
    if (!$row || !$okpw) {
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
    rate_limit('google', 20, 900);
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
    $iss = $info['iss'] ?? '';
    $issOk = in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true);
    if (!is_array($info) || ($info['aud'] ?? '') !== $clientId || (int)($info['exp'] ?? 0) < time() || !$issOk) {
      fail(401, 'jeton Google invalide');
    }
    // e-mail seulement s'il est vérifié par Google (email_verified peut valoir "true" en string)
    $emailOk = (($info['email_verified'] ?? '') === true) || (($info['email_verified'] ?? '') === 'true');
    $sub = (string)($info['sub'] ?? '');
    if ($sub === '') { fail(401, 'jeton Google invalide'); }
    $email = ($emailOk && isset($info['email'])) ? substr((string)$info['email'], 0, 190) : null;
    $name = trim((string)($info['given_name'] ?? ($info['name'] ?? 'Athlète')));

    $st = db()->prepare('SELECT id FROM users WHERE google_sub = ?');
    $st->execute([$sub]);
    $uid = $st->fetchColumn();
    if ($uid) {
      $s = issue_session((int)$uid);
      $s['isNew'] = false;
      ok($s);
    }

    // création : pseudo provisoire dérivé de l'email — le client propose
    // aussitôt d'en choisir un (action 'username' ci-dessous)
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
      ->execute([$username, mb_substr($name ?: $username, 0, 40), password_hash(bin2hex(random_bytes(24)), PASSWORD_BCRYPT, ['cost' => 11]), $sub, $email]);
    $s = issue_session((int)db()->lastInsertId());
    $s['isNew'] = true;
    ok($s);
  }

  case 'username': {
    // changement de pseudo (droit de rectification) — mêmes règles qu'à l'inscription
    $u = require_user();
    $username = strtolower(trim((string)($b['username'] ?? '')));
    if (!preg_match('/^[a-z0-9_.]{3,20}$/', $username)) {
      fail(400, 'pseudo invalide : 3-20 caractères, lettres/chiffres/_ /.');
    }
    if ($username !== $u['username']) {
      try {
        db()->prepare('UPDATE users SET username = ? WHERE id = ?')->execute([$username, $u['id']]);
      } catch (PDOException $e) {
        if ((int)$e->getCode() === 23000) { fail(409, 'ce pseudo est déjà pris'); }
        fail(500, 'erreur');
      }
    }
    $st = db()->prepare('SELECT id, username, display_name, avatar_emoji, accent FROM users WHERE id = ?');
    $st->execute([$u['id']]);
    ok(['user' => public_user($st->fetch(PDO::FETCH_ASSOC))]);
  }

  case 'profile_update': {
    // édition du profil public : nom affiché, bio, emoji, couleur, confidentialité
    $u = require_user();
    rate_limit('profup', 10, 900);
    $displayName = trim(str_replace(['<', '>'], '', (string)($b['displayName'] ?? '')));
    if ($displayName === '' || mb_strlen($displayName) > 40) { fail(400, 'nom invalide (1-40 caractères)'); }
    $bio = trim(str_replace(['<', '>'], '', (string)($b['bio'] ?? '')));
    if (mb_strlen($bio) > 160) { fail(400, 'bio trop longue (160 caractères max)'); }
    $emoji = substr(trim((string)($b['emoji'] ?? '')), 0, 16) ?: null;
    $accent = preg_match('/^[a-z]{3,10}$/', (string)($b['accent'] ?? '')) ? $b['accent'] : 'ember';
    $privacy = in_array($b['privacy'] ?? '', ['friends', 'public'], true) ? $b['privacy'] : 'friends';
    $gym = trim(str_replace(['<', '>'], '', (string)($b['gym'] ?? '')));
    if (mb_strlen($gym) > 80) { fail(400, 'nom de salle trop long'); }
    $gymKey = $gym !== '' ? gym_key($gym) : null;
    with_profile_cols(function () use ($u, $displayName, $bio, $emoji, $accent, $privacy, $gym, $gymKey) {
      db()->prepare('UPDATE users SET display_name = ?, bio = ?, avatar_emoji = ?, accent = ?, privacy = ?, gym = ?, gym_key = ? WHERE id = ?')
        ->execute([$displayName, $bio !== '' ? $bio : null, $emoji, $accent, $privacy, $gym !== '' ? $gym : null, $gymKey, $u['id']]);
    });
    bump_live(friend_ids($u['id'])); // leurs écrans affichent le nouveau nom/bio
    ok(['ok' => true]);
  }

  case 'me': {
    $u = require_user();
    ok(['user' => public_user([
      'id' => $u['id'], 'username' => $u['username'], 'display_name' => $u['display_name'],
      'avatar_emoji' => $u['avatar_emoji'], 'accent' => $u['accent'],
    ])]);
  }

  case 'delete': {
    // suppression définitive du compte (mot de passe exigé) — cascade sur toutes les données
    $u = require_user();
    rate_limit('delete', 5, 900);
    $password = (string)($b['password'] ?? '');
    $st = db()->prepare('SELECT pass_hash FROM users WHERE id = ?');
    $st->execute([$u['id']]);
    $hash = $st->fetchColumn();
    if (!$hash || !password_verify($password, $hash)) {
      usleep(350000);
      fail(401, 'mot de passe incorrect');
    }
    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
    ok(['ok' => true]);
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
