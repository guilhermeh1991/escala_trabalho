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

A tabela abaixo é a lista completa: toda penalidade que o motor aplica está
aqui, com o nome da chave em `PESO` (`src/motor/motor.js`). Peso que não está
nesta tabela não existe no código.

| Faixa | Regra | Chave | Peso |
|---|---|---|---|
| 1 — lei | Máximo de dias seguidos trabalhados | `estouroSeq` | 200.000 |
| 1 — lei | Teto de domingos seguidos trabalhados | `pulaDomingo` | 150.000 |
| 2 — casa | Furar o domingo de folga fixado por data | `domingoAncorado` | 28.000 |
| 2 — casa | Folgar em domingo fora do ciclo ancorado | `domingoExtra` | 28.000 |
| 2 — casa | Dia de folga fixa escolhido para a pessoa | `diaFixo` | 25.000 |
| 2 — casa | Folgar em domingo fora da fase automática | `domingoForaRotacao` | 24.000 |
| 2 — casa | Deixar passar o domingo da fase automática | `domingoRotacao` | 24.000 |
| 3 — loja | Ficar sem nenhum farmacêutico | `farmaCritico` | 5.000 |
| 3 — loja | Manter subgerente na loja | `subger` | 1.400 |
| 3 — loja | Chegar a dois farmacêuticos | `farmaAlvo` | 900 |
| 3 — loja | Subgerente ausente no fim de semana | `subgerFds` | 900 |
| 3 — loja | Mínimo de caixa e de balcão | `equipe` | 600 |
| 3 — loja | Folgar em domingo que não é o seu | `outroDomingo` | 450 |
| 3 — loja | Mínimo de pessoas do dia da semana | `curva` | 400 |
| 3 — loja | Cada folga além do teto do dia | `teto` | 150 |
| 4 — qualidade | Terceira folga na semana, descolada do par | `extraFolgaSolta` | 1.600 |
| 4 — qualidade | Folga extra colada ao par | `extraFolga` | 700 |
| 4 — qualidade | Cada dia além de 3 num bloco de descanso | `blocoLongo` | 500 |
| 4 — qualidade | Duas folgas na semana sem serem dias seguidos | `separado` | 210 |
| 4 — qualidade | Folga única na semana | `avulso` | 130 |
| 4 — qualidade | **Bônus**: par de folgas que inclui o domingo dele | `bonusDomColado` | −250 |

Os pesos de `curva` e `teto` são substituídos pelo parâmetro **"Quando não
couber tudo"**: `par` usa 400 e 150, `equilibrado` usa 800 e 250, `equipe` usa
1.800 e 400.

Note que os quatro pesos de domingo da faixa 2 estão **acima** do dia de folga
fixa. Um domingo de folga fixado por data é mais forte que a preferência de dia
fixo da semana — e isso não se deduz da ordem das seções deste documento.

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

### A semana vai de domingo a sábado

Não é configurável. A grade e os documentos impressos já marcam o domingo como
início de semana, e agora a contagem de folgas concorda com o que se vê na tela.

O período costuma ir do dia 11 ao dia 10, então as pontas quase nunca caem em
domingo: sobra um pedaço de 1 a 6 dias em cada extremidade. **Um pedaço desses é
somado à semana vizinha**, formando um bloco de 8 a 13 dias, e o alvo passa a ser
o do bloco inteiro:

| Bloco | Folgas | Bloco | Folgas |
|---|---|---|---|
| 7 dias | 2 | 11 dias | 3 |
| 8 dias | 2 | 12 dias | 3 |
| 9 dias | 2 | 13 dias | 3 |
| 10 dias | 3 | | |

A conta é `2 × (dias ÷ 7, arredondado para baixo) + 1 se o resto chegar a 3`. É a
mesma regra proporcional de sempre, e por isso **somar a ponta à vizinha dá
exatamente o mesmo total que contá-la separada**: ninguém ganha nem perde folga
por causa da fusão.

Por que não exigir duas folgas na ponta: em 7 de 24 períodos a ponta tem **um dia
só**. Numa ponta de dois dias, com doze pessoas e mínimo de sete por dia, seriam
doze folgas no mesmo dia — a loja fecharia. Ver
[decisão 0012](decisoes/0012-semana-domingo-a-sabado.md).

