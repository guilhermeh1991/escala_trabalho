#!/usr/bin/env node
/**
 * Suíte de testes do motor de escala.
 *
 *     node testes/executar.js
 *
 * Sai com código 1 se qualquer limiar for rompido, o que faz o CI falhar.
 * Os limiares vêm das medições registradas em docs/03-algoritmo.md e existem
 * para impedir que uma mudança no motor piore a escala sem ninguém perceber.
 */
const E = require('../src/motor/motor.js');
const S = require('./simular.js');
const {verificar, metricas} = require('./verificador.js');

const LIMIARES = {
  escalasLimpas5x2:   90,   // % de cenários sem nenhuma violação trabalhista
  escalasLimpas6x1:   90,
  folgasEmPar:        94,   // % de folgas em dias seguidos (só no 5x2)
  desvioEquipeMax:   2.00,  // oscilação da equipe em loja, dia a dia
  diasSemFolgaMax:   1.50,  // média por escala
  casosReaisLimpos:   100,  // % das lojas reais sem violação trabalhista
};

const REGRAS_TRABALHISTAS = [
  'R1-folgas-semana', 'R2-sequencia', 'R3-domingo',
  'R4-par', 'R6-gerente', 'R8-ausencia', 'R10-6x1-domingo'
];

let falhas = [];
function conferir(rotulo, valor, limiar, comparador = '>=') {
  const ok = comparador === '>=' ? valor >= limiar : valor <= limiar;
  const seta = comparador === '>=' ? '≥' : '≤';
  console.log(`  ${ok ? 'ok   ' : 'FALHA'}  ${rotulo.padEnd(34)} ${String(valor).padStart(7)}  (exigido ${seta} ${limiar})`);
  if (!ok) falhas.push(rotulo);
  return ok;
}

function estadoInicial(equipe, P) {
  const est = {};
  equipe.filter(c => !c.gerente).forEach((c, k) => {
    est[c.id] = (c.diasDesdeFolga != null && c.diasDesdeFolga !== '')
      ? Number(c.diasDesdeFolga)
      : (k % Math.max(2, P.maxSeq - 1));
  });
  return est;
}

/* ------------------------------------------------------------------ */
console.log('\n=== 1. Simulação em massa (300 cenários aleatórios) ===\n');
S.resetar(12345);

const porModelo = {'5x2': {n:0, limpos:0}, '6x1': {n:0, limpos:0}};
const agregado = {desvio:0, par:0, parN:0, semFolga:0, n:0};
const violacoes = {};
let quebras = 0;

for (let n = 1; n <= 300; n++) {
  const {equipe, P} = S.cenario(n);
  let res;
  try {
    res = E.gerarEscala(equipe, P);
  } catch (err) {
    quebras++;
    console.log(`  cenário ${n} lançou exceção: ${err.message}`);
    continue;
  }
  const P2 = Object.assign({cicloDomingo:3, maxSeq:6, minFarma:2, minSubger:1}, P);
  const V = verificar(res, equipe, P2, estadoInicial(equipe, P));
  const M = metricas(res, equipe, P2);

  const legais = V.filter(v => REGRAS_TRABALHISTAS.includes(v.regra));
  legais.forEach(v => violacoes[v.regra] = (violacoes[v.regra] || 0) + 1);

  const m = P.modelo || '5x2';
  porModelo[m].n++;
  if (!legais.length) porModelo[m].limpos++;

  agregado.desvio += M.desvioEquipe;
  agregado.semFolga += M.diasSemFolga;
  agregado.n++;
  if (m === '5x2') { agregado.par += M.pctPar; agregado.parN++; }
}

