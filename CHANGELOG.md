# Histórico

## 1.2 — novembro de 2026

### Equipe

- Gerentes agora podem escolher duas folgas fixas na ficha. Na semana do domingo
  do ciclo, o domingo substitui a primeira folga fixa e a segunda permanece.
- Gerentes antigos continuam com sábado e domingo até a nova configuração ser
  preenchida.
- Adicionada a coluna `folga_fixa_2` com migração aditiva para MySQL/HostGator.

## 1.1 — novembro de 2026

Sistema reduzido a uma única forma de montar escala.

### Regras

- **Modelo 6x1 removido.** Só existe 5x2: duas folgas por semana, em dias
  seguidos.
- **A semana passa a ir de domingo a sábado**, sem opção na tela. A contagem de
  folgas agora coincide com a semana que a grade e o PDF sempre desenharam.
- Ponta de período com menos de sete dias é **somada à semana vizinha**, num
  bloco de 8 a 13 dias que pede folgas proporcionais. O total de folgas do
  período não muda. Ver [decisão 0012](docs/decisoes/0012-semana-domingo-a-sabado.md).
- Escala já publicada continua sendo conferida pelo formato de semana que valia
  quando foi publicada.

### Motor

- Novo peso `folgaSemanal` (180.000, faixa legal): ficar abaixo das folgas que a
  semana exige passa a custar. **Antes não custava nada** — defeito latente que
  só apareceu quando um bloco passou a pedir três folgas.
- Gerador aprendeu a montar três folgas num bloco (par mais um dia), em vez de
  só pares.
- Pesos `solto` e `domAvulso` removidos: eram declarados e nunca usados.
- Escalas limpas de 90,6% para 95,3%; tempo por escala de 265 ms para 176 ms.

### Documentação

- Tabela de pesos completada: faltavam sete pesos, entre eles os quatro de
  domingo, que estão acima do dia de folga fixa na ordem de prioridade.

## 1.0 — julho de 2026

Primeira versão organizada, com as duas formas de uso e documentação completa.

### Motor

- Programação dinâmica por colaborador no lugar do algoritmo guloso. Folgas em
  par subiram de 55% para 96,6%; semanas sem folga caíram de 202 para zero.
- Ciclo de domingos virou restrição da busca em vez de pré-atribuição.
- Pesos reorganizados em faixas por ordem de grandeza: a soma dos furos de
  cobertura de um mês não alcança mais o custo de uma infração legal. Escalas
  limpas subiram de 90,6% para 95% no 5x2 e de 75,6% para 95% no 6x1.
- Restrição rígida reduzida ao que torna a atribuição impossível. Resolveu o
  beco sem saída do farmacêutico único.
- Ponta final do período entrou na conta de dias seguidos trabalhados.
- Detecção de blocos de folga que se juntam na virada da semana.
- Alvo diário implícito quando o mínimo por dia não é informado.
- Quatro rodadas de replanejamento para corrigir a vantagem de quem é planejado
  primeiro.

### Regras

- Modelo 6x1, com a folga da semana e o domingo do ciclo como direitos
  separados.
- Dois farmacêuticos na loja, com um tolerado em último caso.
- Ao menos um subgerente todos os dias, com reforço no fim de semana.
- Folga fixa em dia escolhido, por colaborador.
- Primeiro domingo de folga informado por data, ancorando o ciclo.
- Mínimo de pessoas por dia da semana, extraído da curva histórica de cada loja.
- Escolha entre priorizar o descanso ou a equipe na loja.

### Aplicativo

- Exportação em `.xlsx` de verdade, gerado sem biblioteca externa, com cores,
  larguras e painéis congelados. Substituiu o CSV.
- Impressão com documento próprio em A4 paisagem e cores forçadas.
- Versão web com login por e-mail e senha, dados no Postgres e isolamento entre
  empresas por Row Level Security.
- Senhas conforme NIST SP 800-63B revisão 4: mínimo de 12 caracteres, sem regra
  de composição, sem troca periódica, com conferência contra vazamentos
  conhecidos. Removido o SHA-256 no navegador, que era inadequado.

### Testes

- Verificador independente, escrito do zero, que revelou sete defeitos.
- Suíte com 300 cenários aleatórios e 12 competências reais, com limiares
  cobrados pelo CI.
- Distinção entre violação e impossibilidade, que eliminou 88% do ruído nos
  alertas de farmacêutico.
