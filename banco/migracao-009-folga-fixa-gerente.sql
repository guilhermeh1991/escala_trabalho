-- =============================================================================
-- MIGRAÇÃO 009 — segunda folga fixa do gerente
--
-- Alteração aditiva: gerentes antigos permanecem com o fallback sábado+domingo
-- enquanto a ficha não preencher os dois dias fixos.
-- =============================================================================

SET @banco := DATABASE();
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='colaboradores'
               AND COLUMN_NAME='folga_fixa_2');
SET @sql := IF(@ja=0,
  'ALTER TABLE colaboradores ADD COLUMN folga_fixa_2 TINYINT NULL AFTER folga_fixa',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- A validação 0..6 fica no código para permitir instalação em versões MySQL
-- antigas que não aplicam CHECK de forma consistente.
