# 0010 — Regra tem dono: perfil declarado e autoridade do banco

**Situação**: aceita

## Problema

Três coisas separadas estavam misturadas sob o nome "regra".

**1. Política da casa vestida de lei.** "Gerente folga sábado e domingo" estava
no código com a mesma cara de "no máximo seis dias seguidos trabalhados". A
primeira é uma escolha da empresa; a segunda é a lei. Quem lia o alerta não
tinha como distinguir, e quem quisesse um gerente que folga na segunda não tinha
onde dizer isso.

**2. Mínimo de cobertura sem nível.** `minFarma: 2` queria dizer "meta" numa
loja e "não publique sem isso" em outra. Como só existia um número, o sistema
tratava todos como meta — e quem precisava de piso real não tinha como exigir.

**3. O cliente escolhia a régua.** `validarEscalaServidor()` fazia
`array_merge($paramsLoja, $paramsRecebidos)`. O payload vencia. Mandar
`maxSeq: 365` desligava o bloqueio de dias seguidos; `minInterjornada: 1`
desligava o descanso de 11h. A revalidação no servidor existia e funcionava,
mas media com a régua que o navegador mandasse.

O terceiro problema anulava os outros dois: não adianta classificar regra se
quem é validado escolhe o valor dela.

## Decisão

**Perfis nomeados por loja.** `lojas.parametros.perfis` guarda perfis com
`{nome, base, regras}`, onde `base` é `lei` ou `politica-da-casa`. O
colaborador aponta por `perfil`. Cada alerta carrega a base e cita o perfil que
decidiu. Sem perfis configurados, o gerente mantém sábado e domingo.

**Meta e piso como chaves distintas.** `minCaixa` continua meta; o novo
`minCaixaObrigatorio` é piso e bloqueia publicação. Chave ausente é "sem piso",
nunca zero.

**O banco manda nas regras.** `CHAVES_DE_REGRA` lista tudo que classifica ou
afrouxa regra; essas chaves vêm só de `lojas.parametros`. Do payload passa
apenas `_horas`. Divergência vira observação na resposta e linha em
`registro_acoes`.

**Não verificado ≠ conforme.** O resumo ganhou `conformidade`
(`completa`/`parcial`/`reprovada`), `nao_verificadas` e `validacao_parcial`.
Jornada sem entrada e saída deixa a validação parcial em vez de passar por
conformidade.

## Por que não uma tabela de perfis

Uma tabela `perfis_operacionais` com FK em `colaboradores` seria mais
consultável. Custaria migração em Postgres e MySQL e tocaria o caminho de dados
que acabou de ser estabilizado. `lojas.parametros` já é o lugar dos parâmetros
de loja, já é versionado por `lojas.versao` e já é copiado para
`escala_versoes.parametros` a cada publicação — ou seja, o histórico de qual
regra valia em cada escala sai de graça. Se os perfis crescerem a ponto de
precisar de consulta SQL, a migração continua possível.

## Preservação

Nenhuma loja muda de comportamento sem alteração explícita:

- loja sem `perfis` mantém a folga de fim de semana do gerente;
- loja sem chave `*Obrigatorio` não ganha bloqueio nenhum;
- parâmetros gravados continuam válidos como estão.

O que muda sem pedir é o que **não** deveria funcionar: afrouxar regra pelo
payload. Dois testes em `testes/api.sh` cobrem a tentativa e o registro na
auditoria.

## Custo

O verificador independente precisou aprender perfil e piso — e, por
[decisão 0005](0005-verificador-independente.md), reimplementados do zero, não
importados do motor. São três lugares a manter por regra: `motor.js`,
`comum.php` e `verificador.js`. É o custo já aceito em 0005, agora estendido a
duas regras novas.

Testes que afrouxavam regra pelo payload para provocar bloqueio deixaram de
funcionar: passaram a gravar os parâmetros na loja antes. Foi sintoma de que o
furo era real — o teste usava o mesmo caminho que um cliente mal-intencionado.
