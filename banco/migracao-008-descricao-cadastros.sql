-- =============================================================================
-- MIGRAÇÃO 008 — descrição de cadastros administrativos
--
-- Campos restritos a cadastro. Não altera equipe, parâmetros ou escalas.
-- =============================================================================
SET @banco := DATABASE();

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='empresas' AND COLUMN_NAME='descricao');
SET @sql := IF(@ja=0, 'ALTER TABLE empresas ADD COLUMN descricao VARCHAR(500) NULL AFTER nome', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='lojas' AND COLUMN_NAME='descricao');
SET @sql := IF(@ja=0, 'ALTER TABLE lojas ADD COLUMN descricao VARCHAR(500) NULL AFTER nome', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
