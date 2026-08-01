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
function responder(array $dados, int $codigo = 200): never
{
    http_response_code($codigo);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function falhar(string $mensagem, int $codigo = 400): never
{
    responder(['erro' => $mensagem], $codigo);
}

function corpo(): array
{
    $bruto = file_get_contents('php://input');
    if ($bruto === false || $bruto === '') {
        return [];
    }
    $dados = json_decode($bruto, true);
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

function ehUuid(?string $v): bool
{
    return is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) === 1;
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
        'SELECT id, empresa_id, colaborador_id, email, nome, papel, email_confirmado
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

/** Quem monta escala: administrador e gestor. */
function exigirGestao(array $u): void
{
    exigirPapel($u, ['admin', 'gestor']);
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
    if (!empty($u['empresa_id']) || !empty($u['colaborador_id'])) {
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
        'SELECT c.id AS colaborador_id, l.empresa_id
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
            SET empresa_id = ?, colaborador_id = ?, papel = \'colaborador\'
          WHERE id = ? AND empresa_id IS NULL')
        ->execute([$achado['empresa_id'], $achado['colaborador_id'], $u['id']]);

    registrar($u['id'], $achado['empresa_id'], 'vinculado_como_colaborador',
        ['colaborador' => $achado['colaborador_id']]);

    $u['empresa_id']     = $achado['empresa_id'];
    $u['colaborador_id'] = $achado['colaborador_id'];
    $u['papel']          = 'colaborador';
    return $u;
}

// -----------------------------------------------------------------------------
//  ISOLAMENTO ENTRE EMPRESAS
//  Estas funções existem para que nenhum endpoint precise lembrar do filtro.
//  Esquecer o filtro é o erro que vazaria dados de uma empresa para outra.
// -----------------------------------------------------------------------------

/** A loja pertence à empresa do usuário? Se não, aborta. */
function exigirLojaDaEmpresa(string $lojaId, array $u): void
{
    if (!ehUuid($lojaId)) {
        falhar('Loja inválida.');
    }
    $st = bd()->prepare('SELECT 1 FROM lojas WHERE id = ? AND empresa_id = ? LIMIT 1');
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
    $st = bd()->prepare(
        'SELECT 1 FROM colaboradores c
           JOIN lojas l ON l.id = c.loja_id
          WHERE c.id = ? AND l.empresa_id = ? LIMIT 1');
    $st->execute([$colabId, $u['empresa_id']]);
    if (!$st->fetchColumn()) {
        falhar('Colaborador não encontrado.', 404);
    }
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
    if ($emailBaixo !== '' && str_contains($baixa, $emailBaixo)) {
        return 'Não use o seu e-mail dentro da senha.';
    }
    $local = mb_strtolower(explode('@', $emailBaixo)[0] ?? '', 'UTF-8');
    if ($local !== '' && mb_strlen($local) >= 3 && str_contains($baixa, $local)) {
        return 'Não use o seu e-mail dentro da senha.';
    }
    foreach (['escala', 'farmacia', 'drogaria', '123456', 'senha', 'password', 'qwerty'] as $p) {
        if (str_contains($baixa, $p)) {
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
    $cabecalhos = implode("\r\n", [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . $config['email_remetente'],
        'Reply-To: ' . $config['email_remetente'],
    ]);
    try {
        return @mail($para, '=?UTF-8?B?' . base64_encode($assunto) . '?=', $corpoHtml, $cabecalhos);
    } catch (Throwable $e) {
        error_log('e-mail: ' . $e->getMessage());
        return false;
    }
}

function paginaBase(): string
{
    global $config;
    return rtrim($config['endereco_site'], '/');
}
