-- =============================================================================
--  SUPERVISOR MULTILOJA — MySQL / HostGator
--
--  Um gestor pode supervisionar várias lojas da mesma empresa. A tabela passa a
--  ser a fonte exclusiva de autorização para o papel gestor. usuarios.loja_id
--  permanece intacta para colaboradores e para compatibilidade de dados legados.
--  Esta migração é idempotente e preserva cada vínculo único existente.
-- =============================================================================

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

-- O marcador impede que uma nova execução restaure um vínculo revogado.
CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
  nome       VARCHAR(100) NOT NULL PRIMARY KEY,
  aplicada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Converte o único vínculo antigo sem alterar usuarios.loja_id. Esta cópia só
-- ocorre na primeira execução da migração, antes de marcar sua conclusão.
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

SELECT COUNT(*) AS vinculos_supervisor FROM supervisor_lojas;
