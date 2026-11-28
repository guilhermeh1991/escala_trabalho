# 0013 — Folgas fixas personalizadas do gerente

**Situação**: aceita

## Problema

O gerente era sempre marcado como folga no sábado e no domingo. Isso preservava
lojas antigas, mas não permitia uma política como sexta + sábado. O campo de
folga fixa existente também não resolvia: ele só era aplicado a não-gerentes.

## Decisão

A ficha do gerente pode informar dois dias fixos ordenados:

- **Folga fixa 1**: o domingo do ciclo pode substituí-la;
- **Folga fixa 2**: permanece na semana.

Com sexta + sábado:

```
semana 1: sexta + sábado
semana 2, com domingo do ciclo: domingo + sábado
semana 3: sexta + sábado
```

A semana continua sendo domingo a sábado. O domingo do ciclo não é somado às
duas folgas fixas: ele substitui a primeira. Isso mantém duas folgas na semana.

## Compatibilidade

Gerentes antigos sem os dois campos continuam com sábado + domingo. Perfis de
loja continuam sendo fallback; quando a ficha tem os dois dias, a ficha vence o
perfil. A nova coluna `folga_fixa_2` é nula para dados antigos.

Domingo como um dos dias fixos não gera uma segunda folga de domingo: a rotação
não duplica o mesmo dia. Dias iguais ou fora de 0..6 são rejeitados.

## O que foi descartado

- Somar domingo às duas folgas fixas, criando três folgas naquela semana.
- Fazer o domingo substituir a segunda folga, pois a regra confirmada preserva o
  segundo dia e substitui o primeiro.
- Usar somente perfis: a escolha é específica da pessoa e a ficha precisa vencer
  a política padrão da loja.
