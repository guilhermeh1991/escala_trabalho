#!/usr/bin/env bash
# =============================================================================
#  Teste de integração da API PHP.
#  Sobe um servidor PHP local, cria duas empresas e tenta invadir uma pela
#  outra. O teste de isolamento é o mais importante: como o MySQL não tem
#  Row Level Security, é o PHP que precisa barrar.
# =============================================================================
set -u
cd "$(dirname "$0")/.."

BASE="http://127.0.0.1:8877"
COOKIES_A=$(mktemp); COOKIES_B=$(mktemp); COOKIES_P=$(mktemp); COOKIES_S=$(mktemp)
falhas=0

ok()    { echo "  ok     $1"; }
falha() { echo "  FALHA  $1"; falhas=$((falhas+1)); }

chamar() { # $1=cookies $2=arquivo $3=json $4=csrf
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/$2" \
    -H 'Content-Type: application/json' \
        -H "Origin: $BASE" \
    ${4:+-H "X-CSRF: $4"} -d "$3"
}

# Mantém corpo e status separados para que testes de autorização não confundam
# sessão ausente com proibição correta.
chamar_com_status() { # define HTTP_STATUS e HTTP_BODY
  local cookies="$1" arquivo="$2" payload="$3" csrf="${4:-}" tmp
  tmp=$(mktemp)
  HTTP_STATUS=$(curl -s -o "$tmp" -w '%{http_code}' -c "$cookies" -b "$cookies" \
    -X POST "$BASE/api/$arquivo" -H 'Content-Type: application/json' \
    -H "Origin: $BASE" ${csrf:+-H "X-CSRF: $csrf"} -d "$payload")
  HTTP_BODY=$(<"$tmp")
  rm -f "$tmp"
}

json_true() {
  local campo="$1" corpo="$2"
  printf '%s' "$corpo" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get(sys.argv[1]) is True else 1)' "$campo"
}

json_false() {
  local campo="$1" corpo="$2"
  printf '%s' "$corpo" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get(sys.argv[1]) is False else 1)' "$campo"
}

json_logado_false() {
  json_false logado "$1"
}

json_loja_exata() {
  local corpo="$1" nome="$2"
  printf '%s' "$corpo" | python3 -c 'import json,sys; d=json.load(sys.stdin); lojas=d.get("lojas",{}); raise SystemExit(0 if any(x.get("nome")==sys.argv[1] for x in lojas.values()) else 1)' "$nome"
}

