#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DB=teste_migracoes_legadas
mysqladmin -u root -h 127.0.0.1 ping
mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4;"
mysql -u root -h 127.0.0.1 "$DB" < banco/mysql-schema.sql

# Simula registros de uma base anterior às relações 006/007/008. O schema base
# já possui as colunas de compatibilidade, mas ainda não possui as tabelas novas.
E=$(cat /proc/sys/kernel/random/uuid); L=$(cat /proc/sys/kernel/random/uuid); U=$(cat /proc/sys/kernel/random/uuid); S=$(cat /proc/sys/kernel/random/uuid)
C=$(cat /proc/sys/kernel/random/uuid); A=$(cat /proc/sys/kernel/random/uuid)
mysql -u root -h 127.0.0.1 "$DB" <<SQL
INSERT INTO empresas (id,nome,codigo_convite) VALUES ('$E','Empresa Legada','LEGADA01');
INSERT INTO lojas (id,empresa_id,nome,parametros,ordem) VALUES ('$L','$E','Loja Legada','{}',0);
INSERT INTO usuarios (id,empresa_id,email,senha_hash,nome,papel,email_confirmado) VALUES ('$U','$E','gestor.legado@exemplo.test','hash','Gestor Legado','gestor',1);
INSERT INTO colaboradores (id,loja_id,nome,cargo,horario,jornada,primeiro_domingo) VALUES ('$C','$L','Pessoa Legada','CAIXA','08:00 AS 16:00','{"entrada":"08:00","saida":"16:00","intervalos":[]}','2026-01-04');
INSERT INTO ausencias (id,colaborador_id,tipo,ini,fim) VALUES ('$A','$C','F','2026-02-01','2026-02-10');
INSERT INTO escalas (id,loja_id,inicio,fim,grade,parametros,atualizado_por,atualizado_em) VALUES ('$S','$L','2026-01-01','2026-01-31','{"$C":["X",""]}','{"modelo":"5x2","_horas":{"$C":{"1":"09:00 AS 17:00"}}}','$U','2026-01-15 10:20:30');
SQL

# O checksum inclui os valores originais e a data de alteração, não as novas
# colunas. A migração não pode reescrever a grade, os horários ou o autor.
SQL_ESCALA="SELECT SHA2(CONCAT_WS('|',id,loja_id,inicio,fim,grade,parametros,atualizado_por,atualizado_em),256) FROM escalas WHERE id='$S';"
ESCALA_ANTES=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "$SQL_ESCALA")

# Testa a entrada documentada de produção, sozinha. Executar a 007 antes desta
# asserção esconderia sua ausência no script cumulativo.
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null
PUBLICADA=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM escalas e JOIN escala_versoes v ON v.escala_id=e.id AND v.versao=e.versao_publicada WHERE e.id='$S' AND e.publicada=1 AND v.publicada=1 AND JSON_EXTRACT(v.snapshot,'$.incompleto')=TRUE AND v.grade=e.grade AND v.parametros=e.parametros AND v.criado_em='2026-01-15 10:20:30';")
[[ "$PUBLICADA" = 1 ]] || { echo "script cumulativo não preservou a publicação legada" >&2; exit 1; }
[[ "$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "$SQL_ESCALA")" = "$ESCALA_ANTES" ]] || { echo "migração alterou conteúdo ou data da escala legada" >&2; exit 1; }

# Simula uma base que ainda não registrou a 006, mas já tem o vínculo único.
mysql -u root -h 127.0.0.1 "$DB" -e "DELETE FROM migracoes_aplicadas WHERE nome='006-supervisor-multiloja'; UPDATE usuarios SET loja_id='$L' WHERE id='$U';"
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null
COUNT1=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM escala_versoes WHERE escala_id='$S';")
LINK1=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';")
echo "after-first: versions=$COUNT1 supervisor_links=$LINK1"
[[ "$COUNT1" = 1 && "$LINK1" = 1 ]] || { echo "legacy backfill assertion failed" >&2; exit 1; }
mysql -u root -h 127.0.0.1 "$DB" -e "DELETE FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';"
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-006-supervisor-multiloja.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-007-historico-versoes.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-008-descricao-cadastros.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null
COUNT2=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM escala_versoes WHERE escala_id='$S';")
LINK2=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM supervisor_lojas WHERE usuario_id='$U' AND loja_id='$L';")
COLS=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND ((table_name='lojas' AND column_name='versao') OR (table_name='empresas' AND column_name='descricao') OR (table_name='lojas' AND column_name='descricao') OR (table_name='escalas' AND column_name='versao_publicada')); ")
echo "after-second: versions=$COUNT2 supervisor_links=$LINK2 fields=$COLS"
[[ "$COUNT2" = 1 && "$LINK2" = 0 && "$COLS" = 4 ]] || { echo "legacy rerun assertion failed" >&2; exit 1; }
[[ "$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "$SQL_ESCALA")" = "$ESCALA_ANTES" ]] || { echo "reexecução alterou a escala legada" >&2; exit 1; }
PRESERVADOS=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT (SELECT COUNT(*) FROM empresas WHERE id='$E' AND nome='Empresa Legada' AND codigo_convite='LEGADA01')+(SELECT COUNT(*) FROM usuarios WHERE id='$U' AND empresa_id='$E' AND senha_hash='hash' AND papel='gestor')+(SELECT COUNT(*) FROM lojas WHERE id='$L' AND empresa_id='$E' AND parametros=JSON_OBJECT())+(SELECT COUNT(*) FROM colaboradores WHERE id='$C' AND loja_id='$L' AND horario='08:00 AS 16:00' AND primeiro_domingo='2026-01-04' AND JSON_UNQUOTE(JSON_EXTRACT(jornada,'$.saida'))='16:00')+(SELECT COUNT(*) FROM ausencias WHERE id='$A' AND colaborador_id='$C' AND tipo='F' AND fim='2026-02-10');")
[[ "$PRESERVADOS" = 5 ]] || { echo "cadastros legados não foram preservados" >&2; exit 1; }
echo "migrações legadas: ok (escala_versoes=$COUNT2, vínculo revogado preservado=$LINK2, campos=$COLS)"
echo "preservação: ok (grade, horários, autor, datas, cadastros, jornada e ausência)"
