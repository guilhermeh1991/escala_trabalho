# Migração para HostGator/PHP como plataforma única

**Data:** 2026-10-18
**Status:** aprovado para planejamento
**Decisão:** a aplicação será operada exclusivamente em HostGator, com PHP e MySQL. A publicação ocorrerá por comandos explícitos no terminal local e pelo GitHub Actions.

## 1. Objetivo

Consolidar o projeto em uma única variante de produção, removendo integralmente Supabase, PostgreSQL/RLS, Cloudflare, a versão offline e quaisquer artefatos ou documentos associados. A solução resultante precisa ser reproduzível, validada pelo CI e publicada na HostGator sem edição ou envio manual de arquivos pelo cPanel/SFTP.

A alteração não deve apagar nem alterar os dados existentes no MySQL de produção. Ela também não deve apagar `api/config.php` no servidor, pois esse arquivo contém as credenciais locais e não faz parte do Git nem do pacote de deploy.

## 2. Resultado esperado

A estrutura operacional terá apenas este caminho:

```text
src/ + api/ + banco/mysql-schema.sql
        ↓
python build/montar.py
        ↓
dist/index.html
        ↓
GitHub Actions
        ↓
SFTP para HostGator
```

O fluxo diário será:

```powershell
npm run check
git add .
git commit -m "tipo: descrição"
git push origin main
```

O `git push origin main` é o ato explícito de publicação. O GitHub Actions repetirá a validação, montará o artefato e fará o envio à HostGator. Não haverá comando que envie para produção automaticamente sem um `git push` explícito.

## 3. Escopo

### 3.1 Incluído

- Manter apenas a variante HostGator/PHP/MySQL.
- Gerar somente `dist/index.html` como HTML implantável.
- Remover a integração Supabase, a versão offline e suas referências.
- Remover PostgreSQL, schema Supabase e verificações RLS do projeto.
- Tornar ESLint e PHPStan bloqueadores no CI.
- Criar lockfile npm e trocar a instalação do CI para `npm ci`.
- Criar scripts npm de build e validação completa.
- Atualizar documentação para o fluxo único de terminal → GitHub Actions → HostGator.
- Limpar rastros versionados de worktrees do Claude e ignorar `.claude/`.
- Tratar os HTMLs versionados na raiz como artefatos obsoletos e removê-los depois de validar o build canônico.
- Documentar e automatizar, quando possível, verificações pós-deploy e rollback.

### 3.2 Excluído

- Mudanças funcionais na montagem de escalas.
- Mudança de banco de dados, perda de dados ou execução de migrações destrutivas no MySQL de produção.
- Integração direta com Google Agenda/iCal, notificações e novos filtros de gestor.
- Alteração de credenciais, segredos do GitHub ou conteúdo de `api/config.php`.
- Exclusão remota de branches Git sem confirmação explícita antes da operação.

## 4. Arquitetura final

### 4.1 Aplicação

O código-fonte permanecerá em `src/`, e `build/montar.py` combinará o template, o motor, os módulos de documentos e a camada PHP para criar **apenas** `dist/index.html`.

A página usa a API relativa `api/` e o backend PHP persiste os dados no MySQL da HostGator. A aplicação não terá referências a SDKs, chaves, URLs ou políticas do Supabase.

### 4.2 Banco

A fonte de verdade do banco será o conjunto MySQL:

- `banco/mysql-schema.sql` para uma instalação nova;
- scripts de migração MySQL existentes para bases já instaladas;
- `banco/verificar-e-migrar.sql` como verificação de integridade e idempotência.

A segurança de separação entre empresas continuará no PHP, com consultas preparadas, sessão, CSRF e validações de posse já cobertas pelos testes de integração. Nenhuma tabela existente no MySQL de produção será apagada, truncada ou alterada por esta migração de plataforma.

### 4.3 CI/CD

O workflow terá jobs bloqueadores para:

1. instalação reproduzível de dependências npm;
2. ESLint;
3. testes do motor e dos documentos;
4. sintaxe PHP e PHPStan;
5. integração PHP/MySQL, incluindo isolamento entre empresas e acesso individual;
6. validação da instalação/migrações MySQL;
7. build único e análise sintática do JavaScript embutido;
8. deploy apenas após a aprovação dos jobs anteriores e apenas em push para `main`.

O deploy envia os arquivos API necessários e o `dist/index.html` para a HostGator. Ele não envia `api/config.php` e não habilita limpeza remota.

## 5. Segurança operacional de deploy

### 5.1 Antes do primeiro deploy da migração

Antes do primeiro push que altere o pipeline de deploy:

