# Atualizar uma instalação existente na HostGator

Este roteiro atualiza uma instalação PHP/MySQL existente. Não crie uma empresa
ou banco substituto, não importe fixtures e não troque `api/config.php` pelo
exemplo. O deploy atual envia arquivos, mas não executa migrações ou backups.

## Preparar pelo cPanel

1. Em **Domínios**, confirme o diretório raiz de `shiftflow.com.br`. Não presuma
   que seja `public_html`: registre o caminho e confira seu `index.html` e `api/`.
2. Em **MultiPHP Manager**, registre a versão do PHP e confirme as extensões
   `pdo_mysql` e `mbstring`. O CI usa PHP 8.3; uma versão diferente precisa ser
   testada antes de publicar. No phpMyAdmin, registre `SELECT VERSION();` e o
   banco selecionado, conforme o `api/config.php` existente. Não compartilhe
   senhas, chaves, tokens ou o conteúdo desse arquivo em PRs ou conversas.
3. Em **Backup**, exporte o banco existente. Faça também uma cópia completa do
   diretório publicado, incluindo arquivos ocultos, `api/config.php`, possíveis
   uploads e o `.htaccess` da raiz. Guarde cópias fora do diretório público e
   fora do repositório. Um ZIP ou SQL dentro do site pode expor os dados.
4. Crie um banco temporário separado no cPanel e restaure nele a exportação.
   Importe sem ignorar erros. Compare as contagens, registros representativos,
   grades, horários, vínculos e parâmetros com a origem. Preserve essa cópia
   como privada; não a conecte a um site público e não habilite envio de e-mail.
5. Na cópia restaurada, execute o **script atualizado completo**
   `banco/verificar-e-migrar.sql`. Ele inclui 002 a 008, inclusive versões de
   escala e concorrência. Todos os indicadores finais devem ser `1`.
   Execute `banco/conferir-atualizacao.sql`: inconsistências devem ser zero.
   Repita o script cumulativo e confira que versões/vínculos não duplicam e
   que vínculos revogados continuam revogados.

Não execute `testes/api.sh`, `testes/api-colaborador.sh`,
`testes/painel-admin-setup.sh` ou `testes/migracoes-legadas.sh` na hospedagem de
produção. Eles recriam bancos de teste e sobrescrevem configuração local.

## Publicar

1. Valide a revisão exata da branch candidata: build, sintaxe, motor, APIs,
   migrações e navegador. No navegador, confira 320, 390, 1024 e 1440 px nos
   estados válido e bloqueado. Um CI que não iniciou não comprova validação.
2. Programe uma janela curta e suspenda requisições à aplicação e à API pelo
   mecanismo de manutenção da hospedagem. Aguarde as requisições em andamento
   terminarem. Uma página de aviso sozinha não impede gravações na API.
3. Com as gravações suspensas, faça a cópia **final** de banco e arquivos e
   confirme que ela é íntegra. Registre as contagens antes da atualização.
4. Execute `banco/verificar-e-migrar.sql` no banco correto e confira a saída e
   `banco/conferir-atualizacao.sql`. DDL do MySQL faz commit implícito: se houver
   erro, mantenha a manutenção e investigue antes de enviar a aplicação.
5. Publique o conjunto da mesma revisão: `dist/escala-hostgator.html` como
   `index.html`, `api/comum.php`, `auth.php`, `dados.php`, `minha.php` e o
   `.htaccess` da API. **Preserve o `api/config.php` existente**, os uploads e o
   `.htaccess` da raiz. Não envie o schema inicial, testes, dumps ou a variante
   offline para substituir a aplicação operacional.
6. Pelo GitHub, o merge em `main` dispara testes e deploy automaticamente.
   Portanto o merge só deve acontecer depois da preparação do banco. Confira
   `HG_PATH` contra o diretório real antes de usar esse caminho. Como alternativa,
   os mesmos arquivos podem ser enviados pelo Gerenciador de arquivos durante
   a manutenção; registre a revisão e compare checksums para evitar mistura.
7. Antes de reabrir a aplicação, teste login de uma conta existente, listagem
   de lojas/equipe, escala publicada e acesso do colaborador. Compare contagens,
   IDs, parâmetros, vínculos e grades com o estado anterior. Mudanças esperadas:
   tabelas/colunas adicionais e cópia das grades para `escala_versoes`.
8. Reabra as gravações após a verificação. Confirme uma edição/rascunho em
   ambiente de teste; não publique escalas fictícias na empresa de um cliente.

## Dados antigos e permissões

A migração 007 preserva grade, parâmetros, ajustes de horário, autor e data,
mas marca snapshots antigos como incompletos. Não existe informação suficiente
para reconstruir nomes e jornadas históricos. Antes de liberar, confira também
o acesso das contas às escalas antigas: a consulta somente para leitura exibe
os identificadores e códigos originais, mantém ajustes de horário gravados e
permite baixar o registro em JSON. Não atribui nomes atuais a pessoas do passado
nem permite editar ou publicar um snapshot incompleto. Não gere outra escala
para substituir um registro antigo como forma de corrigir a visualização.

A 006 converte vínculos únicos de gestores uma só vez. Gestores sem vínculo
legado precisam receber as lojas autorizadas pelo administrador; não conceda
acesso irrestrito para contornar a migração. Contas e senhas existentes são
preservadas. `super_admins` é opcional: configure apenas uma conta controlada
e confirmada pelo responsável, no arquivo privado existente.

Não configure novos pisos ou faixas automaticamente nas lojas. Pisos já
declarados podem bloquear publicação quando não atendidos; rascunhos e versões
publicadas anteriores devem ser preservados.

## Reversão

Guarde a versão anterior dos arquivos. Como o schema é aditivo, prefira reverter
o código mantendo os dados, ainda com as gravações suspensas. A aplicação antiga
não mantém o histórico novo: não a reabra para gravações sem decidir como
reconciliar os dados depois. Restauração do banco é o último recurso e só pode
usar o backup final com a aplicação ainda parada. Restaurar uma cópia anterior
após reabrir o sistema perderia as gravações feitas desde aquele backup.
