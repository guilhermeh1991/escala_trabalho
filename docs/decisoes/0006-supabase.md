# 0006 — Supabase para banco e autenticação

**Situação**: aceita

## Problema

O protótipo guardava tudo no dispositivo e autenticava com SHA-256 no próprio
navegador. Para uso real com vários gerentes, isso não serve: sem
compartilhamento, sem recuperação de senha, e com hash inadequado.

## Opções

| Opção | A favor | Contra |
|---|---|---|
| **Supabase** | Postgres, autenticação e regras de acesso num pacote; região São Paulo; sem servidor para manter | Plano gratuito pausa após 7 dias sem uso e não tem backup |
| **Firebase** | maduro, boa faixa gratuita | banco de documentos casa mal com dados relacionais; sem região no Brasil |
| **Servidor próprio** | controle total | alguém precisa cuidar de sistema, certificado e backup toda semana |
| **Cloudflare D1** | barato e rápido | montagem manual de autenticação e regras de acesso |

## Decisão

Supabase, com a página estática no Cloudflare Pages.

Pesou: o isolamento entre empresas pode ser feito pelo próprio banco com Row
Level Security, o que é bem mais seguro que confiar no código do navegador. E
a região São Paulo mantém dados de funcionário no Brasil, simplificando a LGPD.

O motor continua rodando no navegador. O servidor só guarda resultado — não há
servidor de aplicação para manter.

## Alerta registrado

O plano gratuito **pausa o projeto após 7 dias sem acesso e não faz backup**.
Como escala se monta uma vez por mês, a pausa vai acontecer.

Recomendação: plano Pro, US$ 25 por mês, assim que o sistema virar rotina. O
risco não é o custo — é ficar sem backup no dia em que precisar dele.

## Consequência para o código

A interface não mudou. A camada de dados manteve a mesma assinatura
(`store.get` e `store.set`) e passou a sincronizar com o Postgres por baixo.
Nenhuma linha do desenho da grade ou da edição de equipe precisou ser tocada.
