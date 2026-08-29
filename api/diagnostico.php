<?php
/**
 * DIAGNÓSTICO — descobre por que a API não está respondendo.
 *
 * Abra no navegador:  https://seudominio.com.br/api/diagnostico.php
 *
 * Devolve texto puro, sem depender de nada do sistema. Se esta página não
 * abrir, o problema é anterior ao código: PHP desligado, arquivo no lugar
 * errado ou .htaccess bloqueando.
 *
 * APAGUE ESTE ARQUIVO depois de resolver — ele revela detalhes do servidor.
 */

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

// Manda cada linha na hora. Se algum teste travar, tudo que ja foi
// apurado continua visivel em vez de perder a pagina inteira.
@ini_set('output_buffering', '0');
@ini_set('zlib.output_compression', '0');
while (ob_get_level()) { ob_end_flush(); }
ob_implicit_flush(true);

$falhas = [];
$avisos = [];

function ok($t)    { echo "  ok      $t\n"; }
function erro($t)  { global $falhas; $falhas[] = $t; echo "  FALHA   $t\n"; }
function aviso($t) { global $avisos; $avisos[] = $t; echo "  atencao $t\n"; }

echo "DIAGNOSTICO DO SISTEMA DE ESCALA\n";
echo str_repeat('=', 60) . "\n\n";

// -----------------------------------------------------------------
echo "1. PHP\n";
// -----------------------------------------------------------------
$v = PHP_VERSION;
echo "  versao instalada: $v\n";
if (version_compare($v, '7.4', '<')) {
    erro("PHP muito antigo. Suba para 8.0 ou mais no cPanel (Selecionar versao do PHP).");
} elseif (version_compare($v, '8.0', '<')) {
    aviso("PHP 7.4 funciona, mas 8.1+ e recomendado.");
} else {
    ok("versao adequada");
}

foreach (['pdo_mysql' => 'conexao com o banco',
          'mbstring'  => 'acentuacao',
          'json'      => 'formato das respostas',
          'openssl'   => 'geracao de tokens'] as $ext => $paraQue) {
    if (extension_loaded($ext)) ok("extensao $ext ($paraQue)");
    else erro("extensao $ext AUSENTE — necessaria para $paraQue");
}

if (function_exists('random_bytes')) ok('random_bytes disponivel');
else erro('random_bytes ausente — tokens nao podem ser gerados');

// -----------------------------------------------------------------
echo "\n2. Arquivos\n";
// -----------------------------------------------------------------
$precisa = ['comum.php', 'auth.php', 'dados.php', 'minha.php'];
foreach ($precisa as $arq) {
    $caminho = __DIR__ . '/' . $arq;
    if (!file_exists($caminho)) { erro("$arq nao encontrado em " . __DIR__); continue; }
    if (filesize($caminho) < 100) { erro("$arq esta vazio ou truncado (upload incompleto?)"); continue; }
    ok("$arq presente (" . number_format(filesize($caminho)) . " bytes)");
}

$cfg = __DIR__ . '/config.php';
if (!file_exists($cfg)) {
    erro("config.php NAO EXISTE. Copie config.exemplo.php para config.php e preencha.");
} else {
    ok('config.php presente');
}