const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : 100;
conferir('escalas limpas — 5x2 (%)', pct(porModelo['5x2'].limpos, porModelo['5x2'].n), LIMIARES.escalasLimpas5x2);
conferir('escalas limpas — 6x1 (%)', pct(porModelo['6x1'].limpos, porModelo['6x1'].n), LIMIARES.escalasLimpas6x1);
conferir('folgas em par — 5x2 (%)', +(agregado.par / Math.max(1, agregado.parN)).toFixed(1), LIMIARES.folgasEmPar);
conferir('desvio da equipe por dia', +(agregado.desvio / agregado.n).toFixed(2), LIMIARES.desvioEquipeMax, '<=');
conferir('dias sem folga por escala', +(agregado.semFolga / agregado.n).toFixed(2), LIMIARES.diasSemFolgaMax, '<=');
conferir('exceções no motor', quebras, 0, '<=');

if (Object.keys(violacoes).length) {
  console.log('\n  violações remanescentes (esperadas em cenários apertados):');
  Object.entries(violacoes).sort((a,b) => b[1]-a[1])
    .forEach(([k,v]) => console.log(`    ${k.padEnd(22)} ${v}`));
}

/* ------------------------------------------------------------------ */
console.log('\n=== 2. Lojas reais ===\n');

const mk = l => l.map((r, i) => ({
  id: 'c' + i, nome: r[0], cargo: r[1], horario: r[2], gerente: !!r[3],
  ativo: true, ausencias: r[4] || [], domTrabConsec: null,
  diasDesdeFolga: null, folgaFixa: null, primeiroDomingo: null
}));

const L330 = mk([
  ['GUILHERME','GERENTE','07:00 AS 16:20',true], ['RENATA','SUBGERENTE','10:00 AS 18:20'],
  ['QUESNEL','SUBGERENTE','14:40 AS 23:00'], ['ROBERTA','FARMACÊUTICO','07:00 AS 15:20'],
  ['PRISCILA','FARMACÊUTICO','11:00 AS 19:20'], ['MIANGUE','FARMACÊUTICO','14:40 AS 23:00'],
  ['JESSICA','BALCONISTA','08:00 AS 16:20'], ['LUCAS ARAUJO','BALCONISTA','10:00 AS 18:20'],
  ['MIRIÃ','CAIXA','07:00 AS 15:20'], ['JULIA','CAIXA','11:00 AS 19:20'],
  ['GIANE','CAIXA','13:00 AS 21:20'], ['LUCAS HATEWA','CAIXA','14:40 AS 23:00'],
  ['LORENZO','AX. LOJA','09:00 AS 18:00']
]);
const L332 = mk([
  ['MAYARA','GERENTE','07:00 AS 16:20',true], ['MIRIAN','SUB/FARMA','07:00 AS 15:20'],
  ['VANDERLEIA','SUBGERENTE','14:40 AS 23:00'], ['EDUARDA','SUBGERENTE','14:40 AS 23:00'],
  ['LETICIA','FARMACÊUTICO','11:00 AS 19:20'], ['ANA PAULA','FARMACÊUTICO','14:40 AS 23:00'],
  ['MARIA','BALCONISTA','09:00 AS 18:00'], ['ANNA','BALCONISTA','12:00 AS 20:20'],
  ['RAQUEL','CAIXA','07:00 AS 15:20'], ['NICOLE','CAIXA','07:00 AS 15:20'],
  ['FELIPE','CAIXA','13:00 AS 21:20'], ['ELOISA','CAIXA','14:40 AS 23:00'],
  ['ESMERALDA','CAIXA','14:40 AS 23:00'], ['ALINE','CAIXA','14:40 AS 23:00'],
  ['LIVIA','REPOSITOR','08:00 AS 17:00'], ['ROSA','AX. LOJA','08:00 AS 17:00']
]);

const base = {cicloDomingo:3, maxSeq:6, minFarma:2, minSubger:1, subgerFds:true,
              inicioSemana:'P', prioridade:'par'};
