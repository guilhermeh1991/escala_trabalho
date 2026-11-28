# HostGator/PHP como plataforma única — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar o sistema em HostGator/PHP/MySQL, removendo Supabase e a variante offline, com build único, CI reprodutível e publicação segura exclusivamente por GitHub Actions após `git push origin main`.

**Architecture:** `build/montar.py` passa a combinar o template, motor, documentos e módulos PHP em um único `dist/index.html`. O backend PHP e o MySQL permanecem como a única camada de dados; o GitHub Actions instala dependências a partir do lockfile, bloqueia toda falha de análise/teste/build e envia os endpoints PHP antes do HTML final. O deploy não manipula o banco e preserva `api/config.php` no servidor.

**Tech Stack:** JavaScript ES2021, Node.js 20, ESLint 8, Python 3.11 (biblioteca padrão), PHP 8.3, MySQL 8, Bash, GitHub Actions, SFTP/HostGator.

**Spec:** [2026-10-18-hostgator-unico-design.md](../specs/2026-10-18-hostgator-unico-design.md)

## Global Constraints

- HostGator/PHP/MySQL é a única plataforma suportada; não manter fallback offline, Supabase, PostgreSQL/RLS, Cloudflare ou Netlify.
- O build deve gerar somente `dist/index.html`; `dist/` continua ignorado pelo Git.
- Não executar `DROP`, `TRUNCATE`, migração destrutiva ou qualquer alteração no MySQL de produção.
- Nunca versionar, enviar ou substituir `api/config.php`; credenciais e segredos não podem aparecer em código, logs ou documentação de exemplo.
- `git push origin main` continua sendo o único ato de publicação; não criar comando local que publique automaticamente.
- Todo deploy precisa enviar API antes de `index.html`, não pode limpar arquivos remotos e deve fazer smoke test HTTPS sem imprimir tokens/dados pessoais.
- Não excluir branches remotas, worktrees ativos ou arquivos remotos sem uma confirmação explícita do usuário no momento da operação.
- Não realizar commit ou push durante a implementação; ao término, apresentar comandos para o usuário revisar, commitar e publicar.

## Review Focus

- **Artefatos obsoletos no diretório ignorado:** rodar o build em uma pasta `dist/` que já contenha `escala-web.html` e `escala-offline.html` deve removê-los e deixar exclusivamente `index.html`.
- **Marcadores de template alterados:** a montagem deve encerrar com erro claro se um marcador exigido para injetar API, telas, motor ou documentos desaparecer.
- **Requisição pós-deploy sem sessão:** `POST /api/auth.php` com `{"acao":"sessao"}` deve retornar JSON com `logado: false` e uma string CSRF, sem registrar o corpo sensível.
- **Análise estática com aviso:** avisos ESLint e diagnósticos PHPStan devem falhar no CI; não pode haver `|| true` que mascare regressões.
- **Dados existentes em produção:** o workflow não pode conter execução de SQL, limpeza SFTP nem upload de `api/config.php`; uma falha de deploy só pode exigir rollback de código.

---

## File Structure

| Caminho | Responsabilidade após a migração |
|---|---|
| `build/montar.py` | Montar e validar exclusivamente `dist/index.html`; remover artefatos legados gerados pelo próprio build. |
| `testes/build.py` | Teste determinístico do build canônico e da ausência de variantes removidas. |
| `testes/banco.sh` | Criar um banco efêmero, aplicar o schema/migrações MySQL e verificar idempotência e tabelas esperadas. |
| `package.json` / `package-lock.json` | Interface de comandos local e instalação npm reproduzível. |
| `.github/workflows/testes.yml` | Gates bloqueadores, build único, deploy API-primeiro, smoke test e artefato de rollback. |
| `src/app/acesso-dados-php.js` | Camada HTTP para a API PHP sem referência histórica a Supabase. |
| `src/app/acesso-telas-php.js`, `src/app/telas-acesso.html`, `src/app/aba-acessos.html` | Fluxos de autenticação e acesso da única variante mantida. |
| `banco/mysql-schema.sql`, `banco/migracao-*.sql`, `banco/verificar-e-migrar.sql` | Fonte e evolução do banco MySQL. |
| `README.md`, `CONTRIBUTING.md`, `PUBLICAR.md`, `CHANGELOG.md`, `docs/` | Documentação exclusiva do caminho HostGator/PHP/MySQL e do fluxo por terminal. |

Arquivos removidos: `banco/schema.sql`, `src/app/acesso-dados.js`, `src/app/acesso-telas.js`, `docs/04-implantacao.md`, `docs/decisoes/0006-supabase.md`, `index.html` e `escala-hostgator.html` da raiz após a validação do artefato canônico.

