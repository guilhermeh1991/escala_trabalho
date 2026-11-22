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

/* RESUMO E VALIDAÇÃO DA ESCALA NO SERVIDOR
   O servidor revalida a grade, as ausências do banco, a continuidade do período
   anterior e as jornadas antes de gravar ou publicar. Contadores ou alertas
   enviados pelo navegador nunca são aceitos como prova de conformidade. */

/* Parâmetros que classificam ou afrouxam uma regra. Só valem vindos de
   lojas.parametros; se chegarem pelo payload, viram divergência registrada. */
const CHAVES_DE_REGRA = [
    'modelo', 'folgasSemana', 'cicloDomingo', 'maxSeq', 'minInterjornada', 'inicioSemana',
    'minCaixa', 'minBalcao', 'minFarma', 'minSubger', 'minDia',
    'minCaixaObrigatorio', 'minBalcaoObrigatorio', 'minFarmaObrigatorio',
    'minSubgerObrigatorio', 'minDiaObrigatorio', 'perfis', 'subgerFds',
];

/* Base declarada de uma regra. Nenhuma regra da casa é apresentada como
   exigência legal: quem decidiu fica explícito no alerta. */
const BASE_LEI = 'lei';
const BASE_CASA = 'politica-da-casa';

/** Piso obrigatório de uma função. Ausente devolve null: sem piso, só meta. */
function pisoObrigatorio(array $P, string $chaveMeta): ?int
{
    $chave = $chaveMeta . 'Obrigatorio';
    if (!isset($P[$chave]) || !is_numeric($P[$chave])) return null;
    return max(0, (int)$P[$chave]);
}

/** Perfis operacionais da loja, normalizados. Loja sem perfis devolve lista vazia. */
function perfisDaLoja(array $paramsLoja): array
{
    $brutos = is_array($paramsLoja['perfis'] ?? null) ? $paramsLoja['perfis'] : [];
    $saida = [];
    foreach ($brutos as $id => $perfil) {
        if (!is_array($perfil)) continue;
        $base = ($perfil['base'] ?? BASE_CASA) === BASE_LEI ? BASE_LEI : BASE_CASA;
        $saida[(string)$id] = [
            'id' => (string)$id,
            'nome' => (string)($perfil['nome'] ?? $id),
            'base' => $base,
            'regras' => is_array($perfil['regras'] ?? null) ? $perfil['regras'] : [],
        ];
    }
    return $saida;
}

/** Perfil aplicável a um colaborador, ou null quando a loja não definiu nenhum. */
function perfilDoColaborador(array $colab, array $perfis): ?array
{
    $id = (string)($colab['perfil'] ?? '');
    if ($id !== '' && isset($perfis[$id])) return $perfis[$id];
    return null;
}

function minutosDaHoraServidor(?string $hora): ?int
{
    if (!is_string($hora) || !preg_match('/^(\d{1,2}):(\d{2})$/', trim($hora), $m)) {
        return null;
    }
    $h = (int)$m[1];
    $min = (int)$m[2];
    return ($h >= 0 && $h < 24 && $min >= 0 && $min < 60) ? ($h * 60 + $min) : null;
}

function horaDosMinutosServidor(int $minutos): string
{
    $n = (($minutos % 1440) + 1440) % 1440;
    return sprintf('%02d:%02d', intdiv($n, 60), $n % 60);
}

function textoDuracaoServidor(int $minutos): string
{
    return intdiv($minutos, 60) . 'h' . sprintf('%02d', abs($minutos % 60));
}

function horasDaStringServidor($txt): array
{
    if (!is_string($txt) || $txt === '') return [];
    if (!preg_match_all('/\b(\d{1,2}:\d{2})\b/', $txt, $m)) return [];
    $out = [];
    foreach ($m[1] as $h) {
        $partes = explode(':', $h);
        $pad = sprintf('%02d:%02d', (int)$partes[0], (int)$partes[1]);
        if (minutosDaHoraServidor($pad) !== null) $out[] = $pad;
    }
    return $out;
}

function jornadaPadraoServidor(array $c): ?array
{
    $j = $c['jornada'] ?? null;
    if (is_string($j) && $j !== '') {
        $j = json_decode($j, true);
    }
    if (is_array($j)) {
        $ent = isset($j['entrada']) ? (string)$j['entrada'] : '';
        $sai = isset($j['saida']) ? (string)$j['saida'] : '';
        $hsE = horasDaStringServidor($ent);
        $hsS = horasDaStringServidor($sai);
        if ($hsE && $hsS) {
            return ['entrada' => $hsE[0], 'saida' => $hsS[0]];
        }
    }
    $horas = horasDaStringServidor((string)($c['horario'] ?? ''));
    if (count($horas) >= 2) {
        return ['entrada' => $horas[0], 'saida' => $horas[1]];
    }
    return null;
}

function entradaDoDiaServidor(array $c, int $i, array $horasMapa): ?string
{
    $cid = (string)($c['id'] ?? '');
    $porColab = $horasMapa[$cid] ?? [];
    $ajustada = is_array($porColab) ? ($porColab[(string)$i] ?? ($porColab[$i] ?? null)) : null;
    $hs = horasDaStringServidor($ajustada);
    if (count($hs) >= 1) return $hs[0];
    $j = jornadaPadraoServidor($c);
    return $j ? $j['entrada'] : null;
}

function fimDoDiaMinutosServidor(array $c, int $i, array $horasMapa): ?int
{
    $cid = (string)($c['id'] ?? '');
    $porColab = $horasMapa[$cid] ?? [];
    $ajustada = is_array($porColab) ? ($porColab[(string)$i] ?? ($porColab[$i] ?? null)) : null;
    $hs = horasDaStringServidor($ajustada);
    if (count($hs) >= 2) {
        $ini = minutosDaHoraServidor($hs[0]);
        $fim = minutosDaHoraServidor($hs[1]);
        if ($ini !== null && $fim !== null) {
            return $fim > $ini ? $fim : $fim + 1440;
        }
    }
    $j = jornadaPadraoServidor($c);
    if (!$j) return null;
    $ent = entradaDoDiaServidor($c, $i, $horasMapa);
    $iniPad = minutosDaHoraServidor($j['entrada']);
    $fimPad = minutosDaHoraServidor($j['saida']);
    $inicio = minutosDaHoraServidor($ent);
    if ($iniPad === null || $fimPad === null || $inicio === null) return null;
    $bruto = $fimPad - $iniPad;
    if ($bruto <= 0) $bruto += 1440;
    return $inicio + $bruto;
}