Duas condições para a fusão, ambas descobertas medindo:

1. só funde se existir ao menos uma semana de calendário completa, senão um
   período curto inteiro viraria um "bloco" que não é semana nenhuma;
2. só funde se o bloco resultante ficar com no máximo 13 dias, senão as duas
   pontas de um período de 14 dias colapsam num bloco único.

## 4. Domingo de folga colado ao fim de semana

> Sendo o domingo dele, tentar encaixar sábado ou segunda.

É uma tentativa, não uma obrigação — cede quando esbarra no limite de dias
seguidos. Metade da equipe é direcionada ao sábado e metade à segunda; sem isso
a segunda-feira fica deserta, porque o par sábado+domingo é sempre mais fácil
de formar.

## 5. Perfis operacionais

> Folga fixa semanal vem do perfil da pessoa, não de uma exigência legal.

Cada loja define seus perfis em `parametros.perfis`. Um perfil declara o nome
que aparece nos alertas, a **base** da regra (`lei` ou `politica-da-casa`) e as
regras em si:

```json
"perfis": {
  "gerente-fds": {
    "nome": "Gerente — folga no fim de semana",
    "base": "politica-da-casa",
    "regras": { "folgaFixaSemanal": [0, 6] }
  }
}
```

O colaborador aponta para um perfil pelo campo `perfil`. **Loja sem perfis
configurados mantém o comportamento anterior**: quem está marcado como gerente
folga sábado e domingo. Se a ficha do gerente tiver duas folgas fixas, elas
prevalecem sobre o perfil; na semana do domingo do ciclo, o domingo substitui a
primeira folga fixa e a segunda permanece. Nada muda para gerentes antigos até
alguém configurar os dois dias.

Isso importa porque a folga de fim de semana do gerente nunca foi exigência da
lei — é política da casa. O alerta agora diz qual perfil decidiu, em vez de
apresentar a regra como obrigação universal. Limite de dias seguidos, ciclo de
domingos, folgas semanais mínimas e descanso de 11h são marcados como `lei`.

Consequência operacional do perfil de gerente: a loja fica sem gerente todo fim
de semana. Foi por isso que a regra do subgerente existe.

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

| | Unidade Aurora | Unidade Horizonte |
|---|---|---|
| Dia mais cheio | terça, 11 pessoas | terça, quinta e sábado, 12,8 |
| Dia mais vazio | domingo, 7,3 | sexta, 9,2 |

As duas lojas têm padrões diferentes, e por isso o mínimo é por loja e por dia
da semana. Sem esse alvo o motor não tem noção de demanda diária: numa das
simulações, 13 de 14 pessoas folgaram no mesmo domingo.

Quando o campo fica zerado, o sistema deduz um alvo plano a partir da própria
capacidade da equipe.

## 8b. Meta e mínimo obrigatório

Os mínimos de cobertura têm dois níveis, configuráveis por loja e por função:

| Nível | Chave | Efeito |
|---|---|---|
| Meta | `minCaixa`, `minBalcao`, `minFarma`, `minSubger`, `minDia` | aviso; não impede publicar |
| Piso obrigatório | as mesmas com sufixo `Obrigatorio` | **bloqueia a publicação** |

O piso só existe onde a loja o declarou. Chave ausente significa "sem piso", e
não zero — por isso as lojas já configuradas continuam exatamente como estavam:
nenhuma meta vira bloqueio sem uma alteração explícita de quem administra.

Quando não há gente disponível para alcançar o piso (férias, atestado, licença),
o alerta registra a indisponibilidade no texto, **mas o piso continua
bloqueando**. A distinção entre violação e impossibilidade da
[decisão 0005](decisoes/0005-verificador-independente.md) vale para o gerador,
que precisa produzir alguma escala; aqui a pergunta é se a escala pode ser
publicada, e escassez de equipe não autoriza publicar uma escala que a própria
loja declarou inaceitável. Ver
[decisão 0011](decisoes/0011-cobertura-intradiaria.md).