---

### Task 1: Construir e testar o artefato único HostGator

**Files:**
- Create: `testes/build.py`
- Modify: `build/montar.py:1-226`
- Delete: `src/app/acesso-dados.js`
- Delete: `src/app/acesso-telas.js`
- Delete: `banco/schema.sql`
- Delete: `index.html`
- Delete: `escala-hostgator.html`

**Interfaces:**
- Consumes: `src/app/template.html`, `src/motor/motor.js`, `src/motor/planilha.js`, `src/motor/documento.js`, `src/app/acesso-dados-php.js`, `src/app/acesso-telas-php.js`, `src/app/minha-escala.js`, `src/app/minha-escala.css`, `src/app/telas-acesso.html`, `src/app/aba-acessos.html`.
- Produces: `python3 build/montar.py` cria apenas `dist/index.html` e sai com código zero somente se as verificações internas forem aprovadas.

- [ ] **Step 1: Escrever o teste de contrato do build**

Criar `testes/build.py` para apagar somente `dist/index.html`, `dist/escala-offline.html`, `dist/escala-web.html` e `dist/escala-hostgator.html`, executar o build e validar este contrato:

```python
from pathlib import Path
import subprocess
import sys

RAIZ = Path(__file__).resolve().parent.parent
DIST = RAIZ / 'dist'
OBSOLETOS = ('escala-offline.html', 'escala-web.html', 'escala-hostgator.html')

for nome in ('index.html', *OBSOLETOS):
    (DIST / nome).unlink(missing_ok=True)

resultado = subprocess.run(
    [sys.executable, 'build/montar.py'], cwd=RAIZ, text=True,
    capture_output=True, check=False
)
assert resultado.returncode == 0, resultado.stdout + resultado.stderr

html = (DIST / 'index.html').read_text(encoding='utf-8')
assert 'function gerarEscala' in html
assert 'function gerarXLSX' in html
assert 'function gerarPdfEscala' in html
assert "const CONFIG = { API: 'api' }" in html
assert 'id="tela-cadastro"' in html
assert 'service_role' not in html
assert 'supabase-js' not in html
assert 'createClient' not in html
assert '/*ENGINE*/' not in html
assert '/*CSS_MINHA*/' not in html
for nome in OBSOLETOS:
    assert not (DIST / nome).exists(), nome
print('build único: ok')
```

- [ ] **Step 2: Executar o teste para confirmar a falha inicial**

Run:

```bash
python3 testes/build.py
```

Expected: falha porque o build atual não gera `dist/index.html` e ainda gera variantes `escala-offline.html`, `escala-web.html` e `escala-hostgator.html`.

- [ ] **Step 3: Reduzir `build/montar.py` à única variante PHP**

No topo do arquivo, alterar o texto de ajuda para declarar somente `dist/index.html`. Antes de montar, remover exclusivamente os três nomes legados em `DIST`, sem limpar outros arquivos possíveis do diretório:

```python
for nome in ('escala-offline.html', 'escala-web.html', 'escala-hostgator.html'):
    (DIST / nome).unlink(missing_ok=True)
```

Remover toda a leitura e todas as transformações exclusivas da variante Supabase/offline:

- leituras de `src/app/acesso-dados.js` e `src/app/acesso-telas.js`;
- o bloco **VERSÃO OFFLINE**;
- o bloco **VERSÃO WEB**;
- inserção do CDN `@supabase/supabase-js`;
- `CONFIG` com `SUPABASE_URL` e `SUPABASE_ANON_KEY`;
- validações dos arquivos `escala-offline.html` e `escala-web.html`.

Manter a montagem atualmente chamada de HostGator, mas renomear a variável para `html`, gravando em `DIST / 'index.html'`:

```python
html = template.replace('/*CSS_MINHA*/', css_minha, 1)
# aplicar as substituições já usadas pela variante PHP
(DIST / 'index.html').write_text(html, encoding='utf-8')
```

Substituir o dicionário `conferir` por uma única entrada `index.html`; manter verificações de motor, XLSX, PDF, telas de acesso, `CONFIG = { API: 'api' }`, ausência de Supabase/service role/login local, presença de `pintarMinhaEscala`, CSS e `aplicarPapel()`. Imprimir somente o tamanho de `index.html`.

- [ ] **Step 4: Executar o teste do build para confirmar a aprovação**

Run:

```bash
python3 testes/build.py
```

