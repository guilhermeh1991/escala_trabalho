#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="http://127.0.0.1:8877"
DB="teste_escala"
PLATFORM_EMAIL="plataforma.browser@exemplo.test"
PLATFORM_PASSWORD="acesso corporativo nove maio"
ADMIN_EMAIL="admin.browser@exemplo.test"
ADMIN_PASSWORD="gestao operacional onze junho"
SUP_EMAIL="supervisor.browser@exemplo.test"
SUP_PASSWORD="loja autorizada doze junho"
COOKIE_P=$(mktemp); COOKIE_A=$(mktemp); COOKIE_S=$(mktemp)
PID_FILE="/tmp/shiftflow-browser-php.pid"
LOG_FILE="/tmp/shiftflow-browser-php.log"
cleanup(){
  local code=$?
  rm -f "$COOKIE_P" "$COOKIE_A" "$COOKIE_S"
  if [[ $code -ne 0 ]]; then
    if [[ -f "$PID_FILE" ]]; then kill "$(cat "$PID_FILE")" 2>/dev/null || true; rm -f "$PID_FILE"; fi
    rm -f api/config.php
  fi
}
trap cleanup EXIT

if [[ -f "$PID_FILE" ]]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4;"
mysql -u root -h 127.0.0.1 "$DB" < banco/mysql-schema.sql
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-006-supervisor-multiloja.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-007-historico-versoes.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-008-descricao-cadastros.sql >/dev/null
mysql -u root -h 127.0.0.1 "$DB" < banco/verificar-e-migrar.sql >/dev/null

cat > api/config.php <<PHP
<?php return [
  'bd_host'=>'127.0.0.1', 'bd_nome'=>'$DB', 'bd_usuario'=>'root', 'bd_senha'=>'',
  'endereco_site'=>'$BASE', 'email_remetente'=>'teste@local',
  'super_admins'=>['$PLATFORM_EMAIL'],
];
PHP
nohup php -S 127.0.0.1:8877 -t . >"$LOG_FILE" 2>&1 &
PHP_PID=$!
echo "$PHP_PID" >"$PID_FILE"
for _ in $(seq 1 30); do
  if ! kill -0 "$PHP_PID" 2>/dev/null; then
    echo "Servidor PHP encerrou prematuramente. Log:" >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  if curl -sS -X POST "$BASE/api/auth.php" -H 'Content-Type: application/json' -d '{"acao":"sessao"}' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

json(){ python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
request(){
  local cookie="$1" file="$2" body="$3" csrf="${4:-}" tmp
  tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$tmp" -w '%{http_code}' -c "$cookie" -b "$cookie" -X POST "$BASE/api/$file" \
    -H 'Content-Type: application/json' -H "Origin: $BASE" ${csrf:+-H "X-CSRF: $csrf"} -d "$body")
  if [[ "$status" != 2* ]]; then
    echo "API $file HTTP $status: $(<"$tmp")" >&2; rm -f "$tmp"; return 1
  fi
  cat "$tmp"; rm -f "$tmp"
}
prepare(){
  local cookie="$1" name="$2" email="$3" password="$4" csrf token
  csrf=$(request "$cookie" auth.php '{"acao":"sessao"}' | json csrf)
  request "$cookie" auth.php "{\"acao\":\"cadastrar\",\"nome\":\"$name\",\"email\":\"$email\",\"senha\":\"$password\"}" "$csrf" >/dev/null
  token=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT token_confirmacao FROM usuarios WHERE email='$email';")
  request "$cookie" auth.php "{\"acao\":\"confirmar\",\"token\":\"$token\"}" "$csrf" >/dev/null
  csrf=$(request "$cookie" auth.php '{"acao":"sessao"}' | json csrf)
  request "$cookie" auth.php "{\"acao\":\"entrar\",\"email\":\"$email\",\"senha\":\"$password\"}" "$csrf" >/dev/null
  request "$cookie" auth.php '{"acao":"sessao"}' | json csrf
}

CSRF_P=$(prepare "$COOKIE_P" 'Plataforma Browser' "$PLATFORM_EMAIL" "$PLATFORM_PASSWORD")
CSRF_A=$(prepare "$COOKIE_A" 'Admin Operacional' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
R=$(request "$COOKIE_A" auth.php '{"acao":"criar_empresa","nome":"Empresa Operacional Teste","loja":"Loja Operacional A"}' "$CSRF_A")
CONVITE=$(printf '%s' "$R" | json codigo_convite)
LOJA_A=$(printf '%s' "$R" | json loja_id)
EMPRESA=$(printf '%s' "$R" | json empresa_id)
R=$(request "$COOKIE_A" dados.php '{"acao":"criar_loja","nome":"Loja Operacional B","params":{}}' "$CSRF_A")
LOJA_B=$(printf '%s' "$R" | json id)

# Equipe representativa para o exercício real da escala: 100 pessoas, quatro
# competências, três jornadas efetivamente cadastradas e sem gerente. A faixa
# obrigatória de caixa tem cobertura redundante nos três turnos; isso deixa a
# publicação inicial válida e permite criar um bloqueio específico depois sem
# que regra de loja vazia ou falta de jornada mascare o cenário.
PARAMS_BROWSER='{"modelo":"5x2","folgasSemana":2,"cicloDomingo":3,"maxSeq":6,"inicioSemana":0,"minCaixa":0,"minBalcao":0,"minFarma":0,"minSubger":0,"minCaixaObrigatorio":1,"perfis":{"gerente-fds":{"nome":"Gerente — folga no fim de semana","base":"politica-da-casa","regras":{"folgaFixaSemanal":[0,6]}}},"minDia":{"0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0},"expediente":{"0":[{"ini":"07:00","fim":"22:00"}],"1":[{"ini":"07:00","fim":"22:00"}],"2":[{"ini":"07:00","fim":"22:00"}],"3":[{"ini":"07:00","fim":"22:00"}],"4":[{"ini":"07:00","fim":"22:00"}],"5":[{"ini":"07:00","fim":"22:00"}],"6":[{"ini":"07:00","fim":"22:00"}]},"faixas":{"0":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"1":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"2":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"3":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"4":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"5":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}],"6":[{"funcao":"caixa","ini":"08:00","fim":"20:00","meta":1,"obrigatorio":1}]},"funcoes":{"caixa":{"nome":"Caixa","cargos":["CAIXA"]},"balcao":{"nome":"Balcão","cargos":["BALCONISTA"]},"farmaceutico":{"nome":"Farmacêutico","cargos":["FARMACEUTICO"]},"subgerente":{"nome":"Subgerente","cargos":["SUBGERENTE"]}}}'
PARAMS_SQL=$(printf '%s' "$PARAMS_BROWSER" | sed "s/'/''/g")
mysql -u root -h 127.0.0.1 "$DB" -e "UPDATE lojas SET parametros='$PARAMS_SQL', versao=versao+1 WHERE id='$LOJA_A';"
SQL_EQUIPE=$(mktemp)
for i in $(seq 1 100); do
  mod=$(( (i - 1) % 6 )); turno=$(( (i - 1) % 3 ));
  case "$mod" in
    0|5) cargo='CAIXA' ;;
    1|4) cargo='BALCONISTA' ;;
    2) cargo='FARMACEUTICO' ;;
    3) cargo='SUB/FARMA' ;;
  esac
  case "$turno" in
    0) entrada='07:00'; saida='15:20' ;;
    1) entrada='09:00'; saida='17:20' ;;
    2) entrada='13:40'; saida='22:00' ;;
  esac
  printf "INSERT INTO colaboradores (id,loja_id,nome,cargo,horario,jornada,gerente,ativo,ordem) VALUES (UUID(),'%s','Pessoa Browser %03d','%s','%s AS %s','{\\\"entrada\\\":\\\"%s\\\",\\\"saida\\\":\\\"%s\\\",\\\"intervalos\\\":[]}',0,1,%d);\\n" \
    "$LOJA_A" "$i" "$cargo" "$entrada" "$saida" "$entrada" "$saida" "$i" >> "$SQL_EQUIPE"
  done
