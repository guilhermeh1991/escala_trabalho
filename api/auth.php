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
            'loja_id' => $u['loja_id'], 'colaborador_id' => $u['colaborador_id'],
        ],
        'empresa'     => $empresa,
        'colaborador' => $colaborador,
        'plataforma' => ehSuperAdmin($u),
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

    $st = bd()->prepare('SELECT id, nome, email_confirmado FROM usuarios WHERE email = ? LIMIT 1');
    $st->execute([$email]);
    $existente = $st->fetch();
    if ($existente && (int)$existente['email_confirmado'] === 1) {
        // Não confirmamos que o e-mail existe: isso revelaria cadastros.
        registrarTentativa('cadastro:' . origem(), false);
        // Não revelar se a conta existe; a tela usa o estado neutro sem afirmar
        // que um e-mail foi enviado neste caso.
        responder(['ok' => true, 'confirmar' => true, 'email_enviado' => null]);
    }

    $token = bin2hex(random_bytes(32));
    if ($existente) {
        // Cadastro existente mas nunca confirmado: gera novo link e reenvia.
        $id = $existente['id'];
        $st = bd()->prepare(
            'UPDATE usuarios SET senha_hash = ?, nome = ?, token_confirmacao = ?, token_expira = (NOW() + INTERVAL 2 DAY)
            WHERE id = ?');
        $st->execute([password_hash($senha, algoritmoSenha()), $nome, $token, $id]);
    } else {
        $id = uuid();
        $st = bd()->prepare(
            'INSERT INTO usuarios (id, email, senha_hash, nome, token_confirmacao, token_expira)
            VALUES (?, ?, ?, ?, ?, (NOW() + INTERVAL 2 DAY))');
        $st->execute([$id, $email, password_hash($senha, algoritmoSenha()), $nome, $token]);
    }

    $link = paginaBase() . '/?confirmar=' . $token;
    $emailEnviado = enviarEmail($email, 'Confirme seu acesso ao sistema de escala',
        "<p>Olá, {$nome}.</p>
         <p>Para ativar seu acesso, clique no endereço abaixo:</p>
         <p><a href=\"{$link}\">{$link}</a></p>
         <p>O link vale por dois dias. Se não foi você quem pediu, ignore este e-mail.</p>");

    registrar($id, null, 'cadastro', ['email' => $email, 'email_enviado' => $emailEnviado]);
    responder(['ok' => true, 'confirmar' => true, 'email_enviado' => $emailEnviado]);

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
    // A resposta permanece idêntica exista ou não o e-mail, para não revelar cadastros.
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
    if (ehSuperAdmin($u)) falhar('Administrador da plataforma não pode criar empresa por este fluxo.', 403);
    if ($u['empresa_id']) falhar('Este usuário já pertence a uma empresa.');
    if ($u['papel'] === 'colaborador') falhar('Seu acesso é de colaborador.', 403);

    $nome = trim((string)campo($dados, 'nome', ''));
    if (mb_strlen($nome) < 2) falhar('Informe o nome da empresa.');

    // Nome da primeira loja. Em branco, usa o nome da empresa — quem tem uma
    // loja só não precisa digitar duas vezes.
    $nomeLoja = trim((string)campo($dados, 'loja', ''));
    if ($nomeLoja === '') $nomeLoja = $nome;

    $id      = uuid();
    $idLoja  = uuid();
    $codigo  = codigoConvite();
    $codLoja = codigoConvite();

    bd()->beginTransaction();
    try {
        bd()->prepare('INSERT INTO empresas (id, nome, codigo_convite) VALUES (?, ?, ?)')
            ->execute([$id, $nome, $codigo]);

        // A empresa nasce com a loja que a pessoa nomeou, e vazia: sem
        // colaborador de exemplo. Antes vinham duas lojas de demonstração,
        // o que fazia todo cadastro novo abrir com dados de outra rede.
        bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, codigo_convite, parametros, ordem)
                       VALUES (?,?,?,?,?,0)')
            ->execute([$idLoja, $id, mb_substr($nomeLoja, 0, 80), $codLoja, '{}']);

        bd()->prepare('UPDATE usuarios SET empresa_id = ?, loja_id = ?, papel = \'admin\' WHERE id = ?')
            ->execute([$id, $idLoja, $u['id']]);
        bd()->commit();
    } catch (Throwable $e) {
        bd()->rollBack();
        error_log('criar empresa: ' . $e->getMessage());
        falhar('Não foi possível criar a empresa.', 500);
    }
    registrar($u['id'], $id, 'empresa_criada', ['nome' => $nome, 'loja' => $nomeLoja]);
    responder(['ok' => true, 'empresa_id' => $id, 'loja_id' => $idLoja,
               'codigo_convite' => $codigo]);

// -----------------------------------------------------------------------------
case 'entrar_por_convite':
// -----------------------------------------------------------------------------
    $u = exigirLogin();
    if ($u['empresa_id']) falhar('Este usuário já pertence a uma empresa.');

    $codigo = strtoupper(trim((string)campo($dados, 'codigo', '')));
    exigirDentroDoLimite('convite:' . origem(), 10, 30);

    // O código pode ser da empresa (vê a rede toda) ou de uma loja (vê só ela)
    $st = bd()->prepare('SELECT id FROM empresas WHERE codigo_convite = ? LIMIT 1');
    $st->execute([$codigo]);
    $e = $st->fetch();

    $idLoja = null;
    if (!$e) {
        $st = bd()->prepare('SELECT id, empresa_id, nome FROM lojas WHERE codigo_convite = ? LIMIT 1');
        $st->execute([$codigo]);
        $l = $st->fetch();
        if ($l) { $e = ['id' => $l['empresa_id']]; $idLoja = $l['id']; }
    }
    if (!$e) {
        registrarTentativa('convite:' . origem(), false);
        falhar('Código de convite inválido.');
    }

    if (ehSuperAdmin($u)) falhar('Administrador da plataforma não entra por convite.', 403);
    bd()->prepare('UPDATE usuarios SET empresa_id = ?, loja_id = ?, papel = \'gestor\' WHERE id = ?')
        ->execute([$e['id'], $idLoja, $u['id']]);
    registrar($u['id'], $e['id'], 'entrou_por_convite', ['loja' => $idLoja]);
    responder(['ok' => true, 'empresa_id' => $e['id'], 'loja_id' => $idLoja]);

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
    if (ehSupervisor($u)) {
        $permitidas = lojasDoSupervisor($u);
        if (!$permitidas) falhar('Supervisor sem loja autorizada.', 403);
        $marcadores = implode(',', array_fill(0, count($permitidas), '?'));
        $st = bd()->prepare(
            "SELECT DISTINCT us.id, us.nome, us.email, us.papel, us.ultimo_acesso, us.criado_em,
                    us.loja_id, l.nome AS loja
               FROM usuarios us
               LEFT JOIN lojas l ON l.id = us.loja_id
              WHERE us.empresa_id = ? AND us.loja_id IN ($marcadores)
              ORDER BY us.criado_em");
        $st->execute(array_merge([$u['empresa_id']], $permitidas));
    } else {
        $st = bd()->prepare(
            'SELECT us.id, us.nome, us.email, us.papel, us.ultimo_acesso, us.criado_em,
                    us.loja_id, l.nome AS loja
               FROM usuarios us
               LEFT JOIN lojas l ON l.id = us.loja_id
              WHERE us.empresa_id = ? ORDER BY us.criado_em');
        $st->execute([$u['empresa_id']]);
    }
    responder(['acessos' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'mudar_papel':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo  = (string)campo($dados, 'usuario_id', '');
    $papel = (string)campo($dados, 'papel', '');
    if (!in_array($papel, ['admin', 'gestor', 'leitor', 'colaborador'], true)) falhar('Perfil inválido.');
    if ($alvo === $u['id']) falhar('Você não pode mudar o próprio perfil.');

    $alvoUsuario = exigirUsuarioDaEmpresa($alvo, $u);
    if ($alvoUsuario['papel'] === 'admin' && $papel !== 'admin') {
        falhar('Não é possível rebaixar outro administrador por este fluxo.', 403);
    }
    $st = bd()->prepare('UPDATE usuarios SET papel = ? WHERE id = ? AND empresa_id = ?');
    $st->execute([$papel, $alvo, $u['empresa_id']]);
    if ($alvoUsuario['papel'] === 'gestor' && $papel !== 'gestor') {
        bd()->prepare('DELETE FROM supervisor_lojas WHERE usuario_id = ?')->execute([$alvo]);
    }
    registrar($u['id'], $u['empresa_id'], 'mudou_papel', ['alvo' => $alvo, 'papel' => $papel]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'definir_loja':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo   = (string)campo($dados, 'usuario_id', '');
    $lojaId = (string)campo($dados, 'loja_id', '');

    $alvoUsuario = exigirUsuarioDaEmpresa($alvo, $u);
    if ($alvoUsuario['papel'] === 'gestor') {
        if ($lojaId === '') falhar('Supervisor precisa de uma loja autorizada.', 403);
        exigirLojaDaEmpresa($lojaId, $u);
        bd()->prepare('INSERT IGNORE INTO supervisor_lojas (usuario_id, loja_id) VALUES (?, ?)')
            ->execute([$alvo, $lojaId]);
        registrar($u['id'], $u['empresa_id'], 'supervisor_loja_atribuida',
            ['pessoa' => $alvo, 'loja' => $lojaId]);
        responder(['ok' => true, 'loja_id' => $lojaId]);
    }
    if ($alvoUsuario['papel'] === 'colaborador') {
        falhar('Colaborador deve ser vinculado pela ficha da equipe.', 403);
    }
    if ($lojaId === '') {
        // sem loja = administrador da empresa enxerga a rede inteira
        $st = bd()->prepare('UPDATE usuarios SET loja_id = NULL WHERE id = ? AND empresa_id = ?');
        $st->execute([$alvo, $u['empresa_id']]);
    } else {
        exigirLojaDaEmpresa($lojaId, $u);
        $st = bd()->prepare('UPDATE usuarios SET loja_id = ? WHERE id = ? AND empresa_id = ?');
        $st->execute([$lojaId, $alvo, $u['empresa_id']]);
    }
    registrar($u['id'], $u['empresa_id'], 'definiu_loja', ['alvo' => $alvo, 'loja' => $lojaId]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'remover_acesso':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo = (string)campo($dados, 'usuario_id', '');
    if ($alvo === $u['id']) falhar('Você não pode remover o próprio acesso.');

    // Desvincula da empresa; a conta continua existindo sem acesso aos dados.
    $alvoUsuario = exigirUsuarioDaEmpresa($alvo, $u);
    if ($alvoUsuario['papel'] === 'gestor') {
        bd()->prepare('DELETE FROM supervisor_lojas WHERE usuario_id = ?')
            ->execute([$alvo]);
    }
    $st = bd()->prepare('UPDATE usuarios SET empresa_id = NULL, loja_id = NULL, colaborador_id = NULL WHERE id = ? AND empresa_id = ?');
    $st->execute([$alvo, $u['empresa_id']]);
    registrar($u['id'], $u['empresa_id'], 'removeu_acesso', ['alvo' => $alvoUsuario['id']]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_empresas':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $q = trim((string)campo($dados, 'q', ''));
    $st = bd()->prepare(
        'SELECT id, nome, descricao, criado_em FROM empresas
          WHERE (? = \'\' OR nome LIKE CONCAT(\'%\', ?, \'%\') OR descricao LIKE CONCAT(\'%\', ?, \'%\'))
          ORDER BY nome, id');
    $st->execute([$q, $q, $q]);
    responder(['empresas' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_supervisores':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $empresaId = (string)campo($dados, 'empresa_id', '');
    if (!ehUuid($empresaId)) falhar('Empresa inválida.');
    $q = trim((string)campo($dados, 'q', ''));
    $st = bd()->prepare(
        'SELECT id, nome, email, papel FROM usuarios
          WHERE empresa_id = ? AND papel = \'gestor\'
            AND (? = \'\' OR nome LIKE CONCAT(\'%\', ?, \'%\') OR email LIKE CONCAT(\'%\', ?, \'%\'))
          ORDER BY nome, email');
    $st->execute([$empresaId, $q, $q, $q]);
    responder(['supervisores' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_lojas':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $empresaId = trim((string)campo($dados, 'empresa_id', ''));
    if ($empresaId !== '' && !ehUuid($empresaId)) falhar('Empresa inválida.');
    $q = trim((string)campo($dados, 'q', ''));
    $st = bd()->prepare(
        'SELECT l.id, l.empresa_id, l.nome, l.descricao, l.ordem, l.criado_em, e.nome AS empresa_nome
           FROM lojas l JOIN empresas e ON e.id = l.empresa_id
          WHERE (? = \'\' OR l.empresa_id = ?)
            AND (? = \'\' OR l.nome LIKE CONCAT(\'%\', ?, \'%\') OR l.descricao LIKE CONCAT(\'%\', ?, \'%\'))
          ORDER BY e.nome, l.ordem, l.criado_em');
    $st->execute([$empresaId, $empresaId, $q, $q, $q]);
    responder(['lojas' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_criar_empresa':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $nome = trim((string)campo($dados, 'nome', ''));
    $descricao = mb_substr(trim((string)campo($dados, 'descricao', '')), 0, 500);
    if (mb_strlen($nome) < 2) falhar('Informe o nome da empresa.');
    $nomeLoja = trim((string)campo($dados, 'loja', ''));
    if ($nomeLoja === '') $nomeLoja = $nome;
    $empresaId = uuid();
    $lojaId = uuid();
    $codigo = codigoConvite();
    $codigoLoja = codigoConvite();
    bd()->beginTransaction();
    try {
        bd()->prepare('INSERT INTO empresas (id, nome, descricao, codigo_convite) VALUES (?, ?, ?, ?)')
            ->execute([$empresaId, $nome, $descricao !== '' ? $descricao : null, $codigo]);
        bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, descricao, codigo_convite, parametros, ordem)
                       VALUES (?, ?, ?, ?, ?, ?, 0)')
            ->execute([$lojaId, $empresaId, mb_substr($nomeLoja, 0, 80), null, $codigoLoja, '{}']);
        bd()->commit();
    } catch (Throwable $e) {
        bd()->rollBack();
        error_log('plataforma criar empresa: ' . $e->getMessage());
        falhar('Não foi possível criar a empresa.', 500);
    }
    registrar($u['id'], $empresaId, 'plataforma_empresa_criada',
        ['nome' => $nome, 'loja' => $nomeLoja]);
    responder(['ok' => true, 'empresa_id' => $empresaId, 'loja_id' => $lojaId,
               'codigo_convite' => $codigo, 'codigo_loja' => $codigoLoja]);

// -----------------------------------------------------------------------------
case 'plataforma_editar_empresa':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $empresaId = (string)campo($dados, 'empresa_id', '');
    if (!ehUuid($empresaId)) falhar('Empresa inválida.');
    $nome = trim((string)campo($dados, 'nome', ''));
    $descricao = mb_substr(trim((string)campo($dados, 'descricao', '')), 0, 500);
    if (mb_strlen($nome) < 2) falhar('Informe o nome da empresa.');
    $st = bd()->prepare('SELECT 1 FROM empresas WHERE id=? LIMIT 1');
    $st->execute([$empresaId]);
    if (!$st->fetchColumn()) falhar('Empresa não encontrada.', 404);
    bd()->prepare('UPDATE empresas SET nome=?, descricao=? WHERE id=?')
        ->execute([$nome, $descricao !== '' ? $descricao : null, $empresaId]);
    registrar($u['id'], $empresaId, 'plataforma_empresa_editada', ['nome' => $nome, 'descricao' => $descricao]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'plataforma_editar_loja':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $lojaId = (string)campo($dados, 'loja_id', '');
    if (!ehUuid($lojaId)) falhar('Loja inválida.');
    $nome = mb_substr(trim((string)campo($dados, 'nome', '')), 0, 80);
    $descricao = mb_substr(trim((string)campo($dados, 'descricao', '')), 0, 500);
    if ($nome === '') falhar('Informe o nome da loja.');
    $st = bd()->prepare('SELECT empresa_id FROM lojas WHERE id=? LIMIT 1');
    $st->execute([$lojaId]);
    $empresaId = $st->fetchColumn();
    if (!$empresaId) falhar('Loja não encontrada.', 404);
    bd()->prepare('UPDATE lojas SET nome=?, descricao=? WHERE id=?')
        ->execute([$nome, $descricao !== '' ? $descricao : null, $lojaId]);
    registrar($u['id'], $empresaId, 'plataforma_loja_editada', ['loja' => $lojaId, 'nome' => $nome, 'descricao' => $descricao]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'supervisor_listar_lojas':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirSupervisorDaEmpresa($u['id'], $u);
    $lojasSupervisor = lojasDoSupervisor($u);
    if (!$lojasSupervisor) falhar('Supervisor sem loja autorizada.', 403);
    responder(['lojas' => $lojasSupervisor]);

// -----------------------------------------------------------------------------
case 'supervisor_atribuir_loja':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo = (string)campo($dados, 'usuario_id', '');
    $lojaId = (string)campo($dados, 'loja_id', '');
    $alvoUsuario = exigirSupervisorDaEmpresa($alvo, $u);
    exigirLojaDaEmpresaId($lojaId, $u['empresa_id']);
    bd()->prepare('INSERT IGNORE INTO supervisor_lojas (usuario_id, loja_id) VALUES (?, ?)')
        ->execute([$alvoUsuario['id'], $lojaId]);
    registrar($u['id'], $u['empresa_id'], 'supervisor_loja_atribuida',
        ['pessoa' => $alvoUsuario['id'], 'loja' => $lojaId]);
    responder(['ok' => true, 'usuario_id' => $alvoUsuario['id'], 'loja_id' => $lojaId]);

// -----------------------------------------------------------------------------
case 'supervisor_revogar_loja':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo = (string)campo($dados, 'usuario_id', '');
    $lojaId = (string)campo($dados, 'loja_id', '');
    $alvoUsuario = exigirSupervisorDaEmpresa($alvo, $u);
    exigirLojaDaEmpresaId($lojaId, $u['empresa_id']);
    $st = bd()->prepare('DELETE FROM supervisor_lojas WHERE usuario_id = ? AND loja_id = ?');
    $st->execute([$alvoUsuario['id'], $lojaId]);
    if ($st->rowCount() !== 1) falhar('Vínculo não encontrado.', 404);
    registrar($u['id'], $u['empresa_id'], 'supervisor_loja_revogada',
        ['pessoa' => $alvoUsuario['id'], 'loja' => $lojaId]);
    responder(['ok' => true, 'usuario_id' => $alvoUsuario['id'], 'loja_id' => $lojaId]);

// -----------------------------------------------------------------------------
case 'supervisor_listar_lojas_admin':
// -----------------------------------------------------------------------------
    $u = exigirEmpresa();
    exigirAdminEmpresa($u);
    $alvo = (string)campo($dados, 'usuario_id', '');
    $alvoUsuario = exigirSupervisorDaEmpresa($alvo, $u);
    $st = bd()->prepare(
        'SELECT l.id, l.nome FROM supervisor_lojas sl
           JOIN lojas l ON l.id = sl.loja_id
          WHERE sl.usuario_id = ? AND l.empresa_id = ?
          ORDER BY l.ordem, l.criado_em');
    $st->execute([$alvoUsuario['id'], $u['empresa_id']]);
    responder(['lojas' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_supervisor_lojas':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $alvo = exigirSupervisorDaPlataforma((string)campo($dados, 'usuario_id', ''));
    $st = bd()->prepare(
        'SELECT l.id, l.empresa_id, l.nome FROM supervisor_lojas sl
           JOIN lojas l ON l.id = sl.loja_id
          WHERE sl.usuario_id = ? ORDER BY l.empresa_id, l.ordem, l.criado_em');
    $st->execute([$alvo['id']]);
    responder(['lojas' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_atribuir_supervisor_loja':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $alvo = exigirSupervisorDaPlataforma((string)campo($dados, 'usuario_id', ''));
    $lojaId = (string)campo($dados, 'loja_id', '');
    $st = bd()->prepare('SELECT empresa_id FROM lojas WHERE id = ? LIMIT 1');
    $st->execute([$lojaId]);
    $empresaId = $st->fetchColumn();
    if (!$empresaId) falhar('Loja não encontrada.', 404);
    if (empty($alvo['empresa_id']) || $alvo['empresa_id'] !== $empresaId) {
        falhar('Supervisor e loja pertencem a empresas diferentes.', 403);
    }
    bd()->prepare('INSERT IGNORE INTO supervisor_lojas (usuario_id, loja_id) VALUES (?, ?)')
        ->execute([$alvo['id'], $lojaId]);
    registrar($u['id'], $empresaId, 'supervisor_loja_atribuida',
        ['pessoa' => $alvo['id'], 'loja' => $lojaId]);
    responder(['ok' => true, 'usuario_id' => $alvo['id'], 'loja_id' => $lojaId]);

// -----------------------------------------------------------------------------
case 'plataforma_revogar_supervisor_loja':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $alvo = exigirSupervisorDaPlataforma((string)campo($dados, 'usuario_id', ''));
    $lojaId = (string)campo($dados, 'loja_id', '');
    $st = bd()->prepare(
        'DELETE sl FROM supervisor_lojas sl JOIN lojas l ON l.id = sl.loja_id
          WHERE sl.usuario_id = ? AND sl.loja_id = ?');
    $st->execute([$alvo['id'], $lojaId]);
    if ($st->rowCount() !== 1) falhar('Vínculo não encontrado.', 404);
    $st = bd()->prepare('SELECT empresa_id FROM lojas WHERE id = ?');
    $st->execute([$lojaId]);
    registrar($u['id'], (string)$st->fetchColumn(), 'supervisor_loja_revogada',
        ['pessoa' => $alvo['id'], 'loja' => $lojaId]);
    responder(['ok' => true, 'usuario_id' => $alvo['id'], 'loja_id' => $lojaId]);

// -----------------------------------------------------------------------------
case 'plataforma_criar_loja':
// -----------------------------------------------------------------------------
    $u = exigirPlataforma();
    $empresaId = (string)campo($dados, 'empresa_id', '');
    if (!ehUuid($empresaId)) falhar('Empresa inválida.');
    $nome = mb_substr(trim((string)campo($dados, 'nome', '')), 0, 80);
    if ($nome === '') falhar('Informe o nome da loja.');
    $st = bd()->prepare('SELECT 1 FROM empresas WHERE id = ? LIMIT 1');
    $st->execute([$empresaId]);
    if (!$st->fetchColumn()) falhar('Empresa não encontrada.', 404);
    $st = bd()->prepare('SELECT COALESCE(MAX(ordem), -1) + 1 FROM lojas WHERE empresa_id = ?');
    $st->execute([$empresaId]);
    $ordem = (int)$st->fetchColumn();
    $lojaId = uuid();
    $descricao = mb_substr(trim((string)campo($dados, 'descricao', '')), 0, 500);
    $codigoLoja = codigoConvite();
    bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, descricao, codigo_convite, parametros, ordem)
                   VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$lojaId, $empresaId, $nome, $descricao !== '' ? $descricao : null, $codigoLoja, '{}', $ordem]);
    registrar($u['id'], $empresaId, 'plataforma_loja_criada', ['nome' => $nome]);
    responder(['ok' => true, 'id' => $lojaId, 'codigo' => $codigoLoja]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_usuarios':
// -----------------------------------------------------------------------------
    exigirPlataforma();
    $empresaId = trim((string)campo($dados, 'empresa_id', ''));
    if ($empresaId !== '' && !ehUuid($empresaId)) falhar('Empresa inválida.');
    $q = trim((string)campo($dados, 'q', ''));
    $st = bd()->prepare(
        'SELECT u.id, u.nome, u.email, u.papel, u.email_confirmado, u.criado_em,
                u.ultimo_acesso, u.empresa_id, e.nome AS empresa, u.loja_id, l.nome AS loja
           FROM usuarios u
           LEFT JOIN empresas e ON e.id = u.empresa_id
           LEFT JOIN lojas l ON l.id = u.loja_id
          WHERE (? = \'\' OR u.empresa_id = ?)
            AND (? = \'\' OR u.nome LIKE CONCAT(\'%\', ?, \'%\')
                 OR u.email LIKE CONCAT(\'%\', ?, \'%\'))
          ORDER BY e.nome, u.nome, u.email
          LIMIT 500');
    $st->execute([$empresaId, $empresaId, $q, $q, $q]);
    responder(['usuarios' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
case 'plataforma_listar_escalas_publicadas':
// -----------------------------------------------------------------------------
    exigirPlataforma();
    $lojaId = trim((string)campo($dados, 'loja_id', ''));
    if (!ehUuid($lojaId)) falhar('Loja inválida.');
    $st = bd()->prepare(
        'SELECT v.inicio, v.fim, v.versao, v.publicada_em, v.criado_em,
                v.resumo, v.snapshot, l.nome AS loja, l.empresa_id, e.nome AS empresa
           FROM escala_versoes v
           JOIN lojas l ON l.id = v.loja_id
           JOIN empresas e ON e.id = l.empresa_id
          WHERE v.loja_id = ? AND v.publicada = 1
          ORDER BY v.inicio DESC, v.versao DESC LIMIT 200');
    $st->execute([$lojaId]);
    $escalas = array_map(function (array $row): array {
        $snap = json_decode((string)$row['snapshot'], true) ?: [];
        $resumo = $row['resumo'] ? (json_decode((string)$row['resumo'], true) ?: []) : [];
        return [
            'inicio' => $row['inicio'], 'fim' => $row['fim'],
            'versao' => (int)$row['versao'],
            'publicada_em' => $row['publicada_em'], 'criado_em' => $row['criado_em'],
            'empresa' => $row['empresa'], 'loja' => $row['loja'], 'loja_id' => $lojaId,
            'pessoas' => $resumo['pessoas'] ?? null, 'dias' => $resumo['dias'] ?? null,
            'incompleto' => !empty($snap['incompleto']),
        ];
    }, $st->fetchAll());
    responder(['escalas' => $escalas]);

// -----------------------------------------------------------------------------
case 'plataforma_carregar_escala_publicada':
// -----------------------------------------------------------------------------
    exigirPlataforma();
    $lojaId = trim((string)campo($dados, 'loja_id', ''));
    $inicio = trim((string)campo($dados, 'inicio', ''));
    $fim = trim((string)campo($dados, 'fim', ''));
    $versao = (int)campo($dados, 'versao', 0);
    if (!ehUuid($lojaId) || !ehDataValida($inicio) || !ehDataValida($fim) || $versao < 1) {
        falhar('Identificação da escala inválida.');
    }
    $st = bd()->prepare(
        'SELECT v.grade, v.parametros, v.snapshot, v.inicio, v.fim, v.versao, v.publicada_em,
                l.nome AS loja, e.nome AS empresa
           FROM escala_versoes v
           JOIN lojas l ON l.id = v.loja_id
           JOIN empresas e ON e.id = l.empresa_id
          WHERE v.loja_id = ? AND v.inicio = ? AND v.fim = ? AND v.versao = ? AND v.publicada = 1
          LIMIT 1');
    $st->execute([$lojaId, $inicio, $fim, $versao]);
    $row = $st->fetch();
    if (!$row) falhar('Publicação não encontrada.', 404);
    $grade = json_decode((string)$row['grade'], true) ?: [];
    $params = $row['parametros'] ? (json_decode((string)$row['parametros'], true) ?: []) : [];
    $snapshot = $row['snapshot'] ? (json_decode((string)$row['snapshot'], true) ?: []) : [];
    $participantes = is_array($snapshot['participantes'] ?? null) ? $snapshot['participantes'] : [];
    $porId = [];
    foreach ($participantes as $p) {
        if (is_array($p) && isset($p['id'])) $porId[(string)$p['id']] = $p;
    }
    foreach (array_keys($grade) as $id) {
        $id = (string)$id;
        if (!isset($porId[$id])) $porId[$id] = ['id' => $id, 'nome' => $id, 'cargo' => '', 'jornada' => null];
    }
    responder(['escala' => [
        'empresa' => $row['empresa'], 'loja' => $row['loja'],
        'inicio' => $row['inicio'], 'fim' => $row['fim'], 'versao' => (int)$row['versao'],
        'publicada_em' => $row['publicada_em'], 'incompleto' => !empty($snapshot['incompleto']),
        'grade' => $grade, 'horas' => is_array($params['_horas'] ?? null) ? $params['_horas'] : [],
        'participantes' => array_values($porId),
    ]]);

// -----------------------------------------------------------------------------
default:
    falhar('Ação desconhecida.', 404);
}
