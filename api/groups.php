<?php
/**
 * Sport Salle v2 — groupes de sport : création, adhésion par code,
 * classement hebdo, liste des membres.
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

switch ($action) {

  case 'create': {
    $name = trim((string)($b['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 48) { fail(400, 'nom de groupe invalide (1-48 caractères)'); }
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $code = 'G-';
    for ($i = 0; $i < 8; $i++) { $code .= $alphabet[random_int(0, strlen($alphabet) - 1)]; }
    db()->prepare('INSERT INTO sport_groups (name, code, owner_id) VALUES (?,?,?)')->execute([$name, $code, $me['id']]);
    $gid = (int)db()->lastInsertId();
    db()->prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)')->execute([$gid, $me['id']]);
    ok(['ok' => true, 'group' => ['id' => $gid, 'name' => $name, 'code' => $code]]);
  }

  case 'join': {
    $code = strtoupper(trim((string)($b['code'] ?? '')));
    $st = db()->prepare('SELECT id, name, code FROM sport_groups WHERE code = ?');
    $st->execute([$code]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) { fail(404, 'aucun groupe avec ce code'); }
    db()->prepare('INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?,?)')->execute([(int)$g['id'], $me['id']]);
    ok(['ok' => true, 'group' => ['id' => (int)$g['id'], 'name' => $g['name'], 'code' => $g['code']]]);
  }

  case 'leave': {
    $gid = (int)($b['groupId'] ?? 0);
    db()->prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')->execute([$gid, $me['id']]);
    // dernier membre parti -> le groupe disparaît
    $st = db()->prepare('SELECT COUNT(*) FROM group_members WHERE group_id = ?');
    $st->execute([$gid]);
    if ((int)$st->fetchColumn() === 0) {
      db()->prepare('DELETE FROM sport_groups WHERE id = ?')->execute([$gid]);
    }
    ok(['ok' => true]);
  }

  case 'mine': {
    $st = db()->prepare(
      'SELECT g.id, g.name, g.code, g.owner_id,
              (SELECT COUNT(*) FROM group_members m2 WHERE m2.group_id = g.id) AS member_count
       FROM sport_groups g JOIN group_members m ON m.group_id = g.id
       WHERE m.user_id = ? ORDER BY g.created_at DESC'
    );
    $st->execute([$me['id']]);
    $groups = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $g) {
      $groups[] = [
        'id' => (int)$g['id'], 'name' => $g['name'], 'code' => $g['code'],
        'isOwner' => (int)$g['owner_id'] === $me['id'], 'memberCount' => (int)$g['member_count'],
      ];
    }
    ok(['groups' => $groups]);
  }

  case 'detail': {
    $gid = (int)($b['groupId'] ?? 0);
    if (!is_group_member($gid, $me['id'])) { fail(403, 'tu n’es pas membre de ce groupe'); }
    $st = db()->prepare('SELECT id, name, code, owner_id FROM sport_groups WHERE id = ?');
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) { fail(404, 'groupe introuvable'); }
    $st = db()->prepare(
      'SELECT u.id, u.username, u.display_name, u.avatar_emoji, u.accent
       FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?'
    );
    $st->execute([$gid]);
    $members = array_map('public_user', $st->fetchAll(PDO::FETCH_ASSOC));
    $stats = stats_for(array_map(fn($m) => $m['id'], $members));
    foreach ($members as &$m) { $m['stats'] = $stats[$m['id']] ?? null; }
    // classement hebdo : séances puis volume
    usort($members, function ($x, $y) {
      $c = (($y['stats']['weekCount'] ?? 0) <=> ($x['stats']['weekCount'] ?? 0));
      return $c !== 0 ? $c : (($y['stats']['weekVolume'] ?? 0) <=> ($x['stats']['weekVolume'] ?? 0));
    });
    ok(['group' => [
      'id' => (int)$g['id'], 'name' => $g['name'], 'code' => $g['code'],
      'isOwner' => (int)$g['owner_id'] === $me['id'],
    ], 'members' => $members]);
  }

  default:
    fail(400, 'action inconnue');
}
