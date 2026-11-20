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
cleanup(){ rm -f "$COOKIE_P" "$COOKIE_A" "$COOKIE_S"; }
trap cleanup EXIT

mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4;"
mysql -u root -h 127.0.0.1 "$DB" < banco/mysql-schema.sql
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-002-colaborador.sql
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-003-acesso-por-loja.sql
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-004-resumo-escala.sql
mysql -u root -h 127.0.0.1 "$DB" < banco/migracao-005-jornada-estruturada.sql
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
nohup php -S 127.0.0.1:8877 -t . >/tmp/shiftflow-browser-php.log 2>&1 &
echo $! >/tmp/shiftflow-browser-php.pid
sleep 2

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
CSRF_S=$(prepare "$COOKIE_S" 'Supervisor Browser' "$SUP_EMAIL" "$SUP_PASSWORD")
request "$COOKIE_S" auth.php "{\"acao\":\"entrar_por_convite\",\"codigo\":\"$CONVITE\"}" "$CSRF_S" >/dev/null
# A operação de vínculo da empresa é preparada para o painel.
SUP_ID=$(mysql -u root -h 127.0.0.1 "$DB" -sN -e "SELECT id FROM usuarios WHERE email='$SUP_EMAIL';")
request "$COOKIE_A" auth.php "{\"acao\":\"supervisor_atribuir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A" >/dev/null

{
  echo "PLATFORM_EMAIL=$PLATFORM_EMAIL"
  echo "PLATFORM_PASSWORD=$PLATFORM_PASSWORD"
  echo "OPERADOR_EMAIL=$ADMIN_EMAIL"
  echo "OPERADOR_PASSWORD=$ADMIN_PASSWORD"
  echo "STORE_A=$LOJA_A"
  echo "STORE_B=$LOJA_B"
} >> "$GITHUB_ENV"
echo "fixture ready: empresa=$EMPRESA loja_a=$LOJA_A loja_b=$LOJA_B"