Expected: saída `build único: ok`, `dist/index.html` presente e nenhuma das três variantes antigas presente.

- [ ] **Step 5: Remover as fontes e snapshots exclusivos da arquitetura descartada**

Após o teste aprovado, remover com Git os arquivos sem consumidores:

```bash
git rm banco/schema.sql src/app/acesso-dados.js src/app/acesso-telas.js index.html escala-hostgator.html
```

Confirmar que `src/app/telas-acesso.html`, `src/app/aba-acessos.html`, `src/app/acesso-dados-php.js` e `src/app/acesso-telas-php.js` continuam no repositório: eles são dependências diretas do build HostGator.

- [ ] **Step 6: Executar as verificações de regressão do artefato e do motor**

Run:

```bash
python3 testes/build.py
node testes/executar.js
```

Expected: build único aprovado; suíte do motor termina com `RESULTADO: todos os limiares atendidos`.

---

### Task 2: Padronizar comandos locais e fixar as dependências npm

**Files:**
- Modify: `package.json:1-12`
- Create: `package-lock.json`

**Interfaces:**
- Consumes: Node.js 20 e os comandos existentes `node testes/executar.js`, `python3 build/montar.py`, `bash testes/api.sh`, `bash testes/api-colaborador.sh`.
- Produces: interface npm `lint`, `test`, `build`, `test:api`, `test:api-colaborador` e `check`; lockfile compatível com `npm ci`.

- [ ] **Step 1: Fazer o lint falhar se houver advertências**

Alterar o script `lint` em `package.json` para:

```json
"lint": "eslint --max-warnings=0 src/ testes/"
```

Isso transforma avisos existentes em falha para que o gate de qualidade seja efetivo.

- [ ] **Step 2: Adicionar os comandos operacionais padronizados**

Definir o bloco completo de scripts assim:

```json
"scripts": {
  "lint": "eslint --max-warnings=0 src/ testes/",
  "test": "node testes/executar.js",
  "build": "python3 build/montar.py",
  "test:build": "python3 testes/build.py",
  "test:api": "bash testes/api.sh",
  "test:api-colaborador": "bash testes/api-colaborador.sh",
  "check": "npm run lint && npm test && npm run test:build"
}
```

`check` não inclui os testes de API porque eles dependem de MySQL local; o CI os executa com MySQL efêmero.

- [ ] **Step 3: Gerar o lockfile sem alterar versões de dependências**

Run:

```bash
npm install --package-lock-only
```

Expected: cria `package-lock.json`; `package.json` mantém ESLint na linha `^8.57.0` e não ganha dependências de produção.

- [ ] **Step 4: Confirmar instalação reproduzível e os comandos principais**

Run:

```bash
npm ci
npm run lint
npm test
npm run build
npm run check
```

Expected: todos terminam com código zero. Se `npm run lint` revelar avisos, corrigir cada arquivo apontado antes de continuar; não reintroduzir tolerância no script.

- [ ] **Step 5: Conferir que os testes não deixaram configuração sensível rastreável**

Run:

```bash
git status --short
```

Expected: nenhum `api/config.php`, arquivo `.env`, dump SQL ou conteúdo de `dist/` listado como arquivo a versionar.

---

### Task 3: Validar explicitamente schema e migrações MySQL

**Files:**
- Create: `testes/banco.sh`
- Modify: `banco/README.md:1-53`
- Modify: `CONTRIBUTING.md:40-58`

**Interfaces:**
- Consumes: cliente `mysql`, serviço MySQL em `127.0.0.1`, `banco/mysql-schema.sql`, `banco/migracao-002-colaborador.sql`, `banco/migracao-003-acesso-por-loja.sql`, `banco/migracao-004-resumo-escala.sql` e `banco/verificar-e-migrar.sql`.
- Produces: `bash testes/banco.sh`, que sai com zero apenas quando uma instalação nova e duas execuções de `verificar-e-migrar.sql` deixam as oito tabelas esperadas disponíveis.

- [ ] **Step 1: Criar o teste de banco idempotente**

Criar `testes/banco.sh` com `set -eu`, criando exclusivamente `teste_escala_schema`, aplicando os arquivos MySQL e validando a lista de tabelas. O conteúdo funcional deve seguir este formato:

```bash
#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
BD="teste_escala_schema"
MYSQL=(mysql -u root -h 127.0.0.1)

"${MYSQL[@]}" -e "DROP DATABASE IF EXISTS $BD; CREATE DATABASE $BD CHARACTER SET utf8mb4;"
"${MYSQL[@]}" "$BD" < banco/mysql-schema.sql
for arquivo in banco/migracao-002-colaborador.sql banco/migracao-003-acesso-por-loja.sql banco/migracao-004-resumo-escala.sql; do
  "${MYSQL[@]}" "$BD" < "$arquivo"
done
"${MYSQL[@]}" "$BD" < banco/verificar-e-migrar.sql
"${MYSQL[@]}" "$BD" < banco/verificar-e-migrar.sql

tabelas=$("${MYSQL[@]}" -N -s "$BD" -e "SHOW TABLES" | sort | tr '\n' ' ')
esperadas='ausencias colaboradores empresas escalas lojas registro_acoes tentativas_login usuarios '
[ "$tabelas" = "$esperadas" ] || { echo "Tabelas inesperadas: $tabelas" >&2; exit 1; }
echo 'schema MySQL e migrações: ok'
```

Ao final, executar `DROP DATABASE IF EXISTS teste_escala_schema` em uma função `trap` para não deixar o banco efêmero após êxito ou falha.

- [ ] **Step 2: Executar o teste contra MySQL local ou o serviço de CI**

Run:

```bash
bash testes/banco.sh
```

Expected: `schema MySQL e migrações: ok`. Se MySQL local não estiver disponível, não simular o resultado; marcar o teste como pendente localmente e executá-lo no job `banco` do CI na Task 4.

- [ ] **Step 3: Reescrever a documentação do banco para MySQL**

Substituir `banco/README.md` por uma referência ao schema MySQL e às migrações. Ela deve conter:

- `mysql-schema.sql` para instalação nova;
- ordem exata das três migrações e depois `verificar-e-migrar.sql` para uma base existente;
- aviso explícito de que não se deve rodar o schema inicial em uma base já usada;
- comando `bash testes/banco.sh` para validar uma base efêmera;
- lista das oito tabelas esperadas;
- explicação de que isolamento entre empresas é imposto pela API PHP e testado por `testes/api.sh` e `testes/api-colaborador.sh`.

- [ ] **Step 4: Corrigir as instruções de contribuição para o modelo MySQL**

Em `CONTRIBUTING.md`, substituir o trecho que aponta `banco/schema.sql` e RLS por estas regras:

```markdown
Ao mudar o banco MySQL, não edite dados de produção por scripts de desenvolvimento.
Crie uma migração idempotente em `banco/migracao-NNN-descricao.sql`, atualize
`banco/verificar-e-migrar.sql` se necessário e rode `bash testes/banco.sh`,
`bash testes/api.sh` e `bash testes/api-colaborador.sh`.
Toda consulta nova que recebe identificador do navegador deve validar posse com
`exigirLojaDaEmpresa()` ou `exigirColaboradorDaEmpresa()` antes de acessar dados.
```

Também substituir “monta as duas versões” por “monta a versão HostGator”.

- [ ] **Step 5: Reexecutar as suítes que dependem do banco**

Run:

```bash
bash testes/banco.sh
bash testes/api.sh
bash testes/api-colaborador.sh
```

Expected: as três terminam com código zero. Confirmar ao fim que `api/config.php` foi removido pelos scripts e não aparece em `git status --short`.

---

### Task 4: Endurecer o CI e tornar o deploy API-primeiro e verificável

**Files:**
- Modify: `.github/workflows/testes.yml:1-144`
- Modify: `testes/api.sh:1-211` (somente se for necessário garantir limpeza de `api/config.php` em falhas)
- Modify: `testes/api-colaborador.sh:1-199` (somente se for necessário garantir limpeza de `api/config.php` em falhas)

**Interfaces:**
- Consumes: `package-lock.json`, scripts npm, `testes/banco.sh`, os quatro arquivos PHP implantáveis, segredo existente `HG_HOST`, `HG_USER`, `HG_SSH_KEY`, `HG_SSH_PASSPHRASE`, `HG_PATH` e novo segredo `HG_SITE_URL`.
- Produces: workflow que só publica após todos os gates e que consulta `POST ${HG_SITE_URL}/api/auth.php` após upload, validando a forma JSON sem exibir corpo/tokens.

- [ ] **Step 1: Tornar análise JavaScript bloqueadora e reproduzível**

No job `motor`, substituir:

```yaml
run: npm install
```

por:

```yaml
run: npm ci
```

Substituir a etapa ESLint por:

```yaml
- name: ESLint (análise estática JS)
  run: npm run lint
```

Remover `|| true` completamente. Manter a suíte com `npm test` em vez de invocação direta.

- [ ] **Step 2: Tornar PHPStan bloqueador**

