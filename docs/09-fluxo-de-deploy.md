# Fluxo de deploy

## Como funciona depois de configurado

```
Você edita o código no VS Code
        │
        │  git push origin main
        ▼
  GitHub Actions
  ├── roda os testes do motor      (≈40s)
  ├── roda os testes da API PHP    (≈60s)
  └── verifica o esquema do banco  (≈10s)
        │
        │  todos passaram?
        ▼
  build/montar.py
  gera os três HTMLs
        │
        │  SFTP porta 2222
        ▼
  HostGator / public_html
  arquivos atualizados ao vivo
```

Se qualquer teste falhar, o deploy não sai. O site nunca recebe código quebrado.

---

## Configurar uma vez, usar para sempre

### Passo 1 — Secrets do GitHub

No repositório: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor |
|---|---|
| `HG_HOST` | IP do servidor (cPanel → Informações gerais) |
| `HG_USER` | Usuário do cPanel |
| `HG_PASSWORD` | Senha do cPanel |
| `HG_PATH` | Caminho no servidor, ex: `/home/seuusuario/public_html` |

As credenciais ficam criptografadas no GitHub e nunca aparecem nos logs.

### Passo 2 — Habilitar SSH/SFTP na HostGator

cPanel → **SSH/Shell Access** → Gerenciar chaves SSH → Enable.

O SFTP usa porta **2222** nos planos compartilhados.

### Passo 3 — Testar

Faça uma alteração pequena, qualquer coisa. Abra o arquivo e mude uma linha
de CSS. Commit e push. Em **Actions** no GitHub, o fluxo `testes e deploy`
deve aparecer rodando. Em cerca de 2 minutos, a mudança estará no ar.

---

## VS Code com deploy imediato (para ajustes visuais)

Instale a extensão **SFTP** (Natizyskunk) e preencha `.vscode/sftp.json`
com os dados do servidor.

Com `uploadOnSave: false` (como está configurado), o envio é manual:
`Ctrl+Shift+P → SFTP: Upload File`. Isso é intencional — evita subir um
arquivo no meio de uma edição.

Para arquivos de CSS e HTML de aparência, onde o risco de quebrar algo é
baixo, você pode mudar para `uploadOnSave: true` em `.vscode/sftp.json`.

### O que o SFTP do VS Code nunca deve enviar

O arquivo `.vscode/sftp.json` já tem uma lista de exclusões que protege o
banco (`api/config.php`), os testes, a documentação e os fontes.

As Actions enviam apenas:

```
dist/escala-hostgator.html    → index.html no servidor
api/comum.php
api/auth.php
api/dados.php
api/minha.php
api/.htaccess
```

`api/config.php` **jamais é enviado pelo Actions**: ele não está no Git.
Se você usou o SFTP do VS Code para criá-lo no servidor pela primeira vez,
ele permanece lá sem ser apagado em nenhum deploy.

---

## O que o VS Code substitui (se você preferir)

Você pode trabalhar localmente no VS Code em vez de depender do Claude para
cada mudança. O projeto já tem toda a estrutura:

```
src/           fontes — edite aqui
build/         script de build
testes/        suíte de testes
```

Fluxo local:

```bash
# editar um arquivo em src/
python3 build/montar.py       # gera os HTMLs em dist/
node testes/executar.js       # confere o motor
bash testes/api.sh            # confere o PHP (precisa de MySQL rodando)
git add . && git commit -m "melhoria: ..." && git push
```

O push dispara o Actions, que repete os testes e faz o deploy.

### Extensões recomendadas (`.vscode/extensions.json`)

Quando você abrir o repositório no VS Code, ele vai perguntar se quer
instalar as extensões recomendadas. As úteis para este projeto:

| Extensão | Para quê |
|---|---|
| SFTP (Natizykunk) | upload direto para o servidor |
| PHP Intelephense | autocomplete e erro em tempo real no PHP |
| GitLens | histórico de quem mudou cada linha |
| Git Graph | visualizar os branches |

---

## Quando cada abordagem faz sentido

| Situação | Use |
|---|---|
| Nova regra de escala, mudança no motor | Actions (com testes) |
| Mudança no PHP (segurança, isolamento) | Actions (com testes) |
| Ajuste de cor, texto, layout da tela | VS Code + SFTP direto |
| Adicionar um campo na equipe | Depende: se tocar no PHP, Actions |
| Emergência: algo quebrou no servidor | SFTP direto para reverter rápido |
