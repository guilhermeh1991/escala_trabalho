# 0011 — Cobertura medida por faixa de horário

**Situação**: aceita

## Problema

O mínimo diário conta pessoas no dia. Isso não diz se houve alguém no caixa às
12h30.

Nas lojas reais o furo é concreto: a loja fecha o dia com nove pessoas, cumpre
o mínimo diário com folga, e mesmo assim fica sem caixa durante uma hora porque
todo mundo almoça junto. O mesmo vale para turnos concentrados — duas pessoas
de manhã satisfazem "mínimo 2 no dia" e deixam a tarde inteira descoberta.

Contar cabeças por dia e chamar isso de cobertura é medir a coisa errada.

## Decisão

Medir presença ao longo do dia, por função, contra faixas de demanda que a loja
declara.

**Opcional por loja.** Sem `faixas` configuradas o módulo não roda e nada muda.
O mínimo diário continua sendo mínimo diário — não vira exigência contínua do
expediente por conta própria. Quem quiser a medida fina a liga explicitamente.

**Limites semiabertos.** `[entrada, saída)`. Era a escolha que decidia se a
troca de turno às 14:00 viraria buraco de zero minuto ou dupla contagem. Com
semiaberto, quem sai não conta no instante da saída e quem entra conta: a troca
exata fica limpa nos dois sentidos.

**Segmentação por evento, não por grade.** Os cortes são os instantes em que
presença ou demanda mudam. Uma grade de 30 minutos esconderia uma lacuna de 10,
e lacuna curta em cobertura obrigatória é justamente o que ninguém percebe
olhando a escala.

**Cargo atende função só quando declarado.** Não há dedução por substring.
Repositor não vira balcão porque alguém achou que faz sentido; a loja declara.
O padrão existente (caixa, balcão, farmacêutico, subgerente) virou configuração
visível em vez de regra implícita no código.

**Pessoa conta uma vez.** `SUB/FARMA` atende farmacêutico e subgerente ao mesmo
tempo. Satisfaz as duas faixas, e o total de presentes no segmento continua
sendo uma pessoa. Inflar o total seria dizer que a loja tem gente que não tem.

## Dados faltantes

Três estados que não podem colapsar em um:

- jornada sem entrada e saída: presença não verificável;
- `intervalos: []`: sem intervalo, presença cheia;
- duração de intervalo sem horário: lacuna — não se inventa onde foi o almoço.

O terceiro é o que mais importa. Chutar 12h–13h produziria um relatório
plausível e falso. A lacuna é reportada, a validação fica parcial, e **o
bloqueio não é contornado**: se a faixa está descoberta por quem tem dado
conhecido, continua bloqueada.

## Piso obrigatório sem gente disponível

A etapa anterior tratava piso inalcançável como impedimento operacional, que
não bloqueava — por analogia com a [decisão 0004](0004-restricao-rigida-minima.md),
onde cobrar o impossível gerava ruído.

Aqui a analogia não se aplica, e a decisão foi revertida: piso obrigatório
bloqueia mesmo sem gente disponível. A diferença é que 0004 fala do **gerador**,
que precisa conseguir produzir alguma escala; isto é **validação de
publicação**, onde a pergunta é se a escala pode valer. Escassez de equipe não
é motivo para publicar uma escala que a própria loja declarou inaceitável.

Quem abre mão do piso é quem administra, alterando a configuração — não a
escassez do dia. A indisponibilidade continua registrada no texto do alerta.

## Reprodutibilidade histórica

A versão da escala guarda, no snapshot, as regras que de fato valeram na
validação (`regras_aplicadas`), lidas do banco. Sem isso, reabrir uma escala de
três meses atrás a mediria com a configuração de hoje, e o histórico mudaria
sozinho toda vez que alguém editasse os parâmetros da loja.

## Custo

Mais uma implementação espelhada: `src/motor/cobertura.js` e o bloco
equivalente em `api/comum.php`. A autoridade continua sendo o servidor, com
`expediente`, `faixas` e `funcoes` em `CHAVES_DE_REGRA` — o cliente não
consegue afrouxar faixa pelo payload.

Diferente do verificador independente da
[decisão 0005](0005-verificador-independente.md), aqui o espelho é deliberado:
os dois lados devem concordar, porque um é a prévia e o outro é a autoridade.
Divergência entre eles é defeito, não achado.

Medição em 30 dias, faixas em todos os dias da semana: 20 pessoas em ~250ms,
50 em ~720ms, 100 em ~2,3s. O custo está na geração da escala, não na análise
de cobertura, que fica em torno de 20ms mesmo com 100 pessoas.

## Limitações conhecidas

- A análise usa a jornada padrão da pessoa; rodízio de horários dentro do
  período só é refletido via ajuste manual na grade.
- O gerador não otimiza para cobertura intradiária — ele distribui folgas. A
  análise acusa o furo; realocar turnos continua sendo decisão de quem opera.
- Faixas são por dia da semana, não por data. Véspera de feriado com demanda
  atípica não tem como ser declarada sem mudar o dia inteiro.
