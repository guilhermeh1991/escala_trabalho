# Arquitetura

## Visão geral

```
   navegador                          Supabase (São Paulo)
┌──────────────────┐              ┌──────────────────────────┐
│ escala-web.html  │              │  Auth  e-mail e senha    │
│                  │──── JWT ────▶│        hash com salt     │
│  motor (JS)      │              ├──────────────────────────┤
│  planilha (JS)   │◀─── dados ──▶│  PostgreSQL              │
│  interface       │              │  + RLS por empresa       │
└──────────────────┘              └──────────────────────────┘
        │
        └─── Cloudflare Pages (arquivo estático, sem servidor)
```

**O motor roda no navegador.** A escala é montada na máquina de quem clicou em
"Gerar". O servidor só guarda o resultado. Isso mantém a resposta instantânea e
elimina uma camada inteira de infraestrutura.

**Não existe servidor de aplicação.** A página é um arquivo estático. Não há
sistema operacional para atualizar, certificado para renovar nem porta aberta.

## As duas versões

Saem do mesmo template de interface, montadas por `build/montar.py`:

| | offline | web |
|---|---|---|
| Onde ficam os dados | no dispositivo | banco PostgreSQL |
| Login | não tem | e-mail e senha |
| Vários usuários | não | sim, isolados por empresa |
| Precisa de internet | não | sim |
| Para quê | uso individual, plano B | operação real |

## Camadas do código

```
src/motor/motor.js        algoritmo e validação. Sem DOM, sem rede.
src/motor/planilha.js     gerador de .xlsx. Sem DOM, sem rede.
src/app/template.html     interface e a camada offline de dados
src/app/acesso-dados.js   Supabase: sessão e sincronização
src/app/acesso-telas.js   Supabase: telas de entrar, cadastrar, recuperar
```

O motor e a planilha não conhecem navegador. Por isso a suíte de testes roda
direto no Node, sem emulação de DOM, e por isso o mesmo motor serve às duas
versões sem alteração.

## Como a interface fala com os dados

A versão web mantém a mesma interface de armazenamento da versão offline —
`store.get(chave)` e `store.set(chave, valor)`. O que muda é o que está por
baixo: na web, `store` sincroniza com o Postgres.

Isso foi deliberado. Nenhuma linha da interface, do desenho da grade ou da
edição de equipe precisou mudar para o sistema virar multiusuário.

A gravação é adiada em 700 ms e agrupada, para não disparar uma escrita a cada
tecla digitada num campo de nome.

## Modelo de dados

```
empresas ──┬── perfis          (um por usuário, liga ao auth do Supabase)
           └── lojas ──┬── colaboradores ── ausencias
                       └── escalas
```

Três decisões:

**`lojas.parametros` é JSONB.** São parâmetros de configuração que mudam juntos
e nunca são consultados individualmente. Coluna por parâmetro só criaria
migração a cada regra nova.

**`escalas.grade` é JSONB.** É uma matriz de pessoa por dia. Normalizar em uma
linha por célula daria 400 linhas por escala sem ganho nenhum — nunca se
consulta uma célula isolada.

**`colaboradores` é tabela normal.** É a entidade que se edita, se lista e se
ordena individualmente. JSONB aqui atrapalharia.

## Isolamento entre empresas

Feito pelo banco, com Row Level Security. Cada consulta é filtrada pelo
Postgres com base no usuário autenticado — não por código no navegador.

Alguém que abra as ferramentas de desenvolvimento e altere o JavaScript
continua sem enxergar dados de outra empresa: o banco recusa as linhas.

A função `empresa_atual()` é `security definer` para poder ler a tabela de
perfis sem cair em recursão de política.

Ver [05 — Segurança e LGPD](05-seguranca-e-lgpd.md).

## Por que gerar .xlsx à mão

`src/motor/planilha.js` monta o pacote OOXML na unha: ZIP sem compressão e XML.
Não usa biblioteca externa.

O motivo é que carregar biblioteca de CDN falha quando não há internet — e a
versão offline existe justamente para esse cenário. São cerca de 200 linhas,
e o arquivo abre no LibreOffice, no Excel e no Google Sheets com cores, largura
de coluna e painéis congelados.

## Build

`build/montar.py` gera as duas versões e confere o resultado: motor presente,
planilha presente, e na versão web que não sobrou nenhum resquício do login
local nem a chave `service_role`. O script sai com erro se qualquer conferência
falhar, o que impede publicar arquivo quebrado.