Substituir a etapa atual por:

```yaml
- name: Análise estática PHPStan (nível 8)
  run: phpstan analyse --configuration=phpstan.neon --no-progress
```

Remover `|| true`. Se surgirem erros PHPStan, corrigir o código ou o arquivo `phpstan.neon`; não adicionar padrões genéricos novos a `ignoreErrors` para esconder diagnósticos.

- [ ] **Step 3: Trocar a validação Postgres/RLS por MySQL real**

Configurar o job `banco` com o mesmo serviço MySQL 8 e health check já usado no job `api`, e substituir o bloco Python/RLS por:

```yaml
- name: Validar schema e migrações MySQL
  run: bash testes/banco.sh
```

O job `banco` deve continuar independente do job `api`, mesmo que ambos usem MySQL efêmero.

- [ ] **Step 4: Validar o build único antes do deploy**

Na parte de deploy, substituir a montagem e loop por:

```yaml
- name: Montar artefato de produção
  run: npm run build

- name: Validar contrato do build
  run: npm run test:build

- name: Conferir sintaxe do JavaScript gerado
  run: |
    node -e "
      const fs = require('fs');
      const html = fs.readFileSync('dist/index.html', 'utf8');
      const script = html.match(/<script>([\s\S]*)<\/script>/);
      if (!script) throw new Error('tag script não encontrada em dist/index.html');
      new Function(script[1]);
      console.log('dist/index.html: ok');
    "
```

Remover a cópia de `dist/escala-hostgator.html` para outro arquivo. O arquivo enviado será diretamente `dist/index.html`.

- [ ] **Step 5: Enviar API antes do HTML e impedir inclusão de configuração**

Manter a preparação restrita a estes arquivos:

```yaml
- name: Preparar API para deploy
  run: |
    mkdir -p deploy/api
    cp api/comum.php api/auth.php api/dados.php api/minha.php api/.htaccess deploy/api/
    test ! -e deploy/api/config.php
```

Mover a etapa SFTP de `deploy/api` para antes da etapa de HTML. Na etapa do HTML, usar:

```yaml
local_path: 'dist/index.html'
remote_path: ${{ secrets.HG_PATH }}
sftp_only: true
```

Não adicionar opções de exclusão remota, `delete`, `clean`, `rm` ou qualquer comando SSH que modifique conteúdo fora desses arquivos.

- [ ] **Step 6: Adicionar smoke test público sem vazar dados**

Criar uma etapa após os dois uploads, com o segredo `HG_SITE_URL` documentado e usado apenas no ambiente da etapa:

```yaml
- name: Verificar API publicada
  env:
    SITE_URL: ${{ secrets.HG_SITE_URL }}
  run: |
    test -n "$SITE_URL"
    curl --fail --silent --show-error --request POST "${SITE_URL%/}/api/auth.php" \
      --header 'Content-Type: application/json' \
      --data '{"acao":"sessao"}' \
      | python3 -c "import json, sys; resposta=json.load(sys.stdin); assert resposta.get('logado') is False; assert isinstance(resposta.get('csrf'), str) and resposta['csrf']; print('API publicada: ok')"
```

A saída deve ser somente `API publicada: ok`; não imprimir o JSON recebido.

- [ ] **Step 7: Preservar artefato para rollback e restringir permissões**

No topo do workflow, adicionar:

```yaml
permissions:
  contents: read
```

Atualizar a etapa de artefato para guardar apenas `dist/index.html` e os arquivos de API preparados, com um nome que carregue o SHA:

```yaml
- name: Guardar pacote de rollback
  uses: actions/upload-artifact@v4
  with:
    name: deploy-${{ github.sha }}
    path: |
      dist/index.html
      deploy/api/
    retention-days: 30
```

- [ ] **Step 8: Validar sintaxe YAML e procurar tolerâncias mascaradas**

Run:

```bash
python3 -c "import pathlib; t=pathlib.Path('.github/workflows/testes.yml').read_text(encoding='utf-8'); assert '|| true' not in t; assert 'npm ci' in t; assert 'testes/banco.sh' in t; assert 'dist/index.html' in t; assert 'HG_SITE_URL' in t; assert 'test ! -e deploy/api/config.php' in t"
```

Expected: código zero sem saída. Depois, abrir o workflow no GitHub ou usar uma ferramenta YAML disponível para confirmar indentação antes de publicar.

- [ ] **Step 9: Fazer os testes de API limparem `api/config.php` mesmo em falha**

Se a execução da Task 3 deixar `api/config.php` após qualquer asserção falhar, adicionar imediatamente depois de criar cada `SRV`/`SERVIDOR`:

