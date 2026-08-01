<?php
/**
 * Acesso: cadastro, entrada, saída, recuperação de senha e vínculo com empresa.
 *
 * Chamada:  POST api/auth.php  com {"acao": "...", ...}
 */

declare(strict_types=1);
require __DIR__ . '/comum.php';

$dados = corpo();
$acao  = (string)campo($dados, 'acao', '');

// A sessão é lida sem CSRF porque não altera nada.
if ($acao !== 'sessao') {
    exigirCsrf();
}

switch ($acao) {

// -----------------------------------------------------------------------------
case 'sessao':
// -----------------------------------------------------------------------------
    $u = usuarioLogado();
    if (!$u) {
        responder(['logado' => false, 'csrf' => tokenCsrf()]);
    }
    // se o e-mail dele está cadastrado em alguma equipe, o vínculo acontece aqui
    $u = vincularColaborador($u);

    $empresa = null;
    if ($u['empresa_id']) {
        $st = bd()->prepare('SELECT id, nome, codigo_convite FROM empresas WHERE id = ?');
        $st->execute([$u['empresa_id']]);
        $empresa = $st->fetch() ?: null;
        // colaborador não precisa do código de convite
        if ($empresa && $u['papel'] === 'colaborador') {
            unset($empresa['codigo_convite']);
        }
    }
    $colaborador = null;
    if ($u['colaborador_id']) {
        $st = bd()->prepare(
            'SELECT c.id, c.nome, c.cargo, c.horario, l.nome AS loja, l.id AS loja_id
               FROM colaboradores c JOIN lojas l ON l.id = c.loja_id
              WHERE c.id = ?');
        $st->execute([$u['colaborador_id']]);
        $colaborador = $st->fetch() ?: null;
    }
    responder([
        'logado'  => true,
        'csrf'    => tokenCsrf(),
        'usuario' => [
            'id' => $u['id'], 'nome' => $u['nome'], 'email' => $u['email'],
            'papel' => $u['papel'], 'empresa_id' => $u['empresa_id'],
            'colaborador_id' => $u['colaborador_id'],
        ],
        'empresa'     => $empresa,
        'colaborador' => $colaborador,
    ]);

// -----------------------------------------------------------------------------
case 'cadastrar':
// -----------------------------------------------------------------------------
    $nome  = trim((string)campo($dados, 'nome', ''));
    $email = mb_strtolower(trim((string)campo($dados, 'email', '')));
    $senha = (string)campo($dados, 'senha', '');

    if (mb_strlen($nome) < 2)                          falhar('Informe o seu nome.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))    falhar('E-mail inválido.');
    if ($erro = conferirSenha($senha, $email))         falhar($erro);

    exigirDentroDoLimite('cadastro:' . origem(), 10, 60);

    $st = bd()->prepare('SELECT 1 FROM usuarios WHERE email = ? LIMIT 1');
    $st->execute([$email]);
    if ($st->fetchColumn()) {
        // Não confirmamos que o e-mail existe: isso revelaria cadastros.
        registrarTentativa('cadastro:' . origem(), false);
        responder(['ok' => true, 'confirmar' => true]);
    }

    $id    = uuid();
    $token = bin2hex(random_bytes(32));
    $st = bd()->prepare(
        'INSERT INTO usuarios (id, email, senha_hash, nome, token_confirmacao, token_expira)
         VALUES (?, ?, ?, ?, ?, (NOW() + INTERVAL 2 DAY))');
    $st->execute([$id, $email, password_hash($senha, algoritmoSenha()), $nome, $token]);

    $link = paginaBase() . '/?confirmar=' . $token;
    enviarEmail($email, 'Confirme seu acesso ao sistema de escala',
        "<p>Olá, {$nome}.</p>
         <p>Para ativar seu acesso, clique no endereço abaixo:</p>
         <p><a href=\"{$link}\">{$link}</a></p>
         <p>O link vale por dois dias. Se não foi você quem pediu, ignore este e-mail.</p>");

    registrar($id, null, 'cadastro', ['email' => $email]);
    responder(['ok' => true, 'confirmar' => true]);

// -----------------------------------------------------------------------------
case 'confirmar':
// -----------------------------------------------------------------------------
    $token = (string)campo($dados, 'token', '');
    if ($token === '') falhar('Link inválido.');

    $st = bd()->prepare(
        'SELECT id FROM usuarios
          WHERE token_confirmacao = ? AND token_expira > NOW() LIMIT 1');
    $st->execute([$token]);
    $u = $st->fetch();
    if (!$u) falhar('Link expirado ou já usado. Peça um novo cadastro.', 410);

    bd()->prepare(
        'UPDATE usuarios
            SET email_confirmado = 1, token_confirmacao = NULL, token_expira = NULL
          WHERE id = ?')->execute([$u['id']]);

    session_regenerate_id(true);
    $_SESSION['usuario_id'] = $u['id'];
    registrar($u['id'], null, 'email_confirmado');
    $atual = usuarioLogado();
    if ($atual) vincularColaborador($atual);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'entrar':
// -----------------------------------------------------------------------------
    $email = mb_strtolower(trim((string)campo($dados, 'email', '')));
    $senha = (string)campo($dados, 'senha', '');

    exigirDentroDoLimite('login:' . $email);
    exigirDentroDoLimite('origem:' . origem(), 20, 15);

    $st = bd()->prepare(
        'SELECT id, senha_hash, email_confirmado FROM usuarios WHERE email = ? LIMIT 1');
    $st->execute([$email]);
    $u = $st->fetch();

    // password_verify roda mesmo sem usuário, para o tempo de resposta não
    // denunciar quais e-mails existem.
    $hashFalso = '$2y$12$' . str_repeat('a', 53);
    $confere = password_verify($senha, $u['senha_hash'] ?? $hashFalso);

    if (!$u || !$confere) {
        registrarTentativa('login:' . $email, false);
        registrarTentativa('origem:' . origem(), false);
        falhar('E-mail ou senha não conferem.', 401);
    }
    if (!(int)$u['email_confirmado']) {
        falhar('Confirme o e-mail pelo link que enviamos antes de entrar.', 403);
    }

    // Reforça o hash se o algoritmo do servidor tiver melhorado
    if (password_needs_rehash($u['senha_hash'], algoritmoSenha())) {
        bd()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
            ->execute([password_hash($senha, algoritmoSenha()), $u['id']]);
    }

    session_regenerate_id(true);          // impede fixação de sessão
    $_SESSION['usuario_id'] = $u['id'];
    bd()->prepare('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?')
        ->execute([$u['id']]);
    registrarTentativa('login:' . $email, true);
    $atual = usuarioLogado();
    if ($atual) vincularColaborador($atual);
    registrar($u['id'], null, 'entrou');
    responder(['ok' => true, 'csrf' => tokenCsrf()]);

// -----------------------------------------------------------------------------
case 'sair':
// -----------------------------------------------------------------------------
    $u = usuarioLogado();
    if ($u) registrar($u['id'], $u['empresa_id'], 'saiu');
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'recuperar':
// -----------------------------------------------------------------------------
    $email = mb_strtolower(trim((string)campo($dados, 'email', '')));
    exigirDentroDoLimite('recuperar:' . origem(), 5, 30);
    registrarTentativa('recuperar:' . origem(), false);

    $st = bd()->prepare('SELECT id, nome FROM usuarios WHERE email = ? LIMIT 1');
    $st->execute([$email]);
    $u = $st->fetch();

    if ($u) {
        $token = bin2hex(random_bytes(32));
        bd()->prepare(
            'UPDATE usuarios
                SET token_recuperacao = ?, token_expira = (NOW() + INTERVAL 1 HOUR)
              WHERE id = ?')->execute([$token, $u['id']]);
        $link = paginaBase() . '/?redefinir=' . $token;
        enviarEmail($email, 'Redefinir a senha do sistema de escala',
            "<p>Olá, {$u['nome']}.</p>
             <p>Para escolher uma nova senha, clique no endereço abaixo:</p>
             <p><a href=\"{$link}\">{$link}</a></p>
             <p>O link vale por uma hora. Se não foi você quem pediu, ignore este e-mail —
                sua senha atual continua valendo.</p>");
        registrar($u['id'], null, 'pediu_recuperacao');
    }
    // Resposta idêntica exista ou não o e-mail, para não revelar cadastros.
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'redefinir':
// -----------------------------------------------------------------------------
    $token = (string)campo($dados, 'token', '');
    $senha = (string)campo($dados, 'senha', '');

    $st = bd()->prepare(
        'SELECT id, email FROM usuarios
          WHERE token_recuperacao = ? AND token_expira > NOW() LIMIT 1');
    $st->execute([$token]);
    $u = $st->fetch();
    if (!$u) falhar('Link expirado ou já usado. Peça outro.', 410);

    if ($erro = conferirSenha($senha, $u['email'])) falhar($erro);

    bd()->prepare(
        'UPDATE usuarios
            SET senha_hash = ?, token_recuperacao = NULL, token_expira = NULL,
                email_confirmado = 1
          WHERE id = ?')->execute([password_hash($senha, algoritmoSenha()), $u['id']]);

    session_regenerate_id(true);
    $_SESSION['usuario_id'] = $u['id'];
    registrar($u['id'], null, 'senha_redefinida');
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'criar_empresa':
// -----------------------------------------------------------------------------
    $u = exigirLogin();
    if ($u['empresa_id']) falhar('Este usuário já pertence a uma empresa.');
    if ($u['papel'] === 'colaborador') falhar('Seu acesso é de colaborador.', 403);

    $nome = trim((string)campo($dados, 'nome', ''));
    if (mb_strlen($nome) < 2) falhar('Informe o nome da empresa.');

    $id = uuid();
    // código curto, sem caracteres que se confundem na leitura
    $alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $codigo = '';
        for ($i = 0; $i < 8; $i++) $codigo .= $alfabeto[random_int(0, strlen($alfabeto) - 1)];
        $st = bd()->prepare('SELECT 1 FROM empresas WHERE codigo_convite = ?');
        $st->execute([$codigo]);
    } while ($st->fetchColumn());

    bd()->beginTransaction();
    try {
        bd()->prepare('INSERT INTO empresas (id, nome, codigo_convite) VALUES (?, ?, ?)')
            ->execute([$id, $nome, $codigo]);
        bd()->prepare('UPDATE usuarios SET empresa_id = ?, papel = \'admin\' WHERE id = ?')
            ->execute([$id, $u['id']]);
        bd()->commit();
    } catch (Throwable $e) {
        bd()->rollBack();
        error_log('criar empresa: ' . $e->getMessage());
        falhar('Não foi possível criar a empresa.', 500);
    }
    registrar($u['id'], $id, 'empresa_criada', ['nome' => $nome]);
    responder(['ok' => true, 'empresa_id' => $id, 'codigo_convite' => $codigo]);

// -----------------------------------------------------------------------------
case 'entrar_por_convite':
// -----------------------------------------------------------------------------
    $u = exigirLogin();
    if ($u['empresa_id']) falhar('Este usuário já pertence a uma empresa.');

    $codigo = strtoupper(trim((string)campo($dados, 'codigo', '')));
    exigirDentroDoLimite('convite:' . origem(), 10, 30);

    $st = bd()->prepare('SELECT id FROM empresas WHERE codigo_convite = ? LIMIT 1');
    $st->execute([$codigo]);
    $e = $st->fetch();
    if (!$e) {
        registrarTentativa('convite:' . origem(), false);
        falhar('Código de convite inválido.');
    }

    bd()->prepare('UPDATE usuarios SET empresa_id = ?, papel = \'gestor\' WHERE id = ?')
        ->execute([$e['id'], $u['id']]);
    registrar($u['id'], $e['id'], 'entrou_por_convite');
    responder(['ok' => true, 'empresa_id' => $e['id']]);

// -----------------------------------------------------------------------------
case 'trocar_senha':
// -----------------------------------------------------------------------------
    $u = exigirLogin();
    $atual = (string)campo($dados, 'atual', '');
    $nova  = (string)campo($dados, 'nova', '');

    $st = bd()->prepare('SELECT senha_hash FROM usuarios WHERE id = ?');
    $st->execute([$u['id']]);
    $hash = (string)$st->fetchColumn();
    if (!password_verify($atual, $hash)) falhar('A senha atual não confere.', 401);
    if ($erro = conferirSenha($nova, $u['email'])) falhar($erro);

    bd()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
        ->execute([password_hash($nova, algoritmoSenha()), $u['id']]);
    registrar($u['id'], $u['empresa_id'], 'trocou_senha');
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'listar_acessos':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirGestao($u);
    $st = bd()->prepare(
        'SELECT id, nome, email, papel, ultimo_acesso, criado_em
           FROM usuarios WHERE empresa_id = ? ORDER BY criado_em');
    $st->execute([$u['empresa_id']]);
    responder(['acessos' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'mudar_papel':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirPapel($u, ['admin']);
    $alvo  = (string)campo($dados, 'usuario_id', '');
    $papel = (string)campo($dados, 'papel', '');
    if (!in_array($papel, ['admin', 'gestor', 'leitor', 'colaborador'], true)) falhar('Perfil inválido.');
    if ($alvo === $u['id']) falhar('Você não pode mudar o próprio perfil.');

    $st = bd()->prepare('UPDATE usuarios SET papel = ? WHERE id = ? AND empresa_id = ?');
    $st->execute([$papel, $alvo, $u['empresa_id']]);
    registrar($u['id'], $u['empresa_id'], 'mudou_papel', ['alvo' => $alvo, 'papel' => $papel]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'remover_acesso':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirPapel($u, ['admin']);
    $alvo = (string)campo($dados, 'usuario_id', '');
    if ($alvo === $u['id']) falhar('Você não pode remover o próprio acesso.');

    // Desvincula da empresa; a conta continua existindo sem acesso aos dados.
    $st = bd()->prepare('UPDATE usuarios SET empresa_id = NULL WHERE id = ? AND empresa_id = ?');
    $st->execute([$alvo, $u['empresa_id']]);
    registrar($u['id'], $u['empresa_id'], 'removeu_acesso', ['alvo' => $alvo]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
default:
    falhar('Ação desconhecida.', 404);
}
