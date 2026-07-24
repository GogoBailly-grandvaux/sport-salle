<?php
/**
 * Sport Salle v2 — social : recherche, demandes d'ami, liste, fil d'activité.
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

switch ($action) {

  case 'search': {
    rate_limit('search', 40, 900); // anti-énumération
    $q = strtolower(trim((string)($b['q'] ?? '')));
    if (strlen($q) < 2) { ok(['results' => []]); }
    $st = db()->prepare(
      'SELECT id, username, display_name, avatar_emoji, accent, avatar_photo FROM users
       WHERE (username LIKE ? OR LOWER(display_name) LIKE ?) AND id <> ? LIMIT 10'
    );
    $like = addcslashes($q, '%_\\') . '%';
    $st->execute([$like, $like, $me['id']]);
    $rows = array_map('public_user', $st->fetchAll(PDO::FETCH_ASSOC));
    // état de la relation pour chaque résultat
    foreach ($rows as &$r) { $r['relation'] = relation_state($me['id'], $r['id']); }
    ok(['results' => $rows]);
  }

  case 'request': {
    rate_limit('friendreq', 30, 3600); // anti-spam de demandes/notifications
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $st = db()->prepare('SELECT id FROM users WHERE username = ?');
    $st->execute([$username]);
    $target = $st->fetchColumn();
    if (!$target) { fail(404, 'utilisateur introuvable'); }
    $target = (int)$target;
    if ($target === $me['id']) { fail(400, 'tu ne peux pas t’ajouter toi-même 😄'); }
    [$lo, $hi] = friend_pair($me['id'], $target);
    $st = db()->prepare('SELECT status, requester FROM friendships WHERE user_lo = ? AND user_hi = ?');
    $st->execute([$lo, $hi]);
    $ex = $st->fetch(PDO::FETCH_ASSOC);
    if ($ex) {
      if ($ex['status'] === 'accepted') { fail(409, 'vous êtes déjà amis'); }
      if ((int)$ex['requester'] === $me['id']) { fail(409, 'demande déjà envoyée'); }
      // l'autre m'avait déjà demandé -> on accepte
      db()->prepare("UPDATE friendships SET status = 'accepted' WHERE user_lo = ? AND user_hi = ?")->execute([$lo, $hi]);
      notify($target, $me['id'], 'friend_acc');
      bump_live([$target]);
      ok(['ok' => true, 'accepted' => true]);
    }
    try {
      db()->prepare('INSERT INTO friendships (user_lo, user_hi, status, requester) VALUES (?,?,?,?)')
        ->execute([$lo, $hi, 'pending', $me['id']]);
    } catch (PDOException $e) {
      if ((int)$e->getCode() === 23000) { fail(409, 'demande déjà envoyée'); } // course : déjà créée
      throw $e;
    }
    notify($target, $me['id'], 'friend_req');
    bump_live([$target]);
    ok(['ok' => true, 'accepted' => false]);
  }

  case 'respond': {
    $other = (int)($b['userId'] ?? 0);
    $accept = (bool)($b['accept'] ?? false);
    [$lo, $hi] = friend_pair($me['id'], $other);
    $st = db()->prepare("SELECT requester FROM friendships WHERE user_lo = ? AND user_hi = ? AND status = 'pending'");
    $st->execute([$lo, $hi]);
    $req = $st->fetchColumn();
    if ($req === false) { fail(404, 'demande introuvable'); }
    if ((int)$req === $me['id']) { fail(400, 'tu ne peux pas répondre à ta propre demande'); }
    if ($accept) {
      db()->prepare("UPDATE friendships SET status = 'accepted' WHERE user_lo = ? AND user_hi = ?")->execute([$lo, $hi]);
      notify($other, $me['id'], 'friend_acc');
    } else {
      db()->prepare('DELETE FROM friendships WHERE user_lo = ? AND user_hi = ?')->execute([$lo, $hi]);
    }
    bump_live([$other]);
    ok(['ok' => true]);
  }

  case 'remove': {
    $other = (int)($b['userId'] ?? 0);
    [$lo, $hi] = friend_pair($me['id'], $other);
    db()->prepare('DELETE FROM friendships WHERE user_lo = ? AND user_hi = ?')->execute([$lo, $hi]);
    bump_live([$other]);
    ok(['ok' => true]);
  }

  case 'profile': {
    rate_limit('lookup', 100, 900); // anti-énumération (généreux : consultation légitime)
    // page profil publique : identité toujours ; contenu (stats/programmes)
    // uniquement si autorisé (soi-même, ami, ou compte public) — RGPD by design
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $row = with_profile_cols(function () use ($username) {
      $st = db()->prepare('SELECT id, username, display_name, avatar_emoji, accent, avatar_photo, instagram, verified, bio, privacy, gym, created_at FROM users WHERE username = ?');
      $st->execute([$username]);
      return $st->fetch(PDO::FETCH_ASSOC);
    });
    if (!$row) { fail(404, 'utilisateur introuvable'); }
    $uid = (int)$row['id'];
    $out = public_user($row);
    $out['memberSince'] = substr((string)$row['created_at'], 0, 10);
    $out['gym'] = $row['gym'] ?? null;
    $out['isPublic'] = ($row['privacy'] ?? 'friends') === 'public';
    $out['instagram'] = $row['instagram'] ?? null;
    $out['verified'] = (int)($row['verified'] ?? 0) === 1;
    $out['relation'] = relation_state($me['id'], $uid);
    $out['isMe'] = $uid === $me['id'];
    $canView = can_view_content($me['id'], $uid, $row['privacy'] ?? 'friends');
    $out['canView'] = $canView;
    if ($canView) {
      $out['bio'] = $row['bio']; // bio = contenu libre : visible seulement si autorisé
      $stats = stats_for([$uid]);
      $out['stats'] = $stats[$uid] ?? null;
      $st = db()->prepare('SELECT id, name, downloads, group_id, created_at FROM shared_programs
                           WHERE user_id = ? AND group_id IS NULL ORDER BY created_at DESC LIMIT 20');
      $st->execute([$uid]);
      $out['programs'] = array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'downloads' => (int)$r['downloads']], $st->fetchAll(PDO::FETCH_ASSOC));
    }
    ok(['profile' => $out]);
  }

  case 'list': {
    // amis acceptés + demandes reçues + demandes envoyées, avec stats pour les amis
    $st = db()->prepare(
      'SELECT f.user_lo, f.user_hi, f.status, f.requester,
              u.id, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
       FROM friendships f
       JOIN users u ON u.id = IF(f.user_lo = ?, f.user_hi, f.user_lo)
       WHERE f.user_lo = ? OR f.user_hi = ?'
    );
    $st->execute([$me['id'], $me['id'], $me['id']]);
    $friends = []; $incoming = []; $outgoing = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $u = public_user($r);
      if ($r['status'] === 'accepted') { $friends[] = $u; }
      elseif ((int)$r['requester'] === $me['id']) { $outgoing[] = $u; }
      else { $incoming[] = $u; }
    }
    $stats = stats_for(array_map(fn($f) => $f['id'], $friends));
    foreach ($friends as &$f) { $f['stats'] = $stats[$f['id']] ?? null; }
    // tri : dernière séance la plus récente d'abord
    usort($friends, fn($x, $y) => (($y['stats']['lastWorkoutAt'] ?? 0) <=> ($x['stats']['lastWorkoutAt'] ?? 0)));
    ok(['friends' => $friends, 'incoming' => $incoming, 'outgoing' => $outgoing]);
  }

  case 'gyms': {
    // Répertoire des salles : celles ayant au moins un compte PUBLIC (confidentialité).
    rate_limit('lookup', 100, 900);
    $q = gym_key((string)($b['q'] ?? ''));
    $rows = with_profile_cols(function () use ($q) {
      if ($q !== '') {
        $st = db()->prepare("SELECT MAX(gym) AS gym, gym_key, COUNT(*) AS n FROM users
          WHERE gym_key IS NOT NULL AND privacy = 'public' AND gym_key LIKE ?
          GROUP BY gym_key ORDER BY n DESC LIMIT 40");
        $st->execute(['%' . $q . '%']);
      } else {
        $st = db()->prepare("SELECT MAX(gym) AS gym, gym_key, COUNT(*) AS n FROM users
          WHERE gym_key IS NOT NULL AND privacy = 'public'
          GROUP BY gym_key ORDER BY n DESC LIMIT 40");
        $st->execute();
      }
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    ok(['gyms' => array_map(fn($r) => ['gym' => $r['gym'], 'key' => $r['gym_key'], 'count' => (int)$r['n']], $rows)]);
  }

  case 'gym': {
    // « Ma salle » (sans key) ou une salle du répertoire (avec key).
    // Confidentialité : seuls les comptes PUBLICS, mes amis, et moi sont listés.
    $key = isset($b['key']) && $b['key'] !== '' ? gym_key((string)$b['key']) : null;
    $me2 = with_profile_cols(function () use ($me) {
      $st = db()->prepare('SELECT gym, gym_key FROM users WHERE id = ?'); $st->execute([$me['id']]);
      return $st->fetch(PDO::FETCH_ASSOC);
    });
    $targetKey = $key ?: ($me2['gym_key'] ?? null);
    if (empty($targetKey)) { ok(['gym' => null, 'members' => [], 'isMine' => !$key]); }
    $targetName = $key ? null : ($me2['gym'] ?? null);
    $st = db()->prepare('SELECT id, username, display_name, avatar_emoji, accent, avatar_photo, gym, privacy FROM users WHERE gym_key = ? LIMIT 300');
    $st->execute([$targetKey]);
    $members = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $uid = (int)$r['id'];
      $visible = $uid === $me['id'] || ($r['privacy'] ?? 'friends') === 'public' || are_friends($me['id'], $uid);
      if (!$visible) { continue; }
      if ($targetName === null) { $targetName = $r['gym']; }
      $u = public_user($r); $u['isMe'] = $uid === $me['id'];
      $members[] = $u;
    }
    $stats = stats_for(array_map(fn($m) => $m['id'], $members));
    foreach ($members as &$m) { $m['stats'] = $stats[$m['id']] ?? null; }
    usort($members, function ($x, $y) {
      $c = (($y['stats']['weekCount'] ?? 0) <=> ($x['stats']['weekCount'] ?? 0));
      return $c !== 0 ? $c : (($y['stats']['weekVolume'] ?? 0) <=> ($x['stats']['weekVolume'] ?? 0));
    });
    ok(['gym' => $targetName, 'members' => $members, 'count' => count($members), 'isMine' => !$key]);
  }

  case 'notifs': {
    $rows = [];
    try {
      $st = db()->prepare(
        'SELECT n.id, n.kind, n.ref_id, n.meta, n.seen, UNIX_TIMESTAMP(n.created_at) AS ts,
                u.id AS uid, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo
         FROM notifs n JOIN users u ON u.id = n.actor_id
         WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 40');
      $st->execute([$me['id']]);
      $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) { if ($e->getCode() !== '42S02') { throw $e; } }
    $out = [];
    foreach ($rows as $r) {
      $out[] = [
        'id' => (int)$r['id'], 'kind' => $r['kind'],
        'refId' => $r['ref_id'] !== null ? (int)$r['ref_id'] : null,
        'meta' => $r['meta'], 'seen' => (bool)$r['seen'], 'ts' => (int)$r['ts'],
        'actor' => public_user(['id' => $r['uid'], 'username' => $r['username'], 'display_name' => $r['display_name'], 'avatar_emoji' => $r['avatar_emoji'], 'accent' => $r['accent'], 'avatar_photo' => $r['avatar_photo'] ?? null]),
      ];
    }
    // marquage lu à la consultation
    if (!empty($b['markSeen'])) {
      try { db()->prepare('UPDATE notifs SET seen = 1 WHERE user_id = ? AND seen = 0')->execute([$me['id']]); }
      catch (PDOException $e) { if ($e->getCode() !== '42S02') { throw $e; } }
    }
    ok(['notifs' => $out]);
  }

  default:
    fail(400, 'action inconnue');
}

function relation_state(int $me, int $other): string {
  [$lo, $hi] = friend_pair($me, $other);
  $st = db()->prepare('SELECT status, requester FROM friendships WHERE user_lo = ? AND user_hi = ?');
  $st->execute([$lo, $hi]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if (!$r) { return 'none'; }
  if ($r['status'] === 'accepted') { return 'friends'; }
  return ((int)$r['requester'] === $me) ? 'sent' : 'received';
}
