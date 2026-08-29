# 0008 — MySQL na HostGator em vez de Supabase

**Situação**: aceita, convivendo com a versão Supabase

## Problema

A versão web usava Supabase. Duas coisas incomodavam:

1. O plano gratuito **pausa o projeto após 7 dias sem acesso e não faz
   backup**. Escala se monta uma vez por mês — a pausa aconteceria sempre.
2. Havia uma conta HostGator já paga, com MySQL, backup e servidores no Brasil.

## A restrição técnica que decide o desenho

MySQL não fala HTTP. Navegador não fala o protocolo do MySQL. Não existe
"conectar o navegador ao MySQL" — a opção "MySQL remoto" do cPanel serve para
ferramentas de desktop e outros servidores.

Logo: **usar a HostGator exige escrever um backend**. Não é opcional.

## Opções

| Opção | A favor | Contra |
|---|---|---|
| **Supabase** | sem backend para escrever; isolamento garantido pelo banco (RLS) | pausa em 7 dias, sem backup no gratuito, US$ 25/mês para resolver |
| **MongoDB Atlas** | — | a Data API foi desligada em setembro de 2025; exigiria backend do mesmo jeito, sem nenhuma vantagem |
| **HostGator + PHP** | já pago, backup incluso, servidores no Brasil, sem pausa | backend precisa ser escrito e mantido; isolamento passa a depender do código |

## Decisão

Escrever o backend em PHP e usar o MySQL da HostGator, **mantendo a versão
Supabase no repositório**. As duas saem do mesmo template de interface, com
camadas de dados diferentes.

Pesou: o problema da pausa é real e recorrente, o custo já está pago, e
PHP com MySQL em hospedagem compartilhada é a pilha mais documentada que
existe — não há nada de exótico para dar errado.

## O que se perdeu, e como foi compensado

**A Row Level Security.** No Supabase, o banco recusa linha de outra empresa
mesmo que o código erre. No MySQL isso não existe: o isolamento passou a
depender do PHP lembrar do filtro em toda consulta.

Compensação: nenhum endpoint monta consulta direto. Todos passam por
`exigirLojaDaEmpresa()` e `exigirColaboradorDaEmpresa()`, em `api/comum.php`.
E `testes/api.sh` tenta invadir uma empresa pela outra de cinco formas a cada
execução, com o CI cobrando.

**A autenticação pronta.** Passou a ser código nosso. Mitigado usando o que o
PHP já traz e é testado por muita gente: `password_hash()` com argon2id,
sessão com cookie `HttpOnly` e `Secure`, `session_regenerate_id()` ao entrar.
Nada de criptografia caseira.

## Verificação

`testes/api.sh` sobe MySQL e PHP de verdade e roda 33 checagens: regras de
senha, CSRF, confirmação de e-mail, não revelar quais e-mails existem, força
bruta, injeção de SQL, auditoria e os cinco cenários de invasão entre empresas.

Na primeira execução, o teste encontrou um defeito real: a conferência de
"senha contém o e-mail" só olhava a parte antes do arroba e exigia 4
caracteres, então `ana@teste.com123` passava para o usuário `ana@teste.com`.
Corrigido para conferir o e-mail inteiro.