function listarDatasPeriodoServidor(string $inicio, string $fim): array
{
    if (!ehDataValida($inicio) || !ehDataValida($fim) || $fim < $inicio) return [];
    $out = [];
    $d = new DateTimeImmutable($inicio);
    $f = new DateTimeImmutable($fim);
    while ($d <= $f) {
        $out[] = $d;
        $d = $d->modify('+1 day');
        if (count($out) > 370) break;
    }
    return $out;
}

function semanasDoPeriodoServidor(array $days, $inicioSemana): array
{
    $N = count($days);
    $semanas = [];
    if ($inicioSemana === 'P') {
        for ($i = 0; $i < $N; $i += 7) {
            $fim = min($i + 6, $N - 1);
            $semanas[] = ['ini' => $i, 'fim' => $fim, 'dias' => range($i, $fim)];
        }
        return $semanas;
    }
    $iniSem = (int)$inicioSemana;
    $i = 0;
    while ($i < $N) {
        $j = $i;
        while ($j + 1 < $N && (int)$days[$j + 1]->format('w') !== $iniSem) {
            $j++;
        }
        $semanas[] = ['ini' => $i, 'fim' => $j, 'dias' => range($i, $j)];
        $i = $j + 1;
    }
    return $semanas;
}

function estadoFinalDaGradeServidor(array $grade, string $inicio, string $fim, array $horas = [], array $participantes = []): array
{
    $days = listarDatasPeriodoServidor($inicio, $fim);
    $N = count($days);
    if (!$N || !$grade) return [];
    $mapaPart = [];
    foreach ($participantes as $c) {
        if (is_array($c) && isset($c['id'])) {
            $mapaPart[(string)$c['id']] = $c;
        }
    }
    $ultIdx = $N - 1;
    $estado = [];
    foreach ($grade as $id => $arr) {
        if (!is_array($arr) || count($arr) < $N) continue;
        $diasDesdeFolga = 0;
        for ($i = $ultIdx; $i >= 0 && ($arr[$i] ?? null) === ''; $i--) {
            $diasDesdeFolga++;
        }
        $domTrabConsec = 0;
        for ($i = $ultIdx; $i >= 0; $i--) {
            if ((int)$days[$i]->format('w') !== 0) continue;
            if (($arr[$i] ?? null) === '') $domTrabConsec++;
            else break;
        }
        $trabalhouUlt = (($arr[$ultIdx] ?? null) === '');
        $info = [
            'diasDesdeFolga' => $diasDesdeFolga,
            'domTrabConsec' => $domTrabConsec,
            'trabalhouUltimoDia' => $trabalhouUlt,
            'dataUltimoDia' => $fim,
            'fimUltimoDiaMinutos' => null,
            'saidaUltimoDia' => null,
            'lacunaUltimoDia' => false,
        ];
        if ($trabalhouUlt) {
            $ficha = $mapaPart[(string)$id] ?? ['id' => (string)$id];
            $fimMin = fimDoDiaMinutosServidor($ficha, $ultIdx, $horas);
            if ($fimMin !== null) {
                $info['fimUltimoDiaMinutos'] = $fimMin;
                $info['saidaUltimoDia'] = horaDosMinutosServidor($fimMin);
            } else {
                $info['lacunaUltimoDia'] = true;
            }
        }
        $estado[(string)$id] = $info;
    }
    return $estado;
}

function grupoDeServidor(array $c): string
{
    if (!empty($c['gerente'])) return 'gerencia';
    $cargo = mb_strtoupper((string)($c['cargo'] ?? ''), 'UTF-8');
    if (strpos($cargo, 'CAIXA') !== false) return 'caixa';
    return 'balcao';
}

function ehFarmaServidor(array $c): bool
{
    $cargo = mb_strtoupper((string)($c['cargo'] ?? ''), 'UTF-8');
    return strpos($cargo, 'FARMA') !== false;
}

function ehSubgerServidor(array $c): bool
{
    $cargo = mb_strtoupper((string)($c['cargo'] ?? ''), 'UTF-8');
    return strpos($cargo, 'SUBGER') !== false || strpos($cargo, 'SUB/') === 0;
}

