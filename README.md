# Escala

Gerador de escala de folgas para rede de farmácias. Monta a escala do mês
respeitando a legislação trabalhista e a operação da loja, e mostra o que não
coube em vez de esconder.

O motor não decide semana a semana: para cada pessoa ele monta todas as
combinações possíveis de folga de cada semana e escolhe a sequência do mês
inteiro de menor custo. Isso importa porque colar o fim de semana no domingo de
folga depende do que foi feito na semana anterior — um algoritmo guloso não
enxerga isso e produz escalas ilegais.

## Estado atual

| Medida | Valor | Como é medido |
|---|---|---|
| Escalas sem violação trabalhista — 5x2 | 95% | 300 cenários aleatórios |
| Escalas sem violação trabalhista — 6x1 | 95% | 300 cenários aleatórios |
| Lojas reais (330 e 332), 12 competências | 100% | `testes/executar.js` |
| Folgas em dias seguidos (5x2) | 95% | proporção de folgas com par |
| Tempo para montar uma escala | 265 ms | 13 pessoas, 31 dias |

Os números são conferidos a cada envio de código. Se caírem abaixo dos limiares
em `testes/executar.js`, o CI reprova.

## Como rodar

```bash
git clone <endereço-do-repositório>
cd escala

python3 build/montar.py     # gera dist/escala-offline.html e dist/escala-web.html
node testes/executar.js     # suíte do motor de escala
bash testes/api.sh              # backend PHP
bash testes/api-colaborador.sh  # acesso individual e isolamento
```

Não há dependências para instalar. O motor é JavaScript puro e o build é Python
da biblioteca padrão.

## As três versões

Saem do mesmo template de interface. O que muda é onde os dados moram.

| Arquivo | Onde ficam os dados | Login | Quando usar |
|---|---|---|---|
| `escala-offline.html` | no dispositivo | não tem | uso individual, plano B sem internet |
| `escala-hostgator.html` | MySQL da sua hospedagem | e-mail e senha | **recomendada** se você já tem cPanel |
| `escala-web.html` | Supabase | e-mail e senha | se preferir não manter servidor |

A versão HostGator é a recomendada para quem já paga hospedagem: sem custo
adicional, backup incluso, servidores no Brasil e sem a pausa por inatividade
do plano gratuito do Supabase. O preço é ter um backend PHP para manter —
que já está escrito e testado em `api/`.

Guias: [HostGator](docs/07-implantacao-hostgator.md) · [Supabase](docs/04-implantacao.md)

## Regras implementadas

1. A cada dois domingos trabalhados, um domingo de folga — teto legal da
   Lei 10.101/2000.
2. Nunca mais de seis dias seguidos trabalhados.
3. **5x2**: duas folgas por semana, em dias seguidos.
   **6x1**: uma folga por semana; na semana do domingo do ciclo, a pessoa folga
   duas vezes, porque são direitos separados.
4. No domingo de folga, tenta colar sábado ou segunda.
5. Gerente folga todo sábado e domingo.
6. Dois farmacêuticos na loja (um é tolerado em último caso, nenhum quase nunca).
7. Ao menos um subgerente na loja todos os dias.
8. Mínimo de pessoas por dia da semana, seguindo a curva de movimento da loja.
9. Folga fixa em dia escolhido, por colaborador.
10. Primeiro domingo de folga informado por data, ancorando o ciclo.

O detalhamento de cada regra, com o que acontece quando duas se chocam, está em
[docs/01-regras-de-negocio.md](docs/01-regras-de-negocio.md).

## Organização

```
api/                    backend PHP da versão HostGator
banco/schema.sql        tabelas e políticas de acesso do PostgreSQL (Supabase)
banco/mysql-schema.sql  tabelas do MySQL (HostGator)
build/montar.py         monta as duas versões a partir das fontes
dist/                   os aplicativos prontos (gerados, não versionados)
docs/                   documentação
docs/decisoes/          registro das decisões de projeto e do porquê
src/motor/motor.js      o algoritmo de escala e a validação
src/motor/planilha.js   gerador de .xlsx sem biblioteca externa
src/app/                interface e camada de acesso
testes/                 verificador independente, simulador e suíte
```

O verificador em `testes/verificador.js` foi escrito do zero, sem reaproveitar
nada do motor. Isso é proposital: um validador que compartilha código com o que
ele valida repete os mesmos enganos. Foi assim que sete defeitos apareceram.

## Documentação

| Documento | Para quê |
|---|---|
| [01 — Regras de negócio](docs/01-regras-de-negocio.md) | O que o sistema promete cumprir e em que ordem |
| [02 — Arquitetura](docs/02-arquitetura.md) | Como as peças se encaixam |
| [03 — Algoritmo](docs/03-algoritmo.md) | Como a escala é montada, com as medições |
| [04 — Implantação](docs/04-implantacao.md) | Colocar no ar, passo a passo |
| [05 — Segurança e LGPD](docs/05-seguranca-e-lgpd.md) | Senhas, isolamento entre empresas, dados pessoais |
| [06 — Manual do usuário](docs/06-manual-do-usuario.md) | Para quem vai montar a escala |
| [07 — Implantação na HostGator](docs/07-implantacao-hostgator.md) | Colocar no ar usando cPanel e MySQL |
| [08 — Papéis e acesso](docs/08-papeis-e-acesso.md) | Quem vê o quê, e onde isso é garantido |
| [Decisões](docs/decisoes/) | Por que cada escolha foi feita, e o que foi descartado |

## Limites conhecidos

São limites de matemática, não defeitos a corrigir:

- **6x1 com semana fixa**: com uma folga por semana, o dia de folga só consegue
  andar para trás, nunca para frente, sem estourar os seis dias. Na prática o
  6x1 tende ao dia fixo, que é como as lojas já operam.
- **Farmacêutico único**: não há escala que dê a folga legal a ele e mantenha
  cobertura. O sistema concede a folga e marca o dia em vermelho.
- **Dois subgerentes com exigência diária**: eles nunca podem folgar no mesmo
  dia. Se um sai de férias, o mês inteiro fica sem cobertura em alguns dias.

## Licença

Uso interno. Ver [LICENSE](LICENSE).
