-- ============================================================
-- Sport Salle — schéma MySQL/MariaDB (o2switch)
-- À importer une fois : cPanel → phpMyAdmin → ta base → onglet
-- « Importer » (ou colle ce contenu dans l'onglet SQL → Exécuter).
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_profiles (
  code       VARCHAR(64)  NOT NULL,
  profile_id VARCHAR(64)  NOT NULL,
  device_id  VARCHAR(64)  DEFAULT NULL,
  data       LONGTEXT     NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code, profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
