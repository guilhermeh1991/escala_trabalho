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
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-006-supervisor-multiloja.sql >/dev/null \
  || falha "migracao-006-supervisor-multiloja.sql"
mysql -u root -h 127.0.0.1 teste_escala < banco/verificar-e-migrar.sql >/dev/null \
  || falha "verificar-e-migrar.sql após as migrações"
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-007-historico-versoes.sql >/dev/null \
  || falha "migracao-007-historico-versoes.sql"
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-008-descricao-cadastros.sql >/dev/null \
  || falha "migracao-008-descricao-cadastros.sql"
mysql -u root -h 127.0.0.1 teste_escala < banco/verificar-e-migrar.sql >/dev/null \
  || falha "verificar-e-migrar.sql após as migrações"

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
R=$(chamar "$COOKIES_P" auth.php "{\"acao\":\"plataforma_editar_empresa\",\"empresa_id\":\"$EMPRESA_P\",\"nome\":\"Empresa <Teste>\",\"descricao\":\"Descrição & segura\"}" "$CSRF_P")
echo "$R" | grep -q '"ok":true' && ok "plataforma edita cadastro da empresa" || falha "editar empresa: $R"
R=$(chamar "$COOKIES_P" auth.php "{\"acao\":\"plataforma_editar_loja\",\"loja_id\":\"$LOJA_P\",\"nome\":\"Loja <Texto>\",\"descricao\":\"Descrição sem HTML\"}" "$CSRF_P")
echo "$R" | grep -q '"ok":true' && ok "plataforma edita cadastro da loja" || falha "editar loja: $R"
R=$(chamar "$COOKIES_P" auth.php '{"acao":"plataforma_listar_empresas","q":"Empresa <Teste>"}' "$CSRF_P")
echo "$R" | grep -q 'Empresa <Teste>' && ok "texto cadastral preservado como dado" || falha "texto cadastral: $R"
R=$(chamar "$COOKIES_P" auth.php "{\"acao\":\"plataforma_listar_lojas\",\"empresa_id\":\"$EMPRESA_P\",\"q\":\"Loja <Texto>\"}" "$CSRF_P")
echo "$R" | grep -q 'Loja <Texto>' && ok "texto da loja preservado como dado" || falha "texto da loja: $R"
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
LOJA_B=$(echo "$R" | grep -o '"loja_id":"[^"]*"' | cut -d'"' -f4)
[ -n "$EMPRESA_B" ] && ok "segunda empresa criada por outro usuário" || falha "empresa B: $R"

