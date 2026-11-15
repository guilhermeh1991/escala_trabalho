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
const Documento = require('../src/motor/documento.js');

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

/* A falha que estes casos protegem: cargos diferentes no mesmo grupo genérico
   (balcão) deslocavam o contador de domingo, permitindo que todos os
   BALCONISTAS recebessem folga no mesmo domingo. */
function domingosPorCargo(res, equipe, cargo) {
  const ids = equipe.filter(c => c.cargo === cargo).map(c => c.id);
  return res.days.map((d, i) => d.getDay() === 0
    ? ids.filter(id => res.grid[id][i] === 'X').length
    : null).filter(n => n !== null);
}

const equipeDomingo = [
  ['B1', 'BALCONISTA'], ['R1', 'REPOSITOR'], ['R2', 'REPOSITOR'],
  ['B2', 'BALCONISTA'], ['R3', 'REPOSITOR'], ['R4', 'REPOSITOR'],
  ['B3', 'BALCONISTA'], ['R5', 'REPOSITOR'], ['R6', 'REPOSITOR']
].map(([nome, cargo], i) => ({
  id: 'dom' + i, nome, cargo, horario: '08:00', ativo: true, ausencias: []
}));
const paramsDomingo = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6,
  inicioSemana:0, inicio:'2026-08-02', fim:'2026-08-22', minCaixa:0, minBalcao:0,
  minFarma:0, minSubger:0, minDia:{0:0,1:0,2:0,3:0,4:0,5:0,6:0}};
const resDomingo = E.gerarEscala(equipeDomingo, paramsDomingo);
conferir('3 pessoas do mesmo cargo: 1 folga por domingo',
  JSON.stringify(domingosPorCargo(resDomingo, equipeDomingo, 'BALCONISTA')) === '[1,1,1]' ? 1 : 0, 1);

const equipeCincoDomingos = [
  ['C1', 'CAIXA'], ['A1', 'AX. LOJA'], ['A2', 'AX. LOJA'],
  ['C2', 'CAIXA'], ['A3', 'AX. LOJA'], ['A4', 'AX. LOJA'],
  ['C3', 'CAIXA'], ['A5', 'AX. LOJA'], ['A6', 'AX. LOJA'],
  ['C4', 'CAIXA'], ['A7', 'AX. LOJA'], ['A8', 'AX. LOJA'],
  ['C5', 'CAIXA']
].map(([nome, cargo], i) => ({
  id: 'cinco' + i, nome, cargo, horario: '08:00', ativo: true, ausencias: []
}));
const resCincoDomingos = E.gerarEscala(equipeCincoDomingos, paramsDomingo);
conferir('5 pessoas do mesmo cargo: folgas 2, 2 e 1 nos domingos',
  JSON.stringify(domingosPorCargo(resCincoDomingos, equipeCincoDomingos, 'CAIXA').sort()) === '[1,2,2]' ? 1 : 0, 1);

/* A falha que este caso protege: no 5x2 a âncora era só uma preferência,
   então ao gerar meses futuros o motor podia antecipar outro domingo e
   juntar colaboradores cujos ciclos deveriam continuar separados. */
function domingosDeFolga(res, colaborador) {
  return res.days.map((d, i) => d.getDay() === 0 && res.grid[colaborador.id][i] === 'X'
    ? d.toISOString().slice(0, 10) : null).filter(Boolean);
}
const equipeComHistorico = [
  ['A', '2026-08-02'], ['B', '2026-08-09'], ['C', '2026-08-16']
].map(([nome, primeiroDomingo]) => ({
  id:nome, nome, cargo:'CAIXA', horario:'08:00', ativo:true, ausencias:[], primeiroDomingo
}));
const paramsFuturos = Object.assign({}, paramsDomingo, {inicio:'2026-10-04', fim:'2026-10-31'});
const resFuturo = E.gerarEscala(equipeComHistorico, paramsFuturos);
conferir('âncora de agosto mantém o ciclo de outubro para A',
  JSON.stringify(domingosDeFolga(resFuturo, equipeComHistorico[0])) === '["2026-10-04","2026-10-25"]' ? 1 : 0, 1);