preparar_conta() { # cookies nome email senha csrf_destino
  local cookies="$1" nome="$2" email="$3" senha="$4" csrf_destino="$5"
  local csrf token
  chamar_com_status "$cookies" auth.php '{"acao":"sessao"}'
  [ "$HTTP_STATUS" = 200 ] && json_logado_false "$HTTP_BODY" || return 1
  csrf=$(printf '%s' "$HTTP_BODY" | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
  [ -n "$csrf" ] || return 1

  chamar_com_status "$cookies" auth.php "{\"acao\":\"cadastrar\",\"nome\":\"$nome\",\"email\":\"$email\",\"senha\":\"$senha\"}" "$csrf"
  [ "$HTTP_STATUS" = 200 ] && json_true ok "$HTTP_BODY" || return 1
  token=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT token_confirmacao FROM usuarios WHERE email='$email';")
  [ -n "$token" ] || return 1

  chamar_com_status "$cookies" auth.php "{\"acao\":\"confirmar\",\"token\":\"$token\"}" "$csrf"
  [ "$HTTP_STATUS" = 200 ] && json_true ok "$HTTP_BODY" || return 1

  chamar_com_status "$cookies" auth.php '{"acao":"sair"}' "$csrf"
  [ "$HTTP_STATUS" = 200 ] && json_true ok "$HTTP_BODY" || return 1
  chamar_com_status "$cookies" auth.php '{"acao":"sessao"}'
  csrf=$(printf '%s' "$HTTP_BODY" | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
  [ "$HTTP_STATUS" = 200 ] && [ -n "$csrf" ] || return 1

  chamar_com_status "$cookies" auth.php "{\"acao\":\"entrar\",\"email\":\"$email\",\"senha\":\"$senha\"}" "$csrf"
  [ "$HTTP_STATUS" = 200 ] && json_true ok "$HTTP_BODY" || return 1
  chamar_com_status "$cookies" auth.php '{"acao":"sessao"}'
  [ "$HTTP_STATUS" = 200 ] && json_true logado "$HTTP_BODY" || return 1
  csrf=$(printf '%s' "$HTTP_BODY" | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
  [ -n "$csrf" ] || return 1
  printf -v "$csrf_destino" '%s' "$csrf"
}

# --- preparar banco ---------------------------------------------------------
mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS teste_escala; CREATE DATABASE teste_escala CHARACTER SET utf8mb4;" 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/mysql-schema.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-002-colaborador.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-003-acesso-por-loja.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-004-resumo-escala.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-005-jornada-estruturada.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/verificar-e-migrar.sql >/dev/null \
  || falha "verificar-e-migrar.sql após as migrações"
mysql -u root -h 127.0.0.1 teste_escala < banco/verificar-e-migrar.sql >/dev/null \
  || falha "verificar-e-migrar.sql não foi idempotente"

cat > api/config.php <<'PHP'
<?php return [
  'bd_host'=>'127.0.0.1', 'bd_nome'=>'teste_escala',
  'bd_usuario'=>'root', 'bd_senha'=>'',
  'endereco_site'=>'http://127.0.0.1:8877', 'chave_criacao_empresa'=>'teste-ci-123',
  'email_remetente'=>'teste@local', 'super_admins'=>['plataforma@exemplo.test'],
];
PHP

php -S 127.0.0.1:8877 -t . > /tmp/phpserver.log 2>&1 &
SERVIDOR=$!
sleep 3

echo ""
echo "=== 1. Sessão e token ==="
RESP=$(chamar "$COOKIES_A" auth.php '{"acao":"sessao"}')
CSRF_A=$(echo "$RESP" | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
echo "$RESP" | grep -q '"logado":false' && ok "sessão limpa responde logado:false" || falha "sessão"
[ -n "$CSRF_A" ] && ok "token CSRF emitido" || falha "token CSRF ausente"

echo ""
echo "=== 2. Regras de senha (NIST) ==="
R=$(chamar "$COOKIES_A" auth.php '{"acao":"cadastrar","nome":"Ana","email":"ana@teste.com","senha":"curta"}' "$CSRF_A")
echo "$R" | grep -q "12 caracteres" && ok "senha curta recusada" || falha "senha curta aceita: $R"

R=$(chamar "$COOKIES_A" auth.php '{"acao":"cadastrar","nome":"Ana","email":"ana@teste.com","senha":"ana@teste.com123"}' "$CSRF_A")
echo "$R" | grep -q "e-mail dentro da senha" && ok "senha com o e-mail recusada" || falha "senha com e-mail aceita: $R"

R=$(chamar "$COOKIES_A" auth.php '{"acao":"cadastrar","nome":"Ana","email":"ana@teste.com","senha":"minhaescala2026"}' "$CSRF_A")
echo "$R" | grep -q 'Evite' && ok "senha com palavra óbvia recusada" || falha "palavra óbvia aceita: $R"

echo ""
echo "=== 3. CSRF ==="
R=$(chamar "$COOKIES_A" auth.php '{"acao":"cadastrar","nome":"X","email":"x@t.com","senha":"cavalo bateria grampo"}')
echo "$R" | grep -q "credencial" && ok "requisição sem token CSRF barrada" || falha "CSRF não exigido: $R"

echo ""
echo "=== 4. Cadastro e confirmação ==="
R=$(chamar "$COOKIES_A" auth.php '{"acao":"cadastrar","nome":"Ana Silva","email":"ana@teste.com","senha":"cavalo bateria grampo"}' "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "cadastro aceito" || falha "cadastro: $R"

HASH=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT senha_hash FROM usuarios WHERE email='ana@teste.com';")
case "$HASH" in
  \$argon2id\$*|\$2y\$*) ok "senha guardada com hash forte (${HASH:0:9}...)" ;;
  *) falha "hash inesperado: ${HASH:0:20}" ;;
esac
echo "$HASH" | grep -qi "cavalo" && falha "senha em claro no banco" || ok "senha não aparece em claro"

R=$(chamar "$COOKIES_A" auth.php '{"acao":"entrar","email":"ana@teste.com","senha":"cavalo bateria grampo"}' "$CSRF_A")
echo "$R" | grep -q "Confirme o e-mail" && ok "entrada bloqueada antes de confirmar" || falha "entrou sem confirmar: $R"

TOKEN=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT token_confirmacao FROM usuarios WHERE email='ana@teste.com';")
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"confirmar\",\"token\":\"$TOKEN\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "confirmação por token funciona" || falha "confirmação: $R"

echo ""
echo "=== 5. Não revelar quais e-mails existem ==="
R1=$(chamar "$COOKIES_B" auth.php '{"acao":"recuperar","email":"ana@teste.com"}' "$(chamar "$COOKIES_B" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)")
CSRF_B=$(chamar "$COOKIES_B" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
R2=$(chamar "$COOKIES_B" auth.php '{"acao":"recuperar","email":"naoexiste@teste.com"}' "$CSRF_B")
[ "$R1" = "$R2" ] && ok "recuperação responde igual para e-mail existente e inexistente" || falha "respostas diferentes revelam cadastro"

echo ""
echo "=== 6. Plataforma: autoridade separada e gestão autorizada ==="
if preparar_conta "$COOKIES_P" "Plataforma" "plataforma@exemplo.test" "acesso corporativo nove maio" CSRF_P; then
  ok "preparação da conta de plataforma: cadastro, confirmação, login e sessão"
else
  falha "preparação da conta de plataforma"
  exit 1
fi
R=$(chamar "$COOKIES_P" auth.php '{"acao":"plataforma_listar_empresas"}' "$CSRF_P")
echo "$R" | grep -q '"empresas"' && ok "plataforma lista empresas sem papel vindo do cliente" || falha "plataforma: $R"
R=$(chamar "$COOKIES_P" auth.php '{"acao":"plataforma_criar_empresa","nome":"Empresa Plataforma","loja":"Loja Plataforma"}' "$CSRF_P")
echo "$R" | grep -q '"ok":true' && ok "plataforma cria empresa e loja" || falha "criar empresa plataforma: $R"
EMPRESA_P=$(echo "$R" | grep -o '"empresa_id":"[^"]*"' | cut -d'"' -f4)
LOJA_P=$(echo "$R" | grep -o '"loja_id":"[^"]*"' | cut -d'"' -f4)
R=$(chamar "$COOKIES_P" auth.php "{\"acao\":\"plataforma_criar_loja\",\"empresa_id\":\"$EMPRESA_P\",\"nome\":\"Loja Plataforma 2\"}" "$CSRF_P")
echo "$R" | grep -q '"ok":true' && ok "plataforma cria loja em empresa autorizada" || falha "criar loja plataforma: $R"
R=$(chamar "$COOKIES_P" auth.php '{"acao":"plataforma_listar_lojas"}' "$CSRF_P")
echo "$R" | grep -q 'Loja Plataforma 2' && ok "plataforma lista lojas de empresas" || falha "listar lojas plataforma: $R"
R=$(chamar "$COOKIES_P" auth.php '{"acao":"criar_empresa","nome":"Forjada","papel":"admin"}' "$CSRF_P")
echo "$R" | grep -q "não pode\|plataforma\|empresa" && ok "fluxo comum não concede privilégio de plataforma" || falha "elevação por payload: $R"
chamar_com_status "$COOKIES_A" auth.php '{"acao":"plataforma_listar_empresas"}' "$CSRF_A"
[ "$HTTP_STATUS" = 403 ] && ok "admin de empresa não acessa plataforma" || falha "admin de empresa acessou plataforma: HTTP $HTTP_STATUS $HTTP_BODY"

echo ""
echo "=== 7. Empresa e convite ==="
CSRF_A=$(chamar "$COOKIES_A" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
R=$(chamar "$COOKIES_A" auth.php '{"acao":"criar_empresa","nome":"Drogaria A","chave":"teste-ci-123","loja":"Loja Teste A"}' "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "empresa criada" || falha "criar empresa: $R"
CONVITE_A=$(echo "$R" | grep -o '"codigo_convite":"[^"]*"' | cut -d'"' -f4)
EMPRESA_A=$(echo "$R" | grep -o '"empresa_id":"[^"]*"' | cut -d'"' -f4); LOJA_A=$(echo "$R" | grep -o '"loja_id":"[^"]*"' | cut -d'"' -f4)
PAPEL=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT papel FROM usuarios WHERE email='ana@teste.com';")
[ "$PAPEL" = "admin" ] && ok "quem cria a empresa vira admin" || falha "papel: $PAPEL"

R=$(chamar "$COOKIES_A" auth.php '{"acao":"criar_empresa","nome":"Outra"}' "$CSRF_A")
echo "$R" | grep -q "já pertence" && ok "segunda empresa recusada" || falha "criou duas empresas: $R"

echo ""
echo "=== 7. Segunda empresa, usuário separado ==="
CSRF_B=$(chamar "$COOKIES_B" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
chamar "$COOKIES_B" auth.php '{"acao":"cadastrar","nome":"Bruno","email":"bruno@outra.com","senha":"trovao janela verde"}' "$CSRF_B" > /dev/null
TOKEN_B=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT token_confirmacao FROM usuarios WHERE email='bruno@outra.com';")
chamar "$COOKIES_B" auth.php "{\"acao\":\"confirmar\",\"token\":\"$TOKEN_B\"}" "$CSRF_B" > /dev/null
CSRF_B=$(chamar "$COOKIES_B" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
R=$(chamar "$COOKIES_B" auth.php '{"acao":"criar_empresa","nome":"Drogaria B","chave":"teste-ci-123"}' "$CSRF_B")
EMPRESA_B=$(echo "$R" | grep -o '"empresa_id":"[^"]*"' | cut -d'"' -f4)
[ -n "$EMPRESA_B" ] && ok "segunda empresa criada por outro usuário" || falha "empresa B: $R"

echo ""
echo "=== 8. Dados: criar loja e salvar equipe ==="
R=$(chamar "$COOKIES_A" dados.php '{"acao":"criar_loja","nome":"Loja Teste B"}' "$CSRF_A")
LOJA_A2=$(echo "$R" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "$R" | grep -q '"ok":true' && ok "admin da empresa cria segunda loja" || falha "criar_loja: $R"

# supervisor sem vínculo explícito não pode consultar a empresa;
# o administrador da empresa atribui somente a segunda loja.
if preparar_conta "$COOKIES_S" "Supervisor Teste" "supervisor@exemplo.test" "loja autorizada doze junho" CSRF_S; then
  ok "preparação da conta de supervisor: cadastro, confirmação, login e sessão"
else
  falha "preparação da conta de supervisor"
  exit 1
fi
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q "Supervisor sem loja" && ok "supervisor sem vínculo explícito é barrado" || falha "supervisor sem vínculo: $R"
SUP_ID=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT id FROM usuarios WHERE email='supervisor@exemplo.test';")
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"definir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A2\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "admin vincula supervisor à loja autorizada" || falha "vínculo de supervisor: $R"
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q 'Loja Teste B' && ok "supervisor vê a loja vinculada" || falha "escopo do supervisor: $R"
R=$(chamar "$COOKIES_S" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\"}" "$CSRF_S")
echo "$R" | grep -q "não encontrada" && ok "supervisor não alcança outra loja por identificador" || falha "supervisor atravessou escopo: $R"
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"remover_acesso\",\"usuario_id\":\"$SUP_ID\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "admin revoga vínculo do supervisor" || falha "revogação: $R"
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q "sem empresa\|Sessão" && ok "supervisor revogado perde acesso" || falha "vínculo revogado ainda acessa: $R"

PAYLOAD=$(cat <<JSON
{"acao":"salvar","lojas":{"$LOJA_A":{"nome":"Loja Teste A","_ordem":0,"params":{"modelo":"5x2"},
"colabs":[{"nome":"COLABORADOR A","cargo":"GERENTE","horario":"07:00 AS 16:24","jornada":{"modelo":"gerente-1","entrada":"07:00","saida":"16:24","intervalo":60},"gerente":true,"ativo":true,
"folgaFixa":null,"primeiroDomingo":null,"ausencias":[]},
{"nome":"COLABORADORA B","cargo":"SUBGERENTE","horario":"10:00","gerente":false,"ativo":true,
"folgaFixa":1,"primeiroDomingo":"2026-08-16","ausencias":[{"tipo":"F","ini":"2026-08-20","fim":"2026-08-25"}]}]}}}
JSON
)
R=$(chamar "$COOKIES_A" dados.php "$PAYLOAD" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "equipe salva" || falha "salvar: $R"
N=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT COUNT(*) FROM colaboradores WHERE loja_id='$LOJA_A';")
[ "$N" = "2" ] && ok "2 colaboradores gravados" || falha "gravou $N colaboradores"
NA=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT COUNT(*) FROM ausencias;")
[ "$NA" = "1" ] && ok "ausência gravada" || falha "ausências: $NA"

R=$(chamar "$COOKIES_A" dados.php '{"acao":"carregar"}' "$CSRF_A")
echo "$R" | grep -q "COLABORADORA B" && ok "carregamento devolve a equipe" || falha "carregar: $R"
echo "$R" | grep -q '"folgaFixa":1' && ok "folga fixa preservada" || falha "folga fixa perdida"
echo "$R" | grep -q '"primeiroDomingo":"2026-08-16"' && ok "domingo de folga preservado" || falha "domingo de folga perdido"
echo "$R" | grep -q '"modelo":"gerente-1"' && ok "jornada estruturada preservada" || falha "jornada estruturada perdida"

echo ""
echo "=== 9. ISOLAMENTO ENTRE EMPRESAS (o teste que mais importa) ==="
R=$(chamar "$COOKIES_B" dados.php '{"acao":"carregar"}' "$CSRF_B")
echo "$R" | grep -q "COLABORADORA B" && falha "empresa B ENXERGOU dados da empresa A" || ok "empresa B não vê dados da empresa A"

R=$(chamar "$COOKIES_B" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\",\"grade\":{\"x\":1}}" "$CSRF_B")
echo "$R" | grep -q "não encontrada" && ok "empresa B barrada ao gravar na loja da empresa A" || falha "B gravou na loja de A: $R"

R=$(chamar "$COOKIES_B" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\"}" "$CSRF_B")
echo "$R" | grep -q "não encontrada" && ok "empresa B barrada ao ler escala da empresa A" || falha "B leu escala de A: $R"

R=$(chamar "$COOKIES_B" dados.php "{\"acao\":\"listar_escalas\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_B")
echo "$R" | grep -q "não encontrada" && ok "empresa B barrada ao listar escalas da empresa A" || falha "B listou escalas de A: $R"

PAYLOAD_INVASAO="{\"acao\":\"salvar\",\"lojas\":{\"$LOJA_A\":{\"nome\":\"INVADIDA\",\"colabs\":[]}}}"
R=$(chamar "$COOKIES_B" dados.php "$PAYLOAD_INVASAO" "$CSRF_B")
echo "$R" | grep -qE "outra empresa|fora do seu acesso" && ok "empresa B barrada ao sobrescrever loja da empresa A" || falha "B sobrescreveu loja de A: $R"
NOME=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT nome FROM lojas WHERE id='$LOJA_A';")
[ "$NOME" = "Loja Teste A" ] && ok "nome da loja intacto após tentativa" || falha "loja renomeada para: $NOME"

echo ""
echo "=== 10. Escala ==="
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\",\"grade\":{\"c1\":[\"\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"}}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "escala salva" || falha "salvar escala: $R"
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\"}" "$CSRF_A")
echo "$R" | grep -q '"X"' && ok "escala recuperada igual" || falha "carregar escala: $R"
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"listar_escalas\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A")
echo "$R" | grep -q '"inicio":"2026-08-11"' && ok "listar_escalas devolve o período salvo" || falha "listar_escalas: $R"
echo "$R" | grep -q '"publicada":false' && ok "listar_escalas identifica o rascunho" || falha "status do rascunho: $R"

echo ""
echo "=== 11. Sem sessão não passa ==="
R=$(curl -s -X POST "$BASE/api/dados.php" -H 'Content-Type: application/json' -H "Origin: $BASE" -H "X-CSRF: x" -d '{"acao":"carregar"}')
echo "$R" | grep -q "Sessão expirada\|credencial" && ok "sem sessão é barrado" || falha "passou sem sessão: $R"

echo ""
echo "=== 12. Força bruta ==="
for i in 1 2 3 4 5 6; do
  R=$(chamar "$COOKIES_B" auth.php '{"acao":"entrar","email":"ana@teste.com","senha":"errada"}' "$CSRF_B")
done
echo "$R" | grep -q "Muitas tentativas" && ok "bloqueio após 5 tentativas" || falha "sem bloqueio: $R"

echo ""
echo "=== 13. Injeção de SQL ==="
R=$(chamar "$COOKIES_A" dados.php '{"acao":"carregar_escala","loja_id":"1'\'' OR '\''1'\''='\''1","inicio":"2026-01-01","fim":"2026-01-31"}' "$CSRF_A")
echo "$R" | grep -q "Loja inválida" && ok "identificador malicioso recusado" || falha "injeção: $R"
mysql -u root -h 127.0.0.1 teste_escala -e "SELECT 1;" > /dev/null 2>&1 && ok "banco intacto após tentativa" || falha "banco afetado"

echo ""
echo "=== 14. Auditoria ==="
NR=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT COUNT(*) FROM registro_acoes;")
[ "$NR" -gt 3 ] && ok "$NR ações registradas na auditoria" || falha "auditoria vazia"

# --- encerrar ---------------------------------------------------------------
kill $SERVIDOR 2>/dev/null
rm -f api/config.php "$COOKIES_A" "$COOKIES_B"

echo ""
if [ "$falhas" -eq 0 ]; then
  echo "RESULTADO: todos os testes passaram"
  exit 0
else
  echo "RESULTADO: $falhas falha(s)"
  exit 1
fi