echo ""
echo "=== 8. Dados: criar loja e salvar equipe ==="
R=$(chamar "$COOKIES_A" dados.php '{"acao":"criar_loja","nome":"Loja Teste B"}' "$CSRF_A")
LOJA_A2=$(echo "$R" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "$R" | grep -q '"ok":true' && ok "admin da empresa cria segunda loja" || falha "criar_loja: $R"
R=$(chamar "$COOKIES_A" dados.php '{"acao":"criar_loja","nome":"Loja Teste C"}' "$CSRF_A")
LOJA_A3=$(echo "$R" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "$R" | grep -q '"ok":true' && ok "admin da empresa cria terceira loja" || falha "criar terceira loja: $R"

# supervisor sem vínculo explícito não pode consultar a empresa;
# o administrador da empresa atribui somente a segunda loja.
if preparar_conta "$COOKIES_S" "Supervisor Teste" "supervisor@exemplo.test" "loja autorizada doze junho" CSRF_S; then
  ok "preparação da conta de supervisor: cadastro, confirmação, login e sessão"
else
  falha "preparação da conta de supervisor"
  exit 1
fi
chamar_com_status "$COOKIES_S" auth.php "{\"acao\":\"entrar_por_convite\",\"codigo\":\"$CONVITE_A\"}" "$CSRF_S"
[ "$HTTP_STATUS" = 200 ] && json_true ok "$HTTP_BODY" && ok "supervisor entra na empresa por convite" || { falha "convite do supervisor: HTTP $HTTP_STATUS $HTTP_BODY"; exit 1; }
chamar_com_status "$COOKIES_S" auth.php '{"acao":"sessao"}'
CSRF_S=$(printf '%s' "$HTTP_BODY" | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4)
[ "$HTTP_STATUS" = 200 ] && json_true logado "$HTTP_BODY" || { falha "sessão do supervisor após convite"; exit 1; }
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q "Supervisor sem loja" && ok "supervisor sem vínculo explícito é barrado" || falha "supervisor sem vínculo: $R"
SUP_ID=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT id FROM usuarios WHERE email='supervisor@exemplo.test';")
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"supervisor_atribuir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "admin atribui primeiro vínculo do supervisor" || falha "primeiro vínculo: $R"
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"supervisor_atribuir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A2\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "admin atribui segundo vínculo do supervisor" || falha "segundo vínculo: $R"
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q 'Loja Teste A' && echo "$R" | grep -q 'Loja Teste B' && ok "supervisor acessa duas lojas autorizadas" || falha "duas lojas autorizadas: $R"
# Mesmo que o legado ainda carregue usuarios.loja_id, ele não pode restaurar
# acesso fora da relação explícita.
mysql -u root -h 127.0.0.1 teste_escala -e "UPDATE usuarios SET loja_id='$LOJA_A3' WHERE id='$SUP_ID';"
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q 'Loja Teste C' && falha "fallback em usuarios.loja_id restaurou acesso" || ok "usuarios.loja_id não amplia vínculos"
# Payload com uma loja autorizada e uma terceira não autorizada deve falhar
# antes de gravar qualquer uma delas.
PAYLOAD_MULTI="{\"acao\":\"salvar\",\"lojas\":{\"$LOJA_A2\":{\"nome\":\"NAO ALTERAR B\",\"colabs\":[]},\"$LOJA_A3\":{\"nome\":\"NAO ALTERAR C\",\"colabs\":[]}}}"
R=$(chamar "$COOKIES_S" dados.php "$PAYLOAD_MULTI" "$CSRF_S")
echo "$R" | grep -q "fora do seu acesso" && ok "payload múltiplo não autorizado é rejeitado" || falha "payload múltiplo aceito: $R"
NOME_B=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT nome FROM lojas WHERE id='$LOJA_A2';")
NOME_C=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT nome FROM lojas WHERE id='$LOJA_A3';")
[ "$NOME_B" = "Loja Teste B" ] && [ "$NOME_C" = "Loja Teste C" ] && ok "payload rejeitado não gravou parcialmente" || falha "gravação parcial: $NOME_B / $NOME_C"
R=$(chamar "$COOKIES_S" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A3\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\"}" "$CSRF_S")
echo "$R" | grep -q "não encontrada" && ok "supervisor não alcança terceira loja da própria empresa" || falha "terceira loja: $R"
R=$(chamar "$COOKIES_S" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_B\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-09-10\"}" "$CSRF_S")
echo "$R" | grep -q "não encontrada" && ok "supervisor não alcança loja de outra empresa" || falha "loja de outra empresa: $R"
R=$(chamar "$COOKIES_P" auth.php "{\"acao\":\"plataforma_atribuir_supervisor_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_B\"}" "$CSRF_P")
echo "$R" | grep -q "empresas diferentes" && ok "plataforma bloqueia vínculo entre empresas" || falha "vínculo cruzado: $R"
R=$(chamar "$COOKIES_S" auth.php "{\"acao\":\"supervisor_atribuir_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_B\"}" "$CSRF_S")
echo "$R" | grep -q "não permite\|perfil\|Acesso" && ok "supervisor não pode autoconceder acesso" || falha "autoconcessão: $R"
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"supervisor_revogar_loja\",\"usuario_id\":\"$SUP_ID\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "admin revoga somente uma loja" || falha "revogação parcial: $R"
R=$(chamar "$COOKIES_S" dados.php '{"acao":"carregar"}' "$CSRF_S")
echo "$R" | grep -q 'Loja Teste B' && ok "revogação preserva outro vínculo" || falha "outro vínculo perdido: $R"
R=$(chamar "$COOKIES_A" auth.php "{\"acao\":\"supervisor_listar_lojas_admin\",\"usuario_id\":\"$SUP_ID\"}" "$CSRF_A")
echo "$R" | grep -q 'Loja Teste B' && ok "admin lista vínculos restantes" || falha "listar vínculos: $R"

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
echo "=== 10. Escala, revalidação no servidor e bloqueios de publicação ==="
IDEMP='11111111-1111-4111-8111-111111111111'
SNAP='{"schema":1,"incompleto":false,"participantes":[{"id":"c1","nome":"Pessoa Historica","cargo":"CAIXA","horario":"08:00 AS 16:20","jornada":{"entrada":"08:00","saida":"16:20","intervalos":[{"ini":"12:00","fim":"13:00"}]},"ausencias":[],"ordem":0},{"id":"c2","nome":"Colega Turno","cargo":"BALCONISTA","horario":"08:00 AS 16:20","jornada":{"entrada":"08:00","saida":"16:20","intervalos":[{"ini":"12:00","fim":"13:00"}]},"ausencias":[],"ordem":1}],"grade":{"c1":["","X"],"c2":["X",""]},"params":{"modelo":"5x2"}}'
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"\",\"X\"],\"c2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP,\"idempotency_key\":\"$IDEMP\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && ok "escala salva com snapshot" || falha "salvar escala: $R"
VERSAO=$(echo "$R" | grep -o '"versao":[0-9]*' | cut -d: -f2)
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"\",\"X\"],\"c2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP,\"expected_version\":$VERSAO,\"idempotency_key\":\"22222222-2222-4222-8222-222222222222\",\"publicar\":true}" "$CSRF_A")
echo "$R" | grep -q '"publicada":true' && ok "publicação válida cria versão publicada" || falha "publicação: $R"
VERSAO_PUBLICADA=$(echo "$R" | grep -o '"versao":[0-9]*' | cut -d: -f2)

# Rascunho com pendência obrigatória (loja vazia nos 2 dias: ["X","X"]) pode ser salvo como rascunho
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"X\",\"X\"],\"c2\":[\"X\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP,\"expected_version\":$VERSAO_PUBLICADA,\"idempotency_key\":\"33333333-3333-4333-8333-333333333333\"}" "$CSRF_A")
echo "$R" | grep -q '"ok":true' && echo "$R" | grep -q '"obrigatorias":2' && ok "rascunho com pendência obrigatória é salvo e identifica a pendência" || falha "rascunho após publicação: $R"
VERSAO_RASCUNHO=$(echo "$R" | grep -o '"versao":[0-9]*' | cut -d: -f2)
PUB=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT versao_publicada FROM escalas WHERE loja_id='$LOJA_A' AND inicio='2026-08-11';")
[ "$PUB" = "$VERSAO_PUBLICADA" ] && ok "rascunho não altera versão publicada" || falha "versão publicada alterada: $PUB"

