<?php
/**
 * Sport Salle — Web Push (protocole complet en PHP pur, zéro dépendance).
 * - VAPID (RFC 8292) : JWT ES256, clé auto-générée et stockée en base (app_kv).
 * - Chiffrement du message (RFC 8291, aes128gcm) : ECDH P-256 + HKDF-SHA256.
 * - Envoi fire-and-forget après la réponse (fastcgi/litespeed_finish_request).
 * Requis par lib.php. Ne s'exécute rien tout seul : uniquement des fonctions.
 */

// ---- base64url ----
function b64url_encode(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64url_decode(string $s): string { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

// ---- petit magasin clé/valeur (VAPID) ----
function app_kv_ensure(): void {
  db()->exec('CREATE TABLE IF NOT EXISTS app_kv (k VARCHAR(40) NOT NULL PRIMARY KEY, v MEDIUMTEXT NOT NULL)
              ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}
function app_kv_get(string $k): ?string {
  try {
    $st = db()->prepare('SELECT v FROM app_kv WHERE k = ?'); $st->execute([$k]);
    $v = $st->fetchColumn(); return $v === false ? null : (string)$v;
  } catch (PDOException $e) { if ($e->getCode() === '42S02') { app_kv_ensure(); return null; } throw $e; }
}
function app_kv_set(string $k, string $v): void {
  try { db()->prepare('INSERT INTO app_kv (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, $v]); }
  catch (PDOException $e) { if ($e->getCode() === '42S02') { app_kv_ensure(); db()->prepare('INSERT INTO app_kv (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, $v]); } else { throw $e; } }
}

/** Identité VAPID du serveur (générée une fois, persistée). Retourne pub b64url + PEM privé + point brut. */
function push_vapid(): ?array {
  static $c = null; if ($c !== null) return $c ?: null;
  if (!function_exists('openssl_pkey_new')) { $c = false; return null; }
  $pub = app_kv_get('vapid_pub'); $priv = app_kv_get('vapid_priv');
  if (!$pub || !$priv) {
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$key) { $c = false; return null; }
    openssl_pkey_export($key, $pem);
    $d = openssl_pkey_get_details($key);
    $raw = "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
    $pub = b64url_encode($raw); $priv = $pem;
    app_kv_set('vapid_pub', $pub); app_kv_set('vapid_priv', $priv);
  }
  $c = ['pub' => $pub, 'priv_pem' => $priv, 'pub_raw' => b64url_decode($pub)];
  return $c;
}

// ---- HKDF-SHA256 (RFC 5869) ----
function hkdf_sha256(string $salt, string $ikm, string $info, int $len): string {
  $prk = hash_hmac('sha256', $ikm, $salt, true);
  $out = ''; $t = ''; $i = 1;
  while (strlen($out) < $len) { $t = hash_hmac('sha256', $t . $info . chr($i), $prk, true); $out .= $t; $i++; }
  return substr($out, 0, $len);
}

// ---- clé publique EC (PEM) à partir d'un point brut de 65 octets ----
function ec_pub_pem_from_raw(string $raw65): string {
  $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw65;
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

// ---- signature ECDSA DER -> R||S brut (64 octets) ----
function der_to_raw_sig(string $der): string {
  $off = 0;
  if (ord($der[$off++]) !== 0x30) { throw new Exception('sig'); }
  if (ord($der[$off]) & 0x80) { $off += 1 + (ord($der[$off]) & 0x7f); } else { $off++; }
  if (ord($der[$off++]) !== 0x02) { throw new Exception('sig r'); }
  $rlen = ord($der[$off++]); $r = substr($der, $off, $rlen); $off += $rlen;
  if (ord($der[$off++]) !== 0x02) { throw new Exception('sig s'); }
  $slen = ord($der[$off++]); $s = substr($der, $off, $slen);
  $r = ltrim($r, "\x00"); $s = ltrim($s, "\x00");
  return str_pad($r, 32, "\0", STR_PAD_LEFT) . str_pad($s, 32, "\0", STR_PAD_LEFT);
}

// ---- en-têtes VAPID pour un endpoint ----
function vapid_headers(string $endpoint): array {
  $v = push_vapid(); if (!$v) { throw new Exception('vapid'); }
  $aud = (parse_url($endpoint, PHP_URL_SCHEME) ?: 'https') . '://' . (parse_url($endpoint, PHP_URL_HOST) ?: '');
  $h = b64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
  $p = b64url_encode(json_encode(['aud' => $aud, 'exp' => time() + 43200, 'sub' => 'mailto:hugo.baillygrandvaux@gmail.com']));
  $input = $h . '.' . $p;
  $pk = openssl_pkey_get_private($v['priv_pem']);
  openssl_sign($input, $der, $pk, OPENSSL_ALGO_SHA256);
  $jwt = $input . '.' . b64url_encode(der_to_raw_sig($der));
  return ['Authorization: vapid t=' . $jwt . ', k=' . $v['pub']];
}

/**
 * Chiffre $plaintext pour un abonné (RFC 8291, content-encoding aes128gcm).
 * $asPrivPem/$fixedSalt : injection pour l'auto-test (sinon éphémère aléatoire).
 */
function webpush_encrypt(string $uaPubRaw, string $authSecret, string $plaintext, ?string $asPrivPem = null, ?string $fixedSalt = null): string {
  $eph = $asPrivPem ? openssl_pkey_get_private($asPrivPem)
                    : openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
  $ed = openssl_pkey_get_details($eph);
  $asPub = "\x04" . str_pad($ed['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ed['ec']['y'], 32, "\0", STR_PAD_LEFT);
  $shared = openssl_pkey_derive(ec_pub_pem_from_raw($uaPubRaw), $eph, 32);
  if ($shared === false) { throw new Exception('ecdh'); }

  $salt = $fixedSalt ?? random_bytes(16);
  $ikm  = hkdf_sha256($authSecret, $shared, "WebPush: info\x00" . $uaPubRaw . $asPub, 32);
  $cek  = hkdf_sha256($salt, $ikm, "Content-Encoding: aes128gcm\x00", 16);
  $nonce = hkdf_sha256($salt, $ikm, "Content-Encoding: nonce\x00", 12);

  $record = $plaintext . "\x02"; // délimiteur de dernier enregistrement (RFC 8188)
  $tag = '';
  $ct = openssl_encrypt($record, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
  $header = $salt . pack('N', 4096) . chr(65) . $asPub; // salt | rs | idlen | keyid(as_public)
  return $header . $ct . $tag;
}

/** Envoie une notification chiffrée à un abonnement. Retourne le code HTTP (0 si échec réseau). */
function push_send(array $sub, string $payloadJson): int {
  try {
    $body = webpush_encrypt(b64url_decode($sub['p256dh']), b64url_decode($sub['auth']), $payloadJson);
    $headers = array_merge(vapid_headers($sub['endpoint']), ['Content-Encoding: aes128gcm', 'TTL: 86400', 'Content-Type: application/octet-stream']);
    $ch = curl_init($sub['endpoint']);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
      CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 4]);
    curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return $code;
  } catch (Throwable $e) { error_log('push_send: ' . $e->getMessage()); return 0; }
}

// ---- file d'envoi (traitée APRÈS la réponse au client) ----
function push_enqueue(int $userId, string $kind, int $actorId, ?string $meta): void {
  if ($userId === $actorId || $userId <= 0) { return; }
  $GLOBALS['__pushq'][] = ['to' => $userId, 'kind' => $kind, 'actor' => $actorId, 'meta' => $meta];
}
function push_payload(string $kind, string $actorName, ?string $meta): array {
  $n = $actorName;
  switch ($kind) {
    case 'friend_req': return ['title' => 'Nouvelle demande d’ami', 'body' => "$n veut t’ajouter"];
    case 'friend_acc': return ['title' => 'Demande acceptée 🤝', 'body' => "$n t’a ajouté"];
    case 'react':      return ['title' => "$n", 'body' => 'a réagi ' . ($meta ?: '👊') . ' à ton post'];
    case 'comment':    return ['title' => "$n a répondu", 'body' => $meta ?: '💬'];
    case 'mention':    return ['title' => "$n t’a mentionné", 'body' => $meta ?: ''];
    case 'challenge':  return ['title' => "$n — défi 💪", 'body' => $meta === 'a rejoint' ? "$n a rejoint ton défi !" : "$n te défie cette semaine ($meta)"];
    default:           return ['title' => 'Sport Salle', 'body' => $n];
  }
}
function push_flush(): void {
  $jobs = $GLOBALS['__pushq'] ?? []; if (!$jobs) { return; }
  if (function_exists('fastcgi_finish_request')) { @fastcgi_finish_request(); }
  elseif (function_exists('litespeed_finish_request')) { @litespeed_finish_request(); }
  try {
    if (!push_vapid()) { return; } // openssl EC indisponible : on abandonne proprement
    $actorIds = array_values(array_unique(array_map(fn($j) => $j['actor'], $jobs)));
    $names = [];
    if ($actorIds) {
      $ph = implode(',', array_fill(0, count($actorIds), '?'));
      $st = db()->prepare("SELECT id, display_name FROM users WHERE id IN ($ph)");
      $st->execute($actorIds);
      foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $names[(int)$r['id']] = $r['display_name']; }
    }
    $subsByUser = [];
    foreach ($jobs as $j) {
      $to = $j['to'];
      if (!isset($subsByUser[$to])) {
        $st = db()->prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?');
        $st->execute([$to]);
        $subsByUser[$to] = $st->fetchAll(PDO::FETCH_ASSOC);
      }
      if (!$subsByUser[$to]) { continue; }
      $pl = push_payload($j['kind'], $names[$j['actor']] ?? 'Quelqu’un', $j['meta']);
      $payload = json_encode(['title' => $pl['title'], 'body' => $pl['body'], 'url' => '/#/social', 'tag' => $j['kind'] . ':' . $j['actor']], JSON_UNESCAPED_UNICODE);
      foreach ($subsByUser[$to] as $sub) {
        $code = push_send($sub, $payload);
        if ($code === 404 || $code === 410) { // abonnement mort -> on le purge
          db()->prepare('DELETE FROM push_subs WHERE endpoint = ?')->execute([$sub['endpoint']]);
        }
      }
    }
  } catch (Throwable $e) { error_log('push_flush: ' . $e->getMessage()); }
}
register_shutdown_function('push_flush');
