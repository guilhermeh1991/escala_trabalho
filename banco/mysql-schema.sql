-- =============================================================================
--  ESCALA — banco MySQL (HostGator / cPanel)  —  PARTE 1 de 2
--
--  ORDEM DE EXECUÇÃO
--    1º  este arquivo (mysql-schema.sql)
--    2º  migracao-002-colaborador.sql
--
--  Quem já rodou este arquivo antes só precisa rodar a migração.
--
--  Cole no phpMyAdmin, aba SQL, com o banco já selecionado.
--
--  DIFERENÇA IMPORTANTE EM RELAÇÃO AO POSTGRES
--  O MySQL não tem Row Level Security. O isolamento entre empresas é feito
--  pelo PHP, em api/comum.php, onde toda consulta passa por funções que
--  já embutem o filtro de empresa. Nenhuma consulta monta SQL solto.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- -----------------------------------------------------------------------------
--  Empresas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  codigo_convite CHAR(8)      NOT NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_convite (codigo_convite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Usuários
--  senha_hash guarda o resultado de password_hash() do PHP — bcrypt ou argon2.
--  Nunca a senha, nunca um hash simples como SHA ou MD5.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  empresa_id     CHAR(36)     NULL,
  email          VARCHAR(190) NOT NULL,
  senha_hash     VARCHAR(255) NOT NULL,
  nome           VARCHAR(120) NOT NULL,
  papel          ENUM('admin','gestor','leitor') NOT NULL DEFAULT 'gestor',
  email_confirmado TINYINT(1) NOT NULL DEFAULT 0,
  token_confirmacao CHAR(64)  NULL,
  token_recuperacao CHAR(64)  NULL,
  token_expira   DATETIME     NULL,
  ultimo_acesso  DATETIME     NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  KEY ix_empresa (empresa_id),
  KEY ix_token_conf (token_confirmacao),
  KEY ix_token_rec (token_recuperacao),
  CONSTRAINT fk_usuario_empresa FOREIGN KEY (empresa_id)
    REFERENCES empresas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Controle de tentativas de entrada
--  Segura ataque de força bruta sem depender de serviço externo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tentativas_login (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chave     VARCHAR(190) NOT NULL,   -- e-mail ou endereço de origem
  em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sucesso   TINYINT(1)   NOT NULL DEFAULT 0,
  KEY ix_chave_em (chave, em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Lojas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lojas (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  empresa_id CHAR(36)    NOT NULL,
  nome       VARCHAR(80) NOT NULL,
  parametros JSON        NULL,
  ordem      INT         NOT NULL DEFAULT 0,
  criado_em  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_empresa_ordem (empresa_id, ordem),
  CONSTRAINT fk_loja_empresa FOREIGN KEY (empresa_id)
    REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Colaboradores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colaboradores (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  loja_id          CHAR(36)    NOT NULL,
  nome             VARCHAR(80) NOT NULL,
  cargo            VARCHAR(40) NOT NULL DEFAULT 'BALCONISTA',
  horario          VARCHAR(40) NULL,
  gerente          TINYINT(1)  NOT NULL DEFAULT 0,
  ativo            TINYINT(1)  NOT NULL DEFAULT 1,
  folga_fixa       TINYINT     NULL,      -- 0=domingo ... 6=sábado
  primeiro_domingo DATE        NULL,
  dias_desde_folga TINYINT     NULL,
  ordem            INT         NOT NULL DEFAULT 0,
  KEY ix_loja_ordem (loja_id, ordem),
  CONSTRAINT fk_colab_loja FOREIGN KEY (loja_id)
    REFERENCES lojas(id) ON DELETE CASCADE,
  CONSTRAINT ck_folga_fixa CHECK (folga_fixa IS NULL OR folga_fixa BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Ausências
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ausencias (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  colaborador_id CHAR(36) NOT NULL,
  tipo           ENUM('F','AT','LC','FC') NOT NULL,
  ini            DATE     NOT NULL,
  fim            DATE     NOT NULL,
  KEY ix_colab (colaborador_id),
  CONSTRAINT fk_aus_colab FOREIGN KEY (colaborador_id)
    REFERENCES colaboradores(id) ON DELETE CASCADE,
  CONSTRAINT ck_periodo CHECK (fim >= ini)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Escalas fechadas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalas (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  loja_id        CHAR(36) NOT NULL,
  inicio         DATE     NOT NULL,
  fim            DATE     NOT NULL,
  grade          JSON     NOT NULL,
  parametros     JSON     NULL,
  atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por CHAR(36) NULL,
  UNIQUE KEY uq_escala (loja_id, inicio, fim),
  KEY ix_loja_inicio (loja_id, inicio),
  CONSTRAINT fk_escala_loja FOREIGN KEY (loja_id)
    REFERENCES lojas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Trilha de auditoria
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_acoes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id CHAR(36)     NULL,
  empresa_id CHAR(36)     NULL,
  acao       VARCHAR(60)  NOT NULL,
  detalhe    JSON         NULL,
  origem     VARCHAR(45)  NULL,
  em         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_empresa_em (empresa_id, em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
--  Limpeza de registros antigos de tentativa de entrada.
--  Se o plano não permitir EVENT, apague à mão de vez em quando ou ignore:
--  a tabela cresce devagar.
-- -----------------------------------------------------------------------------
-- SET GLOBAL event_scheduler = ON;
-- CREATE EVENT IF NOT EXISTS limpar_tentativas
--   ON SCHEDULE EVERY 1 DAY
--   DO DELETE FROM tentativas_login WHERE em < (NOW() - INTERVAL 7 DAY);
