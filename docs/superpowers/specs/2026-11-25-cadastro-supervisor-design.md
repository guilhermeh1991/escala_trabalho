# Cadastro neutro e promoção de supervisor

**Data:** 2026-11-25
**Status:** aprovado para implementação

## Contexto

O cadastro público cria uma conta autenticada, mas não deve conceder um papel
privilegiado por uma escolha feita no navegador. No modelo atual, `gestor` é o
papel técnico do supervisor e sua autorização real vem da relação explícita
`supervisor_lojas`.

O caso de uso é: uma pessoa cria e confirma a conta, uma empresa já existe, e
o administrador da plataforma precisa transformá-la em supervisor e escolher
as lojas que ela acompanhará.

## Decisão

O cadastro permanece neutro, sem checkbox que conceda `gestor`. O sistema
continua oferecendo dois caminhos seguros:

- criar uma empresa: a conta vira `admin` daquela empresa;
- entrar por convite: a conta vira `gestor`, inicialmente com o escopo dado pelo
  convite e pelos vínculos explícitos.

Para o caso central, o superadmin promove uma conta confirmada de `admin` para
`gestor` no painel da plataforma. Depois, vincula uma ou mais lojas da mesma
empresa. A conta sem vínculo aparece como supervisor sem acesso e recebe `403`
ao tentar operar.

## Contrato de papéis

| Transição | Resultado |
|---|---|
| `admin` → `gestor` | limpa `usuarios.loja_id`; mantém a empresa; requer vínculos em `supervisor_lojas` para operar |
| `gestor` → `admin` | remove todos os vínculos `supervisor_lojas`; administrador volta a enxergar toda a empresa |
| conta não confirmada | não pode ser promovida |
| empresa/loja de outra rede | rejeitada pelo servidor |

A operação é exclusiva do superadmin, usa transação e registra auditoria com
alvo, empresa, papel anterior e novo papel. O navegador nunca decide empresa,
permissão ou posse de loja.

## Experiência

Na consulta central de usuários, contas `admin` confirmadas exibem **Promover a
supervisor**. A ação pede confirmação, explica a perda da visão global e, após
sucesso, atualiza o bloco de supervisores para que as lojas sejam vinculadas.
Contas `gestor` exibem **Tornar administrador** e a confirmação avisa que os
vínculos serão removidos.

O cadastro explica que criar uma empresa torna a conta administradora, enquanto
supervisor é definido por convite ou pelo superadmin. Não existe intenção de
papel persistida neste primeiro corte.

## Critérios de aceite

1. Não há campo público que escolha `admin` ou `gestor`.
2. O superadmin consegue promover uma conta confirmada da empresa selecionada.
3. Promoção limpa `loja_id` legado e não cria acesso sem vínculo.
4. O superadmin consegue vincular somente lojas da mesma empresa.
5. Rebaixamento remove vínculos antigos e devolve acesso global de `admin`.
6. Ações cruzadas, contas não confirmadas e alteração da própria autoridade
   são recusadas.
7. Respostas não expõem senha, token ou segredo.
8. O fluxo funciona nos breakpoints administrativos já cobertos pelo projeto.
