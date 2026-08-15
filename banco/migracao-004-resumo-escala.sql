-- =============================================================================
--  MIGRAÇÃO 004 — resumo da escala
--
--  Cole no phpMyAdmin, aba SQL, com o banco selecionado. Roda uma vez.
--  Seguro em banco com dados: nada é apagado.
--
--  O QUE MUDA
--  Parte do resumo da escala (pessoas, dias, folgas, ajustes) o servidor
--  consegue recalcular sozinho a partir da grade; a contagem de regras
--  feridas não, porque quem roda o validador é o navegador. Por isso o
--  resumo pronto chega do cliente e fica guardado aqui, para a tela de
--  listagem não precisar reprocessar a grade toda vez.
-- =============================================================================

ALTER TABLE escalas
  ADD COLUMN resumo JSON NULL AFTER parametros;

-- =============================================================================
--  Conferência — a consulta abaixo deve devolver a coluna nova:
--
--  SHOW COLUMNS FROM escalas WHERE Field = 'resumo';
-- =============================================================================
