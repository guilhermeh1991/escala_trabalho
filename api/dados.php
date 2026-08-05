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

switch ($acao) {

// -----------------------------------------------------------------------------
case 'carregar':
// -----------------------------------------------------------------------------
    // A equipe inteira só aparece para quem monta escala. Colaborador usa
    // 'minha_escala', que devolve apenas a própria linha.
    exigirGestao($u);
    $st = bd()->prepare(
        'SELECT id, nome, parametros, ordem FROM lojas
          WHERE empresa_id = ? ORDER BY ordem, criado_em');
    $st->execute([$u['empresa_id']]);
    $lojas = $st->fetchAll();

    if (!$lojas) responder(['lojas' => []]);

    $ids  = array_column($lojas, 'id');
    $mrks = implode(',', array_fill(0, count($ids), '?'));

    $st = bd()->prepare(
        "SELECT id, loja_id, nome, email, cargo, horario, gerente, ativo,
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
            'params' => $l['parametros'] ? json_decode($l['parametros'], true) : new stdClass(),
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

    bd()->beginTransaction();
    try {
        $idsLojas = [];
        foreach ($lojas as $lojaId => $loja) {
            if (!ehUuid((string)$lojaId)) {
                falhar('Identificador de loja inválido.');
            }
            // a loja precisa ser desta empresa, ou ser nova desta empresa
            $st = bd()->prepare('SELECT empresa_id FROM lojas WHERE id = ?');
            $st->execute([$lojaId]);
            $dona = $st->fetchColumn();
            if ($dona !== false && $dona !== $u['empresa_id']) {
                falhar('Loja de outra empresa.', 403);
            }

            $st = bd()->prepare(
                'INSERT INTO lojas (id, empresa_id, nome, parametros, ordem)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE nome = VALUES(nome),
                     parametros = VALUES(parametros), ordem = VALUES(ordem)');
            $st->execute([
                $lojaId, $u['empresa_id'],
                mb_substr((string)($loja['nome'] ?? 'Loja'), 0, 80),
                json_encode($loja['params'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
                (int)($loja['_ordem'] ?? 0),
            ]);
            $idsLojas[] = $lojaId;

            // ---- colaboradores ----
            $colabs   = is_array($loja['colabs'] ?? null) ? $loja['colabs'] : [];
            $idsColab = [];
            foreach ($colabs as $i => $c) {
                $cid = ehUuid((string)($c['id'] ?? '')) ? $c['id'] : uuid();
                $st = bd()->prepare(
                    'INSERT INTO colaboradores
                        (id, loja_id, nome, email, cargo, horario, gerente, ativo,
                         folga_fixa, primeiro_domingo, dias_desde_folga, ordem)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE
                        nome = VALUES(nome), email = VALUES(email), cargo = VALUES(cargo),
                        horario = VALUES(horario), gerente = VALUES(gerente),
                        ativo = VALUES(ativo), folga_fixa = VALUES(folga_fixa),
                        primeiro_domingo = VALUES(primeiro_domingo),
                        dias_desde_folga = VALUES(dias_desde_folga),
                        ordem = VALUES(ordem)');
                $ff = $c['folgaFixa'] ?? null;
                $dd = $c['diasDesdeFolga'] ?? null;
                $emailColab = trim((string)($c['email'] ?? ''));
                if ($emailColab !== '' && !filter_var($emailColab, FILTER_VALIDATE_EMAIL)) {
                    falhar('E-mail inválido para ' . ($c['nome'] ?? 'colaborador') . '.');
                }
                $st->execute([
                    $cid, $lojaId,
                    mb_substr((string)($c['nome'] ?? ''), 0, 80),
                    $emailColab !== '' ? mb_strtolower($emailColab) : null,
                    mb_substr((string)($c['cargo'] ?? 'BALCONISTA'), 0, 40),
                    mb_substr((string)($c['horario'] ?? ''), 0, 40),
                    !empty($c['gerente']) ? 1 : 0,
                    (($c['ativo'] ?? true) !== false) ? 1 : 0,
                    ($ff === null || $ff === '') ? null : (int)$ff,
                    !empty($c['primeiroDomingo']) ? $c['primeiroDomingo'] : null,
                    ($dd === null || $dd === '') ? null : (int)$dd,
                    (int)$i,
                ]);
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
        falhar('Não foi possível salvar. Tente de novo.', 500);
    }
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'carregar_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $st = bd()->prepare(
        'SELECT grade, parametros, publicada, atualizado_em FROM escalas
          WHERE loja_id = ? AND inicio = ? AND fim = ? LIMIT 1');
    $st->execute([$lojaId, (string)campo($dados, 'inicio', ''), (string)campo($dados, 'fim', '')]);
    $e = $st->fetch();
    responder(['escala' => $e ? [
        'grid'   => json_decode($e['grade'], true),
        'params' => $e['parametros'] ? json_decode($e['parametros'], true) : null,
        'publicada' => (bool)$e['publicada'],
        'atualizado_em' => $e['atualizado_em'],
    ] : null]);

// -----------------------------------------------------------------------------
case 'salvar_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');
    $grade  = campo($dados, 'grade');
    if (!$grade || !is_array($grade)) falhar('Escala vazia.');

    $publicar = !empty($dados['publicar']) ? 1 : 0;
    $st = bd()->prepare(
        'INSERT INTO escalas (id, loja_id, inicio, fim, grade, parametros,
                              publicada, publicada_em, atualizado_por)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE grade = VALUES(grade),
             parametros = VALUES(parametros),
             publicada = GREATEST(publicada, VALUES(publicada)),
             publicada_em = IF(VALUES(publicada) = 1 AND publicada_em IS NULL,
                               NOW(), publicada_em),
             atualizado_por = VALUES(atualizado_por)');
    $st->execute([
        uuid(), $lojaId, $inicio, $fim,
        json_encode($grade, JSON_UNESCAPED_UNICODE),
        json_encode(campo($dados, 'parametros'), JSON_UNESCAPED_UNICODE),
        $publicar, $publicar ? date('Y-m-d H:i:s') : null,
        $u['id'],
    ]);
    registrar($u['id'], $u['empresa_id'], 'escala_salva',
        ['loja' => $lojaId, 'inicio' => $inicio, 'fim' => $fim]);
    responder(['ok' => true]);

// -----------------------------------------------------------------------------
case 'excluir_escala':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $lojaId = (string)campo($dados, 'loja_id', '');
    exigirLojaDaEmpresa($lojaId, $u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');

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
    $nome = mb_substr(trim((string)campo($dados, 'nome', 'Nova loja')), 0, 80);
    $id   = uuid();
    $st = bd()->prepare('SELECT COALESCE(MAX(ordem), -1) + 1 FROM lojas WHERE empresa_id = ?');
    $st->execute([$u['empresa_id']]);
    $ordem = (int)$st->fetchColumn();
    bd()->prepare('INSERT INTO lojas (id, empresa_id, nome, parametros, ordem) VALUES (?,?,?,?,?)')
        ->execute([$id, $u['empresa_id'], $nome, json_encode(campo($dados, 'params', new stdClass())), $ordem]);
    responder(['ok' => true, 'id' => $id]);

// -----------------------------------------------------------------------------
case 'historico':
// -----------------------------------------------------------------------------
    exigirGestao($u);
    $st = bd()->prepare(
        'SELECT r.acao, r.detalhe, r.em, us.nome
           FROM registro_acoes r
           LEFT JOIN usuarios us ON us.id = r.usuario_id
          WHERE r.empresa_id = ? ORDER BY r.em DESC LIMIT 100');
    $st->execute([$u['empresa_id']]);
    responder(['registros' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
default:
    falhar('Ação desconhecida.', 404);
}