```bash
cleanup() {
  kill "${SRV:-${SERVIDOR:-}}" 2>/dev/null || true
  rm -f api/config.php "$CG" "$CC" "$CX" "${COOKIES_A:-}" "${COOKIES_B:-}"
}
trap cleanup EXIT
```

Ajustar as variáveis de cookies para existir antes do `trap`. Remover os `kill` e `rm` duplicados ao fim. Reexecutar os testes de API e forçar uma falha temporária somente em uma cópia não versionada do script para confirmar que o trap remove `api/config.php`; restaurar a cópia antes de continuar.

---

### Task 5: Remover referências técnicas e documentais ao Supabase/offline

**Files:**
- Delete: `docs/04-implantacao.md`
- Delete: `docs/decisoes/0006-supabase.md`
- Modify: `README.md:1-158`
- Modify: `docs/02-arquitetura.md:1-113`
- Modify: `docs/05-seguranca-e-lgpd.md:1-125`
- Modify: `docs/07-implantacao-hostgator.md:1-145`
- Modify: `docs/08-papeis-e-acesso.md`
- Modify: `docs/09-fluxo-de-deploy.md:1-138`
- Modify: `docs/10-checklist-implantacao.md:1-34`
- Modify: `docs/decisoes/0008-banco-hostgator.md:1-64`
- Modify: `docs/decisoes/README.md`
- Modify: `docs/decisoes/0007-xlsx-sem-biblioteca.md`
- Modify: `api/README.md:1-47`
- Modify: `api/comum.php:1-110`
- Modify: `src/app/acesso-dados-php.js:1-50`
- Modify: `src/motor/planilha.js:1-20`
- Modify: `testes/api.sh:1-10`
- Modify: `CHANGELOG.md:1-51`

**Interfaces:**
- Consumes: arquitetura decidida nesta especificação e os comandos de Tasks 1–4.
- Produces: documentação que só ensina HostGator/PHP/MySQL e uma busca textual sem referências à arquitetura removida.

- [ ] **Step 1: Reescrever o README como fonte principal do fluxo único**

No README:

- substituir a seção “três versões” por “aplicação única”;
- explicar que `npm run build` gera apenas `dist/index.html`;
- listar `npm run lint`, `npm test`, `npm run build`, `npm run check`, `npm run test:api` e `npm run test:api-colaborador`;
- declarar que publicação ocorre somente via `git push origin main` após `npm run check`;
- alterar a organização para `banco/mysql-schema.sql` e remover `banco/schema.sql`;
- apontar somente para `docs/07-implantacao-hostgator.md`;
- retirar toda referência a Supabase, offline, Cloudflare, Postgres e RLS.

- [ ] **Step 2: Reescrever arquitetura e segurança para a implementação PHP existente**

Em `docs/02-arquitetura.md`, substituir o diagrama Supabase por:

```text
navegador ── HTTPS/JSON ──> HostGator
                                ├── index.html (aplicação)
                                ├── api/*.php (sessão, autorização e dados)
                                └── MySQL (empresas, usuários, lojas e escalas)
```

Descrever a API como fronteira de autorização e listar apenas módulos `*-php.js` e `banco/mysql-schema.sql`.

Em `docs/05-seguranca-e-lgpd.md`, substituir autenticação Supabase por `password_hash()`/`password_verify()`, sessão `HttpOnly`/`Secure`/`SameSite=Strict`, CSRF e limitação de tentativas. Substituir RLS por validação de posse no PHP e apontar para os testes de isolamento. Trocar a seção de backup por exportação cPanel/phpMyAdmin e backups da HostGator; remover referências a chave anon, service role, MFA do Supabase e painel Authentication.

- [ ] **Step 3: Atualizar implantação e deploy para terminal/GitHub Actions**

Em `docs/07-implantacao-hostgator.md`, manter a primeira instalação do banco e `api/config.php`, mas substituir o envio manual por:

```powershell
npm ci
npm run check
git add .
git commit -m "tipo: descrição"
git push origin main
```

Explicar que Actions envia primeiro a API, depois `dist/index.html`, não envia `api/config.php` e faz smoke test. Manter cPanel somente para primeira instalação, configuração de segredos e backup/recuperação.

Em `docs/09-fluxo-de-deploy.md`, remover instruções para SFTP no VS Code e upload manual. Corrigir a tabela de segredos para `HG_HOST`, `HG_USER`, `HG_SSH_KEY`, `HG_SSH_PASSPHRASE`, `HG_PATH` e `HG_SITE_URL`; explicar que `HG_SITE_URL` é a URL HTTPS pública sem dados sensíveis. Descrever rollback por reexecução do pacote/commit anterior, sem banco.

