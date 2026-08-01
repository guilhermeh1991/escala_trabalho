# Testes

```bash
node testes/executar.js
```

Roda tudo e sai com código 1 se algum limiar for rompido.

## O que tem aqui

| Arquivo | Papel |
|---|---|
| `executar.js` | a suíte, com os limiares que o CI cobra |
| `verificador.js` | checagem das regras, escrita do zero, sem usar o motor |
| `simular.js` | gerador de cenários aleatórios e teste de viabilidade |
| `casos-reais.js` | as lojas 330 e 332 em várias competências |

## Por que o verificador é independente

Ele reimplementa a partição em semanas, a contagem de sequências e a checagem
de cobertura a partir do enunciado das regras, sem importar nada de
`src/motor/motor.js`.

Validador que compartilha código com o que valida repete os mesmos enganos. Foi
essa separação que revelou sete defeitos — nenhum deles visível pelo validador
interno do motor.

Ver [decisão 0005](../docs/decisoes/0005-verificador-independente.md).

## Violação x impossibilidade

O simulador confere a viabilidade antes de cobrar o resultado. Se um cenário
tem um farmacêutico só e exige um presente todo dia, o dia descoberto não é
falha do motor — é aritmética.

Sem essa distinção, 88% dos alertas de farmacêutico eram ruído. Ruído em suíte
de teste treina a equipe a ignorar alerta, que é pior que não ter teste.

## Semente fixa

`S.resetar(12345)` antes de cada medição. Sem isso, cada execução vê cenários
diferentes e comparar "antes e depois" não significa nada — erro que já produziu
uma rodada inteira de conclusões inválidas.

## Limiares

Estão no topo de `executar.js`. Não são metas: são o piso já alcançado. Servem
para impedir regressão silenciosa, então baixá-los para fazer o CI passar
derrota o propósito.