# Tentativa de publicar enviando alertas/resumo falsamente vazios é bloqueada com HTTP 422
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"X\",\"X\"],\"c2\":[\"X\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\",\"_resumo\":{\"feridas\":0,\"notas\":0},\"alertas\":[]},\"resumo\":{\"feridas\":0,\"obrigatorias\":0,\"notas\":0},\"snapshot\":$SNAP,\"expected_version\":$VERSAO_RASCUNHO,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "bloqueada por restrição obrigatória" && ok "servidor ignora alertas falsamente vazios e bloqueia publicação (HTTP 422)" || falha "publicação inválida aceita: HTTP $HTTP_STATUS $HTTP_BODY"
PUB_APOS=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT versao_publicada FROM escalas WHERE loja_id='$LOJA_A' AND inicio='2026-08-11';")
[ "$PUB_APOS" = "$VERSAO_PUBLICADA" ] && ok "bloqueio de publicação preserva versão publicada anterior" || falha "versão publicada corrompida: $PUB_APOS"

# Publicação bloqueada por violação de ausência cadastrada no banco e por descanso < 11h
CID_B=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT id FROM colaboradores WHERE loja_id='$LOJA_A' AND nome='COLABORADORA B';")
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-20\",\"fim\":\"2026-08-21\",\"grade\":{\"$CID_B\":[\"\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "Ausência" && ok "publicação bloqueada quando férias do banco são sobrescritas" || falha "ausência não bloqueou publicação: HTTP $HTTP_STATUS $HTTP_BODY"

