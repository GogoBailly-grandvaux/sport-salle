<?php
/**
 * Sport Salle — abonnements aux notifications push.
 * key : clé publique VAPID (pour s'abonner) · subscribe/unsubscribe · selftest.
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

function ensure_push_subs(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS push_subs (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED NOT NULL,
    endpoint      TEXT NOT NULL,
    endpoint_hash CHAR(64) NOT NULL,
    p256dh        VARCHAR(120) NOT NULL,
    auth          VARCHAR(40)  NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ep (endpoint_hash),
    KEY idx_ps_user (user_id),
    CONSTRAINT fk_ps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
function with_push(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) { if ($e->getCode() !== '42S02') { throw $e; } ensure_push_subs(); return $fn(); }
}

switch ($action) {

  case 'key': {
    $v = push_vapid();
    if (!$v) { fail(501, 'push non disponible sur ce serveur'); }
    ok(['key' => $v['pub']]);
  }

  case 'subscribe': {
    rate_limit('pushsub', 30, 3600);
    $endpoint = (string)($b['endpoint'] ?? '');
    $p256dh = (string)($b['p256dh'] ?? '');
    $auth = (string)($b['auth'] ?? '');
    if (!preg_match('#^https://#', $endpoint) || strlen($endpoint) > 1000) { fail(400, 'endpoint invalide'); }
    if (!preg_match('#^[A-Za-z0-9_-]{20,100}$#', $p256dh) || !preg_match('#^[A-Za-z0-9_-]{10,40}$#', $auth)) { fail(400, 'clés invalides'); }
    with_push(function () use ($endpoint, $p256dh, $auth, $me) {
      db()->prepare('INSERT INTO push_subs (user_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)')
        ->execute([$me['id'], $endpoint, hash('sha256', $endpoint), $p256dh, $auth]);
    });
    ok(['ok' => true]);
  }

  case 'unsubscribe': {
    $endpoint = (string)($b['endpoint'] ?? '');
    with_push(function () use ($endpoint, $me) {
      db()->prepare('DELETE FROM push_subs WHERE endpoint_hash = ? AND user_id = ?')->execute([hash('sha256', $endpoint), $me['id']]);
    });
    ok(['ok' => true]);
  }

  case 'status': {
    $n = with_push(function () use ($me) {
      $st = db()->prepare('SELECT COUNT(*) FROM push_subs WHERE user_id = ?'); $st->execute([$me['id']]);
      return (int)$st->fetchColumn();
    });
    ok(['subscribed' => $n > 0, 'devices' => $n, 'available' => push_vapid() !== null]);
  }

  case 'selftest': {
    // Vérifie la chaîne crypto sans dépendre d'un vrai appareil :
    // (1) HKDF contre le vecteur connu RFC 5869, (2) chiffre puis déchiffre (round-trip),
    // (3) signature ES256 -> 64 octets, (4) clé VAPID valide.
    $out = [];
    // (1) RFC 5869 test case 1
    $okm = hkdf_sha256(hex2bin('000102030405060708090a0b0c'), str_repeat("\x0b", 22), hex2bin('f0f1f2f3f4f5f6f7f8f9'), 42);
    $out['hkdf_rfc5869'] = bin2hex($okm) === '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865';
    // (2) round-trip chiffrement (générer un abonné factice, chiffrer, redériver, déchiffrer)
    try {
      $ua = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
      $ud = openssl_pkey_get_details($ua);
      $uaPub = "\x04" . str_pad($ud['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ud['ec']['y'], 32, "\0", STR_PAD_LEFT);
      $authSecret = random_bytes(16);
      $msg = 'Bonjour Sport Salle 💪';
      $body = webpush_encrypt($uaPub, $authSecret, $msg);
      // déchiffrement côté "UA"
      $salt = substr($body, 0, 16);
      $asPub = substr($body, 21, 65);
      $ct = substr($body, 86);
      $shared = openssl_pkey_derive(ec_pub_pem_from_raw($asPub), $ua, 32);
      $ikm = hkdf_sha256($authSecret, $shared, "WebPush: info\x00" . $uaPub . $asPub, 32);
      $cek = hkdf_sha256($salt, $ikm, "Content-Encoding: aes128gcm\x00", 16);
      $nonce = hkdf_sha256($salt, $ikm, "Content-Encoding: nonce\x00", 12);
      $tag = substr($ct, -16); $ctData = substr($ct, 0, -16);
      $dec = openssl_decrypt($ctData, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '');
      $out['encrypt_roundtrip'] = ($dec !== false) && rtrim($dec, "\x02") === $msg;
    } catch (Throwable $e) { $out['encrypt_roundtrip'] = false; $out['err'] = $e->getMessage(); }
    // (3) signature -> 64 octets
    try {
      $v = push_vapid();
      openssl_sign('abc', $der, openssl_pkey_get_private($v['priv_pem']), OPENSSL_ALGO_SHA256);
      $out['sig_raw_64'] = strlen(der_to_raw_sig($der)) === 64;
    } catch (Throwable $e) { $out['sig_raw_64'] = false; }
    // (4) clé VAPID
    $v = push_vapid();
    $out['vapid_key_valid'] = $v && strlen($v['pub_raw']) === 65 && $v['pub_raw'][0] === "\x04";
    $out['all_pass'] = !in_array(false, [$out['hkdf_rfc5869'], $out['encrypt_roundtrip'], $out['sig_raw_64'], $out['vapid_key_valid']], true);
    ok($out);
  }

  default:
    fail(400, 'action inconnue');
}
