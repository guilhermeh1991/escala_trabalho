/* =========================================================================
   COBERTURA INTRADIÁRIA POR FUNÇÃO

   O mínimo diário responde "quantas pessoas trabalharam neste dia". Não
   responde "houve alguém no balcão às 14h". Uma loja pode ter 9 pessoas no dia
   e mesmo assim ficar sem caixa das 12h às 13h, porque todo mundo almoça junto.
   Este módulo responde a segunda pergunta.

   CRITÉRIOS DE CÁLCULO

   1. Presença vem da jornada efetivamente cadastrada: modelo estruturado,
      ajuste manual de horário na grade, ou o texto legado quando traz entrada
      e saída. Nada é inventado — sem dado, o resultado é "não verificável",
      não zero e não "tudo certo".

   2. Intervalos são descontados da presença. Um intervalo declarado vira
      ausência naquele trecho; intervalo desconhecido é registrado como lacuna.

   3. Os limites são semiabertos: [entrada, saída). Quem sai 15:00 não conta
      às 15:00; quem entra 15:00 conta. Assim a troca de turno sem lacuna não
      gera dupla contagem nem buraco falso.

   4. A linha do tempo é segmentada exatamente nos instantes em que presença ou
      demanda mudam — nenhuma grade fixa de 30 ou 60 minutos. Uma lacuna de 10
      minutos aparece como lacuna de 10 minutos.

   5. Turnos que atravessam a meia-noite contribuem para os dois dias: o trecho
      após 24h do dia anterior é transportado para o começo do dia seguinte.

   6. Cada pessoa é contada uma única vez no total do período, mesmo quando
      atende a várias funções. Ver `atendePor` abaixo.
   ========================================================================= */

const DIA_MIN = 1440;