const casosReais = [];
[['5x2',2],['6x1',1]].forEach(([modelo, fsem]) => {
  ['2026-07-11','2026-08-11','2026-09-11'].forEach(inicio => {
    const fim = new Date(inicio + 'T12:00'); fim.setMonth(fim.getMonth() + 1);
    const iso = d => d.toISOString().slice(0,10);
    casosReais.push(['330 ' + modelo + ' ' + inicio.slice(0,7), L330,
      Object.assign({}, base, {modelo, folgasSemana:fsem, inicio, fim:iso(fim),
        minCaixa:2, minBalcao: modelo === '6x1' ? 5 : 4,
        minDia: modelo === '6x1' ? {0:8,1:9,2:11,3:11,4:11,5:10,6:10}
                                 : {0:7,1:7,2:9,3:9,4:9,5:9,6:9}})]);
    casosReais.push(['332 ' + modelo + ' ' + inicio.slice(0,7), L332,
      Object.assign({}, base, {modelo, folgasSemana:fsem, inicio, fim:iso(fim),
        minCaixa:3, minBalcao: modelo === '6x1' ? 5 : 4,
        minDia: modelo === '6x1' ? {0:11,1:11,2:13,3:11,4:13,5:11,6:13}
                                 : {0:9,1:9,2:11,3:9,4:11,5:9,6:11}})]);
  });
});

let reaisLimpos = 0;
casosReais.forEach(([rotulo, equipe, P]) => {
  const res = E.gerarEscala(equipe, P);
  const V = verificar(res, equipe, P, estadoInicial(equipe, P));
  const legais = V.filter(v => REGRAS_TRABALHISTAS.includes(v.regra));
  const cobertura = V.filter(v => v.regra.startsWith('R7')).length;
  if (!legais.length) reaisLimpos++;
  console.log(`  ${legais.length ? 'FALHA' : 'ok   '}  ${rotulo.padEnd(22)}` +
              ` trabalhista: ${legais.length}  cobertura: ${cobertura}`);
  legais.slice(0,3).forEach(v => console.log(`         ! ${v.regra} ${v.quem} — ${v.txt}`));
});
console.log('');
conferir('lojas reais sem violação (%)', pct(reaisLimpos, casosReais.length), LIMIARES.casosReaisLimpos);

/* ------------------------------------------------------------------ */
console.log('\n=== 3. Propriedades do motor ===\n');

const eqDet = mk([['G','GERENTE','07:00',true],['A','SUBGERENTE','10:00'],['B','FARMACÊUTICO','07:00'],
                  ['C','FARMACÊUTICO','14:40'],['D','CAIXA','07:00'],['E','CAIXA','11:00']]);
const pDet = Object.assign({}, base, {modelo:'5x2', folgasSemana:2,
  inicio:'2026-08-11', fim:'2026-09-10', minCaixa:1, minBalcao:1});

const a = JSON.stringify(E.gerarEscala(eqDet, pDet).grid);
const b = JSON.stringify(E.gerarEscala(eqDet, pDet).grid);
conferir('mesma entrada, mesma saída', a === b ? 1 : 0, 1);

const t0 = Date.now();
for (let i = 0; i < 10; i++) E.gerarEscala(L330, Object.assign({}, base,
  {modelo:'5x2', folgasSemana:2, inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:4}));
const ms = Math.round((Date.now() - t0) / 10);
conferir('tempo por escala (ms)', ms, 1500, '<=');

// férias e atestado precisam sair exatamente como foram lançados
const eqAus = JSON.parse(JSON.stringify(L330));
eqAus[2].ausencias = [{tipo:'F', ini:'2026-08-15', fim:'2026-08-30'}];
eqAus[7].ausencias = [{tipo:'AT', ini:'2026-08-20', fim:'2026-08-22'}];
const resAus = E.gerarEscala(eqAus, Object.assign({}, base,
  {modelo:'5x2', folgasSemana:2, inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:3}));
const vAus = verificar(resAus, eqAus, Object.assign({}, base, {folgasSemana:2}), estadoInicial(eqAus, base));
conferir('ausências preservadas', vAus.filter(v => v.regra === 'R8-ausencia').length, 0, '<=');

/* ------------------------------------------------------------------ */
console.log('');
if (falhas.length) {
  console.log(`RESULTADO: ${falhas.length} limiar(es) rompido(s) — ${falhas.join(', ')}\n`);
  process.exit(1);
}
console.log('RESULTADO: todos os limiares atendidos\n');
