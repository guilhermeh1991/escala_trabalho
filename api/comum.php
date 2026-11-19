<?php
/**
 * Base de todos os endpoints.
 *
 * Aqui mora a decisão de segurança mais importante desta versão: como o MySQL
 * não tem Row Level Security, o isolamento entre empresas é responsabilidade
 * deste arquivo. Nenhum endpoint monta SQL solto — todos passam pelas funções
 * daqui, que já embutem o filtro de empresa.
 */

declare(strict_types=1);

// -----------------------------------------------------------------------------
//  Erros: registrar em arquivo, nunca mostrar ao visitante.
//  Mensagem de erro do PHP na tela entrega caminho de arquivo e estrutura do
//  banco para quem estiver sondando.
// -----------------------------------------------------------------------------
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$config = require __DIR__ . '/config.php';

// -----------------------------------------------------------------------------
//  Cabeçalhos
// -----------------------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

// -----------------------------------------------------------------------------
//  Sessão
// -----------------------------------------------------------------------------
$ehHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => $ehHttps,   // só viaja em HTTPS
    'httponly' => true,       // JavaScript não lê o cookie de sessão
    'samesite' => 'Strict',   // não é enviado a partir de outro site
]);
session_name('escala_sessao');
session_start();

// -----------------------------------------------------------------------------
//  Banco
// -----------------------------------------------------------------------------
function bd(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    global $config;
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
        $config['bd_host'], $config['bd_nome']);
    try {
        $pdo = new PDO($dsn, $config['bd_usuario'], $config['bd_senha'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,  // prepared statements de verdade
        ]);
    } catch (PDOException $e) {
        error_log('falha de conexão: ' . $e->getMessage());
        responder(['erro' => 'Banco indisponível no momento.'], 503);
    }
    return $pdo;
}