# Publicação bloqueada por excesso de dias seguidos (maxSeq=5, 6 dias trabalhados) e ciclo de domingos.
# Os parâmetros de regra são gravados na loja: desde a separação de autoridade, o
# servidor lê regra de lojas.parametros e ignora o que vier no payload.
SNAP_SEQ='{"schema":1,"incompleto":false,"participantes":[{"id":"cseq","nome":"Pessoa Sequencia","cargo":"CAIXA","horario":"08:00 AS 16:20","domTrabConsec":1,"ausencias":[],"ordem":0}]}'
# Fixture: fixa os parâmetros da loja direto no banco. É preparação de estado, não
# o comportamento sob teste — a via autorizada de alteração (ação salvar, com
# exigirGestao e escopo de loja) já é coberta nas seções de isolamento acima.
# Usar a API aqui recriaria os colaboradores a cada chamada, com novos ids.
gravar_params_loja() { # $1 = json dos parâmetros
  mysql -u root -h 127.0.0.1 teste_escala -e \
    "UPDATE lojas SET parametros='$1', versao=versao+1 WHERE id='$LOJA_A';" || falha "fixture de parâmetros da loja"
}
gravar_params_loja '{"modelo":"5x2","maxSeq":5}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-01\",\"fim\":\"2026-10-06\",\"grade\":{\"cseq\":[\"\",\"\",\"\",\"\",\"\",\"\"]},\"parametros\":{\"modelo\":\"5x2\",\"maxSeq\":5},\"snapshot\":$SNAP_SEQ,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "dias seguidos" && ok "publicação bloqueada quando sequência máxima configurada é excedida" || falha "sequência não bloqueou: HTTP $HTTP_STATUS $HTTP_BODY"
# O colega cobre o dia de folga: sem ele, "loja sem ninguém escalado" bloquearia
# antes e o teste não provaria nada sobre o ciclo de domingos.
SNAP_DOM='{"schema":1,"incompleto":false,"participantes":[{"id":"cseq","nome":"Pessoa Sequencia","cargo":"CAIXA","horario":"08:00 AS 16:20","domTrabConsec":1,"ausencias":[],"ordem":0},{"id":"cdom2","nome":"Colega Cobertura","cargo":"BALCONISTA","horario":"08:00 AS 16:20","ausencias":[],"ordem":1}]}'
gravar_params_loja '{"modelo":"5x2","cicloDomingo":2}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-04\",\"fim\":\"2026-10-05\",\"grade\":{\"cseq\":[\"\",\"X\"],\"cdom2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_DOM,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "domingos seguidos" && ok "publicação bloqueada quando ciclo configurado de domingos é excedido" || falha "domingo não bloqueou: HTTP $HTTP_STATUS $HTTP_BODY"

# TENTATIVA DE MANIPULAÇÃO: afrouxar a regra pelo payload não pode liberar a publicação.
# A loja mantém maxSeq=5; o payload tenta maxSeq=365.
gravar_params_loja '{"modelo":"5x2","maxSeq":5}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-01\",\"fim\":\"2026-10-06\",\"grade\":{\"cseq\":[\"\",\"\",\"\",\"\",\"\",\"\"]},\"parametros\":{\"modelo\":\"5x2\",\"maxSeq\":365},\"snapshot\":$SNAP_SEQ,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "dias seguidos" && ok "maxSeq afrouxado no payload não enfraquece o bloqueio" || falha "payload afrouxou maxSeq: HTTP $HTTP_STATUS $HTTP_BODY"

