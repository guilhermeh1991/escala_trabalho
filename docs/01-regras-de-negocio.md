# Regras de negócio

Este documento é a fonte da verdade sobre o que o sistema promete cumprir.
Quando duas regras se chocam — e elas se chocam — a ordem de prioridade aqui
é o que decide.

## Ordem de prioridade

O motor não trata as regras como iguais. Elas estão em faixas separadas por
ordem de grandeza, de propósito: **a soma de todos os furos de cobertura de um
mês inteiro ainda é menor que uma única infração legal.**

Isso não é detalhe de implementação. Antes dessa separação, o motor "comprava"
uma infração trabalhista para salvar a cobertura de dois dias — e a troca até
parecia razoável olhando dia a dia. Ver
[decisão 0003](decisoes/0003-pesos-em-faixas.md).

| Faixa | Regra | Peso |
|---|---|---|
| 1 — lei | Máximo de dias seguidos trabalhados | 200.000 |
| 1 — lei | Teto de domingos seguidos trabalhados | 150.000 |
| 2 — casa | 6x1: folga da semana além do domingo do ciclo | 30.000 |
| 2 — casa | Dia de folga fixa escolhido para a pessoa | 25.000 |
| 3 — loja | Ficar sem nenhum farmacêutico | 5.000 |
| 3 — loja | Manter subgerente na loja | 1.400 |
| 3 — loja | Chegar a dois farmacêuticos | 900 |
| 3 — loja | Mínimo de pessoas do dia da semana | 400 |
| 3 — loja | Mínimo de caixa e de balcão | 600 |
| 4 — qualidade | Folga em dias seguidos, equilíbrio entre dias | 60 a 1.600 |

A única restrição verdadeiramente rígida é **dia já ocupado por férias,
atestado ou licença**, mais **a loja não pode ficar vazia**. Todo o resto é
custo. Isso é deliberado: transformar cobertura em bloqueio absoluto criou um
beco sem saída onde o farmacêutico único não podia folgar em nenhum dia do mês.

---

## 1. Ciclo de domingos

> A cada dois domingos trabalhados, o colaborador folga um domingo.

Base legal: Lei 10.101/2000, artigo 6º, parágrafo único — o repouso semanal
remunerado precisa coincidir com o domingo pelo menos uma vez a cada três
semanas. O TST interpretou exatamente nesse sentido: a cada dois domingos
consecutivos trabalhados, o descanso vem no domingo seguinte.

**Três domingos seguidos trabalhados é irregular.** O parâmetro de ciclo aceita
o valor 4 na tela, mas usá-lo põe a empresa fora da lei.

O ciclo é uma restrição da própria busca, não uma pré-atribuição. O motor
carrega um contador de domingos seguidos trabalhados enquanto monta o mês e
recusa qualquer combinação que estoure o teto. Ver
[decisão 0002](decisoes/0002-domingo-na-busca.md).

**Âncora**: o campo "1º domingo de folga" fixa a data exata em que a pessoa
folga pela primeira vez. Os demais saem daí, somando o ciclo. Em branco, o
sistema distribui a equipe pelos domingos para não folgarem todos juntos.

## 2. Máximo de dias seguidos trabalhados

> Nunca mais de seis dias sem folgar.

Padrão: 6. O limite vale de ponta a ponta, incluindo:

- os dias trabalhados que vieram do mês anterior;
- a ponta final do período — os dias entre a última folga e o fim do mês.

A ponta final foi origem de defeito real: o bloco curto no fim do período não
recebia folga e sobrava uma sequência de sete dias, sempre no último dia.

## 3. Folgas da semana

### 5x2 — duas folgas por semana, em dias seguidos

As duas folgas devem ser dias consecutivos. Quando não couber par por falta de
gente, o comportamento depende do parâmetro **"Quando não couber tudo"**:

