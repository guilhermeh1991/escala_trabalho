# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O usuário principal é o gerente de loja de uma rede de farmácias. Todo mês, ele ou ela confere alterações na equipe, registra ausências, configura regras operacionais e gera uma escala que possa revisar, corrigir e distribuir. Colaboradores também consultam a própria escala quando têm acesso individual.

## Product Purpose

O Quadro de Escala gera escalas mensais de folgas para farmácias respeitando a legislação trabalhista e as necessidades da operação. Uma escala bem-sucedida é confiável, legível para revisão humana e explícita sobre conflitos que não puderam ser resolvidos.

## Positioning

Em vez de decidir folgas semana a semana, o motor avalia as combinações possíveis por pessoa ao longo do mês e escolhe a sequência de menor custo. Quando regras e cobertura entram em conflito, o produto mostra as pendências em vez de ocultá-las.

## Operating Context

A rotina mensal começa com a conferência da equipe e das ausências, passa pela geração e revisão da grade diária, permite ajustes manuais em células e termina com o salvamento, a planilha ou a impressão em A4 paisagem. A escala pode ser consultada na tela durante a operação e impressa para circulação na loja.

## Capabilities and Constraints

- Modelos 5x2 e 6x1, ciclo de domingos, folga fixa, férias, atestados e licenças.
- Regras legais e de cobertura têm prioridades explícitas; ausências já lançadas são intocáveis.
- A grade apresenta pessoas por linha e dias por coluna, com indicadores diários de cobertura e pendências recalculadas após edição manual.
- O projeto é uma aplicação web estática em JavaScript puro, com geração de planilha e de documento para impressão sem dependências de interface.
- A melhoria solicitada abrange a experiência visual de toda a aplicação e a versão impressa, sem alterar a confiança do motor ou as regras de negócio.

## Evidence on Hand

- Documentação de regras e do fluxo mensal em `docs/01-regras-de-negocio.md` e `docs/06-manual-do-usuario.md`.
- Interface existente em `index.html`, incluindo tokens visuais, tela de login, área de trabalho, grade de escala, alertas e estilos de impressão.
- Não há ativos de marca, depoimentos ou alegações externas autorizadas para criar.

## Product Principles

1. A legalidade e o descanso do colaborador não podem ser obscurecidos por metas de cobertura.
2. O sistema deve explicar as exceções em vez de apresentar certeza falsa.
3. O gerente precisa enxergar rapidamente o que foi decidido, o que exige ação e o impacto de cada ajuste.
4. A escala deve continuar útil tanto na tela de trabalho quanto no papel.
5. A complexidade do algoritmo deve aparecer como clareza operacional, não como carga cognitiva para quem usa.

## Accessibility & Inclusion

A interface precisa preservar contraste, não depender apenas de cor para comunicar estados, manter controles de teclado e produzir uma impressão legível em escala de cinza quando necessário.
