#!/usr/bin/env bash
# =============================================================================
#  Teste do acesso individual do colaborador.
#
#  A pergunta que este teste responde: um colaborador consegue, de alguma
#  forma, ver a escala dos colegas? Cada bloco tenta um caminho diferente.
# =============================================================================
set -u
cd "$(dirname "$0")/.."

BASE="http://127.0.0.1:8881"
CG=$(mktemp); CC=$(mktemp); CX=$(mktemp)
falhas=0
ok()    { echo "  ok     $1"; }
falha() { echo "  FALHA  $1"; falhas=$((falhas+1)); }

req(){ curl -s -c "$1" -b "$1" -X POST "$BASE/api/$2" \
    -H 'Content-Type: application/json' -H "Origin: $BASE" ${4:+-H "X-CSRF: $4"} -d "$3"; }
    tok(){ req "$1" auth.php '{"acao":"sessao"}' | grep -o '"csrf":"[^"]*"' | cut -d'"' -f4; }

mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS teste_escala; CREATE DATABASE teste_escala CHARACTER SET utf8mb4;" 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/mysql-schema.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-002-colaborador.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-003-acesso-por-loja.sql 2>/dev/null
mysql -u root -h 127.0.0.1 teste_escala < banco/migracao-004-resumo-escala.sql 2>/dev/null

cat > api/config.php <<'PHP'
<?php return ['bd_host'=>'127.0.0.1','bd_nome'=>'teste_escala','bd_usuario'=>'root','bd_senha'=>'',
'endereco_site'=>'http://127.0.0.1:8881','email_remetente'=>'teste@local','chave_criacao_empresa'=>'teste-ci-123'];
PHP
php -S 127.0.0.1:8881 -t . > /tmp/php881.log 2>&1 &
SRV=$!; sleep 3

confirmar(){ # $1=cookies $2=email $3=csrf
  T=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT token_confirmacao FROM usuarios WHERE email='$2';")
  req "$1" auth.php "{\"acao\":\"confirmar\",\"token\":\"$T\"}" "$3" > /dev/null
}

echo ""
echo "=== 1. Gestor monta a estrutura ==="
TG=$(tok $CG)
req $CG auth.php '{"acao":"cadastrar","nome":"Gestor","email":"gestor@drogaria.com","senha":"pedra rio manso 88"}' "$TG" >/dev/null
confirmar $CG gestor@drogaria.com "$TG"
TG=$(tok $CG)
RESP_EMPRESA=$(req $CG auth.php '{"acao":"criar_empresa","nome":"Drogaria Bauru","chave":"teste-ci-123","loja":"Loja 330"}' "$TG")
LOJA=$(echo "$RESP_EMPRESA" | grep -o '"loja_id":"[^"]*"' | cut -d'"' -f4)
[ -n "$LOJA" ] && ok "empresa e loja criadas" || falha "estrutura"

# equipe com e-mail para a Renata e para o Lucas
EQUIPE=$(cat <<JSON
{"acao":"salvar","lojas":{"$LOJA":{"nome":"Loja 330","params":{"modelo":"5x2"},"colabs":[
 {"nome":"RENATA","email":"renata@drogaria.com","cargo":"SUBGERENTE","horario":"10:00 AS 18:20","ausencias":[]},
 {"nome":"LUCAS","email":"lucas@drogaria.com","cargo":"CAIXA","horario":"14:40 AS 23:00","ausencias":[]},
 {"nome":"SEM EMAIL","cargo":"BALCONISTA","horario":"08:00 AS 16:20","ausencias":[]}]}}}
JSON
)
R=$(req $CG dados.php "$EQUIPE" "$TG")
echo "$R" | grep -q '"ok":true' && ok "equipe salva com e-mails" || falha "salvar equipe: $R"

CID_R=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT id FROM colaboradores WHERE nome='RENATA';")
CID_L=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT id FROM colaboradores WHERE nome='LUCAS';")

# escala com linhas distintas: Renata folga dia 1-2, Lucas dias 3-4
GRADE="{\"$CID_R\":[\"X\",\"X\",\"\",\"\",\"\"],\"$CID_L\":[\"\",\"\",\"X\",\"X\",\"\"]}"
R=$(req $CG dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-15\",\"grade\":$GRADE,\"publicar\":true}" "$TG")
echo "$R" | grep -q '"ok":true' && ok "escala publicada" || falha "publicar: $R"

