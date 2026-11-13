-- =============================================================================
--  VERIFICAR E MIGRAR — MySQL / HostGator
--
--  Cole este arquivo INTEIRO na aba SQL do phpMyAdmin, com o banco de produção
--  selecionado, e execute de uma vez. É seguro rodá-lo mais de uma vez: cada
--  coluna, índice e chave estrangeira é conferido antes da alteração.
-- =============================================================================

SET NAMES utf8mb4;
SET @banco := DATABASE();

-- 1. Acesso individual do colaborador (migração 002) -------------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores'
               AND COLUMN_NAME = 'email');
SET @sql := IF(@ja = 0,
  'ALTER TABLE colaboradores ADD COLUMN email VARCHAR(190) NULL AFTER nome',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores'
               AND INDEX_NAME = 'uq_colab_email_loja');
SET @sql := IF(@ja = 0,
  'ALTER TABLE colaboradores ADD UNIQUE KEY uq_colab_email_loja (loja_id, email)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores'
               AND INDEX_NAME = 'ix_colab_email');
SET @sql := IF(@ja = 0,
  'ALTER TABLE colaboradores ADD KEY ix_colab_email (email)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores'
               AND COLUMN_NAME = 'criado_em');
SET @sql := IF(@ja = 0,
  'ALTER TABLE colaboradores ADD COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- MODIFY é naturalmente repetível e garante as quatro opções do ENUM.
ALTER TABLE usuarios
  MODIFY COLUMN papel ENUM('admin','gestor','leitor','colaborador')
    NOT NULL DEFAULT 'gestor';

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND COLUMN_NAME = 'colaborador_id');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD COLUMN colaborador_id CHAR(36) NULL AFTER empresa_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND INDEX_NAME = 'ix_usuario_colab');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD KEY ix_usuario_colab (colaborador_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND CONSTRAINT_NAME = 'fk_usuario_colab'
               AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_colab FOREIGN KEY (colaborador_id) REFERENCES colaboradores(id) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- O backfill só deve acontecer quando o controle de publicação nasce. Guardamos
-- o estado das duas colunas antes de criá-las: isso também recupera uma execução
-- antiga que parou depois de criar `publicada`, mas antes de `publicada_em`.
SET @criou_publicada := (SELECT COUNT(*) = 0 FROM INFORMATION_SCHEMA.COLUMNS
                          WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas'
                            AND COLUMN_NAME = 'publicada');
SET @criou_publicada_em := (SELECT COUNT(*) = 0 FROM INFORMATION_SCHEMA.COLUMNS
                             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas'
                               AND COLUMN_NAME = 'publicada_em');
SET @sql := IF(@criou_publicada,
  'ALTER TABLE escalas ADD COLUMN publicada TINYINT(1) NOT NULL DEFAULT 0 AFTER parametros',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas'
               AND COLUMN_NAME = 'publicada_em');
SET @sql := IF(@ja = 0,
  'ALTER TABLE escalas ADD COLUMN publicada_em DATETIME NULL AFTER publicada',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@criou_publicada OR @criou_publicada_em,
  'UPDATE escalas SET publicada = 1, publicada_em = atualizado_em WHERE publicada = 0',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Jornada estruturada por colaborador ------------------------------------------
-- A coluna é opcional: o horário textual e, principalmente, a âncora de domingo
-- já cadastrados permanecem intactos durante a migração.
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores'
               AND COLUMN_NAME = 'jornada');
SET @sql := IF(@ja = 0,
  'ALTER TABLE colaboradores ADD COLUMN jornada JSON NULL AFTER horario',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Acesso por loja (migração 003) ------------------------------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND COLUMN_NAME = 'loja_id');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD COLUMN loja_id CHAR(36) NULL AFTER empresa_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND INDEX_NAME = 'ix_usuario_loja');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD KEY ix_usuario_loja (loja_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = @banco AND TABLE_NAME = 'usuarios'
               AND CONSTRAINT_NAME = 'fk_usuario_loja'
               AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@ja = 0,
  'ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_loja FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'lojas'
               AND COLUMN_NAME = 'codigo_convite');
SET @sql := IF(@ja = 0,
  'ALTER TABLE lojas ADD COLUMN codigo_convite CHAR(8) NULL AFTER nome',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'lojas'
               AND INDEX_NAME = 'uq_loja_convite');
SET @sql := IF(@ja = 0,
  'ALTER TABLE lojas ADD UNIQUE KEY uq_loja_convite (codigo_convite)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Gera código só para lojas ainda sem convite. O alfabeto evita 0/O e 1/I.
UPDATE lojas
   SET codigo_convite = UPPER(CONCAT(
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1),
         SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1 + RAND() * 32), 1)))
 WHERE codigo_convite IS NULL;

-- Contas de colaborador seguem a loja da própria ficha.
UPDATE usuarios u
  JOIN colaboradores c ON c.id = u.colaborador_id
   SET u.loja_id = c.loja_id
 WHERE u.papel = 'colaborador' AND u.loja_id IS NULL;

-- 3. Resumo da escala (migração 004) -----------------------------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas'
               AND COLUMN_NAME = 'resumo');
SET @sql := IF(@ja = 0,
  'ALTER TABLE escalas ADD COLUMN resumo JSON NULL AFTER parametros',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =============================================================================
--  CONFERÊNCIA FINAL
--  Todas as colunas abaixo devem mostrar 1. Se alguma mostrar 0, rode este
--  arquivo inteiro novamente ou informe o erro exibido pelo phpMyAdmin.
-- =============================================================================
SELECT
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores' AND COLUMN_NAME = 'email') AS colaboradores_email,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores' AND COLUMN_NAME = 'criado_em') AS colaboradores_criado_em,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'colaboradores' AND COLUMN_NAME = 'jornada') AS colaboradores_jornada,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'colaborador_id') AS usuarios_colaborador_id,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'loja_id') AS usuarios_loja_id,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'lojas' AND COLUMN_NAME = 'codigo_convite') AS lojas_codigo_convite,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'publicada') AS escalas_publicada,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'publicada_em') AS escalas_publicada_em,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'resumo') AS escalas_resumo;
