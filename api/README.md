# API PHP

Backend da versão HostGator. Três arquivos respondem a requisições; o quarto é
a base que todos usam.

| Arquivo | Papel |
|---|---|
| `comum.php` | conexão, sessão, isolamento por empresa, limite de tentativas |
| `auth.php` | cadastro, entrada, saída, recuperação de senha, convites |
| `dados.php` | lojas, colaboradores, ausências, escalas |
| `config.php` | credenciais do banco — **não vai para o Git** |

## O ponto de atenção desta versão

O MySQL não tem Row Level Security. No Supabase, o banco recusa linhas de outra
empresa mesmo que o código erre. Aqui, **quem garante o isolamento é o PHP**.

Por isso nenhum endpoint monta consulta com identificador vindo do navegador
sem antes passar por `exigirLojaDaEmpresa()` ou `exigirColaboradorDaEmpresa()`.
Essas funções existem para que esquecer o filtro seja difícil.

Ao criar endpoint novo, a primeira linha depois de `exigirEmpresa()` deve ser a
conferência de posse de qualquer identificador recebido. Sem exceção.

## Proteções implementadas

| Contra | Como |
|---|---|
| Injeção de SQL | PDO com prepared statements de verdade, `EMULATE_PREPARES = false` |
| Senha fraca ou vazada | NIST 800-63B: 12 caracteres, sem regra de composição, conferência de vazamento no navegador |
| Senha guardada mal | `password_hash()` com argon2id, ou bcrypt onde argon2 não existe |
| Força bruta | 5 falhas por e-mail em 15 min, 20 por origem |
| Descoberta de cadastros | resposta e tempo iguais para e-mail existente ou não |
| Sequestro de sessão | cookie `HttpOnly`, `Secure`, `SameSite=Strict`; id renovado ao entrar |
| Requisição forjada de outro site | token CSRF exigido em tudo que altera dados |
| Vazamento por mensagem de erro | erros vão para log, nunca para a tela |

## Testar rapidamente

```bash
curl -s https://seudominio.com.br/api/auth.php \
  -H 'Content-Type: application/json' \
  -d '{"acao":"sessao"}'
```

Deve responder `{"logado":false,"csrf":"..."}`. Se vier HTML, o PHP não está
executando ou houve erro — veja `error_log` no gerenciador de arquivos.
