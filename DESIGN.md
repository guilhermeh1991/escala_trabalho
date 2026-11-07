# Design system — Quadro de Escala

## Contexto e direção

O Quadro de Escala é uma ferramenta operacional para gerentes de farmácia gerarem, revisarem e distribuírem escalas mensais confiáveis. A interface deve tornar o estado do período evidente antes de expor a densidade da grade. A direção adotada é **Faixas de operação**: sinalização objetiva em amarelo operacional sobre uma concha verde-petróleo, superfícies claras e dados de alta legibilidade.

A definição completa da superfície está em [`.impeccable/surfaces/src-app-template-html.md`](.impeccable/surfaces/src-app-template-html.md).

## Fundamentos visuais

### Cor

| Papel | Token / valor | Uso |
| --- | --- | --- |
| Casca e navegação | `--tinta` `#12262D`, `--tinta2` `#1D3A42` | Cabeçalho, navegação e ações neutras |
| Ação principal | `--teal` `#087773` | Gerar, foco e estados ativos |
| Faixa de orientação | `--rota` `#F2C94C` | Contexto do período e próxima ação |
| Fundo | `--fundo` `#F2F5F3` | Área de trabalho |
| Superfície | `--painel` `#FFFFFF` | Painéis e grade |
| Regra / divisão | `--linha` `#D5DED9` | Separação de estruturas |
| Sucesso | `--v-bg` / `--v-fg` | Escala fechada, folga e cobertura atendida |
| Atenção | `--m-bg` / `--m-fg` | Abaixo do alvo e folga compensatória |
| Problema | `--r-bg` / `--r-fg`, `--alerta` | Regra ferida e atestado |
| Informação | `--info-bg` / `--info-fg` | Observações explicativas |
| Licença | `--p-bg` / `--p-fg` | Licença |

As cores de situação sempre têm reforço textual, padrão, borda ou marcador. Nunca são o único canal de significado, principalmente no documento para mural.

### Tipografia

- **Archivo**: títulos e sinalizações de estado.
- **Inter**: controles, navegação, texto e nomes.
- **JetBrains Mono**: horários, totais e dados que precisam de alinhamento tabular.
- Base da interface: 15px; texto funcional compacto: no mínimo 12px onde o espaço permitir.

### Forma e profundidade

- Raios: 6px para controles, 9px para elementos comuns e 14px para painéis.
- Painéis claros usam borda discreta e sombra neutra curta (`--sombra`), sem brilho cromático.
- O amarelo é reservado à faixa de orientação; não representa alerta ou sucesso.

## Padrões de interface

### Cabeçalho e navegação

A casca verde-petróleo identifica o produto e contém loja, identidade e saída. A navegação por abas mantém a seção ativa com sublinhado claro. Não usar gradientes ou decoração em excesso nessa área.

### Faixa contextual da escala

A faixa amarela abre a área da escala com três peças de informação: o estado atual, uma instrução curta e um chip de status. Ela acompanha estes estados:

1. Sem escala: orientar a escolha de período e a geração.
2. Escala alterada: pedir revisão antes de salvar.
3. Escala salva com pendências: indicar a quantidade e remeter à grade.
4. Escala pronta: liberar salvar, imprimir e exportar.

Abaixo dela, o resumo operacional mostra pessoas, dias, cobertura abaixo do mínimo, pendências e observações. É uma leitura factual, não um painel de métricas decorativo.

### Grade mensal

A grade é o centro da tarefa. Mantém nome e horário fixos durante a rolagem horizontal, agrupa pessoas por função e ancora a cobertura diária no rodapé. A coluna de domingo usa divisão visual própria; fins de semana não dependem apenas de cor.

- `X`, `FC`, `F`, `AT` e `LC` têm texto, cor, padrão e/ou borda distintos.
- `!` indica abaixo do mínimo; `~`, abaixo do alvo.
- Células editadas mostram um marcador discreto.
- A legenda explica todos os códigos e o gesto de edição.

### Formulários, tabelas e ações

- A ação principal usa teal; ações secundárias são contornadas; exclusões usam o estado de problema.
- Labels são curtos, em caixa alta e com espaçamento moderado.
- Campos e botões preservam foco de teclado claramente visível.
- Tabelas de administração usam a mesma borda, tipografia e hover suave da grade.

## Responsividade e impressão

- Em telas estreitas, a faixa contextual empilha conteúdo, comandos viram blocos e a grade conserva rolagem horizontal explícita com as duas primeiras colunas presas.
- A impressão gera documento A4 em paisagem para mural. Nome, horário, código, domingo e déficit continuam legíveis em monocromia por meio de texto, bordas e padrões.
- A interface de edição não é incluída na impressão; o documento impresso é a fonte de leitura para equipe.

## Acessibilidade e comportamento

- Contraste de texto e foco seguem o mínimo de 4,5:1 em texto normal.
- Estados de hover, foco, ativo, desabilitado e erro compartilham a mesma linguagem visual de cada controle.
- Ações descrevem o que fazem; mensagens operacionais explicam o próximo passo.
- Atualizações do estado da escala usam regiões `aria-live` sem bloquear o fluxo da pessoa usuária.
