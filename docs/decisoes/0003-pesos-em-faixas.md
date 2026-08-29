# 0003 — Pesos em faixas por ordem de grandeza

**Situação**: aceita

## Problema

Os pesos das restrições estavam na mesma ordem de grandeza: infração legal
custava 9.000, cobertura de farmacêutico 5.000, cobertura de equipe 400 por
unidade.

Consequência: **a soma dos custos de cobertura ultrapassava o custo de
infringir a lei.** O motor "comprava" a infração.

Caso concreto das simulações do 6x1: um farmacêutico ficou sozinho porque o
colega entrou de férias. Cada folga dele descobria o dia. O motor sacrificou a
folga semanal da pessoa para não deixar dois dias sem farmacêutico — troca que
parece razoável olhando dia a dia, e que é ilegal olhando o mês.

## Decisão

Pesos em faixas separadas por ordem de grandeza, de modo que **a soma de todos
os furos de cobertura de um mês inteiro ainda seja menor que uma única infração
legal**.

| Faixa | O quê | Ordem |
|---|---|---|
| 1 | obrigação legal | 150.000 a 200.000 |
| 2 | regra da casa | 25.000 a 30.000 |
| 3 | cobertura da loja | 400 a 5.000 |
| 4 | qualidade | 60 a 1.600 |

É a técnica de otimização lexicográfica: garante que nenhuma combinação de
critérios inferiores supere um critério superior.

## Resultado

| | Antes | Depois |
|---|---|---|
| Escalas limpas — 5x2 | 90,6% | 95,0% |
| Escalas limpas — 6x1 | 75,6% | 95,0% |
| Folga de domingo sem a da semana | 24 | 0 |
| Dias sem folga por escala | 1,85 | 0,56 |
| Furos de caixa | 130 | 86 |

A cobertura **melhorou junto**, o que não era óbvio. Priorizar a lei fez o motor
parar de fazer trocas ruins que degradavam os dois lados.

## O que se perdeu

Em situação impossível — farmacêutico único, por exemplo — o motor agora
concede a folga e deixa o dia descoberto, em vez de negar a folga. É a resposta
correta: o dia descoberto se resolve com substituição, a folga negada é
irregularidade trabalhista.
