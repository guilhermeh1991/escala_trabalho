#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DB=teste_migracoes_legadas
mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4;"
mysql -u root -h 127.0.0.1 "$DB" < banco/mysql-schema.sql

# Simula registros de uma base anterior às relações 006/007/008. O schema base
# já possui as colunas de compatibilidade, mas ainda não possui as tabelas novas.
E=$(cat /proc/sys/kernel/random/uuid); L=$(cat /proc/sys/kernel/random/uuid); U=$(cat /proc/sys/kernel/random/uuid); S=$(cat /proc/sys/kernel/random/uuid)
mysql -u root -h 127.0.0.1 "$DB" <<SQL
INSERT INTO empresas (id,nome,codigo_convite) VALUES ('$E','Empresa Legada','LEGADA01');
INSERT INTO lojas (id,empresa_id,nome,codigo_convite,parametros,ordem) VALUES ('$L','$E','Loja Legada','LOJA0001','{}',0);
INSERT INTO usuarios (id,empresa_id,email,senha_hash,nome,papel,email_confirmado,loja_id) VALUES ('$U','$E','gestor.legado@exemplo.test','hash','Gestor Legado','gestor',1,'$L');
INSERT INTO escalas (id,loja_id,inicio,fim,grade,parametros,publicada,publicada_em,atualizado_por) VALUES ('$S','$L','2026-01-01','2026-01-31','{"c1":["X"]}','{"modelo":"5x2"}',1,'2026-01-01 10:00:00','$U');
SQL
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-006-supervisor-multiloja.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-007-historico-versoes.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-008-descricao-cadastros.sql >/dev/null
COUNT1=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM escala_versoes WHERE escala_id='$S';")
LINK1=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';")
[[ "$COUNT1" = 1 && "$LINK1" = 1 ]]
mysql -u root -h 127.0.0.1 "$DB" -e "DELETE FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';"
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-007-historico-versoes.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-008-descricao-cadastros.sql >/dev/null
COUNT2=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM escala_versoes WHERE escala_id='$S';")
LINK2=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';")
COLS=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND ((table_name='lojas' AND column_name='versao') OR (table_name='empresas' AND column_name='descricao') OR (table_name='lojas' AND column_name='descricao') OR (table_name='escalas' AND column_name='versao_publicada')); ")
[[ "$COUNT2" = 1 && "$LINK2" = 0 && "$COLS" = 4 ]]
echo "migrações legadas: ok (escala_versoes=$COUNT2, vínculo revogado preservado=$LINK2, campos=$COLS)"