/* ---------- utilidades de tempo ---------- */
function minutosDe(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return (h >= 0 && h < 24 && min >= 0 && min < 60) ? h * 60 + min : null;
}
function horaDe(minutos) {
  const n = ((minutos % DIA_MIN) + DIA_MIN) % DIA_MIN;
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
/* Rótulo que preserva 24:00 como fim de dia em vez de voltar para 00:00. */
function rotuloFim(minutos) {
  return minutos >= DIA_MIN && minutos % DIA_MIN === 0 ? '24:00' : horaDe(minutos);
}

/* ---------- funções e competências (item 4) ----------
   Quais cargos atendem cada função é configuração explícita da loja, nunca
   dedução. Repositor e auxiliar não viram balcão por conta própria. */
const FUNCOES_PADRAO = {
  caixa:        { nome: 'Caixa',        cargos: ['CAIXA'] },
  balcao:       { nome: 'Balcão',       cargos: ['BALCONISTA'] },
  farmaceutico: { nome: 'Farmacêutico', cargos: ['FARMACEUTICO', 'FARMACÊUTICO', 'SUB/FARMA'] },
  subgerente:   { nome: 'Subgerente',   cargos: ['SUBGERENTE', 'SUB/FARMA'] },
};

function normalizarCargo(v) {
  return String(v || '').trim().toUpperCase();
}

/** Definição das funções desta loja, com o padrão como ponto de partida. */
function funcoesDaLoja(P) {
  const cfg = (P && P.funcoes) || null;
  if (!cfg || typeof cfg !== 'object') return JSON.parse(JSON.stringify(FUNCOES_PADRAO));
  const saida = {};
  Object.keys(cfg).forEach(id => {
    const f = cfg[id];
    if (!f || typeof f !== 'object') return;
    saida[id] = {
      nome: String(f.nome || id),
      cargos: Array.isArray(f.cargos) ? f.cargos.map(normalizarCargo) : [],
    };
  });
  return Object.keys(saida).length ? saida : JSON.parse(JSON.stringify(FUNCOES_PADRAO));
}

/** A pessoa atende esta função? Comparação exata de cargo, sem heurística. */
function atendePor(colab, funcao) {
  const cargo = normalizarCargo(colab && colab.cargo);
  if (!cargo) return false;
  return (funcao.cargos || []).map(normalizarCargo).includes(cargo);
}

/* ---------- expediente da loja (item 2) ----------
   Sem configuração, o dia inteiro é expediente: a cobertura intradiária só
   passa a cobrar horário onde a loja declarou seu funcionamento. */
function expedienteDoDia(P, diaSemana) {
  const cfg = (P && P.expediente) || null;
  if (!cfg || typeof cfg !== 'object') return null;      // não configurado
  const doDia = cfg[String(diaSemana)] !== undefined ? cfg[String(diaSemana)] : cfg[diaSemana];
  if (doDia === undefined || doDia === null) return null;
  if (doDia === false || doDia === 'fechado') return { fechado: true, janelas: [] };
  const lista = Array.isArray(doDia) ? doDia : [doDia];
  const janelas = [];
  lista.forEach(j => {
    if (!j || typeof j !== 'object') return;
    const ini = minutosDe(j.ini), fimBruto = minutosDe(j.fim);
    if (ini == null || fimBruto == null) return;
    // 00:00 como fim significa meia-noite do dia seguinte, não início do dia.
    const fim = fimBruto <= ini ? fimBruto + DIA_MIN : fimBruto;
    janelas.push({ ini, fim });
  });
  if (!janelas.length) return { fechado: true, janelas: [] };
  return { fechado: false, janelas };
}

/* ---------- faixas de demanda (item 2) ----------
   Cada faixa diz: neste intervalo, esta função precisa de tanta gente, sendo
   tanto meta e tanto piso obrigatório. O mínimo diário existente continua
   valendo como está — ele não vira exigência contínua do expediente inteiro. */
function faixasDoDia(P, diaSemana) {
  const cfg = (P && P.faixas) || null;
  if (!cfg || typeof cfg !== 'object') return [];
  const doDia = cfg[String(diaSemana)] !== undefined ? cfg[String(diaSemana)] : cfg[diaSemana];
  const lista = Array.isArray(doDia) ? doDia : [];
  const saida = [];
  lista.forEach(f => {
    if (!f || typeof f !== 'object') return;
    const ini = minutosDe(f.ini), fimBruto = minutosDe(f.fim);
    if (ini == null || fimBruto == null) return;
    const fim = fimBruto <= ini ? fimBruto + DIA_MIN : fimBruto;
    const meta = (f.meta == null || f.meta === '') ? null : Math.max(0, Number(f.meta));
    const piso = (f.obrigatorio == null || f.obrigatorio === '') ? null : Math.max(0, Number(f.obrigatorio));
    if (meta == null && piso == null) return;
    saida.push({ funcao: String(f.funcao || ''), ini, fim, meta, piso });
  });
  return saida;
}

/* ---------- presença de uma pessoa num dia ----------
   Devolve {trechos, lacuna, motivo}. `trechos` são intervalos [ini, fim) em
   minutos a partir das 00:00 do dia, já descontados os intervalos. Pode passar
   de 1440 quando a jornada atravessa a meia-noite. */
function presencaDoDia(colab, indiceDia, res, opcoes) {
  const codigo = String(((res.grid || {})[colab.id] || [])[indiceDia] || '');
  if (['X', 'FC', 'F', 'AT', 'LC'].includes(codigo)) {
    return { trechos: [], lacuna: false, motivo: 'folga-ou-ausencia' };
  }
  const leitor = (opcoes && opcoes.jornada) || null;
  const dados = leitor ? leitor(colab, indiceDia, res) : null;
  if (!dados || dados.entrada == null || dados.fim == null) {
    return { trechos: [], lacuna: true, motivo: 'jornada-incompleta' };
  }
  const { entrada, fim, intervalos, intervaloDesconhecido } = dados;
  if (fim <= entrada) return { trechos: [], lacuna: true, motivo: 'jornada-invalida' };

  let trechos = [{ ini: entrada, fim }];
  (intervalos || []).forEach(iv => {
    if (iv.ini == null || iv.fim == null || iv.fim <= iv.ini) return;
    const resto = [];
    trechos.forEach(t => {
      if (iv.fim <= t.ini || iv.ini >= t.fim) { resto.push(t); return; }
      if (iv.ini > t.ini) resto.push({ ini: t.ini, fim: iv.ini });
      if (iv.fim < t.fim) resto.push({ ini: iv.fim, fim: t.fim });
    });
    trechos = resto;
  });
  return {
    trechos,
    lacuna: !!intervaloDesconhecido,
    motivo: intervaloDesconhecido ? 'intervalo-desconhecido' : null,
  };
}

/* ---------- análise de um dia ---------- */
function analisarDia(ctx) {
  const { indiceDia, data, ativos, res, P, funcoes, opcoes } = ctx;
  const diaSemana = data.getDay();
  const expediente = expedienteDoDia(P, diaSemana);
  const faixas = faixasDoDia(P, diaSemana);

  if (expediente && expediente.fechado) {
    // Loja fechada não recebe falta de cobertura (item 5).
    return { dia: indiceDia, fechado: true, segmentos: [], alertas: [], lacunas: [] };
  }
  if (!faixas.length) {
    return { dia: indiceDia, fechado: false, segmentos: [], alertas: [], lacunas: [], semFaixas: true };
  }

  /* Presença de cada pessoa, incluindo o que transborda do dia anterior. */
  const presencas = [];
  const lacunas = [];
  ativos.forEach(c => {
    const hoje = presencaDoDia(c, indiceDia, res, opcoes);
    if (hoje.lacuna) lacunas.push({ colab: c.nome, motivo: hoje.motivo });
    hoje.trechos.forEach(t => {
      // Trecho dentro do dia; o excedente volta amanhã, não hoje.
      const fim = Math.min(t.fim, DIA_MIN);
      if (fim > t.ini) presencas.push({ id: c.id, nome: c.nome, cargo: c.cargo, ini: t.ini, fim });
    });
    if (indiceDia > 0) {
      const ontem = presencaDoDia(c, indiceDia - 1, res, opcoes);
      ontem.trechos.forEach(t => {
        if (t.fim <= DIA_MIN) return;                 // não atravessou a meia-noite
        const ini = Math.max(t.ini, DIA_MIN) - DIA_MIN;
        const fim = t.fim - DIA_MIN;
        if (fim > ini) presencas.push({ id: c.id, nome: c.nome, cargo: c.cargo, ini, fim, doDiaAnterior: true });
      });
    }
  });

  /* Pontos de corte: todo instante em que presença ou demanda muda. */
  const cortes = new Set();
  faixas.forEach(f => { cortes.add(f.ini); cortes.add(Math.min(f.fim, DIA_MIN)); });
  presencas.forEach(p => { cortes.add(p.ini); cortes.add(p.fim); });
  if (expediente) expediente.janelas.forEach(j => { cortes.add(j.ini); cortes.add(Math.min(j.fim, DIA_MIN)); });

  const marcos = Array.from(cortes).filter(v => v >= 0 && v <= DIA_MIN).sort((a, b) => a - b);
  const segmentos = [];
  const alertas = [];

  for (let k = 0; k < marcos.length - 1; k++) {
    const ini = marcos[k], fim = marcos[k + 1];
    if (fim <= ini) continue;
    const dentroDoExpediente = !expediente || expediente.janelas.some(j => ini >= j.ini && fim <= Math.min(j.fim, DIA_MIN));
    if (expediente && !dentroDoExpediente) continue;   // fora do expediente não se cobra cobertura

    /* Semiaberto: quem sai exatamente em `ini` não está presente no segmento. */
    const presentes = presencas.filter(p => p.ini <= ini && p.fim >= fim);
    const idsNoSegmento = new Set(presentes.map(p => p.id));

    faixas.forEach(f => {
      const fFim = Math.min(f.fim, DIA_MIN);
      if (f.ini > ini || fFim < fim) return;           // faixa não cobre este segmento
      const funcao = funcoes[f.funcao];
      if (!funcao) return;
      const escalados = presentes.filter(p => atendePor(p, funcao));
      const quantos = new Set(escalados.map(p => p.id)).size;
      const necessario = f.piso != null ? f.piso : f.meta;
      const deficit = Math.max(0, necessario - quantos);
      const seg = {
        dia: indiceDia, funcao: f.funcao, funcaoNome: funcao.nome,
        ini, fim, iniTexto: horaDe(ini), fimTexto: rotuloFim(fim),
        escalados: quantos, meta: f.meta, piso: f.piso, deficit,
        pessoas: escalados.map(p => p.nome),
        totalPresentes: idsNoSegmento.size,
      };
      if (f.piso != null && quantos < f.piso) {
        seg.situacao = 'bloqueio';
        alertas.push({
          colab: '—', tipo: 'cobertura-intradiaria', categoria: 'obrigatoria',
          obrigatoria: true, nivel: 'regra', base: 'politica-da-casa', dia: indiceDia,
          funcao: f.funcao, ini, fim,
          txt: `${('0' + data.getDate()).slice(-2)}/${('0' + (data.getMonth() + 1)).slice(-2)} ${horaDe(ini)}–${rotuloFim(fim)}: ${funcao.nome} ${quantos}/${f.piso} — abaixo do mínimo obrigatório da faixa`,
        });
      } else if (f.meta != null && quantos < f.meta) {
        seg.situacao = 'aviso';
        alertas.push({
          colab: '—', tipo: 'cobertura-intradiaria-meta', categoria: 'preferencia',
          obrigatoria: false, nivel: 'regra', base: 'politica-da-casa', dia: indiceDia,
          funcao: f.funcao, ini, fim,
          txt: `${('0' + data.getDate()).slice(-2)}/${('0' + (data.getMonth() + 1)).slice(-2)} ${horaDe(ini)}–${rotuloFim(fim)}: ${funcao.nome} ${quantos}/${f.meta} — abaixo da meta da faixa`,
        });
      } else {
        seg.situacao = 'ok';
      }
      segmentos.push(seg);
    });
  }

  return { dia: indiceDia, fechado: false, segmentos, alertas, lacunas };
}

/**
 * Analisa a cobertura intradiária de todo o período.
 * @param res    {days, grid, ativos, params, horas}
 * @param colabs lista de colaboradores
 * @param P      parâmetros da loja (expediente, faixas, funcoes)
 * @param opcoes {jornada: (colab, i, res) => {entrada, fim, intervalos, intervaloDesconhecido}}
 */
function analisarCobertura(res, colabs, P, opcoes) {
  const days = res.days || [];
  const ativos = (colabs || []).filter(c => c.ativo !== false);
  const funcoes = funcoesDaLoja(P);
  const dias = [];
  const alertas = [];
  const lacunas = [];

  days.forEach((data, i) => {
    const r = analisarDia({ indiceDia: i, data, ativos, res, P, funcoes, opcoes });
    dias.push(r);
    r.alertas.forEach(a => alertas.push(a));
    (r.lacunas || []).forEach(l => lacunas.push(Object.assign({ dia: i }, l)));
  });

  const configurado = dias.some(d => !d.semFaixas && !d.fechado);
  const bloqueios = alertas.filter(a => a.obrigatoria);
  const avisos = alertas.filter(a => !a.obrigatoria);

  /* Lacuna não vira passe livre: quando há bloqueio de faixa e também falta
     dado, o bloqueio permanece e a lacuna é reportada à parte (item 5). */
  return {
    configurado,
    dias,
    alertas,
    lacunas,
    resumo: {
      configurado,
      segmentos: dias.reduce((n, d) => n + d.segmentos.length, 0),
      bloqueios: bloqueios.length,
      avisos: avisos.length,
      lacunas: lacunas.length,
      diasFechados: dias.filter(d => d.fechado).length,
      validacaoParcial: lacunas.length > 0,
    },
  };
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined')
  module.exports = { analisarCobertura, funcoesDaLoja, atendePor, expedienteDoDia,
    faixasDoDia, presencaDoDia, minutosDe, horaDe, rotuloFim, FUNCOES_PADRAO };