mysql -u root -h 127.0.0.1 "$DB" < "$SQL_EQUIPE"
rm -f "$SQL_EQUIPE"
CSRF_S=$(prepare "$COOKIE_S" 'Supervisor Browser' "$SUP_EMAIL" "$SUP_PASSWORD")
request "$COOKIE_S" auth.php "{\"acao\":\"entrar_por_convite\",\"codigo\":\"$CONVITE\"}" "$CSRF_S" >/dev/null
# A operação de vínculo da empresa é validada e deixada sem lojas pré-atribuídas
# para que o painel administrativo atribua STORE_A e STORE_B pelo seletor no navegador.
SUP_ID=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT id FROM usuarios WHERE email='$SUP_EMAIL';")
request "$COOKIE_A" auth.php "{\"acao\":\"supervisor_atribuir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A" >/dev/null
request "$COOKIE_A" auth.php "{\"acao\":\"supervisor_revogar_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A" >/dev/null
VINCULOS_INICIAIS=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT COUNT(*) FROM supervisor_lojas WHERE usuario_id='$SUP_ID';")
if [[ "$VINCULOS_INICIAIS" != "0" ]]; then
  echo "Erro de fixture: supervisor iniciou com $VINCULOS_INICIAIS vínculo(s) em supervisor_lojas" >&2
  exit 1
fi

# Registro fictício no formato da migração 007: grade/ajustes preservados sem
# inventar participantes históricos. Nenhum cadastro atual pode substituir IDs.
mysql -u root -h 127.0.0.1 "$DB" <<SQL
INSERT INTO escalas (id,loja_id,inicio,fim,grade,parametros,publicada,publicada_em,versao,versao_publicada)
VALUES ('00000000-0000-4000-8000-000000000007','$LOJA_A','2025-01-01','2025-01-02',
  '{"legado-pessoa-1":["","X"],"legado-pessoa-2":["F","AT"]}',
  '{"_horas":{"legado-pessoa-1":{"0":"09:00 AS 17:00"}}}',1,'2025-01-01 10:00:00',1,1);
INSERT INTO escala_versoes (id,escala_id,versao,loja_id,inicio,fim,grade,parametros,snapshot,publicada,publicada_em)
SELECT UUID(),id,1,loja_id,inicio,fim,grade,parametros,
  JSON_OBJECT('incompleto',true,'participantes',JSON_ARRAY(),'grade',grade),1,publicada_em
FROM escalas WHERE id='00000000-0000-4000-8000-000000000007';
SQL

{
  echo "PLATFORM_EMAIL=$PLATFORM_EMAIL"
  echo "PLATFORM_PASSWORD=$PLATFORM_PASSWORD"
  echo "OPERADOR_EMAIL=$ADMIN_EMAIL"
  echo "OPERADOR_PASSWORD=$ADMIN_PASSWORD"
  echo "SUPERVISOR_EMAIL=$SUP_EMAIL"
  echo "STORE_A=$LOJA_A"
  echo "STORE_B=$LOJA_B"
} >> "$GITHUB_ENV"
echo "fixture ready: empresa=$EMPRESA loja_a=$LOJA_A loja_b=$LOJA_B"
