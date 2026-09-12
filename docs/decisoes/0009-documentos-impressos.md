# 0009 — Documento impresso sem identificação ambígua

## Situação

Aceita.

## Problema

A impressão repetia o cargo abaixo de cada nome mesmo quando o cabeçalho da
faixa já dizia Gerência, Subgerência, Farmacêuticos, Balcão ou Caixas. Isso
ocupava espaço e fazia o documento parecer ter informação duplicada.

Também não havia uma barreira contra dois cadastros com o mesmo nome. Remover
uma linha automaticamente seria inseguro: duas pessoas distintas podem ter o
mesmo primeiro nome.

O gerador de PDF existia apenas em uma saída HTML antiga, fora das fontes do
build. Uma nova montagem podia deixar o botão PDF sem implementação.

## Decisão

- Manter os cabeçalhos de faixa e omitir subtítulos de cargo redundantes.
- Mostrar apenas especialidades que acrescentam informação.
- Expandir abreviações de uso interno: `SUB/FARMA` vira
  “Subgerente · Farmacêutico” e `AX. LOJA` vira “Auxiliar de loja”.
- Antes de imprimir ou baixar o PDF, comparar os nomes sem diferença de caixa,
  acentos, espaços extras e caracteres invisíveis. Havendo repetição, bloquear
  a emissão e pedir que os nomes sejam diferenciados na equipe.
- Nunca eliminar silenciosamente um cadastro.
- Manter essas regras e o gerador de PDF em `src/motor/documento.js`, módulo sem
  DOM nem rede, injetado pelo build nas três versões do aplicativo.

## Consequências

O documento fica mais limpo e uma ambiguidade de identificação precisa ser
corrigida no cadastro antes da emissão. O gerador de PDF volta a ter uma fonte
canônica, pode ser testado no Node e não desaparece em builds futuros.