// -----------------------------------------------------------------
echo "\n3. Configuracao\n";
// -----------------------------------------------------------------
$config = null;
if (file_exists($cfg)) {
    try {
        $config = require $cfg;
        if (!is_array($config)) {
            erro('config.php nao devolve um array. A primeira linha deve ser <?php return [');
        } else {
            foreach (['bd_host','bd_nome','bd_usuario','bd_senha','endereco_site','email_remetente'] as $c) {
                if (!array_key_exists($c, $config)) { erro("config.php sem a chave '$c'"); continue; }
                if ($c === 'bd_senha') { ok("$c preenchida (" . strlen($config[$c]) . " caracteres)"); continue; }
                if ($config[$c] === '' || strpos((string)$config[$c], 'SEU') === 0
                    || strpos((string)$config[$c], 'COLE') === 0) {
                    erro("$c ainda com o valor de exemplo: {$config[$c]}");
                } else {
                    ok("$c = {$config[$c]}");
                }
            }
        }
    } catch (Throwable $e) {
        erro('config.php com erro: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------
echo "\n4. Banco de dados\n";
// -----------------------------------------------------------------
if (is_array($config)) {
    try {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4',
            $config['bd_host'], $config['bd_nome']);
        $pdo = new PDO($dsn, $config['bd_usuario'], $config['bd_senha'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        ok('conectou no banco');

        $tabelas = ['empresas','usuarios','lojas','colaboradores',
                    'ausencias','escalas','registro_acoes','tentativas_login'];
        $existem = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($tabelas as $t) {
            if (in_array($t, $existem, true)) ok("tabela $t");
            else erro("tabela $t AUSENTE — rode mysql-schema.sql no phpMyAdmin");
        }

        // migração 002
        $colsUsuarios = $pdo->query('SHOW COLUMNS FROM usuarios')->fetchAll(PDO::FETCH_COLUMN);
        if (in_array('colaborador_id', $colsUsuarios, true)) ok('migracao 002 aplicada');
        else erro('migracao 002 NAO aplicada — rode migracao-002-colaborador.sql');

        $n = (int)$pdo->query('SELECT COUNT(*) FROM usuarios')->fetchColumn();
        echo "  usuarios cadastrados: $n\n";
        if ($n > 0) {
            $st = $pdo->query('SELECT email, email_confirmado,
                               token_confirmacao IS NOT NULL AS tem_token,
                               token_expira, criado_em
                               FROM usuarios ORDER BY criado_em DESC LIMIT 5');
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $u) {
                $conf = $u['email_confirmado'] ? 'CONFIRMADO' : 'aguardando confirmacao';
                $venc = '';
                if (!$u['email_confirmado'] && $u['token_expira']) {
                    $venc = (strtotime($u['token_expira']) < time())
                          ? ' — TOKEN VENCIDO' : ' — token valido ate ' . $u['token_expira'];
                }
                echo "    {$u['email']}: $conf$venc\n";
            }
        }
    } catch (PDOException $e) {
        erro('NAO conectou no banco: ' . $e->getMessage());
        echo "\n    Verifique no cPanel > Bancos de dados MySQL:\n";
        echo "    - o banco e o usuario existem com o prefixo da sua conta\n";
        echo "    - o usuario esta ligado ao banco com TODOS OS PRIVILEGIOS\n";
        echo "    - a senha no config.php e a mesma que voce gerou\n";
    }
}

// -----------------------------------------------------------------
echo "\n5. Sessao\n";
// -----------------------------------------------------------------
$dirSessao = session_save_path() ?: sys_get_temp_dir();
echo "  pasta de sessao: $dirSessao\n";
if (is_writable($dirSessao)) ok('pasta de sessao gravavel');
else erro('pasta de sessao NAO gravavel — o login nao vai se manter');

if (@session_start()) {
    ok('sessao iniciou');
    session_destroy();
} else {
    erro('sessao NAO iniciou');
}

// -----------------------------------------------------------------
echo "\n6. HTTPS e cabecalhos\n";
// -----------------------------------------------------------------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
      || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
if ($https) ok('acessado por HTTPS');
else erro('acessado por HTTP — o cookie de sessao exige HTTPS e o login nao vai funcionar');

echo "  servidor: " . ($_SERVER['SERVER_SOFTWARE'] ?? 'desconhecido') . "\n";
echo "  interface PHP: " . PHP_SAPI . "\n";

// O cabecalho X-CSRF precisa chegar. Em alguns servidores em modo CGI ele
// e removido, e af nenhuma gravacao funciona.
if (function_exists('apache_request_headers')) ok('apache_request_headers disponivel');
else aviso('apache_request_headers ausente (normal em CGI/FastCGI)');

// -----------------------------------------------------------------
echo "\n7. E-mail\n";
// -----------------------------------------------------------------
if (function_exists('mail')) {
    ok('funcao mail() existe');
    aviso('em hospedagem compartilhada o e-mail costuma demorar ou cair em spam');
} else {
    erro('funcao mail() desativada — confirme as contas pelo phpMyAdmin');
}

// -----------------------------------------------------------------
echo "\n8. Teste real da API\n";
// -----------------------------------------------------------------
$url = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost')
     . dirname($_SERVER['SCRIPT_NAME'] ?? '/api') . '/auth.php';
echo "  chamando: $url\n";

$servidorSimples = (PHP_SAPI === 'cli-server');
if ($servidorSimples) {
    aviso('servidor de desenvolvimento e de processo unico — auto-teste pulado');
    echo "  (na HostGator este teste roda normalmente)\n";
} elseif (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => '{"acao":"sessao"}',
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $resp = curl_exec($ch);
    $cod  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    echo "  codigo HTTP: $cod\n";
    if ($resp === false) {
        erro('nao conseguiu chamar a propria API');
    } else {
        $json = json_decode($resp, true);
        if ($json === null) {
            erro('a API NAO devolveu JSON — e esta a causa de "servidor respondeu algo inesperado"');
            echo "\n  ---- o que a API devolveu ----\n";
            echo "  " . str_replace("\n", "\n  ", substr(trim($resp), 0, 1200)) . "\n";
            echo "  ------------------------------\n";
            echo "\n  A mensagem acima e o erro de verdade. Se vier em branco,\n";
            echo "  veja o arquivo error_log nesta mesma pasta.\n";
        } else {
            ok('a API devolveu JSON valido');
            echo "  resposta: " . substr($resp, 0, 200) . "\n";
        }
    }
} else {
    aviso('curl ausente — nao deu para testar a API sozinho');
}

// -----------------------------------------------------------------
echo "\n9. Registro de erros\n";
// -----------------------------------------------------------------
foreach ([__DIR__ . '/error_log', dirname(__DIR__) . '/error_log'] as $log) {
    if (file_exists($log)) {
        echo "  encontrado: $log\n";
        $linhas = array_slice(file($log), -15);
        echo "  ---- ultimas linhas ----\n";
        foreach ($linhas as $l) echo "  " . rtrim($l) . "\n";
        echo "  ------------------------\n";
    }
}

// -----------------------------------------------------------------
echo "\n" . str_repeat('=', 60) . "\n";
if ($falhas) {
    echo "RESULTADO: " . count($falhas) . " problema(s) encontrado(s)\n\n";
    foreach ($falhas as $i => $f) echo "  " . ($i + 1) . ". $f\n";
} else {
    echo "RESULTADO: nenhum problema encontrado no servidor.\n";
    echo "Se o login ainda falhar, o problema esta no navegador —\n";
    echo "abra as ferramentas de desenvolvedor (F12), aba Rede, e tente entrar.\n";
}
if ($avisos) {
    echo "\nObservacoes:\n";
    foreach ($avisos as $a) echo "  - $a\n";
}
echo "\nApague este arquivo depois de resolver.\n";