- [ ] **Step 4: Atualizar checklist, papéis, API e comentários técnicos**

- Em `docs/10-checklist-implantacao.md`, trocar “MySQL ou Supabase” por MySQL e acrescentar itens para backup restaurável, os seis segredos de Actions e confirmação do smoke test pós-deploy.
- Em `docs/08-papeis-e-acesso.md`, remover qualquer referência a autenticação Supabase e explicar os papéis segundo as respostas PHP/coluna `usuarios.papel`.
- Em `api/README.md` e `api/comum.php`, remover comparações com RLS/Supabase e afirmar diretamente que isolamento é responsabilidade deliberada da API, coberta por testes.
- Em `src/app/acesso-dados-php.js`, remover o comentário “Mesma interface da versão Supabase” e descrever o contrato de armazenamento HTTP da aplicação.
- Em `src/motor/planilha.js` e `docs/decisoes/0007-xlsx-sem-biblioteca.md`, substituir justificativas ligadas à versão offline por independência de bibliotecas/CDN e portabilidade do arquivo `.xlsx`.
- Em `testes/api.sh`, remover a menção a RLS no cabeçalho e descrever o teste como isolamento imposto pela API PHP.
- Em `CHANGELOG.md`, reescrever a descrição de autenticação para PHP/MySQL; não preservar uma afirmação de versão Supabase removida.

- [ ] **Step 5: Atualizar o registro de decisões**

Executar:

```bash
git rm docs/04-implantacao.md docs/decisoes/0006-supabase.md
```

Em `docs/decisoes/0008-banco-hostgator.md`, mudar o status para “aceita — plataforma única”, remover a coexistência de variantes e preservar apenas o racional HostGator/PHP/MySQL, as compensações de segurança e os testes de isolamento. Em `docs/decisoes/README.md`, remover a linha 0006 e atualizar a descrição/estado da 0008.

- [ ] **Step 6: Verificar a erradicação de referências à arquitetura removida**

Run:

```bash
rg -n -i "supabase|postgresql|postgres|row level security|\brls\b|cloudflare|netlify|escala-web|escala-offline" \
  --glob '!dist/**' --glob '!node_modules/**' --glob '!.git/**' --glob '!.claude/**' .
```

Expected: nenhum resultado. Palavras como “offline” que significarem somente um recurso interno devem ser renomeadas para uma formulação sem essa palavra, pois o requisito é remover tudo que remeta à variante descartada.

---

### Task 6: Limpar rastros de worktrees e consolidar o índice Git sem ações externas

**Files:**
- Modify: `.gitignore:1-19`
- Delete from Git index: ponteiros/arquivos rastreados sob `.claude/worktrees/` já marcados para exclusão
- No remote deletion in this task.

**Interfaces:**
- Consumes: estado atual do índice, `.gitignore` com `.claude/`, worktrees registrados por Git.
- Produces: repositório que não rastreia `.claude/`; nenhuma exclusão de branch ou worktree ocorre sem verificação e confirmação separadas.

- [ ] **Step 1: Inspecionar o estado antes de mexer no índice**

Run:

```bash
git status --short
git diff --cached --name-status
git diff -- .gitignore
git ls-files .claude
git worktree list --porcelain
git branch --format='%(refname:short) %(worktree)'
```

Expected: confirmar que as exclusões staged pertencem somente a ponteiros `.claude/worktrees/` já obsoletos e que `.gitignore` ignora `.claude/`.

- [ ] **Step 2: Preservar a limpeza correta e impedir novos rastreamentos**

Manter `.claude/` em `.gitignore`. Se `git ls-files .claude` ainda retornar itens, remover apenas os itens confirmados do índice, sem apagar diretórios locais que possam estar em uso:

```bash
git rm --cached -- <cada-caminho-confirmado>
```

Não usar `git clean`, `Remove-Item -Recurse`, `rm -rf .claude` ou exclusão manual de worktrees nesta tarefa.

- [ ] **Step 3: Verificar que o índice contém apenas a limpeza esperada**

Run:

```bash
git diff --cached --name-status -- .claude .gitignore
git check-ignore -v .claude/worktrees/exemplo
```

Expected: `.claude/` ignorado e nenhum arquivo de código/doc removido por engano.

- [ ] **Step 4: Separar a limpeza opcional de branches locais**

Listar somente branches inequivocamente já mescladas e sem worktree:

