<?php
/**
 * Dados da operação: lojas, colaboradores, ausências e escalas.
 *
 * Toda consulta aqui passa pelas funções de isolamento de comum.php. Nenhuma
 * usa identificador vindo do navegador sem antes conferir que ele pertence à
 * empresa de quem está pedindo.
 */

declare(strict_types=1);
require __DIR__ . '/comum.php';

$dados = corpo();
$acao  = (string)campo($dados, 'acao', '');
exigirCsrf();

$u = exigirEmpresa();

/* O deploy do HTML e da API pode chegar antes de a migração ser aplicada no
   phpMyAdmin. Enquanto isso, a tela continua abrindo com o horário textual
   existente; a jornada estruturada passa a ser usada automaticamente assim que
   a coluna existir. */
function jornadaEstruturadaDisponivel(): bool
{
    static $disponivel = null;
    if ($disponivel !== null) return $disponivel;
    try {
        $st = bd()->query("SHOW COLUMNS FROM colaboradores LIKE 'jornada'");
        return $disponivel = (bool)$st->fetch();
    } catch (Throwable $e) {
        return $disponivel = false;
    }
}

switch ($acao) {

// -----------------------------------------------------------------------------
case 'carregar':
// -----------------------------------------------------------------------------
    // A equipe inteira só aparece para quem monta escala. Colaborador usa
    // 'minha_escala', que devolve apenas a própria linha.
    exigirGestao($u);
    // presa a uma loja: as outras nem aparecem no seletor
    if (ehSuperAdmin($u)) { $st = bd()->prepare('SELECT l.id, l.nome, l.codigo_convite, l.parametros, l.ordem, e.nome AS empresa_nome FROM lojas l JOIN empresas e ON e.id = l.empresa_id ORDER BY e.nome, l.ordem, l.criado_em'); $st->execute(); } elseif (ehSupervisor($u)) {
        $idsPermitidos = lojasDoSupervisor($u);
        if (!$idsPermitidos) falhar('Supervisor sem loja autorizada.', 403);
        $marcadores = implode(',', array_fill(0, count($idsPermitidos), '?'));
        $st = bd()->prepare(
            "SELECT id, nome, codigo_convite, parametros, ordem, versao FROM lojas
              WHERE empresa_id = ? AND id IN ($marcadores)
              ORDER BY ordem, criado_em");
        $st->execute(array_merge([$u['empresa_id']], $idsPermitidos));
    } elseif (vePorLoja($u)) {
        $st = bd()->prepare(
            'SELECT id, nome, codigo_convite, parametros, ordem, versao FROM lojas
              WHERE empresa_id = ? AND id = ?');
        $st->execute([$u['empresa_id'], $u['loja_id']]);
    } else {
        $st = bd()->prepare(
            'SELECT id, nome, codigo_convite, parametros, ordem, versao FROM lojas
              WHERE empresa_id = ? ORDER BY ordem, criado_em');
        $st->execute([$u['empresa_id']]);
    }
    $lojas = $st->fetchAll();

    if (!$lojas) responder(['lojas' => []]);

    $ids  = array_column($lojas, 'id');
    $mrks = implode(',', array_fill(0, count($ids), '?'));
    $temJornada = jornadaEstruturadaDisponivel();
    $campoJornada = $temJornada ? 'jornada' : 'NULL AS jornada';

    $st = bd()->prepare(
        "SELECT id, loja_id, nome, email, cargo, horario, $campoJornada, gerente, ativo,
                folga_fixa, primeiro_domingo, dias_desde_folga, ordem
           FROM colaboradores WHERE loja_id IN ($mrks) ORDER BY ordem");
    $st->execute($ids);
    $colabs = $st->fetchAll();

    $ausencias = [];
    if ($colabs) {
        $cids = array_column($colabs, 'id');
        $m2   = implode(',', array_fill(0, count($cids), '?'));
        $st = bd()->prepare(
            "SELECT id, colaborador_id, tipo, ini, fim FROM ausencias
              WHERE colaborador_id IN ($m2)");
        $st->execute($cids);
        foreach ($st->fetchAll() as $a) {
            $ausencias[$a['colaborador_id']][] = [
                'id' => $a['id'], 'tipo' => $a['tipo'],
                'ini' => $a['ini'], 'fim' => $a['fim'],
            ];
        }
    }

    $porLoja = [];
    foreach ($colabs as $c) {
        $porLoja[$c['loja_id']][] = [
            'id'               => $c['id'],
            'nome'             => $c['nome'],
            'email'            => $c['email'],
            'cargo'            => $c['cargo'],
            'horario'          => $c['horario'],
            'jornada'          => $c['jornada'] ? json_decode($c['jornada'], true) : null,
            'gerente'          => (bool)$c['gerente'],
            'ativo'            => (bool)$c['ativo'],
            'folgaFixa'        => $c['folga_fixa'] === null ? null : (int)$c['folga_fixa'],
            'primeiroDomingo'  => $c['primeiro_domingo'],
            'diasDesdeFolga'   => $c['dias_desde_folga'] === null ? null : (int)$c['dias_desde_folga'],
            'ausencias'        => $ausencias[$c['id']] ?? [],
        ];
    }

    $saida = [];
    foreach ($lojas as $l) {
        $saida[$l['id']] = [
            'nome'   => $l['nome'],
            'codigo' => $l['codigo_convite'],
            'params' => $l['parametros'] ? json_decode($l['parametros'], true) : new stdClass(),
            'versao' => (int)($l['versao'] ?? 1),
            'colabs' => $porLoja[$l['id']] ?? [],
            '_ordem' => (int)$l['ordem'],
        ];
    }
    responder(['lojas' => $saida]);

// -----------------------------------------------------------------------------
case 'salvar':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojas = campo($dados, 'lojas', []);
    if (!is_array($lojas)) falhar('Dados inválidos.');
    if (ehSupervisor($u)) {
        $permitidas = array_flip(lojasDoSupervisor($u));
        foreach ($lojas as $lojaId => $_loja) {
            if (!isset($permitidas[(string)$lojaId])) {
                falhar('Loja fora do seu acesso.', 403);
            }
        }
    } elseif (vePorLoja($u)) {
        foreach ($lojas as $lojaId => $_loja) {
            if ((string)$lojaId !== $u['loja_id']) {
                falhar('Loja fora do seu acesso.', 403);
            }
        }
    }

    $expectedVersions = campo($dados, 'expected_versions', []);
    if (!$expectedVersions && is_array($lojas)) {
        foreach ($lojas as $id => $loja) if (isset($loja['_versao'])) $expectedVersions[(string)$id] = (int)$loja['_versao'];
    }
    if (!is_array($expectedVersions)) $expectedVersions = [];
    bd()->beginTransaction();
    try {
        $idsLojas = [];
        foreach ($lojas as $lojaId => $loja) {
            if (!ehUuid((string)$lojaId)) {
                falhar('Identificador de loja inválido.');
            }
            if (ehSupervisor($u)) {
                if (!in_array((string)$lojaId, lojasDoSupervisor($u), true)) {
                    falhar('Loja fora do seu acesso.', 403);
                }
            } elseif (vePorLoja($u) && $lojaId !== $u['loja_id']) {
                falhar('Loja fora do seu acesso.', 403);
            }
            // A versão é checada antes de qualquer upsert para impedir
            // sobrescrita silenciosa em duas sessões concorrentes.
            $st = bd()->prepare('SELECT empresa_id, versao FROM lojas WHERE id = ? FOR UPDATE');
            $st->execute([$lojaId]);
            $lojaAtual = $st->fetch();
            $dona = $lojaAtual['empresa_id'] ?? false;
            if ($dona !== false && array_key_exists((string)$lojaId, $expectedVersions)
                && (int)$lojaAtual['versao'] !== (int)$expectedVersions[(string)$lojaId]) {
                bd()->rollBack();
                falhar('Conflito: a equipe ou os parâmetros foram alterados por outra pessoa. Recarregue antes de salvar.', 409);
            }
            if ($dona !== false && $dona !== $u['empresa_id']) {
                falhar('Loja de outra empresa.', 403);
            }

            if ($dona === false) {
                $st = bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, parametros, ordem, versao)
                                     VALUES (?, ?, ?, ?, ?, 1)');
                $st->execute([$lojaId, $u['empresa_id'], mb_substr((string)($loja['nome'] ?? 'Loja'), 0, 80),
                    json_encode($loja['params'] ?? new stdClass(), JSON_UNESCAPED_UNICODE), (int)($loja['_ordem'] ?? 0)]);
            } else {
                $st = bd()->prepare('UPDATE lojas SET nome=?, parametros=?, ordem=?, versao=versao+1 WHERE id=?');
                $st->execute([mb_substr((string)($loja['nome'] ?? 'Loja'), 0, 80),
                    json_encode($loja['params'] ?? new stdClass(), JSON_UNESCAPED_UNICODE), (int)($loja['_ordem'] ?? 0), $lojaId]);
            }
            $idsLojas[] = $lojaId;

            // ---- colaboradores ----
            $colabs   = is_array($loja['colabs'] ?? null) ? $loja['colabs'] : [];
            $idsColab = [];
            $temJornada = jornadaEstruturadaDisponivel();
            foreach ($colabs as $i => $c) {
                $cidRecebido = (string)($c['id'] ?? '');
                $cid = ehUuid($cidRecebido) ? $cidRecebido : uuid();
                if ($cidRecebido !== '') {
                    if (!ehUuid($cidRecebido)) falhar('Identificador de colaborador inválido.');
                    $stExistente = bd()->prepare('SELECT loja_id FROM colaboradores WHERE id = ? LIMIT 1');
                    $stExistente->execute([$cidRecebido]);
                    $lojaExistente = $stExistente->fetchColumn();
                    if ($lojaExistente !== false && $lojaExistente !== $lojaId) {
                        falhar('Colaborador fora da loja informada.', 403);
                    }
                }
                $sqlColaborador = $temJornada
                    ? 'INSERT INTO colaboradores
                        (id, loja_id, nome, email, cargo, horario, jornada, gerente, ativo,
                         folga_fixa, primeiro_domingo, dias_desde_folga, ordem)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE
                         nome = VALUES(nome), email = VALUES(email), cargo = VALUES(cargo),
                         horario = VALUES(horario), jornada = VALUES(jornada),
                         gerente = VALUES(gerente), ativo = VALUES(ativo), folga_fixa = VALUES(folga_fixa),
                         primeiro_domingo = VALUES(primeiro_domingo),
                         dias_desde_folga = VALUES(dias_desde_folga), ordem = VALUES(ordem)'
                    : 'INSERT INTO colaboradores
                        (id, loja_id, nome, email, cargo, horario, gerente, ativo,
                         folga_fixa, primeiro_domingo, dias_desde_folga, ordem)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE
                         nome = VALUES(nome), email = VALUES(email), cargo = VALUES(cargo),
                         horario = VALUES(horario), gerente = VALUES(gerente),
                         ativo = VALUES(ativo), folga_fixa = VALUES(folga_fixa),
                         primeiro_domingo = VALUES(primeiro_domingo),
                         dias_desde_folga = VALUES(dias_desde_folga), ordem = VALUES(ordem)';
                $st = bd()->prepare($sqlColaborador);
                $ff = $c['folgaFixa'] ?? null;
                $dd = $c['diasDesdeFolga'] ?? null;
                $emailColab = trim((string)($c['email'] ?? ''));
                if ($emailColab !== '' && !filter_var($emailColab, FILTER_VALIDATE_EMAIL)) {
                    falhar('E-mail inválido para ' . ($c['nome'] ?? 'colaborador') . '.');
                }
                $valoresColaborador = [
                    $cid, $lojaId,
                    mb_substr((string)($c['nome'] ?? ''), 0, 80),
                    $emailColab !== '' ? mb_strtolower($emailColab) : null,
                    mb_substr((string)($c['cargo'] ?? 'BALCONISTA'), 0, 40),
                    mb_substr((string)($c['horario'] ?? ''), 0, 40),
                ];
                if ($temJornada) {
                    $valoresColaborador[] = json_encode($c['jornada'] ?? null, JSON_UNESCAPED_UNICODE);
                }
                $valoresColaborador = array_merge($valoresColaborador, [
                    !empty($c['gerente']) ? 1 : 0,
                    (($c['ativo'] ?? true) !== false) ? 1 : 0,
                    ($ff === null || $ff === '') ? null : (int)$ff,
                    !empty($c['primeiroDomingo']) ? $c['primeiroDomingo'] : null,
                    ($dd === null || $dd === '') ? null : (int)$dd,
                    (int)$i,
                ]);
                $st->execute($valoresColaborador);
                $idsColab[] = $cid;

                // ---- ausências ----
                $aus    = is_array($c['ausencias'] ?? null) ? $c['ausencias'] : [];
                $idsAus = [];
                foreach ($aus as $a) {
                    if (empty($a['ini']) || empty($a['fim'])) continue;
                    $aid = ehUuid((string)($a['id'] ?? '')) ? $a['id'] : uuid();
                    $st2 = bd()->prepare(
                        'INSERT INTO ausencias (id, colaborador_id, tipo, ini, fim)
                         VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE tipo = VALUES(tipo),
                             ini = VALUES(ini), fim = VALUES(fim)');
                    $tipo = in_array($a['tipo'] ?? '', ['F','AT','LC','FC'], true) ? $a['tipo'] : 'F';
                    $st2->execute([$aid, $cid, $tipo, $a['ini'], $a['fim']]);
                    $idsAus[] = $aid;
                }
                // apaga as ausências que saíram da lista
                if ($idsAus) {
                    $m = implode(',', array_fill(0, count($idsAus), '?'));
                    $st2 = bd()->prepare(
                        "DELETE FROM ausencias WHERE colaborador_id = ? AND id NOT IN ($m)");
                    $st2->execute(array_merge([$cid], $idsAus));
                } else {
                    bd()->prepare('DELETE FROM ausencias WHERE colaborador_id = ?')->execute([$cid]);
                }
            }
            // apaga os colaboradores que saíram da lista
            if ($idsColab) {
                $m = implode(',', array_fill(0, count($idsColab), '?'));
                $st = bd()->prepare(
                    "DELETE FROM colaboradores WHERE loja_id = ? AND id NOT IN ($m)");
                $st->execute(array_merge([$lojaId], $idsColab));
            } else {
                bd()->prepare('DELETE FROM colaboradores WHERE loja_id = ?')->execute([$lojaId]);
            }
        }
        bd()->commit();
    } catch (Throwable $e) {
        bd()->rollBack();
        error_log('salvar dados: ' . $e->getMessage());
        falhar(mensagemErroBanco($e, 'Não foi possível salvar. Tente de novo.'), 500);
    }
    $novasVersoes = [];
    foreach ($idsLojas as $idLoja) {
        $st = bd()->prepare('SELECT versao FROM lojas WHERE id=?');
        $st->execute([$idLoja]);
        $novasVersoes[$idLoja] = (int)$st->fetchColumn();
    }
    responder(['ok' => true, 'versoes' => $novasVersoes]);

// -----------------------------------------------------------------------------
case 'carregar_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');
    if (!ehDataValida($inicio) || !ehDataValida($fim)) {
        falhar('Período inválido.');
    }

    $st = bd()->prepare(
        'SELECT e.id, e.grade, e.parametros, e.resumo, e.publicada, e.versao,
                e.versao_publicada, e.atualizado_em, v.snapshot
           FROM escalas e
           LEFT JOIN escala_versoes v
             ON v.escala_id = e.id AND v.versao = e.versao
          WHERE e.loja_id = ? AND e.inicio = ? AND e.fim = ? LIMIT 1');
    $st->execute([$lojaId, $inicio, $fim]);
    $e = $st->fetch();
    $versaoSolicitada = campo($dados, 'versao');
    if ($e && $versaoSolicitada !== null && $versaoSolicitada !== '') {
        $st = bd()->prepare('SELECT grade, parametros, resumo, publicada, versao, publicada_em, snapshot
                               FROM escala_versoes WHERE escala_id = ? AND versao = ? LIMIT 1');
        $st->execute([$e['id'], (int)$versaoSolicitada]);
        $v = $st->fetch();
        if (!$v) falhar('Versão da escala não encontrada.', 404);
        $e['grade'] = $v['grade']; $e['parametros'] = $v['parametros']; $e['resumo'] = $v['resumo'];
        $e['publicada'] = $v['publicada']; $e['versao'] = $v['versao'];
        $e['snapshot'] = $v['snapshot']; $e['atualizado_em'] = $v['publicada_em'];
    }
    responder(['escala' => $e ? [
        'grid' => json_decode($e['grade'], true),
        'params' => $e['parametros'] ? json_decode($e['parametros'], true) : null,
        'resumo' => $e['resumo'] ? json_decode($e['resumo'], true) : null,
        'publicada' => (bool)$e['publicada'],
        'versao' => (int)$e['versao'],
        'versao_publicada' => $e['versao_publicada'] === null ? null : (int)$e['versao_publicada'],
        'snapshot' => $e['snapshot'] ? json_decode($e['snapshot'], true) : null,
        'atualizado_em' => $e['atualizado_em'],
    ] : null]);

// -----------------------------------------------------------------------------
case 'escala_anterior':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    if (!ehDataValida($inicio)) {
        falhar('Período inválido.');
    }

    $st = bd()->prepare(
        'SELECT v.inicio, v.fim, v.grade, v.parametros, v.snapshot
           FROM escalas e JOIN escala_versoes v ON v.escala_id=e.id AND v.versao=e.versao
          WHERE e.loja_id = ? AND e.fim < ?
          ORDER BY e.fim DESC, v.versao DESC LIMIT 1');
    $st->execute([$lojaId, $inicio]);
    $e = $st->fetch();
    $paramsAnt = ($e && $e['parametros']) ? (json_decode($e['parametros'], true) ?: []) : [];
    $snapAnt = ($e && $e['snapshot']) ? json_decode($e['snapshot'], true) : null;
    $horasAnt = is_array($paramsAnt['_horas'] ?? null)
        ? $paramsAnt['_horas']
        : (is_array($snapAnt['horas'] ?? null) ? $snapAnt['horas'] : new stdClass());
    responder(['escala' => $e ? [
        'inicio' => $e['inicio'],
        'fim' => $e['fim'],
        'grid' => json_decode($e['grade'], true),
        'horas' => $horasAnt,
        'snapshot' => $snapAnt,
    ] : null]);

// -----------------------------------------------------------------------------
case 'salvar_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');
    if (!ehDataValida($inicio) || !ehDataValida($fim) || $fim < $inicio) {
        falhar('Período de datas inválido.');
    }
    $grade = campo($dados, 'grade');
    if (!$grade || !is_array($grade)) falhar('Escala vazia.');

    $paramsRecebidos = campo($dados, 'parametros');
    if (!is_array($paramsRecebidos)) $paramsRecebidos = [];
    // Qualquer declaração de conformidade ou alertas enviados pelo cliente são descartados.
    unset($paramsRecebidos['_resumo'], $paramsRecebidos['alertas'], $paramsRecebidos['bloqueios']);
    $snapshot = campo($dados, 'snapshot');
    if (!is_array($snapshot)) {
        $snapshot = [
            'schema' => 1, 'incompleto' => true,
            'motivo' => 'Snapshot não enviado pelo cliente legado',
            'participantes' => [], 'grade' => $grade, 'params' => $paramsRecebidos
        ];
    }
    $snapshot['schema'] = (int)($snapshot['schema'] ?? 1);
    $snapshot['loja_id'] = $lojaId;
    $snapshot['inicio'] = $inicio;
    $snapshot['fim'] = $fim;
    $publicar = !empty($dados['publicar']) ? 1 : 0;
    $esperada = campo($dados, 'expected_version');
    $esperada = ($esperada === null || $esperada === '') ? null : (int)$esperada;
    $idempotencia = (string)campo($dados, 'idempotency_key', '');
    if ($idempotencia !== '' && !ehUuid($idempotencia)) falhar('Chave de idempotência inválida.');

    bd()->beginTransaction();
    try {
        $st = bd()->prepare('SELECT id, versao, publicada, publicada_em, versao_publicada
                               FROM escalas WHERE loja_id = ? AND inicio = ? AND fim = ? FOR UPDATE');
        $st->execute([$lojaId, $inicio, $fim]);
        $existente = $st->fetch();
        if ($existente && $idempotencia !== '') {
            $st = bd()->prepare('SELECT versao, publicada, resumo FROM escala_versoes WHERE escala_id = ? AND idempotencia = ?');
            $st->execute([$existente['id'], $idempotencia]);
            if ($ja = $st->fetch()) {
                bd()->commit();
                responder([
                    'ok' => true,
                    'versao' => (int)$ja['versao'],
                    'publicada' => (bool)$ja['publicada'],
                    'repetida' => true,
                    'resumo' => $ja['resumo'] ? json_decode((string)$ja['resumo'], true) : null,
                ]);
            }
        }
        if ($existente && $esperada !== null && (int)$existente['versao'] !== $esperada) {
            bd()->rollBack();
            falhar('Conflito: a escala foi alterada por outra pessoa. Recarregue ou compare as versões.', 409);
        }

        // Revalida no servidor a versão exata antes de gravar ou publicar.
        $validacao = validarEscalaServidor($lojaId, $inicio, $fim, $grade, $paramsRecebidos, $snapshot);
        $resumo = $validacao['resumo'];
        if ($publicar === 1 && count($validacao['obrigatorias']) > 0) {
            bd()->rollBack();
            $primeiros = array_slice(array_map(function ($a) {
                return (($a['colab'] ?? '—') !== '—' ? $a['colab'] . ': ' : '') . ($a['txt'] ?? '');
            }, $validacao['obrigatorias']), 0, 5);
            responder([
                'erro' => 'Publicação bloqueada por restrição obrigatória: ' . implode(' | ', $primeiros),
                'bloqueios' => $validacao['obrigatorias'],
                'alertas' => $validacao['alertas'],
                'resumo' => $resumo,
            ], 422);
        }

        $escalaId = $existente['id'] ?? uuid();
        $versao = $existente ? (int)$existente['versao'] + 1 : 1;
        $publicadaAtual = $existente ? (int)$existente['publicada'] : 0;
        $publicadaEm = ($publicar && !$publicadaAtual) ? date('Y-m-d H:i:s') : null;
        if ($existente) {
            $st = bd()->prepare('UPDATE escalas SET grade=?, parametros=?, resumo=?, versao=?,
                    publicada=GREATEST(publicada, ?), publicada_em=COALESCE(publicada_em, ?),
                    versao_publicada=IF(?=1, ?, versao_publicada), atualizado_por=?
                    WHERE id=?');
            $st->execute([
                json_encode($grade, JSON_UNESCAPED_UNICODE), json_encode($paramsRecebidos, JSON_UNESCAPED_UNICODE),
                json_encode($resumo, JSON_UNESCAPED_UNICODE), $versao, $publicar, $publicadaEm,
                $publicar, $versao, $u['id'], $escalaId
            ]);
        } else {
            $st = bd()->prepare('INSERT INTO escalas
                (id, loja_id, inicio, fim, grade, parametros, resumo, versao, publicada, publicada_em, versao_publicada, atualizado_por)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            $st->execute([$escalaId, $lojaId, $inicio, $fim, json_encode($grade, JSON_UNESCAPED_UNICODE),
                json_encode($paramsRecebidos, JSON_UNESCAPED_UNICODE), json_encode($resumo, JSON_UNESCAPED_UNICODE),
                $versao, $publicar, $publicar ? date('Y-m-d H:i:s') : null,
                $publicar ? $versao : null, $u['id']]);
        }
        $st = bd()->prepare('INSERT INTO escala_versoes
            (id, escala_id, versao, loja_id, inicio, fim, grade, parametros, resumo, snapshot, publicada, publicada_em, idempotencia, criado_por)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $st->execute([uuid(), $escalaId, $versao, $lojaId, $inicio, $fim,
            json_encode($grade, JSON_UNESCAPED_UNICODE), json_encode($paramsRecebidos, JSON_UNESCAPED_UNICODE),
            json_encode($resumo, JSON_UNESCAPED_UNICODE), json_encode($snapshot, JSON_UNESCAPED_UNICODE),
            $publicar, $publicar ? date('Y-m-d H:i:s') : null, $idempotencia !== '' ? $idempotencia : null, $u['id']]);
        registrar($u['id'], $u['empresa_id'], $publicar ? 'escala_publicada' : 'escala_salva',
            ['loja' => $lojaId, 'inicio' => $inicio, 'fim' => $fim, 'versao' => $versao]);
        bd()->commit();
    } catch (Throwable $e) {
        if (bd()->inTransaction()) bd()->rollBack();
        error_log('salvar escala: ' . $e->getMessage());
        falhar(mensagemErroBanco($e, 'Erro ao salvar escala. Tente novamente.'), 500);
    }
    responder([
        'ok' => true,
        'versao' => $versao,
        'publicada' => (bool)$publicar,
        'resumo' => $resumo,
        'alertas' => $validacao['alertas'],
    ]);

    // -----------------------------------------------------------------------------
    case 'listar_versoes_escala':
    // -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);
    $inicio = (string)campo($dados, 'inicio', '');
    $fim = (string)campo($dados, 'fim', '');
    if (!ehDataValida($inicio) || !ehDataValida($fim)) falhar('Período inválido.');
    $st = bd()->prepare('SELECT versao, publicada, publicada_em, criado_em, criado_por, snapshot
                           FROM escala_versoes WHERE loja_id=? AND inicio=? AND fim=? ORDER BY versao DESC');
    $st->execute([$lojaId, $inicio, $fim]);
    responder(['versoes' => array_map(function($v){
        $s = json_decode($v['snapshot'], true) ?: [];
        return ['versao'=>(int)$v['versao'], 'publicada'=>(bool)$v['publicada'],
          'incompleto'=>(bool)($s['incompleto'] ?? false), 'criado_em'=>$v['criado_em'], 'criado_por'=>$v['criado_por']];
    }, $st->fetchAll())]);

    // -----------------------------------------------------------------------------
    case 'listar_escalas':
    // -----------------------------------------------------------------------------
    exigirGestao($u);
$lojaId = (string)campo($dados, 'loja_id', '');
exigirLojaDaEmpresa($lojaId, $u);

$st = bd()->prepare(
    'SELECT v.inicio, v.fim, v.grade, v.parametros, v.resumo, v.publicada,
    v.publicada_em AS atualizado_em, v.criado_em, v.versao, v.snapshot,
    us.nome AS por
    FROM escala_versoes v
    LEFT JOIN usuarios us ON us.id = v.criado_por
    WHERE v.loja_id = ?
    ORDER BY v.inicio DESC, v.versao DESC
    LIMIT 100');
$st->execute([$lojaId]);
$linhas = $st->fetchAll();

$escalas = array_map(function ($e) {
    $grade = json_decode($e['grade'], true) ?: [];
    $params = $e['parametros'] ? json_decode($e['parametros'], true) : [];
    $resumo = $e['resumo'] ? json_decode($e['resumo'], true) : null;
    if (!$resumo) {
        $resumo = resumoDaGrade($grade, is_array($params) ? $params : []);
    }
    return [
        'inicio' => $e['inicio'],
        'fim' => $e['fim'],
        'pessoas' => $resumo['pessoas'] ?? null,
        'dias' => $resumo['dias'] ?? null,
        'modelo' => $resumo['modelo'] ?? null,
        'folgas' => $resumo['folgas'] ?? null,
        'ajustes' => $resumo['ajustes'] ?? null,
        'feridas' => $resumo['feridas'] ?? null,
        'notas' => $resumo['notas'] ?? null,
        'em' => str_replace(' ', 'T', (string)($e['atualizado_em'] ?: $e['criado_em'])),
        'versao' => (int)$e['versao'],
        'incompleto' => (bool)((json_decode($e['snapshot'], true)['incompleto'] ?? false)),
        'publicada' => (bool)$e['publicada'],
        'por' => $e['por'],
        ];
}, $linhas);

responder(['escalas' => $escalas]);

// -----------------------------------------------------------------------------
case 'excluir_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');
    if (!ehDataValida($inicio) || !ehDataValida($fim)) {
        falhar('Período inválido.');
    }

    $st = bd()->prepare(
        'DELETE FROM escalas WHERE loja_id = ? AND inicio = ? AND fim = ?');
    $st->execute([$lojaId, $inicio, $fim]);
    $apagadas = $st->rowCount();

    registrar($u['id'], $u['empresa_id'], 'escala_excluida',
        ['loja' => $lojaId, 'inicio' => $inicio, 'fim' => $fim]);
    responder(['ok' => true, 'apagadas' => $apagadas]);

// -----------------------------------------------------------------------------
case 'criar_loja':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    if (vePorLoja($u)) falhar('Seu acesso é de uma loja só.', 403);
    $nome = mb_substr(trim((string)campo($dados, 'nome', 'Nova loja')), 0, 80);
    $id   = uuid();
    $st = bd()->prepare('SELECT COALESCE(MAX(ordem), -1) + 1 FROM lojas WHERE empresa_id = ?');
    $st->execute([$u['empresa_id']]);
    $ordem = (int)$st->fetchColumn();
    $codigo = codigoConvite();
    bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, codigo_convite, parametros, ordem)
                   VALUES (?,?,?,?,?,?)')
        ->execute([$id, $u['empresa_id'], $nome, $codigo,
                   json_encode(campo($dados, 'params', new stdClass())), $ordem]);
    registrar($u['id'], $u['empresa_id'], 'loja_criada', ['nome' => $nome]);
    responder(['ok' => true, 'id' => $id, 'codigo' => $codigo]);

// -----------------------------------------------------------------------------
case 'historico':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $filtroHistorico = '';
    $argsHistorico = [$u['empresa_id']];
    if (ehSupervisor($u)) {
        $permitidas = lojasDoSupervisor($u);
        if (!$permitidas) falhar('Supervisor sem loja autorizada.', 403);
        $filtroHistorico = ' AND JSON_UNQUOTE(JSON_EXTRACT(r.detalhe, "$.loja")) IN (' . implode(',', array_fill(0, count($permitidas), '?')) . ')';
        $argsHistorico = array_merge($argsHistorico, $permitidas);
    } elseif (vePorLoja($u)) {
        $filtroHistorico = ' AND JSON_UNQUOTE(JSON_EXTRACT(r.detalhe, "$.loja")) = ?';
        $argsHistorico[] = $u['loja_id'];
    }
    $st = bd()->prepare(
        'SELECT r.acao, r.detalhe, r.em, us.nome
           FROM registro_acoes r
           LEFT JOIN usuarios us ON us.id = r.usuario_id
          WHERE r.empresa_id = ?' . $filtroHistorico . ' ORDER BY r.em DESC LIMIT 100');
    $st->execute($argsHistorico);
    responder(['registros' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
default:
    falhar('Ação desconhecida.', 404);
}