# A divergência entre payload e banco é registrada como observação e na auditoria.
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-02\",\"fim\":\"2026-11-03\",\"grade\":{\"cseq\":[\"\",\"X\"],\"cdom2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\",\"maxSeq\":365},\"snapshot\":$SNAP_DOM}" "$CSRF_A")
echo "$R" | grep -q '"divergencias":\[' && echo "$R" | grep -q 'maxSeq' && ok "parâmetro divergente do banco é registrado no resultado" || falha "divergência não registrada: $R"
AUD=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT COUNT(*) FROM registro_acoes WHERE acao='parametros_divergentes';")
[ "$AUD" -ge 1 ] && ok "tentativa de reclassificação fica na trilha de auditoria" || falha "auditoria sem registro de divergência: $AUD"

# Descanso insuficiente entre períodos contíguos (sai 23:00 em 12/10 e entra 07:00 em 13/10)
SNAP_ANT='{"schema":1,"incompleto":false,"participantes":[{"id":"cij","nome":"Pessoa Turno","cargo":"CAIXA","horario":"14:40 AS 23:00","ausencias":[],"ordem":0},{"id":"cij2","nome":"Pessoa Apoio","cargo":"BALCONISTA","horario":"08:00 AS 16:20","ausencias":[],"ordem":1}]}'
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-11\",\"fim\":\"2026-10-12\",\"grade\":{\"cij\":[\"X\",\"\"],\"cij2\":[\"\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_ANT,\"publicar\":true}" "$CSRF_A")
echo "$R" | grep -q '"publicada":true' && ok "período anterior contíguo publicado" || falha "período anterior: $R"
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-13\",\"fim\":\"2026-10-14\",\"grade\":{\"cij\":[\"\",\"X\"],\"cij2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\",\"_horas\":{\"cij\":{\"0\":\"07:00 AS 15:20\"}}},\"snapshot\":$SNAP_ANT,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "período anterior" && ok "publicação bloqueada por descanso < 11h na passagem entre períodos" || falha "interjornada entre períodos não bloqueou: HTTP $HTTP_STATUS $HTTP_BODY"

# Demanda positiva com disponibilidade zero e jornada incompleta registradas no resumo do rascunho
SNAP_INC='{"schema":1,"incompleto":false,"participantes":[{"id":"cinc","nome":"Pessoa Incompleta","cargo":"CAIXA","horario":"08:00","ausencias":[],"ordem":0}]}'
gravar_params_loja '{"modelo":"5x2","minFarma":2,"minSubger":1}'
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-20\",\"fim\":\"2026-10-21\",\"grade\":{\"cinc\":[\"\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_INC}" "$CSRF_A")
echo "$R" | grep -q '"impedimentos":2' && echo "$R" | grep -q '"lacunas":1' && ok "servidor registra impedimentos de disponibilidade zero e lacuna de jornada incompleta" || falha "impedimentos/lacunas: $R"

# MÍNIMO OBRIGATÓRIO POR LOJA E FUNÇÃO: a meta avisa, o piso bloqueia.
# A loja pede meta de 2 caixas e piso obrigatório de 2; só uma pessoa trabalha.
SNAP_PISO='{"schema":1,"incompleto":false,"participantes":[{"id":"cpiso","nome":"Pessoa Caixa","cargo":"CAIXA","horario":"08:00 AS 16:20","jornada":{"entrada":"08:00","saida":"16:20"},"ausencias":[],"ordem":0},{"id":"cpiso2","nome":"Outra Caixa","cargo":"CAIXA","horario":"08:00 AS 16:20","jornada":{"entrada":"08:00","saida":"16:20"},"ausencias":[],"ordem":1}]}'
gravar_params_loja '{"modelo":"5x2","minCaixa":2,"minCaixaObrigatorio":2}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-10\",\"fim\":\"2026-11-11\",\"grade\":{\"cpiso\":[\"\",\"\"],\"cpiso2\":[\"X\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_PISO,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "mínimo obrigatório" && ok "piso obrigatório de cobertura bloqueia a publicação" || falha "piso obrigatório não bloqueou: HTTP $HTTP_STATUS $HTTP_BODY"

