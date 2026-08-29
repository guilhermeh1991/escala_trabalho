# Manual do usuário

Para quem vai montar a escala todo mês.

## Rotina do mês

1. **Equipe** — confira quem entrou, quem saiu, quem mudou de horário.
2. **Equipe → Ausências** — lance férias, atestados e licenças do período.
3. **Escala** — informe o período e clique em **Gerar escala**.
4. Confira as **Pendências** no rodapé da tela.
5. Ajuste o que precisar clicando direto nas células.
6. **Salvar**, depois **Baixar planilha** ou **Imprimir**.

## A tela da escala

Cada linha é uma pessoa, cada coluna é um dia. A célula mostra a hora de entrada
quando é dia de trabalho, ou o código quando não é.

| Cor | Código | |
|---|---|---|
| verde | `X` | folga |
| amarelo | `FC` | folga compensatória |
| azul | `F` | férias |
| vermelho | `AT` | atestado |
| roxo | `LC` | licença |

**Clicar numa célula troca o código**, girando entre trabalho, X, FC, F, AT e
LC. Depois de qualquer ajuste manual, as pendências são recalculadas na hora.

### O rodapé

Seis linhas de conferência por dia: caixa, balcão, farmacêutico, subgerente,
total na loja e quantas pessoas estão de folga.

- **Vermelho**: abaixo do mínimo.
- **Amarelo**: abaixo do alvo, mas tolerado — usado para o farmacêutico quando
  ficou só um na loja.

### Pendências

Duas categorias, e a diferença importa:

- **Regra ferida** — precisa da sua atenção.
- **Observação** — o sistema explica por que fez o que fez. Por exemplo: uma
  folga avulsa que entrou porque, sem ela, a pessoa passaria de seis dias
  seguidos trabalhados.

Observação não é erro. É o sistema mostrando o raciocínio.

## Cadastro da equipe

| Campo | Para quê |
|---|---|
| Nome, cargo, horário | identificação e agrupamento na grade |
| Gerente | folga todo sábado e domingo |
| **Folga fixa** | em "variável" o sistema escolhe; escolhendo um dia, a folga cai sempre nele |
| **1º domingo de folga** | escolha o mês e depois qual domingo; os seguintes saem do ciclo |
| Ativo | desmarque em vez de excluir quem está afastado por longo prazo |

Sobre a folga fixa: até cerca de um terço da equipe com dia fixo, quase não
custa nada. Concentrar várias pessoas no mesmo dia é o que aperta.

## Parâmetros

Valem por loja.

**Modelo de escala** — 5x2 ou 6x1. No 6x1, quem pega o domingo do ciclo folga
duas vezes naquela semana.

**Semana conta de** — onde começa e termina a semana de folgas. Muda bastante o
resultado; ver a tabela em [03 — Algoritmo](03-algoritmo.md).

**Mínimo de pessoas por dia da semana** — o alvo que o gerador persegue. Já vem
preenchido com a média que a sua planilha praticava. **Ao trocar de 5x2 para
6x1, suba estes números**: cada pessoa passa a folgar uma vez em vez de duas,
então há mais gente disponível por dia.

**Quando não couber tudo** — a escolha entre preservar a folga do colaborador ou
a equipe na loja. Não há resposta certa; é decisão de negócio.

## Perguntas frequentes

**Gerei de novo e a escala mudou.** O sistema é determinístico: mesma entrada,
mesma saída. Se mudou, alguma entrada mudou — uma ausência lançada, um campo da
equipe, um parâmetro.

**Uma pessoa ficou com folga sozinha, sem par.** Se a semana já tem um par, o
dia solto é folga extra que entrou para não estourar os seis dias. Aparece como
observação, com a explicação.

**O rodapé está vermelho em vários dias.** A equipe não cobre o mínimo pedido
para aqueles dias. Ou baixe o mínimo, ou aceite, ou contrate. O sistema não
esconde o problema.

**Um dia ficou sem farmacêutico.** Provavelmente só há um farmacêutico
disponível — os outros de férias. Não existe escala que dê a folga a ele e
mantenha a cobertura. Combine substituição para aquele dia.

**Quero a mesma escala do mês passado.** Não há cópia de mês. O campo "1º
domingo de folga" é o que dá continuidade ao ciclo entre meses.

## Planilha e impressão

**Baixar planilha** gera um `.xlsx` com as cores, larguras e painéis
congelados, já configurado em paisagem ajustado à largura da folha. Abre no
LibreOffice, Excel e Google Sheets.

**Imprimir** monta um documento próprio em A4 paisagem, com as cores forçadas —
navegador não imprime fundo colorido por padrão, e sem isso toda a legenda
visual sairia em branco.
