<?php
/**
 * Copie este arquivo para config.php e preencha com os dados do seu cPanel.
 *
 * O config.php NÃO vai para o Git — está no .gitignore. Ele guarda a senha do
 * banco, e senha em repositório é vazamento esperando acontecer.
 */
return [
    // cPanel > Bancos de dados MySQL. O usuário e o banco vêm com o prefixo
    // da sua conta, algo como "seuusuario_escala".
    'bd_host'    => 'localhost',
    'bd_nome'    => 'SEUUSUARIO_escala',
    'bd_usuario' => 'SEUUSUARIO_escala',
    'bd_senha'   => 'A_SENHA_QUE_VOCE_GEROU',

    // Endereço onde a página está publicada, sem barra no fim.
    // É a base dos links de confirmação e de recuperação de senha.
    'endereco_site' => 'https://escala.seudominio.com.br',

    // Remetente dos e-mails. Crie esta conta em cPanel > Contas de e-mail:
    // e-mail com o seu próprio domínio tem muito menos chance de cair em spam.
    'email_remetente' => 'Escala <escala@seudominio.com.br>',
];