conferir('âncora de agosto mantém o ciclo de outubro para B',
  JSON.stringify(domingosDeFolga(resFuturo, equipeComHistorico[1])) === '["2026-10-11"]' ? 1 : 0, 1);
conferir('âncora de agosto mantém o ciclo de outubro para C',
  JSON.stringify(domingosDeFolga(resFuturo, equipeComHistorico[2])) === '["2026-10-18"]' ? 1 : 0, 1);

/* A falha que este caso protege: sem data informada, a posição da pessoa
   na lista era tratada como histórico de domingos trabalhados e forçava uma
   segunda folga para a terceira farmacêutica no primeiro domingo disponível. */
const farmasSemHistorico = [
  'ROBERTA', 'PRISCILA', 'MIANGUE'
].map((nome, i) => ({
  id:'farm' + i, nome, cargo:'FARMACÊUTICO', horario:['07:00', '11:00', '14:40'][i], ativo:true, ausencias:[]
}));
const paramsNovembro = Object.assign({}, paramsDomingo, {inicioSemana:'P', inicio:'2026-11-11', fim:'2026-12-10'});
const resNovembro = E.gerarEscala(farmasSemHistorico, paramsNovembro);
conferir('sem domingo informado não presume histórico para farmacêuticos',
  JSON.stringify(farmasSemHistorico.map(c => domingosDeFolga(resNovembro, c))) ===
  '[["2026-11-15","2026-12-06"],["2026-11-22"],["2026-11-29"]]' ? 1 : 0, 1);

/* Duas âncoras iguais são uma escolha do usuário: ambas devem permanecer,
   mesmo que a cobertura do cargo fique menor naquele domingo. */
const farmasComConflito = [
  ['ROBERTA', '2026-11-15'], ['PRISCILA', '2026-11-15'], ['MIANGUE', '2026-11-29']
].map(([nome, primeiroDomingo], i) => ({
  id:'conflito' + i, nome, cargo:'FARMACÊUTICO', horario:['07:00', '11:00', '14:40'][i], ativo:true, ausencias:[], primeiroDomingo
}));
const resConflito = E.gerarEscala(farmasComConflito, paramsNovembro);
conferir('âncoras iguais permanecem no domingo informado pelo usuário',
  JSON.stringify(farmasComConflito.map(c => domingosDeFolga(resConflito, c))) ===
  '[["2026-11-15","2026-12-06"],["2026-11-15","2026-12-06"],["2026-11-29"]]' ? 1 : 0, 1);

/* A reserva de fase também vale quando um dos colegas veio com âncora: as
   pessoas automáticas devem ocupar as outras fases do ciclo antes de repetir
   a que já está marcada pela pessoa usuária. */
function maiorFolgaDeCargoNoDomingo(res, equipe, cargo){
  return Math.max(0, ...domingosPorCargo(res, equipe, cargo));
}
const paramsDomingoAncorado = Object.assign({}, base, {
  modelo:'5x2', folgasSemana:2, inicioSemana:'P',
  inicio:'2026-12-11', fim:'2027-01-10', minCaixa:2, minBalcao:4,
  minFarma:2, minSubger:1, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}
});
const farmaPriscila = equipe => equipe.find(c => c.nome === 'PRISCILA');
const l330PriscilaAncorada = JSON.parse(JSON.stringify(L330));
farmaPriscila(l330PriscilaAncorada).primeiroDomingo = '2026-11-22';
const resDomingoAncorado = E.gerarEscala(l330PriscilaAncorada, paramsDomingoAncorado);
conferir('âncora de Priscila reserva a fase antes das colegas automáticas',
  maiorFolgaDeCargoNoDomingo(resDomingoAncorado, l330PriscilaAncorada, 'FARMACÊUTICO') <= 1 ? 1 : 0, 1);
conferir('âncora de Priscila mantém o ciclo em dezembro/janeiro',
  JSON.stringify(domingosDeFolga(resDomingoAncorado, farmaPriscila(l330PriscilaAncorada))) ===
  '["2026-12-13","2027-01-03"]' ? 1 : 0, 1);