| Postura | Furos de cobertura | Folgas em par |
|---|---|---|
| Priorizar descanso (padrão) | 17 | 97,8% |
| Equilibrar | 9 | 96,3% |
| Priorizar equipe na loja | 8 | 94,6% |

Medido nas lojas reais, três competências. A escolha é de negócio, não técnica.

### 6x1 — uma folga por semana, mais o domingo do ciclo

A folga da semana e a folga de domingo são **direitos separados**. Na semana em
que cai o domingo do ciclo, a pessoa folga duas vezes: o domingo e o dia comum.

Não há exigência de dias colados no 6x1.

## 4. Domingo de folga colado ao fim de semana

> Sendo o domingo dele, tentar encaixar sábado ou segunda.

É uma tentativa, não uma obrigação — cede quando esbarra no limite de dias
seguidos. Metade da equipe é direcionada ao sábado e metade à segunda; sem isso
a segunda-feira fica deserta, porque o par sábado+domingo é sempre mais fácil
de formar.

## 5. Gerente

> Folga todo sábado e domingo, ignorando as demais regras.

Consequência operacional: a loja fica sem gerente todo fim de semana. Foi por
isso que a regra do subgerente existe.

## 6. Farmacêuticos

> Dois na loja. Um é tolerado em último caso.

Dois níveis: ficar com um custa caro, ficar com nenhum é quase proibido — peso
cinco vezes maior. O rodapé da grade mostra amarelo para um e vermelho para
nenhum.

Resultado nas lojas reais, três competências: dois ou mais farmacêuticos em 28 a
31 dias de 31, nunca zero.

**Onde aperta**: com três farmacêuticos no quadro e alvo de dois, são 27
dias-folga que precisam caber em 31 dias sem nunca se sobrepor. Fecha, mas sem
margem. Se um entra de férias, o mês inteiro cai para um farmacêutico.

## 7. Subgerente

> Ao menos um na loja todos os dias, com reforço no fim de semana.

Com apenas dois subgerentes, eles nunca folgam no mesmo dia. Com um só
disponível — o outro de férias — não existe solução: ele folgaria e ninguém
cobre. O sistema concede a folga e marca o dia.

## 8. Mínimo de pessoas por dia da semana

O alvo não é distribuição plana, e sim a **curva de movimento da loja**. Esta
foi extraída das planilhas históricas:

| | Loja 330 | Loja 332 |
|---|---|---|
| Dia mais cheio | terça, 11 pessoas | terça, quinta e sábado, 12,8 |
| Dia mais vazio | domingo, 7,3 | sexta, 9,2 |

As duas lojas têm padrões diferentes, e por isso o mínimo é por loja e por dia
da semana. Sem esse alvo o motor não tem noção de demanda diária: numa das
simulações, 13 de 14 pessoas folgaram no mesmo domingo.

Quando o campo fica zerado, o sistema deduz um alvo plano a partir da própria
capacidade da equipe.

## 9. Folga fixa

Por colaborador, opcional. No 6x1 é a folga da semana; no 5x2 é o par que passa
a incluir aquele dia.

Custo de cada dia fixo, medido na loja 330:

| Configuração | Violações legais | Furos de cobertura |
|---|---|---|
| Ninguém fixo | 0 | 4 |
| 4 pessoas, dias diferentes | 0 | 3 |
| 6 de 12 pessoas fixas | 0 | 6 a 7 |
| 4 pessoas todas na terça | 0 | 4 a 7 |

Até cerca de um terço da equipe, praticamente não custa. Concentrar várias
pessoas no mesmo dia é o que mais pesa.

## Códigos da grade

| Código | Significa | Entra na escala |
|---|---|---|
| *hora de entrada* | dia trabalhado | gerado |
| `X` | folga | gerado |
| `FC` | folga compensatória | lançado à mão |
| `F` | férias | lançado em Ausências |
| `AT` | atestado | lançado em Ausências |
| `LC` | licença | lançado em Ausências |

Férias, atestado e licença são intocáveis: o motor monta a escala em volta
deles.