# Sem piso declarado, o mesmo quadro continua publicável: a meta é só aviso e a
# configuração anterior da loja segue valendo sem alteração explícita.
gravar_params_loja '{"modelo":"5x2","minCaixa":2}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-10\",\"fim\":\"2026-11-11\",\"grade\":{\"cpiso\":[\"\",\"\"],\"cpiso2\":[\"X\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_PISO,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 200 ] && ok "meta sem piso obrigatório permanece aviso e não bloqueia" || falha "meta virou bloqueio: HTTP $HTTP_STATUS $HTTP_BODY"

# VALIDAÇÃO PARCIAL: jornada incompleta não pode ser apresentada como conformidade completa.
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-10-20\",\"fim\":\"2026-10-21\",\"grade\":{\"cinc\":[\"\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_INC}" "$CSRF_A")
echo "$R" | grep -q '"conformidade":"parcial"' && ok "jornada incompleta resulta em conformidade parcial, não completa" || falha "conformidade não é parcial: $R"
echo "$R" | grep -q '"nao_verificadas":\[' && echo "$R" | grep -q 'interjornada' && ok "resposta nomeia a regra que não pôde ser conferida" || falha "regras não verificadas não nomeadas: $R"

echo ""
echo "=== 10b. Cobertura intradiária por função ==="
# Dois caixas no mesmo turno da manhã: o dia tem 2 pessoas e ainda assim a loja
# fica sem caixa das 14h às 20h. O mínimo diário não enxerga esse furo.
SNAP_INTRA='{"schema":1,"incompleto":false,"participantes":[
{"id":"ci1","nome":"Caixa Manha","cargo":"CAIXA","horario":"08:00 AS 14:00","jornada":{"entrada":"08:00","saida":"14:00","intervalos":[]},"ausencias":[],"ordem":0},
{"id":"ci2","nome":"Caixa Manha Dois","cargo":"CAIXA","horario":"08:00 AS 14:00","jornada":{"entrada":"08:00","saida":"14:00","intervalos":[]},"ausencias":[],"ordem":1}]}'
PARAMS_INTRA='{"modelo":"5x2","expediente":{"1":[{"ini":"08:00","fim":"20:00"}]},"faixas":{"1":[{"funcao":"caixa","ini":"08:00","fim":"20:00","obrigatorio":1}]}}'
gravar_params_loja "$PARAMS_INTRA"
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-09\",\"fim\":\"2026-11-09\",\"grade\":{\"ci1\":[\"\"],\"ci2\":[\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_INTRA,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "14:00–20:00" && ok "faixa descoberta à tarde bloqueia a publicação" || falha "cobertura intradiária não bloqueou: HTTP $HTTP_STATUS $HTTP_BODY"

# Turno da tarde cobrindo a faixa: mesma configuração, escala completa.
SNAP_INTRA_OK='{"schema":1,"incompleto":false,"participantes":[
{"id":"ci1","nome":"Caixa Manha","cargo":"CAIXA","horario":"08:00 AS 14:00","jornada":{"entrada":"08:00","saida":"14:00","intervalos":[]},"ausencias":[],"ordem":0},
{"id":"ci3","nome":"Caixa Tarde","cargo":"CAIXA","horario":"14:00 AS 20:00","jornada":{"entrada":"14:00","saida":"20:00","intervalos":[]},"ausencias":[],"ordem":1}]}'
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-09\",\"fim\":\"2026-11-09\",\"grade\":{\"ci1\":[\"\"],\"ci3\":[\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_INTRA_OK,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 200 ] && ok "troca de turno exata cobre a faixa inteira e publica" || falha "troca de turno bloqueou indevidamente: HTTP $HTTP_STATUS $HTTP_BODY"

# Dia fechado: mesma faixa configurada, ninguém escalado, nenhuma cobrança.
gravar_params_loja '{"modelo":"5x2","expediente":{"1":false},"faixas":{"1":[{"funcao":"caixa","ini":"08:00","fim":"20:00","obrigatorio":2}]}}'
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-16\",\"fim\":\"2026-11-16\",\"grade\":{\"ci1\":[\"X\"],\"ci2\":[\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP_INTRA}" "$CSRF_A")
echo "$R" | grep -q '"cobertura_bloqueios":0' && echo "$R" | grep -q '"dias_fechados":1' && ok "dia fechado não recebe falta de cobertura" || falha "dia fechado cobrou cobertura: $R"