1. confirmar um backup recente e restaurável do MySQL de produção, armazenado fora do repositório;
2. conferir que os segredos SFTP do GitHub Actions existem e apontam para o diretório correto;
3. conferir que `api/config.php` existe no servidor e não será incluído na lista de upload;
4. preservar o commit atualmente publicado como ponto de rollback;
5. validar localmente o build e todas as suítes aplicáveis.

Sem confirmação do backup, nenhuma publicação será feita.

### 5.2 Ordem de envio

O deploy prepara e envia os endpoints PHP antes da página final. Somente depois o workflow envia `dist/index.html`. A interface nova, portanto, só se torna pública após o backend correspondente estar disponível.

O envio substitui arquivos específicos; não deve usar opções que removam arquivos remotos. O deploy não toca no banco MySQL.

### 5.3 Verificação pós-deploy

Depois do upload, o workflow fará uma consulta segura à rota pública de sessão da API e validará que ela responde JSON esperado. Uma falha nessa checagem marca o workflow como falho e aciona o procedimento de rollback.

A verificação não deve revelar credenciais, tokens CSRF, dados de usuário ou conteúdo sensível nos logs.

### 5.4 Rollback

O rollback é sempre de código, nunca de banco:

1. identificar o último commit/deploy bem-sucedido;
2. reenviar o HTML e os arquivos PHP daquele commit pelo workflow manual ou por um commit de reversão;
3. validar novamente o endpoint de sessão;
4. registrar o incidente e manter o banco intacto.

A janela de troca do HTML é limitada ao upload de um arquivo pequeno. Não há indisponibilidade planejada, mas o rollback existe para responder a qualquer comportamento inesperado.

## 6. Limpeza de código e arquivos

### 6.1 Remover

- `banco/schema.sql`;
- `src/app/acesso-dados.js`;
- `src/app/acesso-telas.js`;
- documentação de implantação e decisão dedicadas ao Supabase;
- qualquer geração de `escala-web.html` e `escala-offline.html`;
- verificações de RLS/PostgreSQL no workflow;
- HTMLs legados rastreados na raiz após o build único estar validado;
- worktrees/ponteiros do Claude rastreados por acidente.

### 6.2 Atualizar

- `build/montar.py` para gerar e validar apenas `dist/index.html`;
- `package.json` e `package-lock.json` com scripts de desenvolvimento e CI;
- `.github/workflows/testes.yml` para a validação bloqueadora, build único e deploy protegido;
- README, arquitetura, segurança/LGPD, implantação, deploy, checklist, contribuição, publicação, changelog e decisões relacionadas;
- comentários que descrevem o código PHP como uma adaptação do Supabase, substituindo-os por descrições independentes da arquitetura atual.

## 7. Experiência de desenvolvimento

Os scripts npm previstos são:

| Script | Finalidade |
|---|---|
| `npm run lint` | Executa ESLint nos fontes e testes JavaScript. |
| `npm test` | Executa o motor, testes de XLSX e PDF. |
| `npm run build` | Gera e valida `dist/index.html`. |
| `npm run test:api` | Executa a integração PHP/MySQL; exige MySQL local configurado. |
| `npm run test:api-colaborador` | Executa o isolamento da visão individual; exige MySQL local configurado. |
| `npm run check` | Executa lint, teste do motor e build. |

Os testes de API continuam separados do `check` básico porque exigem MySQL local. O CI os executa obrigatoriamente em serviço MySQL efêmero.

## 8. Critérios de aceite

A migração estará concluída quando:

1. uma busca no repositório, excluindo `.git`, `.claude`, `node_modules` e `dist`, não retornar referências a Supabase, Postgres/PostgreSQL, RLS/Row Level Security, Cloudflare ou variantes offline/web removidas;
2. `npm run lint`, `npm test`, `npm run build` e `npm run check` terminarem com sucesso;
3. o workflow não contiver tolerância que esconda erros de ESLint ou PHPStan;
4. o workflow usar instalação npm reproduzível a partir do lockfile;
5. os testes PHP/MySQL continuarem validando autenticação, autorização, isolamento entre empresas, acesso individual, injeção SQL e migrações idempotentes;
6. o build gerar unicamente `dist/index.html`, com motor, XLSX, PDF, telas de acesso e camada de dados PHP incorporados;
7. o deploy não envie `api/config.php`, não execute limpeza remota e teste a resposta pública da API após o envio;
8. a documentação apresente HostGator/PHP/MySQL como a única plataforma suportada e o fluxo por terminal como único modo de publicação;
9. um backup MySQL restaurável esteja confirmado antes do primeiro deploy dessa migração;
10. HTMLs legados, fontes e branches sejam removidos somente após confirmação explícita das operações externas/destrutivas aplicáveis.
