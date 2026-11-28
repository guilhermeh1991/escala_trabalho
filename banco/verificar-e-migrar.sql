-- =============================================================================
--  VERIFICAR E MIGRAR — MySQL / HostGator
--
--  Atualização de uma base existente: primeiro backup/restauração de teste e
--  pausa das gravações, conforme docs/11-atualizacao-hostgator.md. Selecione o
--  banco correto no phpMyAdmin. Inclui as migrações 002 a 008. As alterações
--  Inclui as migrações 002 a 009. As alterações são repetíveis, mas DDL no
--  MySQL faz commit implícito: erro exige interromper
--  a publicação e conferir o estado, não contar com rollback automático.
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
  'UPDATE escalas SET publicada = 1, publicada_em = atualizado_em, atualizado_em = atualizado_em WHERE publicada = 0',
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

-- 4. Supervisores em várias lojas (migração 006) ------------------------------
CREATE TABLE IF NOT EXISTS supervisor_lojas (
  usuario_id CHAR(36) NOT NULL,
  loja_id    CHAR(36) NOT NULL,
  criado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, loja_id),
  KEY ix_supervisor_loja (loja_id, usuario_id),
  CONSTRAINT fk_supervisor_loja_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_supervisor_loja_loja FOREIGN KEY (loja_id)
    REFERENCES lojas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
  nome       VARCHAR(100) NOT NULL PRIMARY KEY,
  aplicada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO supervisor_lojas (usuario_id, loja_id)
SELECT u.id, u.loja_id
  FROM usuarios u
  JOIN lojas l ON l.id = u.loja_id AND l.empresa_id = u.empresa_id
 WHERE u.papel = 'gestor'
   AND u.loja_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM migracoes_aplicadas m
      WHERE m.nome = '006-supervisor-multiloja'
   );

INSERT IGNORE INTO migracoes_aplicadas (nome)
VALUES ('006-supervisor-multiloja');

-- 3. Resumo da escala (migração 004) -----------------------------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas'
               AND COLUMN_NAME = 'resumo');
SET @sql := IF(@ja = 0,
  'ALTER TABLE escalas ADD COLUMN resumo JSON NULL AFTER parametros',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Descrições dos cadastros administrativos (migração 008) ------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='empresas' AND COLUMN_NAME='descricao');
SET @sql := IF(@ja=0, 'ALTER TABLE empresas ADD COLUMN descricao VARCHAR(500) NULL AFTER nome', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='lojas' AND COLUMN_NAME='descricao');
SET @sql := IF(@ja=0, 'ALTER TABLE lojas ADD COLUMN descricao VARCHAR(500) NULL AFTER nome', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5b. Segunda folga fixa do gerente (migração 009) ----------------------------
SET @ja := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=@banco AND TABLE_NAME='colaboradores'
               AND COLUMN_NAME='folga_fixa_2');
SET @sql := IF(@ja=0,
  'ALTER TABLE colaboradores ADD COLUMN folga_fixa_2 TINYINT NULL AFTER folga_fixa',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. Histórico e concorrência (migração 007) ---------------------------------
-- Manter equivalente a migracao-007-historico-versoes.sql. Apenas as grades
-- existentes são copiadas; nomes e jornadas históricos não são inventados.
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
   SET e.versao_publicada=CASE WHEN e.publicada=1 THEN 1 ELSE NULL END,
       e.atualizado_em=e.atualizado_em
 WHERE e.versao_publicada IS NULL;

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
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'resumo') AS escalas_resumo,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'lojas' AND COLUMN_NAME = 'versao') AS lojas_versao,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'versao') AS escalas_versao,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escalas' AND COLUMN_NAME = 'versao_publicada') AS escalas_versao_publicada,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'empresas' AND COLUMN_NAME = 'descricao') AS empresas_descricao,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'lojas' AND COLUMN_NAME = 'descricao') AS lojas_descricao,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'supervisor_lojas') AS tabela_supervisor_lojas,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = @banco AND TABLE_NAME = 'escala_versoes') AS tabela_escala_versoes;
