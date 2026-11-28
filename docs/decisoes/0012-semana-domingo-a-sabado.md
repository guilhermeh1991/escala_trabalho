# 0012 — A semana vai de domingo a sábado

**Situação**: aceita

## Problema

A definição de semana era um parâmetro com três valores: blocos de 7 dias a
partir do início do período (`'P'`, o padrão), domingo a sábado (`0`) e segunda a
domingo (`1`). Também existiam dois modelos de escala, 5x2 e 6x1.

Dois problemas somados:

**A tela mentia.** A grade desenha uma barra dourada no domingo, o PDF desenha
linha dupla antes do domingo e a visão do colaborador sempre renderizou domingo a
sábado. Mas o motor contava folgas em blocos de 7 dias a partir do dia 11. O que
o usuário via como "semana" não era a semana em que as folgas eram contadas.

**O 6x1 não ia mais existir** na operação, e manter dois modelos exigia manter
duas famílias de opções no gerador, duas validações no servidor e uma regra extra
no verificador.

## Medição

300 cenários (semente 12345), 181 deles puramente 5x2, forçando cada formato:

| Semana conta de | Escalas limpas | Folgas em par | Desvio | Violações |
|---|---|---|---|---|
| `'P'` blocos de 7 | 100,0% | 95,3% | 1,36 | nenhuma |
| **`0` domingo a sábado** | 95,0% | 95,9% | 1,51 | R3×5, R2×8 |
| `1` segunda a domingo | 75,7% | 94,5% | 1,43 | R2×48, R3×8 |

À primeira vista `'P'` parecia melhor. Mas forçando os períodos a **começar num
domingo** (28 dias, 4 semanas cheias), domingo a sábado deu **100,0% de escalas
limpas e zero violações**. Isso isolou a causa: **as violações vinham das semanas
incompletas das pontas, não do formato de semana.**

O período padrão vai do dia 11 ao dia 10. Com semana domingo a sábado isso gera
ponta incompleta nas **duas** extremidades. Em 24 períodos medidos, as pontas têm
de 1 a 6 dias, e **7 dos 24 geram ponta de um dia só**.

## Decisão

A semana vai de domingo a sábado, sem opção na tela. Só existe 5x2.

**A ponta com menos de sete dias é absorvida pela semana vizinha**, formando um
bloco de 8 a 13 dias. O alvo de folgas acompanha o bloco:

```
alvo(k) = 2 × floor(k / 7) + (k mod 7 >= 3 ? 1 : 0)
```

Duas condições, ambas descobertas medindo:

1. **só funde se existir ao menos uma semana de calendário completa** — senão um
   período curto inteiro viraria um "bloco" que não é semana nenhuma;
2. **só funde se o bloco resultante ficar com no máximo 13 dias** — senão as duas
   pontas de um período de 14 dias colapsam num bloco único.

Sem essas duas condições, 5,59% dos blocos saíam abaixo do alvo. Com elas, 0,00%
em 6.304 blocos conferidos.

## Por que esta fórmula

É **a regra que já existia**, sem mudança. O código antigo era
`folgasSemana * semanasCompletas() + semanasParciais()` — literalmente "2 por
semana cheia, 1 por sobra de 3 a 6 dias". Aplicar a mesma expressão a um bloco de
`k` dias é a mesma regra reescrita.

Daí sai a propriedade que sustenta a decisão: **somar uma ponta à vizinha dá
exatamente o mesmo total que contá-la separada** (verificado para pontas de 1 a 6
dias). Ninguém ganha nem perde folga por causa da fusão.

`round(2k/7)` foi descartada: quebra essa equivalência (uma ponta de 6 dias
passaria a pedir 2 folgas em vez de 1) e não é monotônica onde precisa ser — dava
2 folgas para 9 dias e 4 para 12.

## O que foi descartado

**Exigir duas folgas em toda semana, inclusive nas pontas.** Era a leitura
literal do pedido, e é impossível: em 7 de 24 períodos a ponta tem um dia só. Numa
ponta de dois dias, com 12 não-gerentes e mínimo de 7 pessoas por dia, seriam 12
folgas no mesmo dia — **zero pessoas na loja**.

**Alinhar o período ao domingo** (28 dias, começando sempre num domingo). Dava
100% de escalas limpas e zero pontas, mas abandona a convenção dia 11 → dia 10: em
2026 o início iria de 11/01 a 16/02 dependendo do mês.

**Manter o seletor com o padrão trocado.** Menos limpo, e preservaria a
divergência entre o que a tela desenha e o que o motor conta.

## A consequência não óbvia: o gerador precisou aprender a montar três folgas

Esta é a parte que um leitor futuro vai quebrar de novo se não estiver escrita.

Um bloco fundido de 10 a 13 dias pede **três** folgas. Mas `opcoesDaSemana` só
sabia montar pares, e o terceiro dia só aparecia pela variante "par + um extra",
cobrada como `extraFolga` — ou seja, **a terceira folga, que a regra exige, era
cobrada como defeito de qualidade.** A programação dinâmica preferia sempre a
opção de duas folgas, mais barata na cobertura.

Pior: **não existia peso nenhum por furar o alvo de folgas da semana.** Com
semanas de sete dias isso nunca apareceu, porque qualquer par já atendia o alvo 2.
O defeito estava latente desde sempre e só a fusão o revelou.

Duas correções foram necessárias:

- `PESO.folgaSemanal` (180.000, faixa 1 — é direito legal): cada folga faltando
  frente ao alvo do bloco custa isso. Antes, nada.
- opções do tipo `par-mais-um`: um par mais um dia separado, cobradas como
  `separado` e não como folga extra.

Resultado: escalas limpas de 90,6% (base) para **95,3%**, lojas reais em 100%, e
R1-folgas-semana zerado.

## Histórico preservado

Escala publicada sob `'P'` ou `1` continua sendo conferida pela regra da época.
`semanasDoPeriodo` (motor), `semanasDoPeriodoServidor` (PHP) e
`semanasDaConferencia` (verificador) mantêm os dois ramos antigos intactos; só
escala nova usa domingo a sábado. Sem isso, o veredito de uma escala já aprovada
mudaria sozinho, contra a [decisão 0010](0010-regras-por-perfil-e-autoridade-do-banco.md).

As chaves `modelo`, `folgasSemana` e `inicioSemana` continuam sendo gravadas,
embora agora tenham valor único. São registradas em `regras_aplicadas` no
histórico de versões e constam de `CHAVES_DE_REGRA`, a lista que detecta
adulteração de regra pelo navegador — removê-las deixaria de registrar uma
tentativa de enviar `folgasSemana: 1`, que é o ataque descrito em
[05 — Segurança e LGPD](../05-seguranca-e-lgpd.md).
