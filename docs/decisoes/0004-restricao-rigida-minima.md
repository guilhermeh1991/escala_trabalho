# 0004 — Só é rígido o que torna a atribuição impossível

**Situação**: aceita

## Problema

Cobertura mínima era bloqueio absoluto: se dar folga a alguém derrubasse o
mínimo de farmacêuticos, aquele dia ficava indisponível para essa pessoa.

Isso criava beco sem saída. Com um farmacêutico só na loja e exigência de ao
menos um presente, **ele ficava impedido de folgar em qualquer dia do mês**. O
gerador devolvia semanas inteiras sem folga nenhuma — 202 ocorrências em 200
cenários — e o problema aparecia como se fosse defeito do algoritmo.

## Decisão

Só é restrição rígida o que torna a atribuição **impossível**:

- o dia já está ocupado por férias, atestado ou licença;
- a loja ficaria sem ninguém.

Todo o resto vira custo, com peso proporcional à gravidade. É a separação que a
literatura de rostering usa entre restrições rígidas e flexíveis, e o critério
para classificar é a viabilidade, não a importância.

## Resultado

- Semanas sem folga: de 202 para 0.
- Violações de folga semanal: eliminadas.
- Apareceram alertas de "dia sem farmacêutico" — **corretos**: a loja com um
  farmacêutico só não tem como dar a folga dele e manter cobertura. O sistema
  concede a folga legal e marca o dia em vermelho para o gerente combinar
  substituição.

## Nota

Isso mudou a natureza dos alertas de cobertura: deixaram de ser "o algoritmo
falhou" e passaram a ser "a operação precisa de uma decisão". A tela separa as
duas coisas em "regra ferida" e "observação".