echo ""
echo "=== 2. Vínculo automático pelo e-mail ==="
TC=$(tok $CC)
req $CC auth.php '{"acao":"cadastrar","nome":"Renata","email":"renata@drogaria.com","senha":"vento azul carro 12"}' "$TC" >/dev/null
confirmar $CC renata@drogaria.com "$TC"
PAPEL=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT papel FROM usuarios WHERE email='renata@drogaria.com';")
VINC=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT colaborador_id FROM usuarios WHERE email='renata@drogaria.com';")
[ "$PAPEL" = "colaborador" ] && ok "papel definido como colaborador" || falha "papel: $PAPEL"
[ "$VINC" = "$CID_R" ] && ok "vinculada à ficha certa" || falha "vínculo: $VINC"
EMP=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT empresa_id IS NOT NULL FROM usuarios WHERE email='renata@drogaria.com';")
[ "$EMP" = "1" ] && ok "empresa preenchida sozinha" || falha "empresa vazia"

echo ""
echo "=== 3. A escala individual chega certa ==="
TC=$(tok $CC)
R=$(req $CC minha.php '{"acao":"minha_escala"}' "$TC")
echo "$R" | grep -q '"nome":"RENATA"' && ok "devolve os próprios dados" || falha "dados: $R"
echo "$R" | grep -q '"loja":"Loja 330"' && ok "informa a loja" || falha "loja ausente"
echo "$R" | grep -q '"folgas":2' && ok "conta as 2 folgas dela" || falha "contagem: $(echo $R | grep -o '"folgas":[0-9]*')"
echo "$R" | grep -q '10:00 AS 18:20' && ok "mostra o horário dela" || falha "horário ausente"

echo ""
echo "=== 4. ISOLAMENTO — colaborador não vê colega ==="
echo "$R" | grep -q "LUCAS" && falha "apareceu o nome do LUCAS na resposta" || ok "nenhum nome de colega na resposta"
echo "$R" | grep -q "$CID_L" && falha "apareceu o id do LUCAS" || ok "nenhum id de colega"
echo "$R" | grep -q "SEM EMAIL" && falha "apareceu terceiro colaborador" || ok "nenhum terceiro na resposta"

