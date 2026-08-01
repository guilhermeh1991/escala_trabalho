# Banco

`schema.sql` é a fonte da verdade do banco. Cole no SQL Editor do Supabase e
execute uma vez.

## Tabelas

```
empresas ──┬── perfis          um por usuário, liga ao auth
           └── lojas ──┬── colaboradores ── ausencias
                       └── escalas
registro_acoes                 quem gerou ou alterou cada escala
```

## Isolamento

Toda tabela tem Row Level Security. As políticas comparam a empresa da linha com
a empresa do usuário autenticado, via `empresa_atual()`.

Quem altera o JavaScript da página no próprio navegador continua sem enxergar
dados de outra empresa: o filtro está no Postgres.

Conferência — deve retornar 7 linhas, todas com `t`:

```sql
select relname, relrowsecurity
  from pg_class
 where relname in ('empresas','perfis','lojas','colaboradores',
                   'ausencias','escalas','registro_acoes');
```

## Funções

| Função | Para quê |
|---|---|
| `empresa_atual()` | a empresa do usuário logado, usada nas políticas |
| `papel_atual()` | admin, gestor ou leitor |
| `criar_empresa(nome)` | cria a empresa e torna quem chamou administrador |
| `entrar_por_convite(codigo)` | vincula o usuário a uma empresa existente |
| `ao_criar_usuario()` | gatilho que cria o perfil ao nascer o usuário |

`empresa_atual()` e `papel_atual()` são `security definer` para ler a tabela de
perfis sem cair em recursão de política.

## Ao criar tabela nova

Três coisas, sempre:

1. política RLS por empresa;
2. índice na coluna de ligação;
3. registro em `docs/02-arquitetura.md`.

O CI reprova tabela sem RLS.
