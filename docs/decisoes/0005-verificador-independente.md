# 0005 — Verificador escrito do zero

**Situação**: aceita

## Problema

O motor tinha uma função `validar()` que conferia a escala gerada. Ela reportava
poucos problemas, e a escala parecia boa.

O problema de validar com código que compartilha premissas com o gerador: os
dois erram junto. Se o gerador entende "semana" de um jeito errado, o validador
entende do mesmo jeito errado e não acusa nada.

## Decisão

Escrever `testes/verificador.js` do zero, sem importar nada de `motor.js`.
Reimplementa a partição em semanas, o cálculo de sequências, a contagem de
domingos e a checagem de cobertura, a partir do enunciado das regras.

## Resultado

Sete defeitos apareceram na primeira execução, nenhum visível pelo validador
interno:

1. Semana inteira sem folga quando o domingo estava bloqueado.
2. Farmacêutico único impedido de folgar em qualquer dia.
3. Ciclo de domingos fixado antes da hora.
4. Folga em domingo alheio proibida sem necessidade.
5. Ponta final do mês fora da conta de dias seguidos.
6. Blocos de quatro folgas seguidas na virada da semana.
7. Ausência de noção de demanda diária sem mínimo configurado.

## Refinamento

O verificador precisou aprender a distinguir **violação** de
**impossibilidade**. Se todos os farmacêuticos estão de férias, o dia sem
farmacêutico não é falha do motor.

Sem essa distinção, 88% dos alertas de farmacêutico eram ruído — e ruído em
suíte de teste treina a equipe a ignorar alerta.

## Custo

Manter duas implementações das mesmas regras. Quando uma regra muda, os dois
lados mudam. É trabalho real, e vale: é o que segura a qualidade em cada
alteração do motor.
