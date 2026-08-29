# 0002 — Ciclo de domingos como restrição da busca

**Situação**: aceita

## Problema

Os domingos de folga eram calculados antes de montar a escala: dado o ciclo,
sabia-se de antemão quais domingos cada pessoa folgaria. A escala era montada
tentando encaixar esses domingos.

Falhava quando o domingo pré-fixado não cabia. Caso real das simulações: um
subgerente chegava tendo trabalhado cinco dias, com limite de cinco. Era
obrigado a folgar no primeiro dia do período e não alcançava o domingo do dia 2.
Como o ciclo era rígido, o próximo domingo dele só vinha três semanas depois —
e ele trabalhava três domingos seguidos, o que é irregular.

## Opções

1. **Manter a pré-atribuição e replanejar quando falha.** Remendo: exige
   detectar a falha e recalcular o ciclo inteiro.
2. **Levar a restrição para dentro da busca.** O estado da programação dinâmica
   passa a carregar quantos domingos seguidos foram trabalhados, e recusa
   qualquer caminho que estoure o teto.

## Decisão

Opção 2. A lei diz "no máximo dois domingos seguidos trabalhados" — é uma
restrição sobre o caminho, não uma escala fixa de datas. Modelar como restrição
é mais fiel ao que a lei pede.

O campo "1º domingo de folga" continua existindo, agora como **âncora e
preferência**, não como imposição. A legalidade é garantida pela busca mesmo que
a preferência não caiba.

## Resultado

Violações do ciclo de domingos: de 395 para 194 nas simulações, e depois para
zero nas lojas reais.

Efeito colateral que exigiu correção: liberar a escolha do domingo fez todos
folgarem no mesmo domingo em alguns cenários, chegando a deixar a loja vazia.
Resolvido com bloqueio de loja vazia e teto progressivo de folgas por dia.