```bash
git branch --merged main
git worktree list --porcelain
git branch -vv
```

Não executar `git branch -d` nesta implementação. Apresentar a lista ao usuário após as validações finais e pedir confirmação específica, pois uma branch pode conter trabalho local que ainda interessa.

---

### Task 7: Validar o resultado inteiro e preparar publicação sem publicar

**Files:**
- Modify: arquivos produzidos nas Tasks 1–6, somente se uma verificação encontrar defeito.
- No commit, no push, no deploy.

**Interfaces:**
- Consumes: implementação consolidada, MySQL local quando disponível, CI definido no workflow e backup externo de produção.
- Produces: evidência fresca de que a cópia local está pronta para revisão; lista explícita de pré-requisitos externos antes do primeiro push.

- [ ] **Step 1: Rodar a suíte local que não depende de MySQL**

Run:

```bash
npm ci
npm run lint
npm test
npm run build
npm run test:build
npm run check
```

Expected: todos com código zero. Registrar a saída do motor, incluindo os limiares atingidos.

- [ ] **Step 2: Rodar a suíte MySQL se o serviço local estiver disponível**

Run:

```bash
bash testes/banco.sh
bash testes/api.sh
bash testes/api-colaborador.sh
```

Expected: todos com código zero. Se o ambiente local não tiver MySQL, declarar esta limitação no relatório e exigir que o usuário confira a execução verde dos jobs `banco` e `api` no GitHub Actions antes de considerar publicação concluída.

- [ ] **Step 3: Revalidar o contrato de ausência da arquitetura removida**

Run:

```bash
python3 testes/build.py
rg -n -i "supabase|postgresql|postgres|row level security|\brls\b|cloudflare|netlify|escala-web|escala-offline" \
  --glob '!dist/**' --glob '!node_modules/**' --glob '!.git/**' --glob '!.claude/**' .
python3 -c "import pathlib; t=pathlib.Path('.github/workflows/testes.yml').read_text(encoding='utf-8'); assert '|| true' not in t; assert 'npm ci' in t; assert 'HG_SITE_URL' in t; assert 'dist/index.html' in t; assert 'test ! -e deploy/api/config.php' in t"
```

Expected: `testes/build.py` aprovado, busca sem resultados e asserções do workflow com código zero.

- [ ] **Step 4: Revisar o diff completo antes de qualquer publicação**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff --cached --check
git diff --cached --stat
git diff -- . ':!docs/superpowers/**'
git diff --cached -- . ':!docs/superpowers/**'
```

Expected: nenhum erro de whitespace; nenhuma credencial, `api/config.php`, dump SQL, `dist/` ou arquivo `.claude/` novo no diff. Confirmar que apenas arquivos Supabase/offline, snapshots legados e documentação foram removidos.

- [ ] **Step 5: Aplicar o gate operacional antes do primeiro push**

Antes de sugerir `git push`, pedir ao usuário confirmação explícita de todos os pontos:

1. existe backup MySQL recente, restaurável e guardado fora do repositório;
2. `api/config.php` existe no HostGator e contém o `endereco_site` HTTPS correto;
3. os secrets `HG_HOST`, `HG_USER`, `HG_SSH_KEY`, `HG_SSH_PASSPHRASE`, `HG_PATH` e `HG_SITE_URL` estão cadastrados no GitHub;
4. `HG_SITE_URL` usa o domínio público HTTPS correto e não termina com um caminho de API;
5. `HG_PATH` aponta para a pasta remota que já contém o site em produção;
6. a pessoa responsável sabe recuperar o último commit bem-sucedido pelo Actions caso o smoke test falhe.

Sem essa confirmação, encerrar com o repositório validado localmente, porém sem recomendar push.

- [ ] **Step 6: Entregar os comandos de revisão, commit e publicação ao usuário**

Somente depois do gate operacional aprovado, apresentar — sem executar — estes comandos:

```powershell
# conferir a alteração que será registrada
git status
git diff --cached

# registrar a migração localmente
git add -A
git commit -m "refactor: consolida plataforma HostGator PHP"

# publicar de forma explícita; o Actions valida e faz o deploy
git push origin main
```

Orientar a abrir a execução do GitHub Actions e confirmar que os jobs `Motor de escala`, `Backend PHP`, `Esquema do banco` e `Build e deploy para HostGator` terminaram verdes, incluindo a mensagem `API publicada: ok`. Se falhar depois do upload, não tocar no banco: reverter apenas para o último commit bem-sucedido e publicar o rollback pelo mesmo fluxo.
