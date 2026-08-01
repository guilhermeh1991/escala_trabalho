-- =============================================================================
--  MIGRAÇÃO 002 — acesso individual do colaborador  —  PARTE 2 de 2
--
--  Rode DEPOIS de mysql-schema.sql. Se o banco já existe e está em uso,
--  é só este arquivo que falta.
--
--  Cole no phpMyAdmin, aba SQL, com o banco selecionado. Roda uma vez.
--  É seguro rodar num banco que já tem dados: nada é apagado.
--
--  O QUE MUDA
--  Passa a existir um terceiro papel, "colaborador", que só enxerga a própria
--  escala. O vínculo entre a conta de acesso e a pessoa da escala é feito pelo
--  e-mail: o gestor cadastra o e-mail da pessoa na equipe, a pessoa se cadastra
--  com aquele mesmo e-mail e o sistema liga os dois sozinho.
-- =============================================================================

-- 1. E-mail do colaborador na ficha da equipe -------------------------------
ALTER TABLE colaboradores
  ADD COLUMN email VARCHAR(190) NULL AFTER nome;

-- Dois colaboradores da mesma loja não podem ter o mesmo e-mail
ALTER TABLE colaboradores
  ADD UNIQUE KEY uq_colab_email_loja (loja_id, email);

-- Busca por e-mail acontece no cadastro, precisa de índice
ALTER TABLE colaboradores
  ADD KEY ix_colab_email (email);

-- Data de cadastro da ficha, útil para ordenar e auditar
ALTER TABLE colaboradores
  ADD COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Novo papel e vínculo na conta de acesso --------------------------------
ALTER TABLE usuarios
  MODIFY COLUMN papel ENUM('admin','gestor','leitor','colaborador')
    NOT NULL DEFAULT 'gestor';

ALTER TABLE usuarios
  ADD COLUMN colaborador_id CHAR(36) NULL AFTER empresa_id;

ALTER TABLE usuarios
  ADD KEY ix_usuario_colab (colaborador_id);

-- Se a ficha do colaborador for apagada, a conta continua existindo, apenas
-- deixa de estar ligada a alguém da escala.
ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuario_colab FOREIGN KEY (colaborador_id)
    REFERENCES colaboradores(id) ON DELETE SET NULL;

-- 3. Controle de quais escalas o colaborador pode ver -----------------------
--    Uma escala só aparece para o colaborador depois que o gestor publica.
--    Assim ele não vê rascunho em cima da hora nem versão que ainda vai mudar.
ALTER TABLE escalas
  ADD COLUMN publicada TINYINT(1) NOT NULL DEFAULT 0 AFTER parametros;

ALTER TABLE escalas
  ADD COLUMN publicada_em DATETIME NULL AFTER publicada;

-- As escalas que já existiam entram como publicadas, para não desaparecerem.
UPDATE escalas SET publicada = 1, publicada_em = atualizado_em WHERE publicada = 0;

-- =============================================================================
--  Conferência: rode as três consultas abaixo. A saída esperada está no
--  comentário de cada uma.
-- =============================================================================

-- deve listar: email, colaborador_id, papel com 4 opções
-- SHOW COLUMNS FROM usuarios WHERE Field IN ('papel','colaborador_id');
-- SHOW COLUMNS FROM colaboradores WHERE Field = 'email';
-- SHOW COLUMNS FROM escalas WHERE Field IN ('publicada','publicada_em');
