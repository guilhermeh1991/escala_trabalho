# 0001 — Programação dinâmica no lugar de algoritmo guloso

**Situação**: aceita

## Problema

A primeira versão escolhia, para cada semana em ordem, o melhor par de folgas
disponível. Produzia escalas ilegais e mal distribuídas.

A causa era estrutural, não de ajuste de peso. Para colar sábado ou domingo no
domingo de folga, a folga da **semana anterior** também precisa ter caído perto
do fim de semana — senão o intervalo passa de seis dias. O algoritmo guloso
prendia todos no meio da semana nas primeiras semanas e depois não alcançava
mais o fim de semana.

Sintoma visível: 55% de folgas em par, 202 semanas sem folga nenhuma nas
simulações, e violação de sequência nas duas lojas reais.

## Opções

1. **Continuar guloso, ajustando pesos.** Testado. Variações de peso mudavam o
   resultado em ±2%. O gargalo não era calibragem.
2. **Enumerar padrões semanais e resolver por programação linear.** É a
   abordagem clássica da literatura de escala de enfermagem. Correta, mas exige
   um solver e complica o build, que hoje não tem dependência nenhuma.
3. **Programação dinâmica por colaborador.** Monta todas as opções de cada
   semana e escolhe a sequência do mês inteiro de menor custo.

## Decisão

Opção 3. O espaço de estados é pequeno — cerca de 21 estados por semana, cinco
semanas — então a solução ótima por pessoa sai em milissegundos, sem solver.

Entre pessoas continua sendo guloso, compensado por quatro rodadas de
replanejamento em que cada um é retirado e reencaixado vendo a escala dos
outros.

## Resultado

| | Guloso | Programação dinâmica |
|---|---|---|
| Folgas em par | 55% | 96,6% |
| Semanas sem folga | 202 | 0 |
| Violações nas lojas reais | 8 | 0 |

## O que se perdeu

O ótimo é por pessoa, não global. Uma escala perfeita no conjunto poderia ser
melhor que a soma dos ótimos individuais. As rodadas de replanejamento reduzem
a diferença, mas não a eliminam.

Aceitável: as medições mostram folga de sobra em relação aos limiares.