# MANIPULAÇÃO: faixa afrouxada no payload não pode liberar a publicação.
gravar_params_loja "$PARAMS_INTRA"
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-09\",\"fim\":\"2026-11-09\",\"grade\":{\"ci1\":[\"\"],\"ci2\":[\"\"]},\"parametros\":{\"modelo\":\"5x2\",\"faixas\":{\"1\":[]},\"expediente\":{\"1\":false}},\"snapshot\":$SNAP_INTRA,\"publicar\":true}" "$CSRF_A"
[ "$HTTP_STATUS" = 422 ] && echo "$HTTP_BODY" | grep -q "14:00–20:00" && ok "faixa e expediente do payload não enfraquecem o bloqueio" || falha "payload afrouxou a cobertura: HTTP $HTTP_STATUS $HTTP_BODY"

# A versão publicada anterior permanece intacta após o bloqueio.
PUB_INTRA=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT versao_publicada FROM escalas WHERE loja_id='$LOJA_A' AND inicio='2026-11-09';")
[ -n "$PUB_INTRA" ] && ok "bloqueio de cobertura preserva a versão publicada" || falha "versão publicada perdida: '$PUB_INTRA'"

# REPRODUÇÃO HISTÓRICA: a versão guarda as regras que valeram na validação, e
# alterar a configuração da loja depois não reescreve o passado.
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-09\",\"fim\":\"2026-11-09\"}" "$CSRF_A")
echo "$R" | grep -q 'regras_aplicadas' && ok "snapshot guarda as regras aplicadas na validação" || falha "snapshot sem regras aplicadas: $R"
gravar_params_loja '{"modelo":"5x2","expediente":{"1":[{"ini":"06:00","fim":"23:00"}]},"faixas":{"1":[{"funcao":"balcao","ini":"06:00","fim":"23:00","obrigatorio":9}]}}'
R2=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-11-09\",\"fim\":\"2026-11-09\"}" "$CSRF_A")
echo "$R2" | grep -q '"funcao":"caixa"' && ok "análise histórica não depende da configuração futura da loja" || falha "histórico reescrito pela configuração nova: $R2"

R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\"}" "$CSRF_A")
echo "$R" | grep -q 'Pessoa Historica' && ok "snapshot recupera participante histórico" || falha "snapshot não recuperado: $R"
R2=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"\",\"X\"],\"c2\":[\"X\",\"\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP,\"expected_version\":$VERSAO,\"idempotency_key\":\"$IDEMP\"}" "$CSRF_A")
echo "$R2" | grep -q '"repetida":true' && ok "retentativa idempotente não cria versão" || falha "idempotência: $R2"
chamar_com_status "$COOKIES_A" dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\",\"grade\":{\"c1\":[\"X\",\"X\"],\"c2\":[\"X\",\"X\"]},\"parametros\":{\"modelo\":\"5x2\"},\"snapshot\":$SNAP,\"expected_version\":999}" "$CSRF_A"
[ "$HTTP_STATUS" = 409 ] && echo "$HTTP_BODY" | grep -q 'Conflito' && ok "edição simultânea gera HTTP 409 explícito" || falha "conflito: HTTP $HTTP_STATUS $HTTP_BODY"
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"listar_versoes_escala\",\"loja_id\":\"$LOJA_A\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-12\"}" "$CSRF_A")
echo "$R" | grep -q '"versao":' && ok "versões históricas listadas" || falha "listar versões: $R"
R=$(chamar "$COOKIES_A" dados.php "{\"acao\":\"listar_escalas\",\"loja_id\":\"$LOJA_A\"}" "$CSRF_A")
echo "$R" | grep -q '"inicio":"2026-08-11"' && ok "listar_escalas devolve versões" || falha "listar_escalas: $R"

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