## 8c. Cobertura por faixa de horário

O mínimo diário responde "quantas pessoas trabalharam neste dia". Não responde
"havia alguém no caixa às 12h30". Uma loja pode ter nove pessoas no dia e ficar
sem caixa durante o almoço, porque todas saem juntas.

A cobertura intradiária responde a segunda pergunta. **É configuração opcional
por loja**: sem faixas declaradas, nada muda e o mínimo diário segue valendo
exatamente como está. Um mínimo diário nunca vira exigência contínua do
expediente inteiro por conta própria.

### Configuração

| Chave | O que é |
|---|---|
| `expediente` | por dia da semana: janelas de funcionamento, ou `false` para fechado |
| `faixas` | por dia da semana: lista de `{funcao, ini, fim, meta, obrigatorio}` |
| `funcoes` | quais cargos atendem cada função |

`meta` gera aviso; `obrigatorio` impede publicar. Fora do expediente e em dia
fechado não há cobrança de cobertura.

### Critérios de cálculo

1. **Presença vem do que está cadastrado**: jornada estruturada, ajuste manual
   de horário na grade, ou o texto legado quando traz entrada e saída. Nada é
   inventado.
2. **Intervalos são descontados.** Quem está no almoço não está no balcão.
3. **Limites semiabertos `[entrada, saída)`.** Quem sai às 14:00 não conta às
   14:00; quem entra às 14:00 conta. Assim a troca de turno exata não cria
   buraco falso nem conta a mesma vaga duas vezes.
4. **Segmentação nos instantes de mudança**, não em grade fixa de 30 ou 60
   minutos. Uma lacuna de 10 minutos aparece como lacuna de 10 minutos.
5. **Meia-noite**: o turno que termina às 02:00 contribui para o dia seguinte.
6. **Cada pessoa conta uma vez.** Quem acumula competências (`SUB/FARMA` atende
   farmacêutico e subgerente) satisfaz as duas funções sendo uma pessoa só; o
   total de presentes no segmento não a duplica.

### Cargos e funções

Quais cargos atendem cada função é declaração explícita da loja. **Repositor e
auxiliar não contam como balcão** a menos que a loja os inclua em
`funcoes.balcao.cargos`. O padrão cobre caixa, balcão, farmacêutico e
subgerente com os cargos de mesmo nome.

### Dados faltantes

Três situações distintas, que o sistema não confunde:

| Situação | Tratamento |
|---|---|
| Jornada sem entrada e saída | lacuna: presença não verificável |
| `intervalos: []` (lista vazia) | sem intervalo — presença cheia |
| Duração de intervalo sem horário | lacuna: não se inventa o horário do almoço |

Lacuna **não contorna bloqueio**: se a faixa está descoberta por quem tem dado
conhecido, o bloqueio permanece e a lacuna é reportada à parte. A validação
fica marcada como parcial.

## 9. Folga fixa

Por colaborador, opcional. O par de folgas da semana passa a incluir aquele dia.

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

## 10. Descanso entre jornadas

> Entre a saída de um dia e a entrada do próximo, o colaborador precisa ter ao
> menos 11 horas de descanso.

O sistema confere pares de dias trabalhados, incluindo ajustes manuais de
entrada feitos na grade. Descanso menor que 11 horas é uma **regra ferida** e
fica marcado no dia de entrada, em Pendências e nas saídas impressas.

A regra é uma validação da escala pronta: o gerador decide folgas, não turnos.
Quando houver rodízio automático de horários, a restrição deverá entrar também
na geração.

## 11. Jornada padrão do colaborador

O campo de horário da equipe pode apontar para um **modelo oficial de jornada**
ou guardar um ajuste estruturado de entrada, saída e intervalo. O resumo em
texto continua sendo salvo para manter a leitura da grade e dos documentos.
O modelo também informa o intervalo de almoço ou janta; ele aparece uma vez na
coluna fixa da escala e detalhadamente ao clicar em um dia.

A troca de jornada não altera **folga fixa**, **1º domingo de folga** nem o
histórico de domingos: esses dados permanecem independentes na ficha do
colaborador.
