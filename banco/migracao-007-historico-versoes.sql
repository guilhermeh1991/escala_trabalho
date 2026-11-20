-- =============================================================================
--  MIGRAÇÃO 007 — versões imutáveis, snapshots e concorrência de escalas
--
--  Aditiva e segura para dados existentes. Registros legados recebem snapshot
--  marcado como incompleto: a aplicação não inventa participantes ou jornadas.
-- =============================================================================

SET @banco := DATABASE();

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='lojas' AND COLUMN_NAME='versao');
SET @sql := IF(@ja=0, 'ALTER TABLE lojas ADD COLUMN versao INT UNSIGNED NOT NULL DEFAULT 1', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='escalas' AND COLUMN_NAME='versao');
SET @sql := IF(@ja=0, 'ALTER TABLE escalas ADD COLUMN versao INT UNSIGNED NOT NULL DEFAULT 1', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='escalas' AND COLUMN_NAME='versao_publicada');
SET @sql := IF(@ja=0, 'ALTER TABLE escalas ADD COLUMN versao_publicada INT UNSIGNED NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS escala_versoes (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  escala_id      CHAR(36) NOT NULL,
  versao         INT UNSIGNED NOT NULL,
  loja_id        CHAR(36) NOT NULL,
  inicio         DATE NOT NULL,
  fim            DATE NOT NULL,
  grade          JSON NOT NULL,
  parametros     JSON NULL,
  resumo         JSON NULL,
  snapshot       JSON NOT NULL,
  publicada      TINYINT(1) NOT NULL DEFAULT 0,
  publicada_em   DATETIME NULL,
  idempotencia   CHAR(36) NULL,
  criado_por     CHAR(36) NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_escala_versao (escala_id, versao),
  UNIQUE KEY uq_escala_idempotencia (escala_id, idempotencia),
  KEY ix_versoes_loja_periodo (loja_id, inicio, fim, versao),
  CONSTRAINT fk_versao_escala FOREIGN KEY (escala_id) REFERENCES escalas(id) ON DELETE CASCADE,
  CONSTRAINT fk_versao_loja FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO escala_versoes
  (id, escala_id, versao, loja_id, inicio, fim, grade, parametros, resumo,
   snapshot, publicada, publicada_em, criado_por, criado_em)
SELECT UUID(), e.id, 1, e.loja_id, e.inicio, e.fim, e.grade, e.parametros, e.resumo,
       JSON_OBJECT(
         'schema', 1,
         'incompleto', true,
         'motivo', 'Registro legado sem participantes e jornadas históricas capturados',
         'loja_id', e.loja_id,
         'inicio', e.inicio,
         'fim', e.fim,
         'grade', e.grade,
         'params', e.parametros,
         'participantes', JSON_ARRAY()
       ),
       e.publicada, e.publicada_em, e.atualizado_por, e.atualizado_em
  FROM escalas e;

UPDATE escalas e
JOIN escala_versoes v ON v.escala_id=e.id AND v.versao=1
   SET e.versao_publicada=CASE WHEN e.publicada=1 THEN 1 ELSE NULL END
 WHERE e.versao_publicada IS NULL;