// -----------------------------------------------------------------------------
//  Respostas
// -----------------------------------------------------------------------------
function responder(array $dados, int $codigo = 200)
{
    http_response_code($codigo);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function falhar(string $mensagem, int $codigo = 400)
{
    responder(['erro' => $mensagem], $codigo);
}

/** Traduz falha causada por uma migração ainda não aplicada em produção. */
function mensagemErroBanco(Throwable $e, string $generica): string
{
    $sqlstate = $e instanceof PDOException ? (string)$e->getCode() : '';
    if ($sqlstate === '42S22' || stripos($e->getMessage(), 'Unknown column') !== false) {
        return 'O banco de dados está desatualizado: falta aplicar uma migração '
             . '(veja banco/verificar-e-migrar.sql).';
    }
    return $generica;
}

function corpo(): array
{
    // Limite máximo de payload da API: 2 MB para evitar ataques de esgotamento de memória
    $maxBytes = 2 * 1024 * 1024;
    $tamanho = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($tamanho > $maxBytes) {
        falhar('Payload muito grande.', 413);
    }

    $bruto = file_get_contents('php://input');
    if ($bruto === false || $bruto === '') {
        return [];
    }
    if (strlen($bruto) > $maxBytes) {
        falhar('Payload muito grande.', 413);
    }

    $dados = json_decode($bruto, true, 32); // profundidade máxima de 32 níveis
    return is_array($dados) ? $dados : [];
}

function campo(array $dados, string $nome, $padrao = null)
{
    return array_key_exists($nome, $dados) ? $dados[$nome] : $padrao;
}

// -----------------------------------------------------------------------------
//  Identificadores
// -----------------------------------------------------------------------------
function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/* RESUMO DA ESCALA — guardado na coluna `escalas.resumo`. Parte dele o servidor
consegue calcular sozinho a partir da grade; a contagem de regras feridas não,
porque quem roda o validador é o navegador. Por isso o resumo chega pronto de
lá — mas nada é gravado sem passar por este crivo. */

/** Recalcula o resumo a partir da grade. Usado como reserva. */
function resumoDaGrade(array $grade, array $params = []): array
        {
                $dias = 0;
                $folgas = 0;
                foreach ($grade as $linha) {
                        if (!is_array($linha)) continue;
                        if (count($linha) > $dias) $dias = count($linha);
                        foreach ($linha as $cod) {
                                if ($cod === 'X' || $cod === 'FC') $folgas++;
                        }
                }
                $ajustes = 0;
                foreach (($params['_horas'] ?? []) as $porPessoa) {
                        if (is_array($porPessoa)) $ajustes += count($porPessoa);
                }
                return [
                        'pessoas' => count($grade),
                        'dias' => $dias,
                        'folgas' => $folgas,
                        'ajustes' => $ajustes,
                        'modelo' => isset($params['modelo']) ? (string)$params['modelo'] : '5x2',
                        'feridas' => $params['_resumo']['feridas'] ?? null,
                        'notas' => $params['_resumo']['notas'] ?? null,
                        ];
        }

/** Aceita apenas os campos previstos, com o tipo certo. Números que dependem só
da grade são conferidos contra ela: se o que chegou não bater, vale a grade. */
function normalizarResumo($recebido, array $grade, array $params = []): array
        {
                $calculado = resumoDaGrade($grade, $params);
                if (!is_array($recebido)) {
                        return $calculado;
                }
                $inteiroOuNulo = function ($v) {
                        if ($v === null || $v === '') return null;
                        return is_numeric($v) ? max(0, (int)$v) : null;
                };
                $modelo = isset($recebido['modelo']) ? (string)$recebido['modelo'] : $calculado['modelo'];
                if (!in_array($modelo, ['5x2', '6x1'], true)) $modelo = '5x2';
                
                return [
                        'pessoas' => $calculado['pessoas'],
                        'dias' => $calculado['dias'],
                        'folgas' => $calculado['folgas'],
                        'ajustes' => $inteiroOuNulo($recebido['ajustes'] ?? null) ?? $calculado['ajustes'],
                        'modelo' => $modelo,
                        'feridas' => $inteiroOuNulo($recebido['feridas'] ?? null) ?? $calculado['feridas'],
                        'notas' => $inteiroOuNulo($recebido['notas'] ?? null) ?? $calculado['notas'],
                        ];
        }

/** Código curto de convite, sem caracteres que se confundem na leitura. */
function codigoConvite(): string
{
    $alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $codigo = '';
        for ($i = 0; $i < 8; $i++) $codigo .= $alfabeto[random_int(0, strlen($alfabeto) - 1)];
        $st = bd()->prepare(
            'SELECT 1 FROM empresas WHERE codigo_convite = ?
             UNION SELECT 1 FROM lojas WHERE codigo_convite = ? LIMIT 1');
        $st->execute([$codigo, $codigo]);
    } while ($st->fetchColumn());
    return $codigo;
}

function ehUuid(?string $v): bool
{
    return is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) === 1;
}

function ehDataValida(?string $v): bool
{
    if (!is_string($v) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) !== 1) {
        return false;
    }
    $partes = explode('-', $v);
    return checkdate((int)$partes[1], (int)$partes[2], (int)$partes[0]);
}