# A linha da Renata folga nos dias 11 e 12; a do Lucas nos dias 13 e 14.
# Conferido com parser de JSON, não com grep: precisão importa num teste
# de isolamento.
VERIF=$(printf '%s' "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)
dias = d["escala"]["dias"]
folgas = [x["data"] for x in dias if x["tipo"] == "folga"]
print(len(dias), ",".join(folgas))
')
QTD=$(echo "$VERIF" | cut -d" " -f1)
QUAIS=$(echo "$VERIF" | cut -d" " -f2)
[ "$QTD" = "5" ] && ok "a escala tem os 5 dias do período" || falha "$QTD dias na escala"
[ "$QUAIS" = "2026-08-11,2026-08-12" ] && ok "folgas exatamente nos dias dela (11 e 12)" \
  || falha "folgas em $QUAIS — deveria ser 2026-08-11,2026-08-12"
echo "$QUAIS" | grep -q "2026-08-13\|2026-08-14" && falha "apareceram as folgas do LUCAS" \
  || ok "nenhuma folga do LUCAS na resposta"

echo ""
echo "=== 5. Colaborador barrado nos endpoints de gestão ==="
R2=$(req $CC dados.php '{"acao":"carregar"}' "$TC")
echo "$R2" | grep -q "não permite" && ok "carregar equipe: barrado" || falha "carregou equipe: $R2"

R2=$(req $CC dados.php "{\"acao\":\"carregar_escala\",\"loja_id\":\"$LOJA\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-15\"}" "$TC")
echo "$R2" | grep -q "não permite" && ok "carregar grade completa: barrado" || falha "leu grade: $R2"

R2=$(req $CC dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA\",\"inicio\":\"2026-08-11\",\"fim\":\"2026-08-15\",\"grade\":{\"x\":[\"X\"]}}" "$TC")
echo "$R2" | grep -q "não permite" && ok "gravar escala: barrado" || falha "gravou escala: $R2"

R2=$(req $CC dados.php "{\"acao\":\"salvar\",\"lojas\":{\"$LOJA\":{\"nome\":\"HACK\",\"colabs\":[]}}}" "$TC")
echo "$R2" | grep -q "não permite" && ok "alterar equipe: barrado" || falha "alterou equipe: $R2"
NOME=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT nome FROM lojas WHERE id='$LOJA';")
[ "$NOME" = "Loja 330" ] && ok "loja intacta" || falha "loja virou: $NOME"

R2=$(req $CC dados.php '{"acao":"criar_loja","nome":"Minha"}' "$TC")
echo "$R2" | grep -q "não permite" && ok "criar loja: barrado" || falha "criou loja: $R2"

R2=$(req $CC auth.php '{"acao":"listar_acessos"}' "$TC")
echo "$R2" | grep -q "não permite" && ok "listar acessos: barrado" || falha "listou acessos: $R2"

R2=$(req $CC dados.php '{"acao":"historico"}' "$TC")
echo "$R2" | grep -q "não permite" && ok "histórico: barrado" || falha "leu histórico: $R2"

R2=$(req $CC auth.php '{"acao":"criar_empresa","nome":"Minha Empresa"}' "$TC")
echo "$R2" | grep -q "colaborador\|já pertence" && ok "criar empresa: barrado" || falha "criou empresa: $R2"

echo ""
echo "=== 6. Colaborador não alcança a ficha de outro ==="
# tenta forjar: mexe no próprio vínculo? o servidor não aceita id vindo do cliente
R2=$(req $CC minha.php "{\"acao\":\"minha_escala\",\"colaborador_id\":\"$CID_L\"}" "$TC")
echo "$R2" | grep -q '"nome":"RENATA"' && ok "id enviado pelo cliente é ignorado" || falha "aceitou id do cliente: $R2"

echo ""
echo "=== 7. Rascunho não vaza ==="
R2=$(req $CG dados.php "{\"acao\":\"salvar_escala\",\"loja_id\":\"$LOJA\",\"inicio\":\"2026-09-11\",\"fim\":\"2026-09-15\",\"grade\":{\"$CID_R\":[\"X\",\"\",\"\",\"\",\"\"]}}" "$TG")
R2=$(req $CC minha.php '{"acao":"minha_escala","inicio":"2026-09-11","fim":"2026-09-15"}' "$TC")
echo "$R2" | grep -q "não há escala publicada\|Não há escala publicada" && ok "escala não publicada fica invisível" || falha "rascunho vazou: $R2"

R2=$(req $CC minha.php '{"acao":"meus_periodos"}' "$TC")
echo "$R2" | grep -q "2026-09-11" && falha "período não publicado listado" || ok "lista só períodos publicados"

echo ""
echo "=== 8. Estranho sem vínculo ==="
TX=$(tok $CX)
req $CX auth.php '{"acao":"cadastrar","nome":"Estranho","email":"estranho@fora.com","senha":"nuvem preta 4321"}' "$TX" >/dev/null
confirmar $CX estranho@fora.com "$TX"
TX=$(tok $CX)
PAPEL=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT papel FROM usuarios WHERE email='estranho@fora.com';")
EMP=$(mysql -u root -h 127.0.0.1 teste_escala -sN -e "SELECT COALESCE(empresa_id,'vazio') FROM usuarios WHERE email='estranho@fora.com';")
[ "$EMP" = "vazio" ] && ok "e-mail fora da equipe não vira colaborador" || falha "vinculou sem estar na equipe"
R2=$(req $CX minha.php '{"acao":"minha_escala"}' "$TX")
echo "$R2" | grep -q "sem empresa\|não está ligado" && ok "sem vínculo, nada é devolvido" || falha "estranho recebeu dados: $R2"

echo ""
echo "=== 9. Gestor continua com acesso total ==="
TG=$(tok $CG)
R2=$(req $CG dados.php '{"acao":"carregar"}' "$TG")
echo "$R2" | grep -q "RENATA" && ok "gestor vê a equipe inteira" || falha "gestor perdeu acesso: $R2"
echo "$R2" | grep -q "LUCAS" && ok "gestor vê todos os colaboradores" || falha "gestor não vê todos"

kill $SRV 2>/dev/null
rm -f api/config.php $CG $CC $CX

echo ""
if [ "$falhas" -eq 0 ]; then echo "RESULTADO: todos os testes passaram"; exit 0
else echo "RESULTADO: $falhas falha(s)"; exit 1; fi