function validarEscalaServidor(string $lojaId, string $inicio, string $fim, array $grade, array $paramsRecebidos = [], ?array $snapshot = null): array
{
    $days = listarDatasPeriodoServidor($inicio, $fim);
    $N = count($days);
    $nomesDia = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    $paramsLoja = [];
    $mapaBanco = [];
    if (ehUuid($lojaId)) {
        try {
            $stL = bd()->prepare('SELECT parametros FROM lojas WHERE id = ? LIMIT 1');
            $stL->execute([$lojaId]);
            $rawP = $stL->fetchColumn();
            if (is_string($rawP) && $rawP !== '') {
                $dec = json_decode($rawP, true);
                if (is_array($dec)) $paramsLoja = $dec;
            }
            $temJornada = false;
            try {
                $stCol = bd()->query("SHOW COLUMNS FROM colaboradores LIKE 'jornada'");
                $temJornada = (bool)$stCol->fetch();
            } catch (Throwable $_e) {
                $temJornada = false;
            }
            $campoJornada = $temJornada ? 'jornada' : 'NULL AS jornada';
            $stC = bd()->prepare(
                "SELECT id, nome, cargo, horario, $campoJornada, gerente, ativo,
                        folga_fixa, primeiro_domingo, dias_desde_folga, ordem
                   FROM colaboradores WHERE loja_id = ? ORDER BY ordem"
            );
            $stC->execute([$lojaId]);
            $rowsC = $stC->fetchAll();
            $ausPorColab = [];
            if ($rowsC) {
                $cids = array_column($rowsC, 'id');
                $mrk = implode(',', array_fill(0, count($cids), '?'));
                $stA = bd()->prepare("SELECT colaborador_id, tipo, ini, fim FROM ausencias WHERE colaborador_id IN ($mrk)");
                $stA->execute($cids);
                foreach ($stA->fetchAll() as $a) {
                    $ausPorColab[$a['colaborador_id']][] = [
                        'tipo' => $a['tipo'], 'ini' => $a['ini'], 'fim' => $a['fim'],
                    ];
                }
            }
            foreach ($rowsC as $r) {
                $mapaBanco[(string)$r['id']] = [
                    'id' => (string)$r['id'],
                    'nome' => (string)$r['nome'],
                    'cargo' => (string)$r['cargo'],
                    'horario' => (string)($r['horario'] ?? ''),
                    'jornada' => $r['jornada'] ? json_decode((string)$r['jornada'], true) : null,
                    'gerente' => (bool)$r['gerente'],
                    'ativo' => (bool)$r['ativo'],
                    'folgaFixa' => $r['folga_fixa'] === null ? null : (int)$r['folga_fixa'],
                    'primeiroDomingo' => $r['primeiro_domingo'],
                    'diasDesdeFolga' => $r['dias_desde_folga'] === null ? null : (int)$r['dias_desde_folga'],
                    'ausencias' => $ausPorColab[$r['id']] ?? [],
                ];
            }
        } catch (Throwable $_e) {
            // Prossegue com dados da requisição se a consulta falhar fora de contexto transacional
        }
    }

    /* AUTORIDADE DAS REGRAS: o banco manda, o payload não.
       Tudo que classifica ou afrouxa uma regra (modelo, mínimos, tetos, perfis)
       sai exclusivamente de lojas.parametros. Do payload aproveitamos apenas o
       que é dado da escala em edição e não enfraquece bloqueio: os ajustes de
       hora por dia. Divergências entre o que o cliente mandou e o que o banco
       guarda viram observação, nunca permissão. */
    $P = $paramsLoja;
    $divergencias = [];
    foreach (CHAVES_DE_REGRA as $chave) {
        if (!array_key_exists($chave, $paramsRecebidos)) continue;
        $doBanco = $paramsLoja[$chave] ?? null;
        if (json_encode($paramsRecebidos[$chave]) !== json_encode($doBanco)) {
            $divergencias[] = $chave;
        }
    }
    if (is_array($paramsRecebidos['_horas'] ?? null)) {
        $P['_horas'] = $paramsRecebidos['_horas'];
    }
    $perfis = perfisDaLoja($paramsLoja);
    $modelo = in_array($P['modelo'] ?? '5x2', ['5x2', '6x1'], true) ? (string)$P['modelo'] : '5x2';
    $folgasSemana = isset($P['folgasSemana']) && is_numeric($P['folgasSemana'])
        ? max(1, (int)$P['folgasSemana'])
        : ($modelo === '6x1' ? 1 : 2);
    $cicloDomingo = isset($P['cicloDomingo']) && is_numeric($P['cicloDomingo']) ? max(1, (int)$P['cicloDomingo']) : 3;
    $maxSeq = isset($P['maxSeq']) && is_numeric($P['maxSeq']) ? max(1, (int)$P['maxSeq']) : 6;
    $minInterjornada = isset($P['minInterjornada']) && is_numeric($P['minInterjornada']) ? max(1, (int)$P['minInterjornada']) : 660;
    $inicioSemana = ($P['inicioSemana'] ?? 0) === 'P' ? 'P' : (int)($P['inicioSemana'] ?? 0);
    $minCaixa = isset($P['minCaixa']) && is_numeric($P['minCaixa']) ? max(0, (int)$P['minCaixa']) : 0;
    $minBalcao = isset($P['minBalcao']) && is_numeric($P['minBalcao']) ? max(0, (int)$P['minBalcao']) : 0;
    $minFarma = isset($P['minFarma']) && is_numeric($P['minFarma']) ? max(0, (int)$P['minFarma']) : 0;
    $minSubger = isset($P['minSubger']) && is_numeric($P['minSubger']) ? max(0, (int)$P['minSubger']) : 0;
    $minDia = is_array($P['minDia'] ?? null) ? $P['minDia'] : [];

    /* PISOS OBRIGATÓRIOS POR LOJA E FUNÇÃO
       Os valores acima continuam sendo metas: faltar contra eles é aviso. Um piso
       só existe quando a loja o definiu explicitamente; ausente, nada vira
       bloqueio e a configuração anterior segue valendo como estava. */
    $pisoCaixa = pisoObrigatorio($P, 'minCaixa');
    $pisoBalcao = pisoObrigatorio($P, 'minBalcao');
    $pisoFarma = pisoObrigatorio($P, 'minFarma');
    $pisoSubger = pisoObrigatorio($P, 'minSubger');
    $pisoDia = is_array($P['minDiaObrigatorio'] ?? null) ? $P['minDiaObrigatorio'] : [];

    $horasMapa = is_array($P['_horas'] ?? null)
        ? $P['_horas']
        : (is_array($snapshot['horas'] ?? null) ? $snapshot['horas'] : []);

    $estadoAnterior = [];
    if (ehUuid($lojaId) && ehDataValida($inicio)) {
        try {
            $stAnt = bd()->prepare(
                'SELECT v.inicio, v.fim, v.grade, v.parametros, v.snapshot
                   FROM escalas e
                   JOIN escala_versoes v ON v.escala_id = e.id AND v.versao = e.versao
                  WHERE e.loja_id = ? AND e.fim = DATE_SUB(?, INTERVAL 1 DAY)
                  ORDER BY v.versao DESC LIMIT 1'
            );
            $stAnt->execute([$lojaId, $inicio]);
            if ($ant = $stAnt->fetch()) {
                $gAnt = json_decode((string)$ant['grade'], true) ?: [];
                $pAnt = $ant['parametros'] ? (json_decode((string)$ant['parametros'], true) ?: []) : [];
                $sAnt = $ant['snapshot'] ? (json_decode((string)$ant['snapshot'], true) ?: []) : [];
                $hAnt = is_array($pAnt['_horas'] ?? null) ? $pAnt['_horas'] : (is_array($sAnt['horas'] ?? null) ? $sAnt['horas'] : []);
                $partAnt = is_array($sAnt['participantes'] ?? null) && $sAnt['participantes']
                    ? $sAnt['participantes']
                    : array_values($mapaBanco);
                $estadoAnterior = estadoFinalDaGradeServidor($gAnt, (string)$ant['inicio'], (string)$ant['fim'], $hAnt, $partAnt);
            }
        } catch (Throwable $_e) {
            $estadoAnterior = [];
        }
    }

    $mapaSnap = [];
    if (is_array($snapshot['participantes'] ?? null)) {
        foreach ($snapshot['participantes'] as $sp) {
            if (is_array($sp) && isset($sp['id'])) {
                $mapaSnap[(string)$sp['id']] = $sp;
            }
        }
    }

    $participantes = [];
    foreach ($grade as $cidKey => $_linha) {
        $cid = (string)$cidKey;
        $b = $mapaBanco[$cid] ?? null;
        $s = $mapaSnap[$cid] ?? null;
        if ($b && $s) {
            $ausMerged = $b['ausencias'];
            if (is_array($s['ausencias'] ?? null)) {
                foreach ($s['ausencias'] as $as) {
                    if (is_array($as) && !empty($as['ini']) && !empty($as['tipo'])) {
                        $ausMerged[] = $as;
                    }
                }
            }
            $participantes[$cid] = array_merge($s, $b, [
                'horario' => ($b['horario'] !== '' ? $b['horario'] : ($s['horario'] ?? '')),
                'jornada' => $b['jornada'] ?: ($s['jornada'] ?? null),
                'ausencias' => $ausMerged,
            ]);
        } elseif ($b) {
            $participantes[$cid] = $b;
        } elseif ($s) {
            $participantes[$cid] = array_merge([
                'id' => $cid, 'nome' => (string)($s['nome'] ?? $cid), 'cargo' => (string)($s['cargo'] ?? 'BALCONISTA'),
                'horario' => (string)($s['horario'] ?? ''), 'jornada' => $s['jornada'] ?? null,
                'gerente' => !empty($s['gerente']), 'ativo' => ($s['ativo'] ?? true) !== false,
                'ausencias' => is_array($s['ausencias'] ?? null) ? $s['ausencias'] : [],
            ], $s);
        } else {
            $participantes[$cid] = [
                'id' => $cid, 'nome' => $cid, 'cargo' => 'BALCONISTA',
                'horario' => '', 'jornada' => null, 'gerente' => false, 'ativo' => true, 'ausencias' => [],
            ];
        }
    }

    $semanas = semanasDoPeriodoServidor($days, $inicioSemana);
    $codigosValidos = ['', 'X', 'FC', 'F', 'AT', 'LC'];
    $alertas = [];

    foreach ($participantes as $cid => $c) {
        if (($c['ativo'] ?? true) === false) continue;
        $nome = (string)($c['nome'] ?? $cid);
        $arr = $grade[$cid] ?? null;
        if (!is_array($arr) || count($arr) !== $N) {
            $alertas[] = [
                'colab' => $nome, 'tipo' => 'grade-invalida', 'categoria' => 'obrigatoria',
                'obrigatoria' => true, 'nivel' => 'regra',
                'txt' => !is_array($arr)
                    ? 'Colaborador sem linha correspondente na grade'
                    : 'Linha da grade com ' . count($arr) . ' dia(s), esperado ' . $N,
            ];
            continue;
        }

        $ausencias = is_array($c['ausencias'] ?? null) ? $c['ausencias'] : [];
        foreach ($days as $i => $d) {
            $cod = (string)($arr[$i] ?? '');
            if (!in_array($cod, $codigosValidos, true)) {
                $alertas[] = [
                    'colab' => $nome, 'tipo' => 'grade-invalida', 'categoria' => 'obrigatoria',
                    'obrigatoria' => true, 'nivel' => 'regra', 'dia' => $i,
                    'txt' => 'Código inválido "' . $cod . '" em ' . $d->format('d/m'),
                ];
            }
            $dt = $d->format('Y-m-d');
            $tiposDia = [];
            foreach ($ausencias as $a) {
                if (!is_array($a) || empty($a['ini']) || empty($a['tipo'])) continue;
                $fimAus = !empty($a['fim']) ? (string)$a['fim'] : (string)$a['ini'];
                if ((string)$a['ini'] <= $dt && $dt <= $fimAus) {
                    $tiposDia[] = (string)$a['tipo'];
                }
            }
            if ($tiposDia && !in_array($cod, $tiposDia, true)) {
                $alertas[] = [
                    'colab' => $nome, 'tipo' => 'ausencia', 'categoria' => 'obrigatoria',
                    'obrigatoria' => true, 'nivel' => 'regra', 'dia' => $i,
                    'txt' => 'Ausência (' . implode('/', array_unique($tiposDia)) . ') em ' . $d->format('d/m')
                           . ' foi sobrescrita por "' . ($cod !== '' ? $cod : 'trabalho') . '"',
                ];
            }
        }

        $ehFolga = function (int $idx) use ($arr, $N): bool {
            if ($idx < 0 || $idx >= $N) return false;
            return in_array((string)($arr[$idx] ?? ''), ['X', 'F', 'FC', 'AT', 'LC'], true);
        };

        /* Perfil operacional da pessoa. A folga de fim de semana do gerente é
           política da casa, não exigência legal: quando a loja define perfis, os
           dias vêm do perfil; sem perfis definidos, mantém-se sábado e domingo,
           como nas lojas já configuradas. */
        $perfil = perfilDoColaborador($c, $perfis);
        $regrasPerfil = $perfil['regras'] ?? [];
        $baseFolgaFds = $perfil['base'] ?? BASE_CASA;
        $nomePerfil = $perfil['nome'] ?? 'gerente (padrão da casa)';
        $diasFolgaPerfil = is_array($regrasPerfil['folgaFixaSemanal'] ?? null)
            ? array_map('intval', $regrasPerfil['folgaFixaSemanal'])
            : (!empty($c['gerente']) ? [0, 6] : []);

        if ($diasFolgaPerfil) {
            foreach ($days as $i => $d) {
                $wd = (int)$d->format('w');
                if (in_array($wd, $diasFolgaPerfil, true) && !$ehFolga($i)) {
                    $alertas[] = [
                        'colab' => $nome, 'tipo' => 'perfil-folga-fixa', 'categoria' => 'obrigatoria',
                        'obrigatoria' => true, 'nivel' => 'regra', 'dia' => $i,
                        'perfil' => $perfil['id'] ?? 'gerente',
                        'base' => $baseFolgaFds,
                        'txt' => 'Perfil "' . $nomePerfil . '" prevê folga em ' . $nomesDia[$wd]
                               . ', mas a pessoa está escalada em ' . $d->format('d/m'),
                    ];
                }
            }
        } else {
            // 1) Folgas por semana
            foreach ($semanas as $s) {
                if (count($s['dias']) < 7) continue;
                $nFolgas = 0;
                $ferias = 0;
                $domFolga = false;
                foreach ($s['dias'] as $idxDia) {
                    $cod = (string)($arr[$idxDia] ?? '');
                    if ($cod === 'X' || $cod === 'FC') {
                        $nFolgas++;
                        if ((int)$days[$idxDia]->format('w') === 0) $domFolga = true;
                    } elseif (in_array($cod, ['F', 'AT', 'LC'], true)) {
                        $ferias++;
                    }
                }
                if ($ferias >= 5) continue;
                if (($nFolgas + min($ferias, $folgasSemana)) < $folgasSemana) {
                    $alertas[] = [
                        'colab' => $nome, 'tipo' => 'folgas-semana', 'categoria' => 'obrigatoria',
                        'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_LEI,
                        'txt' => 'Semana de ' . $days[$s['ini']]->format('d/m') . ': ' . $nFolgas . ' folga(s), mínimo ' . $folgasSemana,
                    ];
                }
                if ($modelo === '6x1' && $ferias < 4 && $domFolga && $nFolgas < 2) {
                    $alertas[] = [
                        'colab' => $nome, 'tipo' => '6x1-domingo', 'categoria' => 'obrigatoria',
                        'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_CASA,
                        'txt' => 'Semana de ' . $days[$s['ini']]->format('d/m') . ': folgou no domingo do ciclo mas ficou sem a folga semanal do 6x1 (política da casa)',
                    ];
                }
            }

            // 2) Sequência máxima de dias seguidos trabalhados
            $estAnt = $estadoAnterior[$cid] ?? [];
            $seq = isset($estAnt['diasDesdeFolga'])
                ? (int)$estAnt['diasDesdeFolga']
                : (isset($c['diasDesdeFolga']) && $c['diasDesdeFolga'] !== null && $c['diasDesdeFolga'] !== '' ? (int)$c['diasDesdeFolga'] : 0);
            $pior = 0;
            $quando = null;
            foreach ($days as $i => $d) {
                if ($ehFolga($i)) {
                    $seq = 0;
                    continue;
                }
                $seq++;
                if ($seq > $pior) {
                    $pior = $seq;
                    $quando = $d;
                }
            }
            if ($pior > $maxSeq && $quando !== null) {
                $alertas[] = [
                    'colab' => $nome, 'tipo' => 'sequencia', 'categoria' => 'obrigatoria',
                    'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_LEI,
                    'txt' => $pior . ' dias seguidos sem folga (até ' . $quando->format('d/m') . '), máximo ' . $maxSeq,
                ];
            }

            // 3) Domingos seguidos trabalhados
            $corrida = isset($estAnt['domTrabConsec'])
                ? (int)$estAnt['domTrabConsec']
                : (isset($c['domTrabConsec']) && is_numeric($c['domTrabConsec']) ? (int)$c['domTrabConsec'] : 0);
            $avisouDom = false;
            foreach ($days as $i => $d) {
                if ((int)$d->format('w') !== 0) continue;
                if ((string)($arr[$i] ?? '') === '') {
                    $corrida++;
                    if ($corrida > $cicloDomingo - 1 && !$avisouDom) {
                        $alertas[] = [
                            'colab' => $nome, 'tipo' => 'domingo', 'categoria' => 'obrigatoria',
                            'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_LEI,
                            'txt' => $corrida . ' domingos seguidos trabalhados até ' . $d->format('d/m') . ' — máximo configurado ' . ($cicloDomingo - 1),
                        ];
                        $avisouDom = true;
                    }
                } else {
                    $corrida = 0;
                    $avisouDom = false;
                }
            }

            // 3b) Dia de folga fixa (preferência)
            if (isset($c['folgaFixa']) && $c['folgaFixa'] !== null && $c['folgaFixa'] !== '') {
                $diaFixo = (int)$c['folgaFixa'];
                foreach ($semanas as $s2) {
                    if (count($s2['dias']) < 7) continue;
                    $cabe = [];
                    foreach ($s2['dias'] as $idxDia) {
                        if ((int)$days[$idxDia]->format('w') === $diaFixo && !in_array((string)$arr[$idxDia], ['F', 'AT', 'LC'], true)) {
                            $cabe[] = $idxDia;
                        }
                    }
                    if (!$cabe) continue;
                    $folgou = false;
                    foreach ($cabe as $idxDia) {
                        if (in_array((string)$arr[$idxDia], ['X', 'FC'], true)) $folgou = true;
                    }
                    if (!$folgou) {
                        $alertas[] = [
                            'colab' => $nome, 'tipo' => 'dia-fixo', 'categoria' => 'preferencia',
                            'obrigatoria' => false, 'nivel' => 'regra',
                            'txt' => 'Preferência de folga fixa em ' . $nomesDia[$diaFixo] . ': a semana de ' . $days[$s2['ini']]->format('d/m') . ' não teve folga nesse dia',
                        ];
                    }
                }
            }

            // 4) Folgas isoladas no 5x2 (preferência / observação)
            if ($modelo !== '6x1') {
                $semanaParcial = [];
                foreach ($semanas as $s2) {
                    if (count($s2['dias']) < 7) {
                        foreach ($s2['dias'] as $idxDia) $semanaParcial[$idxDia] = true;
                    }
                }
                for ($i = 0; $i < $N; $i++) {
                    if ((string)$arr[$i] !== 'X' || isset($semanaParcial[$i])) continue;
                    $antes = $i > 0 && $ehFolga($i - 1);
                    $depois = $i < $N - 1 && $ehFolga($i + 1);
                    if ($antes || $depois || (int)$days[$i]->format('w') === 0) continue;
                    $temPar = false;
                    foreach ($semanas as $s2) {
                        if ($i >= $s2['ini'] && $i <= $s2['fim']) {
                            foreach ($s2['dias'] as $k) {
                                if ((string)$arr[$k] === 'X' && ($ehFolga($k + 1) || $ehFolga($k - 1))) {
                                    $temPar = true;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    if ($temPar) {
                        $alertas[] = [
                            'colab' => $nome, 'tipo' => 'avulsa', 'categoria' => 'observacao',
                            'obrigatoria' => false, 'nivel' => 'nota',
                            'txt' => $days[$i]->format('d/m') . ' (' . $nomesDia[(int)$days[$i]->format('w')] . ') é folga avulsa — a semana já tem o par',
                        ];
                    } else {
                        $alertas[] = [
                            'colab' => $nome, 'tipo' => 'isolada', 'categoria' => 'preferencia',
                            'obrigatoria' => false, 'nivel' => 'regra',
                            'txt' => 'Preferência 5x2: folga isolada em ' . $days[$i]->format('d/m') . ' e a semana não tem par de folgas',
                        ];
                    }
                }
            }
        }

        // 5) Descanso entre jornadas (obrigatória) e jornadas incompletas (lacuna)
        $estAnt = $estadoAnterior[$cid] ?? [];
        $trabalhouUltAnt = !empty($estAnt['trabalhouUltimoDia']) || !empty($c['trabalhouUltimoDia'])
            || isset($estAnt['fimUltimoDiaMinutos']) || isset($c['fimUltimoDiaMinutos']);
        $fimUltAnt = $estAnt['fimUltimoDiaMinutos'] ?? ($c['fimUltimoDiaMinutos'] ?? null);
        $saidaUltAnt = $estAnt['saidaUltimoDia'] ?? ($c['saidaUltimoDia'] ?? ($fimUltAnt !== null ? horaDosMinutosServidor((int)$fimUltAnt) : null));
        $dataUltAnt = $estAnt['dataUltimoDia'] ?? ($c['dataUltimoDia'] ?? 'período anterior');

        if ($N > 0 && (string)$arr[0] === '' && $trabalhouUltAnt) {
            $ent0 = entradaDoDiaServidor($c, 0, $horasMapa);
            $ent0Min = minutosDaHoraServidor($ent0);
            if ($fimUltAnt !== null && $ent0Min !== null) {
                $descanso0 = $ent0Min + 1440 - (int)$fimUltAnt;
                if ($descanso0 < $minInterjornada) {
                    $liberado0 = horaDosMinutosServidor((int)$fimUltAnt + $minInterjornada);
                    $alertas[] = [
                        'colab' => $nome, 'tipo' => 'interjornada', 'categoria' => 'obrigatoria',
                        'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_LEI,
                        'dia' => 0, 'transicaoPeriodo' => true,
                        'txt' => 'Sai ' . $saidaUltAnt . ' no fim do período anterior (' . $dataUltAnt . ') e entra ' . $ent0 . ' em ' . $days[0]->format('d/m') . ': ' . textoDuracaoServidor($descanso0) . ' de descanso, mínimo 11h (só pode entrar a partir das ' . $liberado0 . ')',
                    ];
                }
            } else {
                $alertas[] = [
                    'colab' => $nome, 'tipo' => 'jornada-incompleta', 'categoria' => 'observacao',
                    'obrigatoria' => false, 'nivel' => 'nota', 'dia' => 0, 'lacuna' => true, 'transicaoPeriodo' => true,
                    'txt' => 'Lacuna na passagem de período em ' . $days[0]->format('d/m') . ': trabalhou no último dia do período anterior, mas falta horário completo de saída/entrada para conferir o descanso de 11h',
                ];
            }
        }

        $diasSemJornadaCompleta = 0;
        $paresSemVerificacao = 0;
        for ($i = 0; $i < $N; $i++) {
            if ((string)$arr[$i] !== '') continue;
            if (entradaDoDiaServidor($c, $i, $horasMapa) === null || fimDoDiaMinutosServidor($c, $i, $horasMapa) === null) {
                $diasSemJornadaCompleta++;
            }
        }
        for ($i = 0; $i < $N - 1; $i++) {
            if ((string)$arr[$i] !== '' || (string)$arr[$i + 1] !== '') continue;
            $fimI = fimDoDiaMinutosServidor($c, $i, $horasMapa);
            $entSeg = entradaDoDiaServidor($c, $i + 1, $horasMapa);
            $entSegMin = minutosDaHoraServidor($entSeg);
            if ($fimI === null || $entSegMin === null) {
                $paresSemVerificacao++;
                continue;
            }
            $descanso = $entSegMin + 1440 - $fimI;
            if ($descanso < $minInterjornada) {
                $liberado = horaDosMinutosServidor($fimI + $minInterjornada);
                $saidaI = horaDosMinutosServidor($fimI);
                $alertas[] = [
                    'colab' => $nome, 'tipo' => 'interjornada', 'categoria' => 'obrigatoria',
                    'obrigatoria' => true, 'nivel' => 'regra', 'base' => BASE_LEI, 'dia' => $i + 1,
                    'txt' => 'Sai ' . $saidaI . ' em ' . $days[$i]->format('d/m') . ' e entra ' . $entSeg . ' em ' . $days[$i + 1]->format('d/m') . ': ' . textoDuracaoServidor($descanso) . ' de descanso, mínimo 11h (só pode entrar a partir das ' . $liberado . ')',
                ];
            }
        }
        if ($diasSemJornadaCompleta > 0) {
            $alertas[] = [
                'colab' => $nome, 'tipo' => 'jornada-incompleta', 'categoria' => 'observacao',
                'obrigatoria' => false, 'nivel' => 'nota', 'lacuna' => true,
                'txt' => 'Jornada incompleta (sem entrada e saída completas) em ' . $diasSemJornadaCompleta . ' dia(s) trabalhado(s)'
                       . ($paresSemVerificacao > 0 ? ' — descanso de 11h não pôde ser conferido em ' . $paresSemVerificacao . ' passagem(ns) de turno' : ''),
            ];
        }
    }

    // 6) Cobertura diária (separa demanda configurada de disponibilidade)
    $ativosParticipantes = array_values(array_filter($participantes, function ($c) {
        return ($c['ativo'] ?? true) !== false;
    }));
    foreach ($days as $i => $d) {
        $cx = 0; $bl = 0; $gr = 0; $fa = 0; $sg = 0;
        $cxDisp = 0; $blDisp = 0; $faDisp = 0; $sgDisp = 0; $totDisp = 0;
        foreach ($ativosParticipantes as $c) {
            $cid = (string)$c['id'];
            $arr = $grade[$cid] ?? null;
            if (!is_array($arr) || !array_key_exists($i, $arr)) continue;
            $cod = (string)$arr[$i];
            $trabalha = ($cod === '');
            $disponivel = !in_array($cod, ['F', 'AT', 'LC'], true);
            $grupo = grupoDeServidor($c);
            if ($trabalha) {
                if ($grupo === 'caixa') $cx++;
                elseif ($grupo === 'gerencia') $gr++;
                else $bl++;
                if (ehFarmaServidor($c)) $fa++;
                if (ehSubgerServidor($c)) $sg++;
            }
            if ($disponivel) {
                $totDisp++;
                if ($grupo === 'caixa') $cxDisp++;
                elseif ($grupo !== 'gerencia') $blDisp++;
                if (ehFarmaServidor($c)) $faDisp++;
                if (ehSubgerServidor($c)) $sgDisp++;
            }
        }
        $total = $cx + $bl + $gr;
        $falta = [];
        $leve = [];
        $impedimentos = [];

        if ($minCaixa > 0 && $cx < $minCaixa) {
            $imp = $cxDisp < $minCaixa;
            $msg = $imp ? "caixa {$cx}/{$minCaixa} (impedimento: {$cxDisp} disponível(is))" : "caixa {$cx}/{$minCaixa}";
            $falta[] = $msg;
            if ($imp) $impedimentos[] = $msg;
        }
        if ($minBalcao > 0 && $bl < $minBalcao) {
            $imp = $blDisp < $minBalcao;
            $msg = $imp ? "balcão {$bl}/{$minBalcao} (impedimento: {$blDisp} disponível(is))" : "balcão {$bl}/{$minBalcao}";
            $falta[] = $msg;
            if ($imp) $impedimentos[] = $msg;
        }
        if ($minFarma > 0 && $fa < 1) {
            $imp = $faDisp < 1;
            $msg = $imp ? "SEM farmacêutico (impedimento: 0 disponíveis para demanda de {$minFarma})" : 'SEM farmacêutico';
            $falta[] = $msg;
            if ($imp) $impedimentos[] = $msg;
        } elseif ($minFarma > 0 && $fa < $minFarma) {
            $imp = $faDisp < $minFarma;
            $leve[] = $imp ? "farmacêutico {$fa}/{$minFarma} (disponíveis: {$faDisp})" : "farmacêutico {$fa}/{$minFarma}";
        }
        if ($minSubger > 0 && $sg < $minSubger) {
            $imp = $sgDisp < $minSubger;
            $msg = $imp ? "subgerente {$sg}/{$minSubger} (impedimento: {$sgDisp} disponível(is))" : "subgerente {$sg}/{$minSubger}";
            $falta[] = $msg;
            if ($imp) $impedimentos[] = $msg;
        }
        $wd = (int)$d->format('w');
        $alvoDiaSem = isset($minDia[$wd]) ? (int)$minDia[$wd] : (isset($minDia[(string)$wd]) ? (int)$minDia[(string)$wd] : 0);
        if ($alvoDiaSem > 0 && $total < $alvoDiaSem) {
            $imp = $totDisp < $alvoDiaSem;
            $msg = $imp ? "equipe {$total}/{$alvoDiaSem} (impedimento: {$totDisp} disponível(is))" : "equipe {$total}/{$alvoDiaSem}";
            $falta[] = $msg;
            if ($imp) $impedimentos[] = $msg;
        }
        /* PISOS OBRIGATÓRIOS: só existem onde a loja definiu. Faltar contra o
           piso bloqueia a publicação; faltar contra a meta continua aviso.
           Quando não há gente disponível, o dia é impedimento operacional e não
           falha da escala — não bloqueia, mas fica registrado. */
        $pisos = [
            ['piso' => $pisoCaixa, 'tem' => $cx, 'disp' => $cxDisp, 'rotulo' => 'caixa'],
            ['piso' => $pisoBalcao, 'tem' => $bl, 'disp' => $blDisp, 'rotulo' => 'balcão'],
            ['piso' => $pisoFarma, 'tem' => $fa, 'disp' => $faDisp, 'rotulo' => 'farmacêutico'],
            ['piso' => $pisoSubger, 'tem' => $sg, 'disp' => $sgDisp, 'rotulo' => 'subgerente'],
        ];
        $wdPiso = (int)$d->format('w');
        $pisoDiaSem = isset($pisoDia[$wdPiso]) ? (int)$pisoDia[$wdPiso]
            : (isset($pisoDia[(string)$wdPiso]) ? (int)$pisoDia[(string)$wdPiso] : null);
        if ($pisoDiaSem !== null) {
            $pisos[] = ['piso' => $pisoDiaSem, 'tem' => $total, 'disp' => $totDisp, 'rotulo' => 'equipe'];
        }
        foreach ($pisos as $p) {
            if ($p['piso'] === null || $p['piso'] <= 0 || $p['tem'] >= $p['piso']) continue;
            $impossivel = $p['disp'] < $p['piso'];
            $alertas[] = [
                'colab' => '—', 'tipo' => 'cobertura-minima',
                'categoria' => $impossivel ? 'observacao' : 'obrigatoria',
                'obrigatoria' => !$impossivel,
                'impedimento' => $impossivel,
                'nivel' => $impossivel ? 'nota' : 'regra',
                'base' => BASE_CASA, 'dia' => $i,
                'txt' => $d->format('d/m') . ': ' . $p['rotulo'] . ' ' . $p['tem'] . '/' . $p['piso']
                       . ($impossivel
                           ? ' — mínimo obrigatório não alcançável (' . $p['disp'] . ' disponível(is))'
                           : ' — abaixo do mínimo obrigatório da loja'),
            ];
        }

        if (count($ativosParticipantes) > 0 && $total === 0) {
            $msg = 'loja sem ninguém escalado';
            if (!in_array($msg, $falta, true)) $falta[] = $msg;
            $alertas[] = [
                'colab' => '—', 'tipo' => 'loja-vazia', 'categoria' => 'obrigatoria',
                'obrigatoria' => true, 'impedimento' => ($totDisp === 0), 'nivel' => 'regra', 'dia' => $i,
                'base' => BASE_CASA,
                'txt' => $d->format('d/m') . ': ' . $msg . ($totDisp === 0 ? ' (impedimento: 0 disponíveis)' : ''),
            ];
        }
        if ($falta) {
            $alertas[] = [
                'colab' => '—', 'tipo' => 'cobertura', 'categoria' => 'preferencia',
                'obrigatoria' => false, 'impedimento' => count($impedimentos) > 0, 'nivel' => 'regra', 'dia' => $i,
                'txt' => $d->format('d/m') . ': ' . implode(', ', $falta),
            ];
        }
        if ($leve) {
            $alertas[] = [
                'colab' => '—', 'tipo' => 'cobertura-leve', 'categoria' => 'observacao',
                'obrigatoria' => false, 'nivel' => 'nota', 'dia' => $i,
                'txt' => $d->format('d/m') . ': ' . implode(', ', $leve) . ' (tolerado)',
            ];
        }
    }

    /* DIVERGÊNCIA DE PARÂMETROS: o cliente mandou regra diferente da que o banco
       guarda. A regra do banco prevaleceu; o fato fica registrado para auditoria
       e aparece como observação, nunca como permissão. */
    foreach ($divergencias as $chave) {
        $alertas[] = [
            'colab' => '—', 'tipo' => 'parametro-divergente', 'categoria' => 'observacao',
            'obrigatoria' => false, 'nivel' => 'nota', 'base' => BASE_CASA,
            'txt' => 'Parâmetro "' . $chave . '" enviado pelo navegador difere do configurado na loja; '
                   . 'a validação usou o valor configurado.',
        ];
    }

    $obrigatorias = array_values(array_filter($alertas, function ($a) { return !empty($a['obrigatoria']); }));
    $preferencias = array_values(array_filter($alertas, function ($a) { return empty($a['obrigatoria']) && ($a['nivel'] ?? '') !== 'nota'; }));
    $observacoes = array_values(array_filter($alertas, function ($a) { return ($a['nivel'] ?? '') === 'nota'; }));
    $impedimentos = array_values(array_filter($alertas, function ($a) { return !empty($a['impedimento']); }));
    $lacunas = array_values(array_filter($alertas, function ($a) { return !empty($a['lacuna']); }));

    /* COBERTURA DA VALIDAÇÃO: sem os dados, uma regra não foi conferida — e não
       conferir não é o mesmo que estar conforme. Cada lacuna é nomeada para que
       a tela e os testes distingam "sem problema" de "não deu para verificar". */
    $naoVerificadas = [];
    if (!$mapaBanco) {
        $naoVerificadas[] = [
            'regra' => 'ausencias-e-cadastro',
            'txt' => 'Equipe não lida do banco nesta validação: ausências, cargos e perfis não foram conferidos.',
        ];
    }
    if (count($lacunas) > 0) {
        $naoVerificadas[] = [
            'regra' => 'interjornada',
            'txt' => count($lacunas) . ' jornada(s) sem entrada e saída completas: o descanso de 11h não pôde ser conferido nesses dias.',
        ];
    }
    if (!$paramsLoja) {
        $naoVerificadas[] = [
            'regra' => 'parametros-da-loja',
            'txt' => 'Loja sem parâmetros salvos: mínimos e perfis foram tratados pelos padrões do sistema.',
        ];
    }
    $validacaoParcial = count($naoVerificadas) > 0;

    $folgasTotais = 0;
    foreach ($grade as $linha) {
        if (!is_array($linha)) continue;
        foreach ($linha as $cod) {
            if ($cod === 'X' || $cod === 'FC') $folgasTotais++;
        }
    }
    $ajustesTotais = 0;
    foreach ($horasMapa as $porPessoa) {
        if (is_array($porPessoa)) $ajustesTotais += count($porPessoa);
    }

    return [
        'alertas' => $alertas,
        'obrigatorias' => $obrigatorias,
        'preferencias' => $preferencias,
        'observacoes' => $observacoes,
        'nao_verificadas' => $naoVerificadas,
        'divergencias' => $divergencias,
        'resumo' => [
            'pessoas' => count($grade),
            'dias' => $N,
            'folgas' => $folgasTotais,
            'ajustes' => $ajustesTotais,
            'modelo' => $modelo,
            'feridas' => count($obrigatorias) + count($preferencias),
            'obrigatorias' => count($obrigatorias),
            'preferencias' => count($preferencias),
            'notas' => count($observacoes),
            'impedimentos' => count($impedimentos),
            'lacunas' => count($lacunas),
            'nao_verificadas' => count($naoVerificadas),
            'validacao_parcial' => $validacaoParcial,
            'conformidade' => count($obrigatorias) > 0
                ? 'reprovada'
                : ($validacaoParcial ? 'parcial' : 'completa'),
            'divergencias' => count($divergencias),
            'perfis_aplicados' => count($perfis),
            'pode_publicar' => count($obrigatorias) === 0,
        ],
    ];
}

/** Recalcula o resumo a partir da grade. Usado quando não há período para validação completa. */
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
    $modelo = isset($params['modelo']) && in_array((string)$params['modelo'], ['5x2', '6x1'], true)
        ? (string)$params['modelo'] : '5x2';
    return [
        'pessoas' => count($grade),
        'dias' => $dias,
        'folgas' => $folgas,
        'ajustes' => $ajustes,
        'modelo' => $modelo,
        'feridas' => 0,
        'obrigatorias' => 0,
        'preferencias' => 0,
        'notas' => 0,
        'impedimentos' => 0,
        'lacunas' => 0,
        // Sem período não há como conferir regra nenhuma: contadores zerados aqui
        // significam "não verificado", e o resumo diz isso em vez de alegar conformidade.
        'nao_verificadas' => 1,
        'validacao_parcial' => true,
        'conformidade' => 'nao-verificada',
        'divergencias' => 0,
        'perfis_aplicados' => 0,
        'pode_publicar' => true,
    ];
}

/** Nunca confia em contadores de regras feridas ou notas vindos do cliente. */
function normalizarResumo($recebido, array $grade, array $params = []): array
{
    return resumoDaGrade($grade, $params);
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
