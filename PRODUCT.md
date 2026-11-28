# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O usuário principal é o gerente de loja de uma rede de farmácias. Todo mês, ele ou ela confere a equipe e as ausências, configura regras operacionais, gera uma proposta de escala, revisa pendências, salva um rascunho e publica a versão aprovada. Supervisores acompanham apenas lojas explicitamente vinculadas. Colaboradores consultam a própria escala publicada.

O painel central da plataforma tem um único operador: o dono da plataforma, usando a conta superadmin. Ele conhece empresas, lojas e supervisores pelo nome, então a tela pode ser densa e direta em vez de didática. Sua tarefa mais frequente ali é vincular supervisores às lojas que eles devem acompanhar; cadastro de empresas e lojas, conferência de contas e consulta de escalas publicadas são tarefas de apoio a essa. Ele opera o painel em notebook ou desktop a partir de 1440px.

## Product Purpose

O Shiftflow transforma regras de equipe, jornada, ausência e cobertura em escalas mensais confiáveis. A interface deixa claro o que está decidido, o que bloqueia a publicação e o que não pôde ser verificado. O produto não promete conformidade legal automática nem trata o gerador como otimizador de cobertura intradiária.

## Positioning

Em vez de esconder conflitos em uma planilha final, o Shiftflow mostra o caminho de decisão: período, estado, pendências, cobertura e próxima ação. Rascunhos e versões publicadas permanecem separados; históricos incompletos continuam consultáveis sem inventar nomes ou jornadas.

## Operating Context

A rotina mensal começa pela conferência da equipe e das ausências, passa pela configuração de regras e faixas de demanda, segue para geração fatiada e revisão da grade, permite ajustes manuais e termina com salvamento, publicação, planilha ou impressão A4 paisagem. A escala também pode ser consultada por loja, supervisor ou colaborador conforme a autorização devolvida pelo servidor.

## Capabilities and Constraints

- Escala 5x2 com semana de domingo a sábado, ciclo de domingos, folga fixa, férias, atestados, licenças e jornadas estruturadas.
- Regras legais e políticas da casa têm prioridades explícitas; ausências lançadas são preservadas.
- A grade apresenta pessoas por linha e dias por coluna, com indicadores diários e cobertura intradiária quando as faixas estão configuradas.
- O projeto é uma aplicação web em JavaScript puro, com backend PHP/MySQL e variantes HostGator, Supabase e offline.
- A interface usa a identidade Shiftflow: fundo `#F5F6F3`, superfícies `#FFFFFF`, texto `#22352C` e ação `#16634C`.
- A autoridade de plataforma vem do servidor: o e-mail precisa estar em `super_admins` no `api/config.php` e a conta não pode ter `empresa_id`. Conta vinculada a uma empresa opera aquela empresa, não a plataforma.
- O painel central é somente leitura para dados operacionais: consulta usuários sem credenciais nem tokens, lista apenas versões publicadas e nunca expõe rascunhos. Editar, publicar ou excluir escala não existe nessa superfície.
- Um supervisor só alcança lojas da própria empresa, por vínculo explícito em `supervisor_lojas`; revogar uma loja preserva as demais. O cadastro é neutro: a promoção de uma conta confirmada para supervisor é feita e auditada pelo superadmin, que então vincula as lojas.
- Cobrança, checkout, contratação de planos e integrações externas não fazem parte desta superfície operacional.

## Evidence on Hand

- Regras e fluxo mensal em `docs/01-regras-de-negocio.md` e `docs/06-manual-do-usuario.md`.
- Interface operacional em `src/app/template.html`, com acesso, grade, equipe, parâmetros, históricos, administração e estados de sincronização.
- Integração PHP e autorização em `src/app/acesso-dados-php.js`, `src/app/acesso-telas-php.js` e `api/`.
- Testes de motor, API, migrações, navegador e empacotamento em `testes/` e `.github/workflows/testes.yml`.

## Product Principles

1. A legalidade e o descanso do colaborador não podem ser obscurecidos por metas de cobertura.
2. O sistema deve explicar exceções, conflitos e lacunas em vez de apresentar certeza falsa.
3. A pessoa gerente precisa enxergar rapidamente o que foi decidido, o que exige ação e o impacto de cada ajuste.
4. Rascunho, publicação vigente, versão anterior e histórico incompleto devem ser distinguíveis.
5. A escala deve continuar útil na tela, no celular e no papel.
6. Alterações cadastrais preservam equipe, parâmetros, escalas e histórico que não pertencem ao campo editado.

## Accessibility & Inclusion

A interface preserva contraste, não depende apenas de cor, mantém foco visível, navegação de teclado na grade e diálogos, mensagens de erro acionáveis, redução de movimento e rolagem contida para tabelas densas. O objetivo é operar uma grade de até 100 pessoas e 30 dias sem explodir o número de paradas de Tab.
