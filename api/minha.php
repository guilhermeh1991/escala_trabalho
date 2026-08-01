<?php
/**
 * Escala individual.
 *
 * Devolve apenas a linha da própria pessoa, extraída da escala da loja. Nunca
 * devolve a grade inteira, nem nome de colega, nem contagem de equipe.
 *
 * A extração acontece AQUI, no servidor. Se ela fosse feita no navegador, a
 * grade completa teria que ser enviada e bastaria abrir as ferramentas de
 * desenvolvimento para ler a escala de todo mundo.
 */

declare(strict_types=1);
require __DIR__ . '/comum.php';

$dados = corpo();
$acao  = (string)campo($dados, 'acao', '');
exigirCsrf();

$u = exigirEmpresa();

/** Qual ficha de colaborador este acesso representa. */
function fichaDoUsuario(array $u): array
{
    // Gestor e administrador podem consultar a própria escala se estiverem
    // cadastrados na equipe. Se não estiverem, não há o que mostrar.
    if (empty($u['colaborador_id'])) {
        falhar('Seu acesso não está ligado a nenhuma ficha da equipe. '
             . 'Peça ao responsável para cadastrar o seu e-mail na equipe.', 404);
    }
    $st = bd()->prepare(
        'SELECT c.id, c.nome, c.cargo, c.horario, c.folga_fixa,
                l.id AS loja_id, l.nome AS loja, l.empresa_id
           FROM colaboradores c
           JOIN lojas l ON l.id = c.loja_id
          WHERE c.id = ? LIMIT 1');
    $st->execute([$u['colaborador_id']]);
    $ficha = $st->fetch();

    // Conferência de posse: a ficha tem de ser da mesma empresa da sessão.
    if (!$ficha || $ficha['empresa_id'] !== $u['empresa_id']) {
        falhar('Ficha não encontrada.', 404);
    }
    return $ficha;
}

const NOMES_DIA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const SIGLA_DIA = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'];

/** Traduz o código da célula para algo que a pessoa entenda. */
function descreverDia(string $codigo, ?string $horario): array
{
    switch ($codigo) {
        case 'X':  return ['tipo' => 'folga',      'rotulo' => 'Folga'];
        case 'FC': return ['tipo' => 'folga',      'rotulo' => 'Folga compensatória'];
        case 'F':  return ['tipo' => 'ferias',     'rotulo' => 'Férias'];
        case 'AT': return ['tipo' => 'atestado',   'rotulo' => 'Atestado'];
        case 'LC': return ['tipo' => 'licenca',    'rotulo' => 'Licença'];
        default:   return ['tipo' => 'trabalho',   'rotulo' => $horario ?: 'Trabalho'];
    }
}

switch ($acao) {

// -----------------------------------------------------------------------------
case 'minha_escala':
// -----------------------------------------------------------------------------
    $ficha = fichaDoUsuario($u);

    $inicio = (string)campo($dados, 'inicio', '');
    $fim    = (string)campo($dados, 'fim', '');

    // Sem período informado, pega a escala publicada mais recente da loja.
    if ($inicio === '' || $fim === '') {
        $st = bd()->prepare(
            'SELECT inicio, fim FROM escalas
              WHERE loja_id = ? AND publicada = 1
              ORDER BY inicio DESC LIMIT 1');
        $st->execute([$ficha['loja_id']]);
        $ultima = $st->fetch();
        if (!$ultima) {
            responder([
                'colaborador' => ['nome' => $ficha['nome'], 'cargo' => $ficha['cargo'],
                                  'horario' => $ficha['horario'], 'loja' => $ficha['loja']],
                'escala' => null,
                'aviso'  => 'A escala da sua loja ainda não foi publicada.',
            ]);
        }
        $inicio = $ultima['inicio'];
        $fim    = $ultima['fim'];
    }

    // Somente escala publicada. Rascunho não vaza.
    $st = bd()->prepare(
        'SELECT grade, inicio, fim, publicada_em FROM escalas
          WHERE loja_id = ? AND inicio = ? AND fim = ? AND publicada = 1 LIMIT 1');
    $st->execute([$ficha['loja_id'], $inicio, $fim]);
    $esc = $st->fetch();

    if (!$esc) {
        responder([
            'colaborador' => ['nome' => $ficha['nome'], 'cargo' => $ficha['cargo'],
                              'horario' => $ficha['horario'], 'loja' => $ficha['loja']],
            'escala' => null,
            'aviso'  => 'Não há escala publicada para este período.',
        ]);
    }

    $grade = json_decode($esc['grade'], true);
    $minha = $grade[$ficha['id']] ?? null;
    if (!is_array($minha)) {
        responder([
            'colaborador' => ['nome' => $ficha['nome'], 'cargo' => $ficha['cargo'],
                              'horario' => $ficha['horario'], 'loja' => $ficha['loja']],
            'escala' => null,
            'aviso'  => 'Você não aparece nesta escala. Fale com o responsável.',
        ]);
    }

    // Monta o calendário só com os dias desta pessoa.
    $dias   = [];
    $atual  = new DateTimeImmutable($inicio);
    $folgas = 0;
    $trabalhados = 0;
    foreach ($minha as $i => $codigo) {
        $d = $atual->modify("+{$i} day");
        if ($d->format('Y-m-d') > $fim) break;
        $info = descreverDia((string)$codigo, $ficha['horario']);
        if ($info['tipo'] === 'folga') $folgas++;
        if ($info['tipo'] === 'trabalho') $trabalhados++;
        $dias[] = [
            'data'      => $d->format('Y-m-d'),
            'dia'       => (int)$d->format('j'),
            'mes'       => (int)$d->format('n'),
            'semana'    => (int)$d->format('w'),
            'nomeDia'   => NOMES_DIA[(int)$d->format('w')],
            'siglaDia'  => SIGLA_DIA[(int)$d->format('w')],
            'codigo'    => (string)$codigo,
            'tipo'      => $info['tipo'],
            'rotulo'    => $info['rotulo'],
        ];
    }

    // Próximas folgas, contando de hoje
    $hoje = (new DateTimeImmutable('today'))->format('Y-m-d');
    $proximas = array_values(array_filter($dias,
        fn($d) => $d['tipo'] === 'folga' && $d['data'] >= $hoje));

    responder([
        'colaborador' => [
            'nome'    => $ficha['nome'],
            'cargo'   => $ficha['cargo'],
            'horario' => $ficha['horario'],
            'loja'    => $ficha['loja'],
        ],
        'escala' => [
            'inicio'       => $inicio,
            'fim'          => $fim,
            'publicada_em' => $esc['publicada_em'],
            'dias'         => $dias,
        ],
        'resumo' => [
            'folgas'      => $folgas,
            'trabalhados' => $trabalhados,
            'proximas'    => array_slice($proximas, 0, 4),
        ],
    ]);

// -----------------------------------------------------------------------------
case 'meus_periodos':
// -----------------------------------------------------------------------------
    $ficha = fichaDoUsuario($u);
    $st = bd()->prepare(
        'SELECT inicio, fim, publicada_em FROM escalas
          WHERE loja_id = ? AND publicada = 1
          ORDER BY inicio DESC LIMIT 12');
    $st->execute([$ficha['loja_id']]);
    responder(['periodos' => $st->fetchAll()]);

// -----------------------------------------------------------------------------
default:
    falhar('Ação desconhecida.', 404);
}