// -----------------------------------------------------------------------------
//  Sessão do usuário
// -----------------------------------------------------------------------------
function usuarioLogado(): ?array
{
    if (empty($_SESSION['usuario_id'])) {
        return null;
    }
    $st = bd()->prepare(
        'SELECT id, empresa_id, loja_id, colaborador_id, email, nome, papel, email_confirmado
           FROM usuarios WHERE id = ? LIMIT 1');
    $st->execute([$_SESSION['usuario_id']]);
    $u = $st->fetch();
    return $u ?: null;
}

/** Exige usuário autenticado. Devolve o registro. */
function exigirLogin(): array
{
    $u = usuarioLogado();
    if (!$u) {
        falhar('Sessão expirada. Entre de novo.', 401);
    }
    return $u;
}

/** Exige usuário autenticado E vinculado a uma empresa. */
function exigirEmpresa(): array
{
    $u = exigirLogin();
    if (empty($u['empresa_id'])) {
        falhar('Usuário sem empresa vinculada.', 403);
    }
    return $u;
}

function exigirPapel(array $u, array $papeis): void
{
    if (!in_array($u['papel'], $papeis, true)) {
        falhar('Seu perfil não permite esta ação.', 403);
    }
}

/** Administrador de empresa: distinto da autoridade da plataforma. */
function exigirAdminEmpresa(array $u): void
{
    if (ehSuperAdmin($u)) {
        falhar('Use o fluxo administrativo da plataforma.', 403);
    }
    exigirPapel($u, ['admin']);
}

/** Quem monta escala: administrador e supervisor com loja explícita. */
function exigirGestao(array $u): void
{
    if (ehSuperAdmin($u)) {
        falhar('Administrador da plataforma não acessa a operação por este fluxo.', 403);
    }
    exigirPapel($u, ['admin', 'gestor']);
    if (($u['papel'] ?? '') === 'gestor' && count(lojasDoSupervisor($u)) === 0) {
        falhar('Supervisor sem loja autorizada.', 403);
    }
}

/**
 * Liga a conta de acesso à ficha do colaborador pelo e-mail.
 *
 * O gestor cadastra o e-mail da pessoa na equipe; quando ela se cadastra com
 * aquele mesmo e-mail e confirma o endereço, o vínculo acontece aqui.
 *
 * O e-mail confirmado é a credencial: só quem controla a caixa postal consegue
 * concluir o cadastro, então casar por e-mail não abre brecha.
 *
 * Só age em conta que ainda não tem empresa — quem já criou a própria empresa
 * ou entrou por convite não é reclassificado.
 */
function vincularColaborador(array $u): array
{
    if (ehSuperAdmin($u) || !empty($u['empresa_id']) || !empty($u['colaborador_id'])) {
        return $u;
    }
    try {
        return vincularColaboradorInterno($u);
    } catch (Throwable $e) {
        // O vínculo é conveniência, não requisito de acesso. Se falhar, a
        // pessoa entra sem vínculo e o responsável resolve depois — melhor
        // que barrar o login inteiro.
        error_log('vinculo: ' . $e->getMessage());
        return $u;
    }
}

function vincularColaboradorInterno(array $u): array
{
    $st = bd()->prepare(
        'SELECT c.id AS colaborador_id, l.empresa_id, l.id AS loja_id
           FROM colaboradores c
           JOIN lojas l ON l.id = c.loja_id
          WHERE c.email = ? AND c.ativo = 1
          ORDER BY l.criado_em, c.ordem
          LIMIT 1');
    $st->execute([$u['email']]);
    $achado = $st->fetch();
    if (!$achado) {
        return $u;
    }
    bd()->prepare(
        'UPDATE usuarios
            SET empresa_id = ?, loja_id = ?, colaborador_id = ?, papel = \'colaborador\'
          WHERE id = ? AND empresa_id IS NULL')
        ->execute([$achado['empresa_id'], $achado['loja_id'],
                   $achado['colaborador_id'], $u['id']]);

    registrar($u['id'], $achado['empresa_id'], 'vinculado_como_colaborador',
        ['colaborador' => $achado['colaborador_id']]);

    $u['empresa_id']     = $achado['empresa_id'];
    $u['loja_id']        = $achado['loja_id'];
    $u['colaborador_id'] = $achado['colaborador_id'];
    $u['papel']          = 'colaborador';
    return $u;
}

// -----------------------------------------------------------------------------
//  ISOLAMENTO ENTRE EMPRESAS
//  Estas funções existem para que nenhum endpoint precise lembrar do filtro.
//  Esquecer o filtro é o erro que vazaria dados de uma empresa para outra.
// -----------------------------------------------------------------------------

/**
 * ESCOPO DE LOJAS
 *
 * O isolamento tem dois níveis. O primeiro é a empresa: ninguém alcança dados
 * de outra rede. O segundo é a loja: uma conta pode ficar presa a uma única
 * loja e não enxergar as demais da própria rede.
 *
 * Quem manda é a coluna usuarios.loja_id:
 *   - preenchida  → a conta só vê aquela loja
 *   - vazia       → a conta vê todas as lojas da empresa
 *
 * O administrador ignora a restrição por desenho: é ele quem precisa da visão
 * da rede inteira para comparar as lojas.
 */
function ehSuperAdmin(array $u): bool
{
    global $config;
    $lista = $config['super_admins'] ?? [];
    $lista = array_map('mb_strtolower', array_map('strval', is_array($lista) ? $lista : []));
    return empty($u['empresa_id'])
        && in_array(mb_strtolower((string)$u['email']), $lista, true);
}

/** Autoridade da plataforma: vem apenas da configuração do servidor. */
function exigirPlataforma(): array
{
    $u = exigirLogin();
    if (!ehSuperAdmin($u)) {
        falhar('Acesso restrito ao administrador da plataforma.', 403);
    }
    return $u;
}

/** Gestor é o supervisor de loja: os vínculos explícitos são obrigatórios. */
function ehSupervisor(array $u): bool
{
    return ($u['papel'] ?? '') === 'gestor';
}

/** Lojas autorizadas por uma relação explícita, sem fallback em usuarios.loja_id. */
function lojasDoSupervisor(array $u): array
{
    if (!ehSupervisor($u) || empty($u['empresa_id'])) return [];
    $st = bd()->prepare(
        'SELECT sl.loja_id
           FROM supervisor_lojas sl
           JOIN lojas l ON l.id = sl.loja_id
          WHERE sl.usuario_id = ? AND l.empresa_id = ?
          ORDER BY l.ordem, l.criado_em');
    $st->execute([$u['id'], $u['empresa_id']]);
    return $st->fetchAll(PDO::FETCH_COLUMN) ?: [];
}

function vePorLoja(array $u): bool
{
    return !ehSuperAdmin($u)
        && (($u['papel'] ?? '') === 'gestor'
            || (($u['papel'] ?? '') !== 'admin' && !empty($u['loja_id'])));
}

/** Ids das lojas que este usuário pode enxergar. */
function lojasDoUsuario(array $u): array
{
    if (ehSuperAdmin($u)) {
        $st = bd()->query('SELECT id FROM lojas ORDER BY empresa_id, ordem, criado_em');
        return $st->fetchAll(PDO::FETCH_COLUMN) ?: [];
    }
    if (ehSupervisor($u)) return lojasDoSupervisor($u);
    if (vePorLoja($u)) return [$u['loja_id']];
    $st = bd()->prepare('SELECT id FROM lojas WHERE empresa_id = ? ORDER BY ordem, criado_em');
    $st->execute([$u['empresa_id']]);
    return $st->fetchAll(PDO::FETCH_COLUMN) ?: [];
}

/** A loja pertence à empresa do usuário? Se não, aborta. */
function exigirLojaDaEmpresa(string $lojaId, array $u): void
{
    if (!ehUuid($lojaId)) {
        falhar('Loja inválida.');
    }
    // Supervisor só alcança lojas presentes na relação explícita.
    if (ehSupervisor($u)) {
        $st = bd()->prepare(
            'SELECT 1 FROM supervisor_lojas sl JOIN lojas l ON l.id = sl.loja_id
              WHERE sl.usuario_id = ? AND sl.loja_id = ? AND l.empresa_id = ? LIMIT 1');
        $st->execute([$u['id'], $lojaId, $u['empresa_id']]);
        if (!$st->fetchColumn()) falhar('Loja não encontrada.', 404);
        return;
    }
    if (vePorLoja($u) && $lojaId !== $u['loja_id']) {
        falhar('Loja não encontrada.', 404);
    }
    if (ehSuperAdmin($u)) { $st2 = bd()->prepare('SELECT 1 FROM lojas WHERE id = ? LIMIT 1'); $st2->execute([$lojaId]); if (!$st2->fetchColumn()) { falhar('Loja não encontrada.', 404); } return; } $st = bd()->prepare('SELECT 1 FROM lojas WHERE id = ? AND empresa_id = ? LIMIT 1');
    $st->execute([$lojaId, $u['empresa_id']]);
    if (!$st->fetchColumn()) {
        falhar('Loja não encontrada.', 404);
    }
}

/** O colaborador pertence a alguma loja da empresa do usuário? */
function exigirColaboradorDaEmpresa(string $colabId, array $u): void
{
    if (!ehUuid($colabId)) {
        falhar('Colaborador inválido.');
    }
    $sqlLoja = '';
    $args = [$colabId, $u['empresa_id']];
    if (ehSupervisor($u)) {
        $permitidas = lojasDoSupervisor($u);
        if (!$permitidas) falhar('Supervisor sem loja autorizada.', 403);
        $sqlLoja = ' AND c.loja_id IN (' . implode(',', array_fill(0, count($permitidas), '?')) . ')';
        $args = array_merge($args, $permitidas);
    } elseif (vePorLoja($u)) {
        $sqlLoja = ' AND c.loja_id = ?';
        $args[] = $u['loja_id'];
    }
    $st = bd()->prepare(
        'SELECT 1 FROM colaboradores c
           JOIN lojas l ON l.id = c.loja_id
          WHERE c.id = ? AND l.empresa_id = ?' . $sqlLoja . ' LIMIT 1');
    $st->execute($args);
    if (!$st->fetchColumn()) {
        falhar('Colaborador não encontrado.', 404);
    }
}

/** Conta administrativa da mesma empresa, sem aceitar ids de outra rede. */
function exigirUsuarioDaEmpresa(string $usuarioId, array $u): array
{
    if (!ehUuid($usuarioId)) {
        falhar('Usuário inválido.');
    }
    $st = bd()->prepare(
        'SELECT id, email, papel, empresa_id, loja_id FROM usuarios
          WHERE id = ? AND empresa_id = ? LIMIT 1');
    $st->execute([$usuarioId, $u['empresa_id']]);
    $alvo = $st->fetch();
    if (!$alvo || ehSuperAdmin($alvo)) {
        falhar('Usuário não encontrado.', 404);
    }
    return $alvo;
}

function exigirSupervisorDaEmpresa(string $usuarioId, array $u): array
{
    $alvo = exigirUsuarioDaEmpresa($usuarioId, $u);
    if ($alvo['papel'] !== 'gestor') {
        falhar('Usuário não é supervisor.', 422);
    }
    return $alvo;
}

function exigirSupervisorDaPlataforma(string $usuarioId): array
{
    if (!ehUuid($usuarioId)) falhar('Usuário inválido.');
    $st = bd()->prepare(
        'SELECT id, email, papel, empresa_id, loja_id FROM usuarios
          WHERE id = ? AND papel = \'gestor\' AND empresa_id IS NOT NULL LIMIT 1');
    $st->execute([$usuarioId]);
    $alvo = $st->fetch();
    if (!$alvo) falhar('Usuário não encontrado.', 404);
    return $alvo;
}

function exigirLojaDaEmpresaId(string $lojaId, string $empresaId): void
{
    if (!ehUuid($lojaId) || !ehUuid($empresaId)) falhar('Identificador inválido.');
    $st = bd()->prepare('SELECT 1 FROM lojas WHERE id = ? AND empresa_id = ? LIMIT 1');
    $st->execute([$lojaId, $empresaId]);
    if (!$st->fetchColumn()) falhar('Loja não encontrada.', 404);
}

// -----------------------------------------------------------------------------
//  Proteção contra requisição forjada por outro site
// -----------------------------------------------------------------------------
function tokenCsrf(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function exigirCsrf(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        return;
    }
    $enviado = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $enviado)) {
        falhar('Requisição sem credencial válida. Recarregue a página.', 419);
    }
}

// -----------------------------------------------------------------------------
//  Limite de tentativas
//  Cinco falhas em quinze minutos para o mesmo e-mail ou origem já bloqueia.
// -----------------------------------------------------------------------------
function origem(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'desconhecida'), 0, 45);
}

function registrarTentativa(string $chave, bool $sucesso): void
{
    $st = bd()->prepare('INSERT INTO tentativas_login (chave, sucesso) VALUES (?, ?)');
    $st->execute([substr($chave, 0, 190), $sucesso ? 1 : 0]);

    // Purge probabilístico (1%): evita inchaço da tabela sem depender de cron.
    // Remove registros de tentativas com mais de 7 dias.
    if (random_int(1, 100) === 1) {
        try {
            bd()->exec('DELETE FROM tentativas_login WHERE em < (NOW() - INTERVAL 7 DAY)');
        } catch (Throwable $e) {
            error_log('purge tentativas_login: ' . $e->getMessage());
        }
    }
}

function exigirDentroDoLimite(string $chave, int $maximo = 5, int $minutos = 15): void
{
    $st = bd()->prepare(
        'SELECT COUNT(*) FROM tentativas_login
          WHERE chave = ? AND sucesso = 0 AND em > (NOW() - INTERVAL ? MINUTE)');
    $st->execute([substr($chave, 0, 190), $minutos]);
    if ((int)$st->fetchColumn() >= $maximo) {
        falhar("Muitas tentativas. Espere {$minutos} minutos e tente de novo.", 429);
    }
}

// -----------------------------------------------------------------------------
//  Auditoria
// -----------------------------------------------------------------------------
function registrar(?string $usuarioId, ?string $empresaId, string $acao, ?array $detalhe = null): void
{
    try {
        $st = bd()->prepare(
            'INSERT INTO registro_acoes (usuario_id, empresa_id, acao, detalhe, origem)
             VALUES (?, ?, ?, ?, ?)');
        $st->execute([
            $usuarioId, $empresaId, $acao,
            $detalhe ? json_encode($detalhe, JSON_UNESCAPED_UNICODE) : null,
            origem(),
        ]);
    } catch (Throwable $e) {
        error_log('auditoria: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------------------
//  Regras de senha — NIST SP 800-63B revisão 4
//  Sem exigência de maiúscula, número ou símbolo: a norma proíbe regras de
//  composição. O que protege é comprimento e não estar em vazamento.
// -----------------------------------------------------------------------------
const SENHA_MIN = 12;
const SENHA_MAX = 64;

function conferirSenha(string $senha, string $email = ''): ?string
{
    $n = mb_strlen($senha, 'UTF-8');
    if ($n < SENHA_MIN) {
        return 'A senha precisa de pelo menos ' . SENHA_MIN . ' caracteres.';
    }
    if ($n > SENHA_MAX) {
        return 'A senha pode ter no máximo ' . SENHA_MAX . ' caracteres.';
    }
    $baixa = mb_strtolower($senha, 'UTF-8');
    $emailBaixo = mb_strtolower(trim($email), 'UTF-8');
    // o e-mail inteiro dentro da senha é o caso mais comum e o mais óbvio
    if ($emailBaixo !== '' && strpos($baixa, $emailBaixo) !== false) {
        return 'Não use o seu e-mail dentro da senha.';
    }
    $local = mb_strtolower(explode('@', $emailBaixo)[0] ?? '', 'UTF-8');
    if ($local !== '' && mb_strlen($local) >= 3 && strpos($baixa, $local) !== false) {
        return 'Não use o seu e-mail dentro da senha.';
    }
    foreach (['escala', 'farmacia', 'drogaria', '123456', 'senha', 'password', 'qwerty'] as $p) {
        if (strpos($baixa, $p) !== false) {
            return "Evite \"{$p}\" na senha.";
        }
    }
    return null;
}

function algoritmoSenha(): string
{
    // argon2id quando disponível; bcrypt é o padrão sólido de reserva
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
}

// -----------------------------------------------------------------------------
//  Envio de e-mail
// -----------------------------------------------------------------------------
function enviarEmail(string $para, string $assunto, string $corpoHtml): bool
{
    global $config;

    if (!empty($config['smtp_host'])) {
        try {
            return enviarEmailSmtp($para, $assunto, $corpoHtml);
        } catch (Throwable $e) {
            error_log('e-mail (SMTP): ' . $e->getMessage());
            return false;
        }
    }

    $cabecalhos = implode("\r\n", [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . $config['email_remetente'],
        'Reply-To: ' . $config['email_remetente'],
    ]);
    try {
        $ok = @mail($para, '=?UTF-8?B?' . base64_encode($assunto) . '?=', $corpoHtml, $cabecalhos);
        if (!$ok) {
            error_log('e-mail: mail() nativo falhou ao enviar para ' . $para);
        }
        return $ok;
    } catch (Throwable $e) {
        error_log('e-mail: ' . $e->getMessage());
        return false;
    }
}

/**
 * Envia e-mail via SMTP autenticado, sem depender de bibliotecas externas.
 *
 * Configure em config.php: smtp_host, smtp_porta, smtp_usuario, smtp_senha,
 * smtp_seguranca ('ssl' para porta 465, 'tls' para porta 587, ou '' para nenhuma).
 */
function enviarEmailSmtp(string $para, string $assunto, string $corpoHtml): bool
{
    global $config;

    $host      = (string)$config['smtp_host'];
    $porta     = (int)($config['smtp_porta'] ?? 587);
    $usuario   = (string)($config['smtp_usuario'] ?? '');
    $senha     = (string)($config['smtp_senha'] ?? '');
    $seguranca = strtolower((string)($config['smtp_seguranca'] ?? 'tls'));
    $remetente = (string)$config['email_remetente'];
    $hostLocal = (string)(parse_url(paginaBase(), PHP_URL_HOST) ?: 'localhost');

    $enderecoConexao = ($seguranca === 'ssl' ? 'ssl://' : '') . $host;
    $conexao = @fsockopen($enderecoConexao, $porta, $codigoErro, $mensagemErro, 10);
    if (!$conexao) {
        throw new RuntimeException("Não foi possível conectar ao SMTP ($host:$porta): $mensagemErro");
    }

    smtpEsperar($conexao, '', '220');
    smtpEsperar($conexao, 'EHLO ' . $hostLocal, '250');

    if ($seguranca === 'tls') {
        smtpEsperar($conexao, 'STARTTLS', '220');
        if (!stream_socket_enable_crypto($conexao, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($conexao);
            throw new RuntimeException('Falha ao iniciar TLS com o servidor SMTP.');
        }
        smtpEsperar($conexao, 'EHLO ' . $hostLocal, '250');
    }

    if ($usuario !== '') {
        smtpEsperar($conexao, 'AUTH LOGIN', '334');
        smtpEsperar($conexao, base64_encode($usuario), '334');
        smtpEsperar($conexao, base64_encode($senha), '235');
    }

    $enderecoRemetente = extrairEnderecoEmail($remetente);
    smtpEsperar($conexao, 'MAIL FROM:<' . $enderecoRemetente . '>', '250');
    smtpEsperar($conexao, 'RCPT TO:<' . $para . '>', '250');
    smtpEsperar($conexao, 'DATA', '354');

    $cabecalhosMensagem = implode("\r\n", [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . $remetente,
        'Reply-To: ' . $remetente,
        'To: ' . $para,
        'Subject: =?UTF-8?B?' . base64_encode($assunto) . '?=',
    ]);
    $corpoEscapado = str_replace("\n.", "\n..", $corpoHtml);
    fwrite($conexao, $cabecalhosMensagem . "\r\n\r\n" . $corpoEscapado . "\r\n.\r\n");
    $resposta = smtpLer($conexao);
    if (strpos($resposta, '250') !== 0) {
        fclose($conexao);
        throw new RuntimeException("Servidor SMTP não confirmou o envio: $resposta");
    }

    fwrite($conexao, "QUIT\r\n");
    fclose($conexao);

    return true;
}

function smtpLer($conexao): string
{
    $resposta = '';
    while ($linha = fgets($conexao, 515)) {
        $resposta .= $linha;
        if (isset($linha[3]) && $linha[3] === ' ') {
            break;
        }
    }
    return $resposta;
}

function smtpEsperar($conexao, string $comando, string $codigoEsperado): void
{
    if ($comando !== '') {
        fwrite($conexao, $comando . "\r\n");
    }
    $resposta = smtpLer($conexao);
    if (strpos($resposta, $codigoEsperado) !== 0) {
        fclose($conexao);
        throw new RuntimeException("SMTP recusou o comando '$comando': $resposta");
    }
}

function extrairEnderecoEmail(string $remetente): string
{
    if (preg_match('/<([^>]+)>/', $remetente, $m)) {
        return $m[1];
    }
    return $remetente;
}

function paginaBase(): string
{
    global $config;
    return rtrim($config['endereco_site'], '/');
}