/* Estado transportado de uma grade só existe quando a linha cobre o período
   inteiro. Todo código diferente de trabalho encerra a sequência. */
const estadoExtraido = E.estadoFinalDaGrade({
  a:['','X','','FC','','F','','AT','','LC','','',''],
  b:['','','','','','','',''],
  curta:['','']
}, '2026-10-25', '2026-11-06');
conferir('estado final conta apenas trabalho consecutivo no fim',
  estadoExtraido.a && estadoExtraido.a.diasDesdeFolga === 3 ? 1 : 0, 1);
conferir('estado final conta domingos consecutivos trabalhados',
  estadoExtraido.a && estadoExtraido.a.domTrabConsec === 0 ? 1 : 0, 1);
conferir('estado final ignora linha curta', Object.hasOwn(estadoExtraido, 'curta') ? 0 : 1, 1);

const eqContinuidade = mk([
  ['G','GERENTE','07:00',true], ['A','CAIXA','08:00'], ['B','CAIXA','10:00']
]);
const pContinuidade = {
  modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  inicio:'2026-11-02', fim:'2026-11-15', minCaixa:0, minBalcao:0,
  minFarma:0, minSubger:0, minDia:{0:0,1:0,2:0,3:0,4:0,5:0,6:0}
};
const eqComSeisDias = eqContinuidade.map(c => c.id === 'c1'
  ? Object.assign({}, c, {diasDesdeFolga:6}) : c);
const resContinuidade = E.gerarEscala(eqComSeisDias, pContinuidade);
conferir('seis dias anteriores forçam folga no primeiro dia novo',
  resContinuidade.grid.c1[0] === 'X' ? 1 : 0, 1);

const eqComDoisDomingos = eqContinuidade.map(c => c.id === 'c1'
  ? Object.assign({}, c, {domTrabConsec:2}) : c);
const pDomingoContinuidade = Object.assign({}, pContinuidade, {inicio:'2026-11-01', fim:'2026-11-14'});
const resDomingoContinuidade = E.gerarEscala(eqComDoisDomingos, pDomingoContinuidade);
conferir('dois domingos anteriores forçam folga no próximo domingo',
  resDomingoContinuidade.grid.c1[0] === 'X' ? 1 : 0, 1);
const resEditado = Object.assign({}, resDomingoContinuidade, {
  days: resDomingoContinuidade.days.slice(),
  grid: Object.assign({}, resDomingoContinuidade.grid, {
    c1: resDomingoContinuidade.grid.c1.slice()
  })
});
resEditado.grid.c1[0] = '';
conferir('validação acusa terceiro domingo após edição manual',
  E.validar(resEditado, eqComDoisDomingos).alertas.some(a => a.tipo === 'domingo') ? 1 : 0, 1);

/* Uma entrada alterada no dia seguinte não pode reduzir o repouso de 11 horas.
   A regra lê o mapa de horários diário, sem mudar a grade nem a cobertura. */
const eqInterjornada = [{id:'ij1', nome:'TURNO FECHAMENTO', cargo:'CAIXA', horario:'13:45 AS 23:00',
  jornada:{modelo:'1345-2300', entrada:'13:45', saida:'23:00', intervalo:60}, ativo:true, ausencias:[]}];
const pInterjornada = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  inicio:'2026-11-02', fim:'2026-11-04', minCaixa:0, minBalcao:0, minFarma:0, minSubger:0,
  minDia:{0:0,1:0,2:0,3:0,4:0,5:0,6:0}};
const resInterjornada = E.gerarEscala(eqInterjornada, pInterjornada);
resInterjornada.grid.ij1 = ['','',''];
resInterjornada.horas = {ij1:{1:'07:00'}};
conferir('validação acusa descanso menor que 11h',
  E.validar(resInterjornada, eqInterjornada).alertas.some(a=>a.tipo==='interjornada') ? 1 : 0, 1);
conferir('verificador independente acusa descanso menor que 11h',
  verificar(resInterjornada, eqInterjornada, pInterjornada, {}).some(v=>v.regra==='R11-interjornada') ? 1 : 0, 1);

