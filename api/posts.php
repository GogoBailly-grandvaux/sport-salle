<?php
/**
 * Sport Salle v2 — fil social : posts (texte, séance, programme) + réactions.
 * Visibilité : mes posts + ceux de mes amis acceptés. Les réactions ne sont
 * possibles que sur les posts qu'on peut voir. Tout est borné et validé.
 */
require __DIR__ . '/lib.php';

$b = read_body();
$action = (string)($b['action'] ?? '');
$me = require_user();

const POST_EMOJIS = ['👊', '🔥', '💪', '👏'];

function ensure_posts_tables(): void {
  db()->exec("CREATE TABLE IF NOT EXISTS posts (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    INT UNSIGNED NOT NULL,
    kind       ENUM('text','workout','program') NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_posts_user (user_id, id),
    CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  db()->exec("CREATE TABLE IF NOT EXISTS post_reactions (
    post_id    INT UNSIGNED NOT NULL,
    user_id    INT UNSIGNED NOT NULL,
    emoji      VARCHAR(8) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_pr_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

/** Exécute $fn ; si les tables du fil n'existent pas encore, les crée et réessaie. */
function with_posts(callable $fn) {
  try { return $fn(); }
  catch (PDOException $e) {
    if ($e->getCode() !== '42S02') { throw $e; }
    ensure_posts_tables();
    return $fn();
  }
}

/** Nettoie une chaîne fournie par le client (bornée, sans chevrons). */
function clean_str($v, int $max): string {
  return mb_substr(str_replace(['<', '>'], '', trim((string)$v)), 0, $max);
}

switch ($action) {

  case 'feed': {
    $before = (int)($b['before'] ?? 0); // pagination : id du plus ancien post affiché
    $ids = array_merge([$me['id']], friend_ids($me['id']));
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $params = $ids;
    $whereBefore = '';
    if ($before > 0) { $whereBefore = ' AND p.id < ?'; $params[] = $before; }
    $rows = with_posts(function () use ($ph, $whereBefore, $params) {
      $st = db()->prepare(
        "SELECT p.id, p.user_id, p.kind, p.content, UNIX_TIMESTAMP(p.created_at) AS ts,
                u.id AS uid, u.username, u.display_name, u.avatar_emoji, u.accent
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.user_id IN ($ph)$whereBefore
         ORDER BY p.id DESC LIMIT 30"
      );
      $st->execute($params);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $posts = [];
    $postIds = array_map(fn($r) => (int)$r['id'], $rows);
    $reactions = []; $mine = [];
    if ($postIds) {
      $ph2 = implode(',', array_fill(0, count($postIds), '?'));
      $st = db()->prepare("SELECT post_id, emoji, COUNT(*) AS n FROM post_reactions WHERE post_id IN ($ph2) GROUP BY post_id, emoji");
      $st->execute($postIds);
      foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $reactions[(int)$r['post_id']][$r['emoji']] = (int)$r['n']; }
      $st = db()->prepare("SELECT post_id, emoji FROM post_reactions WHERE user_id = ? AND post_id IN ($ph2)");
      $st->execute(array_merge([$me['id']], $postIds));
      foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $mine[(int)$r['post_id']] = $r['emoji']; }
    }
    foreach ($rows as $r) {
      $pid = (int)$r['id'];
      $posts[] = [
        'id' => $pid,
        'kind' => $r['kind'],
        'content' => json_decode($r['content'], true) ?: new stdClass(),
        'ts' => (int)$r['ts'],
        'author' => public_user(['id' => $r['uid'], 'username' => $r['username'], 'display_name' => $r['display_name'], 'avatar_emoji' => $r['avatar_emoji'], 'accent' => $r['accent']]),
        'isMine' => (int)$r['user_id'] === $me['id'],
        'reactions' => $reactions[$pid] ?? new stdClass(),
        'myReaction' => $mine[$pid] ?? null,
      ];
    }
    ok(['posts' => $posts, 'hasMore' => count($rows) === 30]);
  }

  case 'of': {
    // posts d'UN utilisateur (page profil) — même règle de visibilité que profile
    $username = strtolower(trim((string)($b['username'] ?? '')));
    $before = (int)($b['before'] ?? 0);
    $row = with_profile_cols(function () use ($username) {
      $st = db()->prepare('SELECT id, privacy FROM users WHERE username = ?');
      $st->execute([$username]);
      return $st->fetch(PDO::FETCH_ASSOC);
    });
    if (!$row) { fail(404, 'utilisateur introuvable'); }
    $uid = (int)$row['id'];
    if (!can_view_content($me['id'], $uid, $row['privacy'] ?? 'friends')) { fail(403, 'compte privé — ajoute cette personne pour voir ses posts'); }
    $params = [$uid]; $whereBefore = '';
    if ($before > 0) { $whereBefore = ' AND p.id < ?'; $params[] = $before; }
    $rows = with_posts(function () use ($whereBefore, $params) {
      $st = db()->prepare(
        "SELECT p.id, p.user_id, p.kind, p.content, UNIX_TIMESTAMP(p.created_at) AS ts,
                u.id AS uid, u.username, u.display_name, u.avatar_emoji, u.accent
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.user_id = ?$whereBefore ORDER BY p.id DESC LIMIT 30");
      $st->execute($params);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    });
    $posts = []; $postIds = array_map(fn($r) => (int)$r['id'], $rows);
    $reactions = []; $mine = [];
    if ($postIds) {
      $ph2 = implode(',', array_fill(0, count($postIds), '?'));
      $st = db()->prepare("SELECT post_id, emoji, COUNT(*) AS n FROM post_reactions WHERE post_id IN ($ph2) GROUP BY post_id, emoji");
      $st->execute($postIds);
      foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $reactions[(int)$r['post_id']][$r['emoji']] = (int)$r['n']; }
      $st = db()->prepare("SELECT post_id, emoji FROM post_reactions WHERE user_id = ? AND post_id IN ($ph2)");
      $st->execute(array_merge([$me['id']], $postIds));
      foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $mine[(int)$r['post_id']] = $r['emoji']; }
    }
    foreach ($rows as $r) {
      $pid = (int)$r['id'];
      $posts[] = [
        'id' => $pid, 'kind' => $r['kind'],
        'content' => json_decode($r['content'], true) ?: new stdClass(),
        'ts' => (int)$r['ts'],
        'author' => public_user(['id' => $r['uid'], 'username' => $r['username'], 'display_name' => $r['display_name'], 'avatar_emoji' => $r['avatar_emoji'], 'accent' => $r['accent']]),
        'isMine' => (int)$r['user_id'] === $me['id'],
        'reactions' => $reactions[$pid] ?? new stdClass(),
        'myReaction' => $mine[$pid] ?? null,
      ];
    }
    ok(['posts' => $posts, 'hasMore' => count($rows) === 30]);
  }

  case 'publish': {
    rate_limit('post', 20, 3600); // max 20 posts/h
    $kind = (string)($b['kind'] ?? '');
    $c = $b['content'] ?? null;
    if (!is_array($c)) { fail(400, 'contenu invalide'); }
    $content = null;
    if ($kind === 'text') {
      $text = clean_str($c['text'] ?? '', 500);
      if ($text === '') { fail(400, 'le message est vide'); }
      $content = ['text' => $text];
    } elseif ($kind === 'workout') {
      $content = [
        'name' => clean_str($c['name'] ?? '', 80) ?: 'Séance',
        'sets' => max(0, min(200, (int)($c['sets'] ?? 0))),
        'volume' => max(0, min(1000000, (int)($c['volume'] ?? 0))),
        'durationSec' => max(0, min(6 * 3600, (int)($c['durationSec'] ?? 0))),
        'prs' => max(0, min(50, (int)($c['prs'] ?? 0))),
        'note' => clean_str($c['note'] ?? '', 300),
      ];
    } elseif ($kind === 'program') {
      $sharedId = (int)($c['sharedId'] ?? 0);
      // le programme référencé doit exister, m'appartenir et être visible amis (hors groupe)
      $st = db()->prepare('SELECT name, group_id FROM shared_programs WHERE id = ? AND user_id = ?');
      $st->execute([$sharedId, $me['id']]);
      $sp = $st->fetch(PDO::FETCH_ASSOC);
      if (!$sp || $sp['group_id'] !== null) { fail(400, 'programme introuvable ou réservé à un groupe'); }
      $content = [
        'sharedId' => $sharedId,
        'name' => clean_str($c['name'] ?? $sp['name'], 80),
        'exos' => max(0, min(50, (int)($c['exos'] ?? 0))),
      ];
    } else {
      fail(400, 'type de post inconnu');
    }
    $json = json_encode($content, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 4096) { fail(413, 'post trop volumineux'); }
    with_posts(function () use ($kind, $json, $me) {
      db()->prepare('INSERT INTO posts (user_id, kind, content) VALUES (?,?,?)')
        ->execute([$me['id'], $kind, $json]);
    });
    // ménage opportuniste : les posts de plus de 180 jours s'effacent
    try { db()->exec('DELETE FROM posts WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY) LIMIT 50'); } catch (PDOException $e) {}
    bump_live(friend_ids($me['id']));
    ok(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'react': {
    rate_limit('react', 60, 900); // max 60 réactions/15 min
    $postId = (int)($b['postId'] ?? 0);
    $emoji = (string)($b['emoji'] ?? '');
    $author = with_posts(function () use ($postId) {
      $st = db()->prepare('SELECT user_id FROM posts WHERE id = ?');
      $st->execute([$postId]);
      return $st->fetchColumn();
    });
    if ($author === false) { fail(404, 'post introuvable'); }
    $author = (int)$author;
    if ($author !== $me['id'] && !are_friends($me['id'], $author)) {
      $pub = with_profile_cols(function () use ($author) {
        $st = db()->prepare('SELECT privacy FROM users WHERE id = ?');
        $st->execute([$author]);
        return $st->fetchColumn();
      });
      if (($pub ?: 'friends') !== 'public') { fail(403, 'réservé aux amis'); }
    }
    if ($emoji === '') {
      db()->prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?')->execute([$postId, $me['id']]);
    } else {
      if (!in_array($emoji, POST_EMOJIS, true)) { fail(400, 'réaction inconnue'); }
      db()->prepare('INSERT INTO post_reactions (post_id, user_id, emoji) VALUES (?,?,?)
                     ON DUPLICATE KEY UPDATE emoji = VALUES(emoji)')->execute([$postId, $me['id'], $emoji]);
    }
    if ($author !== $me['id']) { bump_live([$author]); }
    ok(['ok' => true]);
  }

  case 'delete': {
    $postId = (int)($b['postId'] ?? 0);
    with_posts(function () use ($postId, $me) {
      db()->prepare('DELETE FROM posts WHERE id = ? AND user_id = ?')->execute([$postId, $me['id']]);
    });
    bump_live(friend_ids($me['id']));
    ok(['ok' => true]);
  }

  default:
    fail(400, 'action inconnue');
}
