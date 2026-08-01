# Histórico

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