/* ------------------------------------------------------------------ */
console.log('\n=== 4. Documento impresso ===\n');

const descricoes = [
  ['GERENTE',       'gerencia', ''],
  ['SUBGERENTE',    'subger',   ''],
  ['FARMACÊUTICO',  'farma',    ''],
  ['BALCONISTA',    'balcao',   ''],
  ['CAIXA',         'caixa',    ''],
  ['SUB/FARMA',     'subger',   'Subgerente · Farmacêutico'],
  ['AX. LOJA',      'apoio',    'Auxiliar de loja'],
  ['REPOSITOR',     'apoio',    'Repositor']
];
descricoes.forEach(([cargo, faixa, esperado])=>{
  const obtido = Documento.descricaoCargoImpressao({cargo}, faixa);
  conferir(`descrição ${cargo}`, obtido === esperado ? 1 : 0, 1);
});

const repetidos = Documento.nomesDuplicadosDocumento([
  {id:'1', nome:' José da Silva '},
  {id:'2', nome:'JOSE  DA SILVA'},
  {id:'3', nome:'Maria'}
]);
conferir('detecta nome com acento/espaços', repetidos.length, 1);
conferir('não remove nomes duplicados', repetidos[0].quantidade, 2);
conferir('mantém nomes distintos', Documento.nomesDuplicadosDocumento([
  {nome:'Lucas Araújo'}, {nome:'Lucas Hatewa'}
]).length, 0, '<=');

const pdfMinimo = Documento.gerarPdfEscala({
  days:[new Date(2026,7,11)],
  grid:{c1:['']},
  ativos:[{id:'c1', nome:'JOSÉ', cargo:'CAIXA'}],
  P:{minCaixa:1, minBalcao:0, minFarma:0, minSubger:0},
  cob:[{cx:1, bl:0, fa:0, sg:0, total:1}],
  interjornadas:{c1:{0:{txt:'Sai 23:00 em 10/08 e entra 07:00 em 11/08: 8h00 de descanso, mínimo 11h'}}},
  intervaloDe:()=> '12:00–13:00',
  periodo:'11/08/2026 a 11/08/2026',
  horaDe:()=> '07:00',
  horaSaidaDe:()=> '16:24',
  faixaDe:()=> 4,
  rotuloFaixa:()=> 'Caixas',
  descricaoCargo:(c)=> Documento.descricaoCargoImpressao(c, 'caixa')
}, 'Loja teste');
const pdfTexto = Buffer.from(pdfMinimo).toString('latin1');
conferir('PDF gerado começa corretamente', pdfTexto.slice(0,8) === '%PDF-1.4' ? 1 : 0, 1);
conferir('PDF inclui jornada completa, intervalo e nota de descanso',
  pdfTexto.includes('JORNADA') && pdfTexto.includes('07:00') && pdfTexto.includes('16:24')
    && pdfTexto.includes('INTERVALO') && pdfTexto.includes('Revisar descanso:') ? 1 : 0, 1);

const marcasMonocromaticas = typeof Documento.marcaMonocromaticaDocumento === 'function'
  ? ['X', 'FC', 'F', 'AT', 'LC'].map(Documento.marcaMonocromaticaDocumento) : [];
conferir('status impressos possuem padrões sem depender de cor',
  JSON.stringify(marcasMonocromaticas) ===
  '["status-x","status-fc","status-f","status-at","status-lc"]' ? 1 : 0, 1);
conferir('alertas de cobertura usam marcadores textuais',
  typeof Documento.marcadorCoberturaDocumento === 'function' &&
  Documento.marcadorCoberturaDocumento('minimo') === '!' &&
  Documento.marcadorCoberturaDocumento('alvo') === '~' ? 1 : 0, 1);

/* ------------------------------------------------------------------ */
console.log('');
if (falhas.length) {
  console.log(`RESULTADO: ${falhas.length} limiar(es) rompido(s) — ${falhas.join(', ')}\n`);
  process.exit(1);
}
console.log('RESULTADO: todos os limiares atendidos\n');
