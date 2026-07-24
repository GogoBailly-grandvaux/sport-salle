<?php
/**
 * Sport Salle v2 — partage de programmes entre utilisateurs
 * (visibles des amis, ou publiés dans un groupe).
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

switch ($action) {

  case 'publish': {
    rate_limit('publish', 40, 3600);
    $name = trim((string)($b['name'] ?? ''));
    $payload = $b['payload'] ?? null;
    $groupId = isset($b['groupId']) ? (int)$b['groupId'] : null;
    if ($name === '' || mb_strlen($name) > 80) { fail(400, 'nom invalide'); }
    if (!is_array($payload) || ($payload['kind'] ?? '') !== 'routine') { fail(400, 'programme invalide'); }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 512 * 1024) { fail(413, 'programme trop volumineux'); }
    if ($groupId !== null && !is_group_member($groupId, $me['id'])) { fail(403, 'tu n’es pas membre de ce groupe'); }
    // limite anti-spam : 30 publications max par utilisateur
    $st = db()->prepare('SELECT COUNT(*) FROM shared_programs WHERE user_id = ?');
    $st->execute([$me['id']]);
    if ((int)$st->fetchColumn() >= 30) { fail(429, 'limite de partages atteinte (30) — supprime-en d’abord'); }
    db()->prepare('INSERT INTO shared_programs (user_id, group_id, name, payload) VALUES (?,?,?,?)')
      ->execute([$me['id'], $groupId, $name, $json]);
    // notifie ceux qui peuvent le voir (amis, ou membres du groupe)
    bump_live($groupId !== null ? group_member_ids_of($groupId, $me['id']) : friend_ids($me['id']));
    ok(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'unpublish': {
    $id = (int)($b['id'] ?? 0);
    $st = db()->prepare('SELECT group_id FROM shared_programs WHERE id = ? AND user_id = ?');
    $st->execute([$id, $me['id']]);
    $gid = $st->fetch(PDO::FETCH_COLUMN);
    db()->prepare('DELETE FROM shared_programs WHERE id = ? AND user_id = ?')->execute([$id, $me['id']]);
    if ($gid !== false) {
      bump_live($gid !== null ? group_member_ids_of((int)$gid, $me['id']) : friend_ids($me['id']));
    }
    ok(['ok' => true]);
  }

  case 'mine': {
    $st = db()->prepare(
      'SELECT sp.id, sp.name, sp.downloads, sp.group_id, sp.created_at, g.name AS group_name
       FROM shared_programs sp LEFT JOIN sport_groups g ON g.id = sp.group_id
       WHERE sp.user_id = ? ORDER BY sp.created_at DESC'
    );
    $st->execute([$me['id']]);
    ok(['programs' => array_map('program_row', $st->fetchAll(PDO::FETCH_ASSOC))]);
  }

  case 'of': { // programmes d'un utilisateur (hors groupes) — amis ou compte public
    $uid = (int)($b['userId'] ?? 0);
    if (!owner_content_visible($me['id'], $uid)) { fail(403, 'réservé aux amis'); }
    $st = db()->prepare(
      'SELECT id, name, downloads, group_id, created_at FROM shared_programs
       WHERE user_id = ? AND group_id IS NULL ORDER BY created_at DESC'
    );
    $st->execute([$uid]);
    ok(['programs' => array_map('program_row', $st->fetchAll(PDO::FETCH_ASSOC))]);
  }

  case 'ofGroup': {
    $gid = (int)($b['groupId'] ?? 0);
    if (!is_group_member($gid, $me['id'])) { fail(403, 'tu n’es pas membre de ce groupe'); }
    $st = db()->prepare(
      'SELECT sp.id, sp.name, sp.downloads, sp.group_id, sp.created_at, u.username, u.display_name
       FROM shared_programs sp JOIN users u ON u.id = sp.user_id
       WHERE sp.group_id = ? ORDER BY sp.created_at DESC'
    );
    $st->execute([$gid]);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $row = program_row($r);
      $row['by'] = ['username' => $r['username'], 'displayName' => $r['display_name']];
      $rows[] = $row;
    }
    ok(['programs' => $rows]);
  }

  case 'explore': { // vitrine : les programmes partagés par MES AMIS, les plus importés d'abord
    $ids = friend_ids($me['id']);
    if (!$ids) { ok(['programs' => []]); }
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare(
      "SELECT sp.id, sp.name, sp.downloads, sp.group_id, sp.created_at,
              u.id AS uid, u.username, u.display_name, u.avatar_emoji, u.accent, u.avatar_photo, u.verified
       FROM shared_programs sp JOIN users u ON u.id = sp.user_id
       WHERE sp.user_id IN ($ph) AND sp.group_id IS NULL
       ORDER BY sp.downloads DESC, sp.created_at DESC LIMIT 30");
    $st->execute($ids);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $row = program_row($r);
      $row['by'] = public_user(['id' => $r['uid'], 'username' => $r['username'], 'display_name' => $r['display_name'], 'avatar_emoji' => $r['avatar_emoji'], 'accent' => $r['accent'], 'avatar_photo' => $r['avatar_photo'] ?? null, 'verified' => $r['verified'] ?? 0]);
      $out[] = $row;
    }
    ok(['programs' => $out]);
  }

  case 'import': {
    $id = (int)($b['id'] ?? 0);
    $st = db()->prepare('SELECT user_id, group_id, payload FROM shared_programs WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) { fail(404, 'programme introuvable'); }
    $ownerId = (int)$r['user_id'];
    $gid = $r['group_id'] !== null ? (int)$r['group_id'] : null;
    $allowed = ($ownerId === $me['id'])
      || ($gid !== null && is_group_member($gid, $me['id']))
      || ($gid === null && owner_content_visible($me['id'], $ownerId));
    if (!$allowed) { fail(403, 'accès refusé'); }
    db()->prepare('UPDATE shared_programs SET downloads = downloads + 1 WHERE id = ?')->execute([$id]);
    ok(['payload' => json_decode($r['payload'], true)]);
  }

  default:
    fail(400, 'action inconnue');
}

/** Contenu de $ownerId visible par $viewer ? (ami accepté ou compte public) */
function owner_content_visible(int $viewer, int $ownerId): bool {
  if ($viewer === $ownerId || are_friends($viewer, $ownerId)) { return true; }
  $pub = with_profile_cols(function () use ($ownerId) {
    $st = db()->prepare('SELECT privacy FROM users WHERE id = ?');
    $st->execute([$ownerId]);
    return $st->fetchColumn();
  });
  return ($pub ?: 'friends') === 'public';
}

/** Membres d'un groupe, sauf $except. */
function group_member_ids_of(int $groupId, int $except): array {
  $st = db()->prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ?');
  $st->execute([$groupId, $except]);
  return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function program_row(array $r): array {
  return [
    'id' => (int)$r['id'],
    'name' => $r['name'],
    'downloads' => (int)$r['downloads'],
    'groupId' => $r['group_id'] !== null ? (int)$r['group_id'] : null,
    'groupName' => $r['group_name'] ?? null,
    'createdAt' => $r['created_at'],
  ];
}
