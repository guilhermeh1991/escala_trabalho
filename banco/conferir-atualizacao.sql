-- SOMENTE LEITURA. Execute após verificar-e-migrar.sql, com a aplicação parada.
-- Guarde a saída de forma privada. Os indicadores de inconsistência devem ser 0.
SELECT VERSION() AS versao_servidor, DATABASE() AS banco_selecionado;

SELECT 'empresas' AS tabela, COUNT(*) AS registros FROM empresas
UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
UNION ALL SELECT 'lojas', COUNT(*) FROM lojas
UNION ALL SELECT 'colaboradores', COUNT(*) FROM colaboradores
UNION ALL SELECT 'ausencias', COUNT(*) FROM ausencias
UNION ALL SELECT 'escalas', COUNT(*) FROM escalas
UNION ALL SELECT 'escala_versoes', COUNT(*) FROM escala_versoes
UNION ALL SELECT 'supervisor_lojas', COUNT(*) FROM supervisor_lojas;

SELECT COUNT(*) AS escalas_sem_versao_atual
  FROM escalas e LEFT JOIN escala_versoes v
    ON v.escala_id=e.id AND v.versao=e.versao
 WHERE v.id IS NULL;

SELECT COUNT(*) AS publicacoes_sem_versao_publicada
  FROM escalas e LEFT JOIN escala_versoes v
    ON v.escala_id=e.id AND v.versao=e.versao_publicada
 WHERE e.publicada=1 AND (v.id IS NULL OR v.publicada<>1);

SELECT COUNT(*) AS vinculos_de_supervisor_inconsistentes
  FROM supervisor_lojas sl
  LEFT JOIN usuarios u ON u.id=sl.usuario_id
  LEFT JOIN lojas l ON l.id=sl.loja_id
 WHERE u.id IS NULL OR l.id IS NULL OR u.papel<>'gestor'
    OR u.empresa_id IS NULL OR u.empresa_id<>l.empresa_id;

-- Informativo: não reatribua automaticamente vínculos ausentes, pois podem
-- corresponder a revogações intencionais.
SELECT COUNT(*) AS gestores_sem_lojas_informativo
  FROM usuarios u LEFT JOIN supervisor_lojas sl ON sl.usuario_id=u.id
 WHERE u.papel='gestor' AND u.empresa_id IS NOT NULL AND sl.usuario_id IS NULL;
