-- ============================================================
-- Sport Salle v2 — comptes, amis, groupes, partage, synchro par compte
-- À importer dans phpMyAdmin (onglet SQL de ta base). Idempotent.
-- La table v1 `sync_profiles` (synchro par code) reste utilisée
-- pour les profils sans compte.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(32)  NOT NULL,
  display_name  VARCHAR(64)  NOT NULL,
  pass_hash     VARCHAR(255) NOT NULL,
  google_sub    VARCHAR(64)  DEFAULT NULL,
  email         VARCHAR(190) DEFAULT NULL,
  avatar_emoji  VARCHAR(16)  DEFAULT NULL,
  accent        VARCHAR(16)  DEFAULT 'ember',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP    NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Amitiés : paire normalisée (user_lo < user_hi)
CREATE TABLE IF NOT EXISTS friendships (
  user_lo    INT UNSIGNED NOT NULL,
  user_hi    INT UNSIGNED NOT NULL,
  status     ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
  requester  INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_lo, user_hi),
  KEY idx_friend_hi (user_hi),
  CONSTRAINT fk_fr_lo FOREIGN KEY (user_lo) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_fr_hi FOREIGN KEY (user_hi) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Groupes de sport (GROUPS est un mot réservé -> sport_groups)
CREATE TABLE IF NOT EXISTS sport_groups (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(64)  NOT NULL,
  code       VARCHAR(24)  NOT NULL,
  owner_id   INT UNSIGNED NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_code (code),
  CONSTRAINT fk_grp_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  KEY idx_gm_user (user_id),
  CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES sport_groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_user  FOREIGN KEY (user_id)  REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Programmes partagés (visibles des amis, ou d'un groupe si group_id non nul)
CREATE TABLE IF NOT EXISTS shared_programs (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  group_id   INT UNSIGNED DEFAULT NULL,
  name       VARCHAR(80)  NOT NULL,
  payload    LONGTEXT     NOT NULL,
  downloads  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sp_user (user_id),
  KEY idx_sp_group (group_id),
  CONSTRAINT fk_sp_user  FOREIGN KEY (user_id)  REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_group FOREIGN KEY (group_id) REFERENCES sport_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Synchro par compte : un instantané par utilisateur (multi-appareils)
CREATE TABLE IF NOT EXISTS user_snapshots (
  user_id    INT UNSIGNED NOT NULL,
  data       LONGTEXT     NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_snap_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stats publiques (visibles des amis / groupes) — envoyées par le client au push
CREATE TABLE IF NOT EXISTS user_stats (
  user_id         INT UNSIGNED NOT NULL,
  last_workout_at BIGINT       DEFAULT NULL,
  last_workout    VARCHAR(120) DEFAULT NULL,
  week_start      BIGINT       DEFAULT NULL,
  week_count      INT UNSIGNED NOT NULL DEFAULT 0,
  week_volume     INT UNSIGNED NOT NULL DEFAULT 0,
  streak          INT UNSIGNED NOT NULL DEFAULT 0,
  total_workouts  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_stats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
