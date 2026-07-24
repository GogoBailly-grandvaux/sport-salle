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
    $q = strtolower(trim((string)($b['q'] ?? '')));
    if (strlen($q) < 2) { ok(['results' => []]); }
    $st = db()->prepare(
      'SELECT id, username, display_name, avatar_emoji, accent FROM users
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
      bump_live([$target]);
      ok(['ok' => true, 'accepted' => true]);
    }
    db()->prepare('INSERT INTO friendships (user_lo, user_hi, status, requester) VALUES (?,?,?,?)')
      ->execute([$lo, $hi, 'pending', $me['id']]);
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
    // page profil publique : identité toujours ; contenu (stats/programmes)
    // uniquement si autorisé (soi-même, ami, ou compte public) — RGPD by design
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $row = with_profile_cols(function () use ($username) {
      $st = db()->prepare('SELECT id, username, display_name, avatar_emoji, accent, bio, privacy, created_at FROM users WHERE username = ?');
      $st->execute([$username]);
      return $st->fetch(PDO::FETCH_ASSOC);
    });
    if (!$row) { fail(404, 'utilisateur introuvable'); }
    $uid = (int)$row['id'];
    $out = public_user($row);
    $out['bio'] = $row['bio'];
    $out['memberSince'] = substr((string)$row['created_at'], 0, 10);
    $out['isPublic'] = ($row['privacy'] ?? 'friends') === 'public';
    $out['relation'] = relation_state($me['id'], $uid);
    $out['isMe'] = $uid === $me['id'];
    $canView = can_view_content($me['id'], $uid, $row['privacy'] ?? 'friends');
    $out['canView'] = $canView;
    if ($canView) {
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
              u.id, u.username, u.display_name, u.avatar_emoji, u.accent
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
