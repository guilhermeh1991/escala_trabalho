# Como mexer neste projeto

## Antes de qualquer alteração no motor

```bash
node testes/executar.js
```

Anote os números. Depois da alteração, rode de novo e compare. Se algum limiar
cair, o CI reprova — e ele reprova por um motivo: o jeito mais fácil de piorar
uma escala é melhorar uma regra sem olhar o efeito nas outras.

## Ao mudar uma regra de escala

Uma regra vive em três lugares. Os três precisam mudar juntos:

1. `src/motor/motor.js` — a implementação
2. `testes/verificador.js` — a checagem independente
3. `docs/01-regras-de-negocio.md` — o enunciado

O verificador é escrito de propósito sem usar nada do motor. Não tente
"simplificar" importando funções de lá: é essa separação que faz os defeitos
aparecerem. Ver [decisão 0005](docs/decisoes/0005-verificador-independente.md).

## Ao mexer nos pesos

Leia [decisão 0003](docs/decisoes/0003-pesos-em-faixas.md) antes. Os pesos estão
em faixas separadas por ordem de grandeza de propósito. Mover um peso de faixa
quebra a garantia de que a lei vem antes da cobertura.

Para calibrar dentro de uma faixa, use a suíte com semente fixa:

```js
S.resetar(12345);   // mesmos 300 cenários, comparação justa
```

Sem fixar a semente, cada execução vê cenários diferentes e a comparação não
significa nada. Isso já produziu uma rodada inteira de conclusões inválidas.

## Ao mudar a interface

```bash
python3 build/montar.py
```

O script monta as duas versões a partir do mesmo template e **falha se algum
marcador não for encontrado**. Se ele reclamar, é porque o template mudou de um
jeito que o build não previa — corrija o marcador em vez de contornar.

## Ao mudar o banco

`banco/schema.sql` é a fonte da verdade. Toda tabela nova precisa de:

- política RLS por empresa;
- índice na coluna de ligação;
- entrada em `docs/02-arquitetura.md`.

O CI reprova tabela sem RLS.

## Registro de decisões

Decisão que muda o rumo do projeto vira arquivo em `docs/decisoes/`. Registre o
que foi **descartado** e por quê — é a parte que mais economiza tempo depois.
