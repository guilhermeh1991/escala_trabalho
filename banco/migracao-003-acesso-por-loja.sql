-- =============================================================================
--  MIGRAÇÃO 003 — acesso por loja
--
--  Cole no phpMyAdmin, aba SQL, com o banco selecionado. Roda uma vez.
--  Seguro em banco com dados: nada é apagado.
--
--  O QUE MUDA
--  Até aqui o isolamento era por empresa: qualquer gestor enxergava todas as
--  lojas da rede. Agora cada conta pode ficar presa a uma loja. Quem não tem
--  loja marcada continua vendo todas — é o caso do administrador.
--
--  Cada loja ganha também o próprio código de convite. Quem entra com o código
--  da loja vira gestor daquela loja e não vê as outras; quem entra com o código
--  da empresa continua vendo a rede inteira.
-- =============================================================================

-- 1. Conta presa a uma loja -------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN loja_id CHAR(36) NULL AFTER empresa_id;

ALTER TABLE usuarios
  ADD KEY ix_usuario_loja (loja_id);

-- Se a loja for apagada, a conta volta a enxergar a empresa toda em vez de
-- ficar órfã sem acesso a nada.
ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuario_loja FOREIGN KEY (loja_id)
    REFERENCES lojas(id) ON DELETE SET NULL;

-- 2. Código de convite por loja ---------------------------------------------
ALTER TABLE lojas
  ADD COLUMN codigo_convite CHAR(8) NULL AFTER nome;

ALTER TABLE lojas
  ADD UNIQUE KEY uq_loja_convite (codigo_convite);

-- Gera um código para as lojas que já existem.
-- O alfabeto evita caracteres que se confundem na leitura: 0/O, 1/I.
UPDATE lojas
   SET codigo_convite = UPPER(
         CONCAT(
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1),
           SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', FLOOR(1+RAND()*32), 1)
         ))
 WHERE codigo_convite IS NULL;

-- 3. Colaborador segue a loja da própria ficha ------------------------------
-- Quem já está vinculado como colaborador passa a ficar preso à loja dele.
UPDATE usuarios u
  JOIN colaboradores c ON c.id = u.colaborador_id
   SET u.loja_id = c.loja_id
 WHERE u.papel = 'colaborador' AND u.loja_id IS NULL;

-- =============================================================================
--  Conferência — as três consultas devem devolver as colunas novas:
--
--  SHOW COLUMNS FROM usuarios WHERE Field IN ('loja_id');
--  SHOW COLUMNS FROM lojas WHERE Field = 'codigo_convite';
--  SELECT nome, codigo_convite FROM lojas;
-- =============================================================================
