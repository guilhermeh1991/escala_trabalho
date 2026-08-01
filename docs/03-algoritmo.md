# O algoritmo

## O problema

Montar escala é um problema de *rostering*: atribuir folgas a pessoas ao longo
de um período respeitando restrições rígidas e otimizando as flexíveis. É o
mesmo problema de escala de enfermagem, bastante estudado na literatura.

A abordagem clássica é gerar padrões semanais válidos e combinar apenas os que
encaixam entre si. É o que fazemos, com uma diferença: em vez de enumerar
padrões e resolver um programa linear, resolvemos por programação dinâmica por
colaborador, o que é suficiente nesta escala de problema e roda em 265 ms.

## Por que não decidir semana a semana

A primeira versão era gulosa: para cada semana, escolhia o melhor par de folgas
disponível. Falhava, e a falha tinha causa precisa.

Para colar sábado ou domingo no domingo de folga, a folga da **semana anterior**
também precisa ter caído perto do fim de semana — senão o intervalo entre as
duas passa de seis dias. O algoritmo guloso prendia todos no meio da semana nas
primeiras semanas e depois não conseguia mais alcançar o fim de semana.

Resultado medido antes e depois da troca:

| | Guloso | Programação dinâmica |
|---|---|---|
| Folgas em par | 55% | 96,6% |
| Semanas sem folga nenhuma | 202 | 0 |
| Violações de sequência | 8 nas lojas reais | 0 |

## Como funciona

Para cada colaborador, no mês inteiro:

**1. Gerar as opções de cada semana.** Todas as formas de fechar aquela semana:
pares consecutivos, pares com o domingo, dias soltos, variantes com um dia extra
para quando a cadeia não fecha de outro jeito. Cada opção carrega o custo dela.

**2. Encadear.** O estado da programação dinâmica guarda três coisas:

- o índice do último dia de descanso — para medir dias seguidos trabalhados;
- quantos domingos seguidos foram trabalhados — o contador legal;
- o tamanho do bloco de descanso que termina na virada — para detectar quando o
  par no fim de uma semana encosta no par da semana seguinte e vira quatro dias
  parados.

**3. Escolher o caminho de menor custo**, incluindo o custo da ponta final do
período.

**4. Replanejar em rodadas.** Quatro passagens em que cada pessoa é retirada da
escala e reencaixada, agora enxergando a escala dos outros já montada. Sem isso,
quem é planejado primeiro fica com os melhores dias e o último pega as sobras.

## Nada é descartado

Uma decisão que mudou muito o resultado: as restrições legais não eliminam
estados da busca, elas custam caro. Assim a cadeia sempre existe e, quando não
há saída limpa, o motor escolhe a combinação que infringe o mínimo possível — em
vez de travar e devolver uma semana sem folga nenhuma.

A única exceção é o que torna a atribuição impossível: dia já ocupado por
ausência, e loja vazia.

## Ordem de custo

Ver [01 — Regras de negócio](01-regras-de-negocio.md) para a tabela completa. O
princípio: **faixas separadas por ordem de grandeza**, de modo que a soma de
todos os furos de cobertura de um mês ainda seja menor que uma infração legal.

## Medições atuais

Suíte em `testes/executar.js`, 300 cenários aleatórios com equipes de 6 a 25
pessoas, períodos de 7 a 35 dias, férias e atestados incluídos.

| Medida | Valor | Limiar do CI |
|---|---|---|
| Escalas limpas — 5x2 | 95% | ≥ 90% |
| Escalas limpas — 6x1 | 95% | ≥ 90% |
| Folgas em par — 5x2 | 95,4% | ≥ 94% |
| Desvio da equipe por dia | 1,54 | ≤ 2,00 |
| Dias sem folga por escala | 0,56 | ≤ 1,50 |
| Lojas reais, 12 competências | 100% | = 100% |
| Tempo por escala | 265 ms | ≤ 1500 ms |

## Limites de matemática

Os 5% que ainda falham nas simulações concentram-se em configurações extremas.
Não são defeitos a corrigir:

**6x1 com semana fixa.** Com uma folga por semana e semanas de sete dias, o
intervalo entre duas folgas é `7 + (posição nova − posição antiga) − 1`. Para
ficar em seis dias ou menos, a posição nova precisa ser menor ou igual à antiga:
**o dia de folga só anda para trás, nunca para frente.** Quando chega na posição
zero, fica fixo. É por isso que o 6x1 tende naturalmente ao dia fixo — e é assim
que as lojas já operam.

**Domingo + segunda no bloco que começa na terça.** Contando a semana do dia 11,
o bloco começa na terça, o domingo cai na posição 6 e a segunda na 7. Para
folgar domingo e segunda, a folga da semana anterior teria que cair no domingo
dela, que é proibido por não ser o domingo dela. **A combinação é inalcançável
nesse formato de semana.** Por isso a definição de semana é um parâmetro:

| Semana conta de | Desvio | Folga na segunda | Folga no sábado |
|---|---|---|---|
| Dia 11, blocos de 7 | 1,46 | 0,5 | 4,3 |
| Domingo a sábado | 1,06 | 3,5 | 2,8 |
| Segunda a domingo | 0,97 | 3,5 | 3,3 |

**Farmacêutico único.** Um farmacêutico sozinho com nove folgas no mês deixa
nove dias sem cobertura. Nenhuma escala resolve; a folga é direito dele.

## O verificador

`testes/verificador.js` reimplementa a checagem das regras **do zero**, sem usar
nada do motor. Um validador que compartilha código com o que valida repete os
mesmos enganos.

Foi assim que sete defeitos apareceram, entre eles: semanas inteiras sem folga
quando o domingo estava bloqueado, farmacêutico único impedido de folgar em
qualquer dia, ciclo de domingos fixado antes da hora, e a ponta final do mês
fora da conta de dias seguidos.

O verificador também distingue o que é violação do que é impossibilidade: se
todos os farmacêuticos estão de férias, o dia sem farmacêutico não é culpa do
motor. Sem essa distinção, 88% dos alertas de farmacêutico eram ruído.
