# Colocar no ar na HostGator

Tempo estimado: 30 minutos. Sem custo adicional — usa a hospedagem que você já paga.

## Antes de começar: por que existe uma pasta `api/`

O navegador fala HTTP. O MySQL fala um protocolo próprio, na porta 3306. **Um
não entende o outro.** Por isso a versão HostGator tem um backend em PHP no
meio: ele recebe as chamadas do navegador, conversa com o MySQL e devolve a
resposta.

A opção "MySQL remoto" do cPanel serve para ferramentas de desktop e outros
servidores, não para navegador. Colocar a senha do banco no JavaScript exporia
o banco inteiro a qualquer visitante.

## Passo 1 — Criar o banco

No cPanel, **Bancos de dados MySQL**:

1. Em "Criar novo banco de dados", nome: `escala`. Ele vira `seuusuario_escala`.
2. Em "Usuários do MySQL", crie um usuário. Use o gerador de senha e **guarde a
   senha** — ela vai no arquivo de configuração.
3. Em "Adicionar usuário ao banco de dados", ligue os dois e marque **Todos os
   privilégios**.

## Passo 2 — Criar as tabelas

No cPanel, **phpMyAdmin**:

1. Selecione o banco `seuusuario_escala` na coluna da esquerda.
2. Aba **SQL**.
3. Cole o conteúdo inteiro de `banco/mysql-schema.sql` e clique em **Executar**.

Devem aparecer 8 tabelas: `empresas`, `usuarios`, `lojas`, `colaboradores`,
`ausencias`, `escalas`, `registro_acoes` e `tentativas_login`.

## Passo 3 — Enviar os arquivos

No **Gerenciador de arquivos**, entre em `public_html` (ou na pasta do
subdomínio, se for usar um).

Envie desta forma:

```
public_html/
├── index.html          ← dist/escala-hostgator.html, renomeado
└── api/
    ├── comum.php
    ├── auth.php
    ├── dados.php
    ├── config.php      ← você vai criar no próximo passo
    └── .htaccess
```

O `.htaccess` é um arquivo oculto. Se não aparecer, ative **Configurações →
Mostrar arquivos ocultos** no gerenciador.

## Passo 4 — Configurar

Copie `api/config.exemplo.php` para `api/config.php` e edite:

```php
'bd_host'    => 'localhost',
'bd_nome'    => 'seuusuario_escala',
'bd_usuario' => 'seuusuario_escala',
'bd_senha'   => 'a senha que você guardou',
'endereco_site'   => 'https://escala.seudominio.com.br',
'email_remetente' => 'Escala <escala@seudominio.com.br>',
```

Sobre o remetente: crie a conta em **cPanel → Contas de e-mail**. E-mail com o
seu próprio domínio tem muito menos chance de cair na caixa de spam do que
qualquer endereço genérico.

## Passo 5 — Testar

Abra `https://seudominio.com.br/api/auth.php` no navegador. Deve aparecer:

```json
{"erro":"Ação desconhecida."}
```

Se aparecer isso, o PHP está executando e o banco conectou. Se aparecer o
código PHP em texto, o PHP não está ativo. Se aparecer erro 500, veja o arquivo
`error_log` na mesma pasta pelo gerenciador de arquivos.

## Passo 6 — Primeiro acesso

1. Abra `https://seudominio.com.br`.
2. **Criar uma conta** com o seu e-mail.
3. Confirme pelo link que chegar.
4. Escolha **Criar empresa** e dê o nome da rede.
5. Vá em **Acessos** e copie o **código de convite**.

Os outros gerentes criam a conta pelo mesmo endereço e colam o código quando o
sistema perguntar a empresa.

## Se o e-mail não chegar

A função `mail()` do PHP em hospedagem compartilhada às vezes é bloqueada ou
cai em spam. Duas saídas:

**Confirmar à mão pelo phpMyAdmin** — para poucos usuários resolve:

```sql
UPDATE usuarios SET email_confirmado = 1 WHERE email = 'pessoa@empresa.com';
```

**Usar SMTP autenticado** — mais confiável. Exige acrescentar uma biblioteca de
envio (PHPMailer) e apontar para o SMTP da própria HostGator, com a conta de
e-mail criada no Passo 4.

## Segurança: o que muda em relação ao Supabase

No Supabase, o banco recusa linhas de outra empresa mesmo que o código erre —
é a Row Level Security do PostgreSQL. **O MySQL não tem esse recurso.**

Aqui, quem garante o isolamento é o PHP, em `api/comum.php`. Toda consulta que
recebe um identificador do navegador passa por `exigirLojaDaEmpresa()` ou
`exigirColaboradorDaEmpresa()` antes de tocar no banco.

Isso foi testado: `testes/api.sh` cria duas empresas e tenta invadir uma pela
outra de cinco formas diferentes — ler dados, gravar escala, ler escala,
sobrescrever loja e injetar SQL. Todas são barradas.

**Ao criar endpoint novo**, a conferência de posse é obrigatória. É o ponto
onde um descuido vazaria dados de uma empresa para outra.

## Backup

A HostGator faz backup automático, e você ainda tem o **Assistente de backup**
no cPanel para baixar uma cópia quando quiser.

Vale exportar o banco pelo phpMyAdmin depois de fechar cada competência:
**Exportar → Rápido → SQL**. Guarde o arquivo fora da hospedagem.

## Manutenção

| Quando | O quê |
|---|---|
| Todo mês | Exportar o banco pelo phpMyAdmin após fechar a escala |
| A cada troca de gerente | `UPDATE usuarios SET empresa_id = NULL WHERE email = '...'` ou pela aba Acessos |
| A cada 6 meses | Limpar `tentativas_login`: `DELETE FROM tentativas_login WHERE em < (NOW() - INTERVAL 30 DAY)` |
| Ao mudar de domínio | Atualizar `endereco_site` no `config.php` |
