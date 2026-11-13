-- =============================================================================
--  MIGRAÇÃO 005 — jornada estruturada por colaborador
--
--  Cole no phpMyAdmin, aba SQL, com o banco selecionado. Roda uma vez.
--  Seguro em banco que já possui dados: nada é apagado nem recalculado.
--
--  A nova coluna guarda modelo, entrada, saída e intervalo da jornada padrão.
--  O campo horario e os campos primeiro_domingo / folga_fixa permanecem como
--  estão; logo, nenhuma âncora de domingo já preenchida é perdida.
-- =============================================================================

ALTER TABLE colaboradores
  ADD COLUMN jornada JSON NULL AFTER horario;

-- =============================================================================
--  Conferência — a consulta deve devolver a coluna nova:
--
--  SHOW COLUMNS FROM colaboradores WHERE Field = 'jornada';
-- =============================================================================
