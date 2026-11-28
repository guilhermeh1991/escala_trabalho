# Plano: cadastro neutro e supervisor

## Objetivo

Permitir que o superadmin transforme uma conta confirmada em supervisor e depois
vincule lojas, sem fazer o cadastro público conceder privilégios.

## Tarefas

- [ ] Adicionar `plataforma_mudar_papel` em [api/auth.php](../../api/auth.php), exigindo `exigirPlataforma()`, validando usuário confirmado da empresa, usando transação e registrando auditoria.
- [ ] Na promoção para `gestor`, limpar `usuarios.loja_id`; no retorno para `admin`, remover `supervisor_lojas` e manter a conta na empresa.
- [ ] Adicionar ações contextuais na consulta central de usuários em [src/app/acesso-telas-php.js](../../src/app/acesso-telas-php.js), com confirmação, atualização das listas e texto “Supervisor” para o papel técnico `gestor`.
- [ ] Atualizar a descrição do painel em [src/app/template.html](../../src/app/template.html) e a orientação do vínculo em [src/app/telas-acesso.html](../../src/app/telas-acesso.html), sem criar seletor de papel no cadastro.
- [ ] Atualizar [docs/08-papeis-e-acesso.md](../../docs/08-papeis-e-acesso.md) e [PRODUCT.md](../../PRODUCT.md) com o contrato de promoção e limpeza de vínculos.
- [ ] Cobrir promoção, bloqueio sem vínculo, vínculo de loja, rebaixamento e remoção dos vínculos em [testes/api.sh](../../testes/api.sh).
- [ ] Atualizar os testes de navegador do painel quando o ambiente de fixture permitir exercitar o novo botão.

## Verificação

- `npm run lint` — atualmente há avisos preexistentes; nenhum erro novo foi introduzido.
- `npm test`
- `php -l api/auth.php`
- `php -l api/comum.php`
- `bash testes/api.sh` em banco de integração autorizado
- `bash testes/painel-admin-setup.sh` e `node testes/painel-admin-browser.js` quando Playwright e MySQL estiverem disponíveis
- `git diff --check`
