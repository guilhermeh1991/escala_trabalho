# Design system — Shiftflow

## Contexto e direção

Shiftflow é uma ferramenta operacional para redes de farmácias gerarem, revisarem e distribuírem escalas mensais confiáveis. A interface deve tornar o período, o estado da escala e a próxima ação evidentes antes de expor a densidade da grade. A direção atual é **operação clara**: uma concha verde profunda, superfícies claras, dados compactos e sinalização factual por estado.

A definição da superfície está em [`.impeccable/surfaces/src-app-template-html.md`](.impeccable/surfaces/src-app-template-html.md).

## Fundamentos visuais

### Cor

| Papel | Token / valor | Uso |
| --- | --- | --- |
| Texto principal | `--texto` `#22352C` | Leitura, títulos e dados |
| Casca de navegação | `--tinta` `#22352C`, `--tinta2` `#2E463A` | Cabeçalho e abas |
| Ação principal | `--teal` `#16634C` | Gerar, foco, controles ativos |
| Fundo | `--fundo` `#F5F6F3` | Área de trabalho |
| Superfície | `--painel` `#FFFFFF` | Painéis, formulários e grade |
| Divisão | `--linha` `#D8DED7` | Bordas e separadores |
| Sucesso | `--v-bg` / `--v-fg` | Folga, cobertura e salvamento confirmado |
| Atenção | `--m-bg` / `--m-fg` | Meta não atingida e folga compensatória |
| Problema | `--r-bg` / `--r-fg`, `--alerta` | Bloqueios, erro e atestado |
| Informação | `--info-bg` / `--info-fg` | Lacunas e explicações |
| Licença/férias | `--p-*` / `--a-*` | Estados de ausência |

As cores de situação sempre têm texto, padrão, borda ou marcador complementar. A cor nunca é o único canal de significado. O amarelo operacional (`--rota`) é reservado à orientação do fluxo, não a sucesso ou erro.

### Tipografia

- **Archivo** para títulos e sinalizações curtas.
- **Inter** para controles, navegação, formulários e texto.
- **JetBrains Mono** para horários, versões, datas e números tabulares.
- Corpo de 15px; texto auxiliar compacto nunca abaixo de 11px quando a leitura permitir.
- Números e horários usam alinhamento tabular quando ajudam a comparar dias e pessoas.

### Forma e profundidade

- Raios de 6px em controles, 8px em agrupamentos e 12px em painéis.
- Superfícies usam borda discreta e sombra curta; cartões agrupam uma tarefa, não cada campo.
- Cabeçalho compacto, navegação discreta e ações principais com prioridade inequívoca.
- Sem gradientes decorativos, métricas fictícias ou grandes áreas vazias.

## Padrões de interface

### Cabeçalho e contexto

O cabeçalho identifica Shiftflow e mantém a loja atual, a pessoa conectada, o estado de sincronização e a saída. A área da escala começa pelo período, situação da escala e fluxo explícito: **Gerar proposta → Revisar pendências → Salvar rascunho → Publicar**.

### Grade mensal

A grade é o centro da tarefa. Nome, jornada e intervalo permanecem identificáveis durante a rolagem própria da grade. Datas têm duas linhas, domingos e fins de semana têm marcação textual/estrutural, e `X`, `FC`, `F`, `AT` e `LC` usam legenda com texto, padrão e borda. A edição manual é acessível por clique e teclado, com foco devolvido ao ponto de origem.

### Pendências e cobertura

Pendências são separadas em bloqueios de publicação, avisos/metas e informações não verificadas. Meta diária, piso obrigatório e cobertura por faixa horária mantêm rótulos diferentes. Falta de informação aparece como lacuna; nunca vira zero ou conformidade.

### Formulários e administração

Formulários agrupam regras, metas/pisos, expediente, faixas e funções conforme o dado realmente editado. A administração da plataforma fica separada da operação da empresa e só aparece quando a autoridade vem do servidor. Nomes e descrições fornecidos por pessoas são inseridos como texto, nunca como HTML.

### Estados e acessibilidade

Todo fluxo importante possui estados de carregamento, vazio, sucesso e falha. Conflito HTTP 409 preserva alterações locais e oferece recarga explícita, com confirmação antes de descartar. Foco visível, navegação por setas/Home/End na grade, Enter/Espaço para edição, Escape para fechar e redução de movimento são requisitos do produto.

## Responsividade e impressão

- Validar 320, 390, 1024 e 1440px; a página não usa `overflow-x:hidden` para esconder defeitos.
- Tabelas densas rolam no próprio contêiner; formulários quebram sem empurrar o documento.
- A impressão é A4 paisagem, legível em escala de cinza, com Shiftflow, loja, período, versão e situação da escala.
- Controles de edição ficam fora da impressão; PDF, planilha e HTML usam os dados da versão selecionada.
