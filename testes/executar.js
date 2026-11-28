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
  escalasLimpas:      90,   // % de cenários sem nenhuma violação trabalhista
  folgasEmPar:        94,   // % de folgas em dias seguidos
  desvioEquipeMax:   2.00,  // oscilação da equipe em loja, dia a dia
  diasSemFolgaMax:   1.50,  // média por escala
  casosReaisLimpos:   100,  // % das lojas reais sem violação trabalhista
};

const REGRAS_TRABALHISTAS = [
  'R1-folgas-semana', 'R2-sequencia', 'R3-domingo',
  'R4-par', 'R6-gerente', 'R8-ausencia'
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

const geral = {n:0, limpos:0};
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

  geral.n++;
  if (!legais.length) geral.limpos++;

  agregado.desvio += M.desvioEquipe;
  agregado.semFolga += M.diasSemFolga;
  agregado.n++;
  agregado.par += M.pctPar;
  agregado.parN++;
}

const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : 100;
conferir('escalas limpas (%)', pct(geral.limpos, geral.n), LIMIARES.escalasLimpas);
conferir('folgas em par (%)', +(agregado.par / Math.max(1, agregado.parN)).toFixed(1), LIMIARES.folgasEmPar);
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

/* Equipes fictícias que reproduzem a composição de cargos e jornadas das duas
   curvas de movimento usadas na regressão. Os nomes são identificadores de
   teste, não pessoas. */
const L330 = mk([
  ['COLABORADOR 01','GERENTE','07:00 AS 16:20',true], ['COLABORADOR 02','SUBGERENTE','10:00 AS 18:20'],
  ['COLABORADOR 03','SUBGERENTE','14:40 AS 23:00'], ['COLABORADOR 04','FARMACÊUTICO','07:00 AS 15:20'],
  ['COLABORADOR 05','FARMACÊUTICO','11:00 AS 19:20'], ['COLABORADOR 06','FARMACÊUTICO','14:40 AS 23:00'],
  ['COLABORADOR 07','BALCONISTA','08:00 AS 16:20'], ['COLABORADOR 08','BALCONISTA','10:00 AS 18:20'],
  ['COLABORADOR 09','CAIXA','07:00 AS 15:20'], ['COLABORADOR 10','CAIXA','11:00 AS 19:20'],
  ['COLABORADOR 11','CAIXA','13:00 AS 21:20'], ['COLABORADOR 12','CAIXA','14:40 AS 23:00'],
  ['COLABORADOR 13','AX. LOJA','09:00 AS 18:00']
]);
const L332 = mk([
  ['COLABORADOR 14','GERENTE','07:00 AS 16:20',true], ['COLABORADOR 15','SUB/FARMA','07:00 AS 15:20'],
  ['COLABORADOR 16','SUBGERENTE','14:40 AS 23:00'], ['COLABORADOR 17','SUBGERENTE','14:40 AS 23:00'],
  ['COLABORADOR 18','FARMACÊUTICO','11:00 AS 19:20'], ['COLABORADOR 19','FARMACÊUTICO','14:40 AS 23:00'],
  ['COLABORADOR 20','BALCONISTA','09:00 AS 18:00'], ['COLABORADOR 21','BALCONISTA','12:00 AS 20:20'],
  ['COLABORADOR 22','CAIXA','07:00 AS 15:20'], ['COLABORADOR 23','CAIXA','07:00 AS 15:20'],
  ['COLABORADOR 24','CAIXA','13:00 AS 21:20'], ['COLABORADOR 25','CAIXA','14:40 AS 23:00'],
  ['COLABORADOR 26','CAIXA','14:40 AS 23:00'], ['COLABORADOR 27','CAIXA','14:40 AS 23:00'],
  ['COLABORADOR 28','REPOSITOR','08:00 AS 17:00'], ['COLABORADOR 29','AX. LOJA','08:00 AS 17:00']
]);

const base = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6,
              minFarma:2, minSubger:1, subgerFds:true, prioridade:'par'};
const casosReais = [];
['2026-07-11','2026-08-11','2026-09-11'].forEach(inicio => {
  const fim = new Date(inicio + 'T12:00'); fim.setMonth(fim.getMonth() + 1);
  const iso = d => d.toISOString().slice(0,10);
  casosReais.push(['330 ' + inicio.slice(0,7), L330,
    Object.assign({}, base, {inicio, fim:iso(fim),
      minCaixa:2, minBalcao:4, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}})]);
  casosReais.push(['332 ' + inicio.slice(0,7), L332,
    Object.assign({}, base, {inicio, fim:iso(fim),
      minCaixa:3, minBalcao:4, minDia:{0:9,1:9,2:11,3:9,4:11,5:9,6:11}})]);
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

/* ---- semana de domingo a sábado e fusão da ponta ----
   O período costuma ir do dia 11 ao dia 10, então as pontas quase nunca caem em
   domingo. Uma ponta de 1 ou 2 dias não tem como receber duas folgas — exigir
   isso esvaziaria a loja — por isso ela é somada à semana vizinha. */
const tamanhoDosBlocos = (ini, fim) =>
  E.semanasDoPeriodo(E.listDays(ini, fim), 0).map(s => s.dias.length);

conferir('semana vai de domingo a sábado, ponta curta somada à vizinha',
  JSON.stringify(tamanhoDosBlocos('2026-08-11','2026-09-10')) === '[12,7,12]' ? 1 : 0, 1);
conferir('ponta de 1 dia não fica sozinha',
  JSON.stringify(tamanhoDosBlocos('2026-04-11','2026-05-10')) === '[8,7,7,8]' ? 1 : 0, 1);
conferir('ponta de 2 dias não fica sozinha',
  JSON.stringify(tamanhoDosBlocos('2026-07-11','2026-08-10')) === '[8,7,7,9]' ? 1 : 0, 1);
conferir('nenhum bloco menor que uma semana em período de dia 11 a dia 10',
  tamanhoDosBlocos('2026-09-11','2026-10-10').every(k => k >= 7) ? 1 : 0, 1);
/* Período de 14 dias sem nenhuma semana cheia: as duas pontas colapsariam num
   bloco só, que não é semana nenhuma. Nesse caso não se funde. */
conferir('período sem semana cheia não funde as pontas',
  tamanhoDosBlocos('2026-08-11','2026-08-24').length > 1 ? 1 : 0, 1);

/* Escala publicada sob a regra antiga continua sendo conferida por ela: o
   veredito de uma escala já aprovada não muda sozinho (decisão 0010). */
const diasAgosto = E.listDays('2026-08-11','2026-09-10');
conferir('escala antiga em blocos de 7 continua conferida em blocos de 7',
  JSON.stringify(E.semanasDoPeriodo(diasAgosto,'P').map(s=>s.dias.length)) === '[7,7,7,7,3]' ? 1 : 0, 1);
conferir('escala antiga de segunda a domingo continua conferida assim',
  JSON.stringify(E.semanasDoPeriodo(diasAgosto,1).map(s=>s.dias.length)) === '[6,7,7,7,4]' ? 1 : 0, 1);

/* O alvo de cada bloco: duas folgas por semana cheia, mais uma se o resto
   chegar a três dias. Um bloco de 10 a 13 dias pede três. */
const alvoEsperado = {7:2, 8:2, 9:2, 10:3, 11:3, 12:3, 13:3};
conferir('bloco maior pede folgas proporcionais',
  Object.entries(alvoEsperado).every(([k, esperado]) =>
    (2 * Math.floor(k/7) + ((k % 7) >= 3 ? 1 : 0)) === esperado) ? 1 : 0, 1);

/* Esta é a asserção que pega o defeito de verdade: o gerador tem de SABER
   montar três folgas num bloco fundido. Enquanto ele só sabia formar pares,
   todo bloco de 10 a 13 dias saía uma folga abaixo do exigido. */
const pFusao = Object.assign({}, base, {modelo:'5x2', folgasSemana:2,
  inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:4,
  minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}});
const resFusao = E.gerarEscala(L330, pFusao);
const blocosAbaixoDoAlvo = resFusao.semanas.reduce((total, s) => {
  const alvo = 2 * Math.floor(s.dias.length/7) + ((s.dias.length % 7) >= 3 ? 1 : 0);
  return total + resFusao.ativos.filter(c => !c.gerente).filter(c => {
    const arr = resFusao.grid[c.id];
    const folgas = s.dias.filter(i => arr[i] === 'X' || arr[i] === 'FC').length;
    const ausentes = s.dias.filter(i => ['F','AT','LC'].includes(arr[i])).length;
    if (ausentes >= s.dias.length - 1) return false;
    return folgas + Math.min(ausentes, alvo) < alvo;
  }).length;
}, 0);
conferir('todo bloco recebe as folgas que exige', blocosAbaixoDoAlvo, 0, '<=');

const folgasPorPessoa = resFusao.ativos.filter(c => !c.gerente)
  .map(c => resFusao.grid[c.id].filter(v => v === 'X').length);
conferir('período de 31 dias dá 8 folgas por pessoa',
  Math.min(...folgasPorPessoa) === 8 ? 1 : 0, 1);

/* Gerente personalizado: sexta+sábado normalmente; no domingo ancorado,
   domingo substitui a primeira folga e sábado permanece. */
const gerenteFixo = {id:'gerente-fixo', nome:'GERENTE FIXO', cargo:'GERENTE',
  horario:'07:00 AS 16:20', gerente:true, ativo:true, folgaFixa:5, folgaFixa2:6,
  primeiroDomingo:'2026-10-18', ausencias:[]};
const pGerenteFixo = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6,
  inicio:'2026-10-11', fim:'2026-11-07', inicioSemana:0,
  minCaixa:0, minBalcao:0, minFarma:0, minSubger:0};
const resGerenteFixo = E.gerarEscala([gerenteFixo], pGerenteFixo);
const folgasGerente = resGerenteFixo.semanas.map(s => s.dias
  .filter(i => resGerenteFixo.grid[gerenteFixo.id][i] === 'X')
  .map(i => resGerenteFixo.days[i].getDay()));
conferir('gerente fixo respeita sexta e sábado',
  JSON.stringify(folgasGerente[0]) === '[5,6]' ? 1 : 0, 1);
conferir('domingo do gerente substitui a primeira folga fixa',
  JSON.stringify(folgasGerente[1]) === '[0,6]' ? 1 : 0, 1);
conferir('gerente volta aos dois dias fixos depois do domingo',
  JSON.stringify(folgasGerente[2]) === '[5,6]' ? 1 : 0, 1);

const eqDet = mk([['G','GERENTE','07:00',true],['A','SUBGERENTE','10:00'],['B','FARMACÊUTICO','07:00'],['A','SUBGERENTE','10:00'],['B','FARMACÊUTICO','07:00'],
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
  'COLABORADOR 04', 'COLABORADOR 05', 'COLABORADOR 06'
].map((nome, i) => ({
  id:'farm' + i, nome, cargo:'FARMACÊUTICO', horario:['07:00', '11:00', '14:40'][i], ativo:true, ausencias:[]
}));
const paramsNovembro = Object.assign({}, paramsDomingo, {inicio:'2026-11-11', fim:'2026-12-10'});
const resNovembro = E.gerarEscala(farmasSemHistorico, paramsNovembro);
conferir('sem domingo informado não presume histórico para farmacêuticos',
  JSON.stringify(farmasSemHistorico.map(c => domingosDeFolga(resNovembro, c))) ===
  '[["2026-11-15","2026-12-06"],["2026-11-22"],["2026-11-29"]]' ? 1 : 0, 1);

/* Duas âncoras iguais são uma escolha do usuário: ambas devem permanecer,
   mesmo que a cobertura do cargo fique menor naquele domingo. */
const farmasComConflito = [
  ['COLABORADOR 04', '2026-11-15'], ['COLABORADOR 05', '2026-11-15'], ['COLABORADOR 06', '2026-11-29']
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
  modelo:'5x2', folgasSemana:2,
  inicio:'2026-12-11', fim:'2027-01-10', minCaixa:2, minBalcao:4,
  minFarma:2, minSubger:1, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}
});
const farmaAncorada = equipe => equipe.find(c => c.nome === 'COLABORADOR 05');
const l330FarmaAncorada = JSON.parse(JSON.stringify(L330));
farmaAncorada(l330FarmaAncorada).primeiroDomingo = '2026-11-22';
const resDomingoAncorado = E.gerarEscala(l330FarmaAncorada, paramsDomingoAncorado);
conferir('âncora da farmacêutica reserva a fase antes das colegas automáticas',
  maiorFolgaDeCargoNoDomingo(resDomingoAncorado, l330FarmaAncorada, 'FARMACÊUTICO') <= 1 ? 1 : 0, 1);
conferir('âncora da farmacêutica mantém o ciclo em dezembro/janeiro',
  JSON.stringify(domingosDeFolga(resDomingoAncorado, farmaAncorada(l330FarmaAncorada))) ===
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

/* Turno que atravessa a meia-noite (16:00 às 01:00 do dia seguinte) entrando às 10:00
   do dia seguinte tem apenas 9h de descanso e deve ser acusado como interjornada. */
const eqMeiaNoite = [{id:'mn1', nome:'TURNO MADRUGADA', cargo:'CAIXA', horario:'16:00 AS 01:00',
  jornada:{modelo:'', entrada:'16:00', saida:'01:00', intervalo:60}, ativo:true, ausencias:[]}];
const resMeiaNoite = E.gerarEscala(eqMeiaNoite, pInterjornada);
resMeiaNoite.grid.mn1 = ['','',''];
resMeiaNoite.horas = {mn1:{1:'10:00 AS 18:20'}};
conferir('turno que atravessa a meia-noite acusa descanso menor que 11h',
  E.validar(resMeiaNoite, eqMeiaNoite).alertas.some(a=>a.tipo==='interjornada' && a.obrigatoria===true) &&
  verificar(resMeiaNoite, eqMeiaNoite, pInterjornada, {}).some(v=>v.regra==='R11-interjornada') ? 1 : 0, 1);

/* Passagem entre períodos contíguos: saída às 23:00 no último dia do período anterior
   e entrada às 07:00 no primeiro dia do período seguinte (8h de descanso). */
const estadoAntTurno = E.estadoFinalDaGrade(
  {ij1:['X','']},
  '2026-10-31',
  '2026-11-01',
  {horas:{}, participantes:eqInterjornada}
);
const eqComSaidaAnterior = eqInterjornada.map(c => Object.assign({}, c, estadoAntTurno[c.id]));
const resTransicao = E.gerarEscala(eqComSaidaAnterior, pInterjornada);
resTransicao.grid.ij1 = ['','',''];
resTransicao.horas = {ij1:{0:'07:00 AS 15:20'}};
const valTransicao = E.validar(resTransicao, eqComSaidaAnterior);
conferir('descanso insuficiente na passagem entre períodos é acusado no dia 0',
  valTransicao.alertas.some(a=>a.tipo==='interjornada' && a.dia===0 && a.transicaoPeriodo===true && a.obrigatoria===true) &&
  verificar(resTransicao, eqComSaidaAnterior, pInterjornada, {}).some(v=>v.regra==='R11-interjornada') ? 1 : 0, 1);

/* Jornadas incompletas: nunca inventar saída onde só há entrada, e sinalizar lacuna. */
const colabIncompleto = {id:'inc1', nome:'HORARIO PARCIAL', cargo:'CAIXA', horario:'08:00', jornada:null, ativo:true, ausencias:[]};
conferir('jornada incompleta não inventa saída padrão',
  E.jornadaPadrao(colabIncompleto) === null && E.saidaDoDia(colabIncompleto, 0, {horas:{}}) === null ? 1 : 0, 1);
const resIncompleto = {
  days: E.listDays('2026-11-02', '2026-11-04'),
  grid: {inc1:['','','X']},
  ativos: [colabIncompleto],
  params: pInterjornada,
  horas: {}
};
const valIncompleto = E.validar(resIncompleto, [colabIncompleto]);
conferir('jornada incompleta sinaliza lacuna sem fabricar violação de 11h',
  valIncompleto.alertas.some(a=>a.tipo==='jornada-incompleta' && a.lacuna===true && a.obrigatoria===false) &&
  !valIncompleto.alertas.some(a=>a.tipo==='interjornada') &&
  verificar(resIncompleto, [colabIncompleto], pInterjornada, {}).some(v=>v.regra==='R11-interjornada-lacuna-nota') ? 1 : 0, 1);

/* Demanda positiva com disponibilidade zero: quando minFarma > 0 ou minSubger > 0
   e não há ninguém disponível (ou todos de férias), a insuficiência e o impedimento
   precisam aparecer explicitamente nos alertas e no verificador. */
const eqSemFarmaSubger = [{id:'cx1', nome:'CAIXA UNICO', cargo:'CAIXA', horario:'08:00 AS 16:20',
  jornada:{entrada:'08:00', saida:'16:20', intervalo:60}, ativo:true, ausencias:[]}];
const pDemandaSemDisp = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  inicio:'2026-11-02', fim:'2026-11-03', minCaixa:1, minBalcao:0, minFarma:2, minSubger:1};
const resSemDisp = {
  days: E.listDays('2026-11-02', '2026-11-03'),
  grid: {cx1:['','']},
  ativos: eqSemFarmaSubger,
  params: pDemandaSemDisp,
  horas: {}
};
const valSemDisp = E.validar(resSemDisp, eqSemFarmaSubger);
const verSemDisp = verificar(resSemDisp, eqSemFarmaSubger, pDemandaSemDisp, {});
conferir('demanda positiva com disponibilidade zero acusa falta de farmacêutico e subgerente',
  valSemDisp.alertas.some(a=>a.tipo==='cobertura' && a.impedimento===true && a.txt.includes('SEM farmacêutico')) &&
  valSemDisp.alertas.some(a=>a.tipo==='cobertura' && a.impedimento===true && a.txt.includes('subgerente 0/1')) &&
  verSemDisp.some(v=>v.regra==='R7-farma-zero') &&
  verSemDisp.some(v=>v.regra==='R7-subgerente') ? 1 : 0, 1);

/* Separação entre restrições obrigatórias, preferências e observações em validar(). */
const colabAusenciaViolada = {
  id:'av1', nome:'COLAB FERIAS', cargo:'BALCONISTA', horario:'08:00 AS 16:20',
  folgaFixa:2, ativo:true, ausencias:[{tipo:'F', ini:'2026-11-02', fim:'2026-11-02'}]
};
const resAusenciaViolada = {
  days: E.listDays('2026-11-01', '2026-11-07'),
  grid: {av1:['','','X','','X','','']}, // dia 02/11 (seg) deveria ser F; folgas isoladas na semana sem folgar na terça (folgaFixa=2 -> quarta=3, terça=2)
  ativos: [colabAusenciaViolada],
  params: {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0, minCaixa:0, minBalcao:0, minFarma:0, minSubger:0},
  horas: {}
};
resAusenciaViolada.grid.av1 = ['','','','X','','X','']; // 03/11 (terça, diaFixo=2) trabalha; folgas isoladas em qua (3) e sex (5)
const valSeparacao = E.validar(resAusenciaViolada, [colabAusenciaViolada]);
conferir('ausência violada é classificada como restrição obrigatória que bloqueia publicação',
  valSeparacao.alertas.some(a=>a.tipo==='ausencia' && a.obrigatoria===true && a.categoria==='obrigatoria') &&
  valSeparacao.resumo.podePublicar === false ? 1 : 0, 1);
conferir('folga fixa e folga isolada são classificadas como preferências (não obrigatórias)',
  valSeparacao.alertas.some(a=>a.tipo==='dia-fixo' && a.obrigatoria===false && a.categoria==='preferencia') &&
  valSeparacao.alertas.some(a=>a.tipo==='isolada' && a.obrigatoria===false && a.categoria==='preferencia') ? 1 : 0, 1);

/* Perfil operacional explícito: a folga de fim de semana é política da casa, não
   exigência legal. O perfil da loja diz quais dias, e o alerta cita o perfil que
   decidiu em vez de apresentar a regra como obrigação universal. */
const colabPerfil = {id:'pf1', nome:'PESSOA PERFIL', cargo:'BALCONISTA', horario:'08:00 AS 16:20',
  perfil:'folga-segunda', ativo:true, ausencias:[]};
const pPerfil = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  minCaixa:0, minBalcao:0, minFarma:0, minSubger:0,
  perfis:{'folga-segunda':{id:'folga-segunda', nome:'Apoio — folga na segunda',
    base:'politica-da-casa', regras:{folgaFixaSemanal:[1]}}}};
const resPerfil = {
  days: E.listDays('2026-11-02', '2026-11-03'),   // 02/11 é segunda-feira
  grid: {pf1:['','']},
  ativos: [colabPerfil],
  params: pPerfil,
  horas: {}
};
const valPerfil = E.validar(resPerfil, [colabPerfil]);
const verPerfil = verificar(resPerfil, [colabPerfil], pPerfil, {});
conferir('folga fixa do perfil é cobrada citando o perfil e a base de política da casa',
  valPerfil.alertas.some(a=>a.tipo==='perfil-folga-fixa' && a.obrigatoria===true
    && a.base==='politica-da-casa' && a.txt.includes('Apoio — folga na segunda')) &&
  verPerfil.some(v=>v.regra==='R6-perfil-folga-fixa') ? 1 : 0, 1);

/* Sem perfis configurados, o gerente mantém sábado e domingo: a configuração
   existente continua valendo até uma alteração explícita. */
const colabGerente = {id:'gr1', nome:'GERENTE', cargo:'GERENTE', horario:'08:00 AS 16:20',
  gerente:true, ativo:true, ausencias:[]};
const pSemPerfis = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  minCaixa:0, minBalcao:0, minFarma:0, minSubger:0};
const resGerente = {
  days: E.listDays('2026-11-07', '2026-11-08'),   // sábado e domingo
  grid: {gr1:['','']},
  ativos: [colabGerente],
  params: pSemPerfis,
  horas: {}
};
conferir('loja sem perfis preserva a folga de fim de semana do gerente',
  E.validar(resGerente, [colabGerente]).alertas.filter(a=>a.tipo==='perfil-folga-fixa').length === 2 &&
  verificar(resGerente, [colabGerente], pSemPerfis, {}).filter(v=>v.regra==='R6-perfil-folga-fixa').length === 2 ? 1 : 0, 1);

/* Mínimo de cobertura: a meta avisa, o piso obrigatório bloqueia. Os dois convivem
   para a mesma função, e o piso só existe onde a loja o declarou. */
const eqPiso = [
  {id:'cx_a', nome:'CAIXA A', cargo:'CAIXA', horario:'08:00 AS 16:20', ativo:true, ausencias:[]},
  {id:'cx_b', nome:'CAIXA B', cargo:'CAIXA', horario:'08:00 AS 16:20', ativo:true, ausencias:[]},
];
const basePiso = {modelo:'5x2', folgasSemana:2, cicloDomingo:3, maxSeq:6, inicioSemana:0,
  minBalcao:0, minFarma:0, minSubger:0};
const montarPiso = params => ({
  days: E.listDays('2026-11-02', '2026-11-03'),
  grid: {cx_a:['',''], cx_b:['X','X']},          // só uma pessoa trabalha
  ativos: eqPiso, params, horas: {}
});
const pComPiso = Object.assign({}, basePiso, {minCaixa:2, minCaixaObrigatorio:2});
const resComPiso = montarPiso(pComPiso);
const valComPiso = E.validar(resComPiso, eqPiso);
conferir('piso obrigatório de cobertura bloqueia a publicação',
  valComPiso.alertas.some(a=>a.tipo==='cobertura-minima' && a.obrigatoria===true) &&
  valComPiso.resumo.podePublicar === false &&
  verificar(resComPiso, eqPiso, pComPiso, {}).some(v=>v.regra==='R12-piso-obrigatorio') ? 1 : 0, 1);

const pSoMeta = Object.assign({}, basePiso, {minCaixa:2});
const resSoMeta = montarPiso(pSoMeta);
const valSoMeta = E.validar(resSoMeta, eqPiso);
conferir('mesma falta sem piso declarado continua aviso e permite publicar',
  valSoMeta.alertas.some(a=>a.tipo==='cobertura' && a.obrigatoria===false) &&
  valSoMeta.resumo.podePublicar === true &&
  verificar(resSoMeta, eqPiso, pSoMeta, {}).every(v=>v.regra!=='R12-piso-obrigatorio') ? 1 : 0, 1);

/* Piso obrigatório impossível ainda bloqueia. A indisponibilidade da equipe é
   registrada como informação (impedimento), mas não rebaixa a obrigação a
   preferência: quem abre mão do piso é quem administra a loja. */
const eqPisoFerias = [
  {id:'cx_c', nome:'CAIXA C', cargo:'CAIXA', horario:'08:00 AS 16:20', ativo:true,
   ausencias:[{tipo:'F', ini:'2026-11-02', fim:'2026-11-03'}]},
];
const pPisoImpossivel = Object.assign({}, basePiso, {minCaixa:1, minCaixaObrigatorio:1});
const resPisoImpossivel = {
  days: E.listDays('2026-11-02', '2026-11-03'),
  grid: {cx_c:['F','F']},
  ativos: eqPisoFerias, params: pPisoImpossivel, horas: {}
};
const valPisoImpossivel = E.validar(resPisoImpossivel, eqPisoFerias);
conferir('piso obrigatório impossível continua bloqueando e registra a indisponibilidade',
  valPisoImpossivel.alertas
    .some(a=>a.tipo==='cobertura-minima' && a.obrigatoria===true && a.impedimento===true) &&
  valPisoImpossivel.resumo.podePublicar === false &&
  verificar(resPisoImpossivel, eqPisoFerias, pPisoImpossivel, {})
    .some(v=>v.regra==='R12-piso-obrigatorio') ? 1 : 0, 1);

/* ------------------------------------------------------------------ */
console.log('\n=== 3b. Cobertura intradiária por função ===\n');

const COB = require('../src/motor/cobertura.js');
const SEG = '2026-11-02';            // segunda-feira
const TER = '2026-11-03';            // terça-feira

/* Monta um cenário de um ou dois dias com jornadas estruturadas. */
function cenarioIntra(equipe, params, grade, fim){
  const dias = E.listDays(SEG, fim || SEG);
  const grid = {};
  equipe.forEach(c=>{ grid[c.id] = grade[c.id] || dias.map(()=>''); });
  const res = {days:dias, grid, ativos:equipe, params, horas:{}};
  return {res, analise: COB.analisarCobertura(res, equipe, params, {jornada: E.jornadaParaCobertura})};
}
const semIntervalo = (entrada, saida) => ({entrada, saida, intervalos:[]});
const pessoa = (id, nome, cargo, jornada) => ({id, nome, cargo, jornada, ativo:true, ausencias:[]});

/* (a) Profissionais concentrados no mesmo turno deixam a tarde descoberta.
   Duas pessoas no dia cumprem qualquer mínimo diário de 2 — e mesmo assim a
   loja fica sem caixa das 14h às 20h. É exatamente o furo que o mínimo diário
   não enxerga. */
const eqConcentrada = [
  pessoa('k1','CAIXA UM','CAIXA', semIntervalo('08:00','14:00')),
  pessoa('k2','CAIXA DOIS','CAIXA', semIntervalo('08:00','14:00')),
];
const pConcentrada = {
  expediente:{'1':[{ini:'08:00', fim:'20:00'}]},
  faixas:{'1':[{funcao:'caixa', ini:'08:00', fim:'20:00', obrigatorio:1}]},
};
const concentrada = cenarioIntra(eqConcentrada, pConcentrada, {});
conferir('concentração no mesmo turno acusa a faixa descoberta que o mínimo diário não vê',
  concentrada.analise.resumo.bloqueios === 1 &&
  concentrada.analise.alertas.some(a=>a.txt.includes('14:00–20:00') && a.obrigatoria===true) ? 1 : 0, 1);

/* (b) Intervalo descoberto: o único caixa almoça e ninguém cobre. */
const eqAlmoco = [
  Object.assign(pessoa('a1','CAIXA UNICO','CAIXA', null),
    {jornada:{entrada:'08:00', saida:'18:00', intervalos:[{ini:'12:00', fim:'13:00'}]}}),
];
const pAlmoco = {
  expediente:{'1':[{ini:'08:00', fim:'18:00'}]},
  faixas:{'1':[{funcao:'caixa', ini:'08:00', fim:'18:00', obrigatorio:1}]},
};
const almocoDescoberto = cenarioIntra(eqAlmoco, pAlmoco, {});
conferir('intervalo descoberto vira bloqueio na faixa exata do almoço',
  almocoDescoberto.analise.resumo.bloqueios === 1 &&
  almocoDescoberto.analise.alertas.some(a=>a.txt.includes('12:00–13:00')) ? 1 : 0, 1);

/* (c) Intervalo coberto por substituição: mesma escala, mais um caixa cruzando
   o horário do almoço. Não pode sobrar alerta. */
const eqSubstituto = eqAlmoco.concat([pessoa('a2','CAIXA APOIO','CAIXA', semIntervalo('11:30','14:00'))]);
const almocoCoberto = cenarioIntra(eqSubstituto, pAlmoco, {});
conferir('intervalo coberto por substituição não gera alerta',
  almocoCoberto.analise.resumo.bloqueios, 0, '<=');

/* (d) Turno atravessando a meia-noite: quem entra 20:00 e sai 02:00 cobre o
   começo do dia seguinte, e isso precisa ser contado no dia seguinte. */
const eqNoturna = [pessoa('n1','NOTURNO','CAIXA', semIntervalo('20:00','02:00'))];
const pNoturna = {
  expediente:{'1':[{ini:'20:00', fim:'00:00'}], '2':[{ini:'00:00', fim:'02:00'}]},
  faixas:{'1':[{funcao:'caixa', ini:'20:00', fim:'00:00', obrigatorio:1}],
          '2':[{funcao:'caixa', ini:'00:00', fim:'02:00', obrigatorio:1}]},
};
const noturna = cenarioIntra(eqNoturna, pNoturna, {}, TER);
conferir('turno que atravessa a meia-noite cobre o início do dia seguinte',
  noturna.analise.resumo.bloqueios === 0 &&
  noturna.analise.dias[1].segmentos.some(s=>s.iniTexto==='00:00' && s.escalados===1) ? 1 : 0, 1);

/* (e) Troca de turno sem lacuna: um sai 14:00, outro entra 14:00. Com limites
   semiabertos não há buraco às 14:00 nem dupla contagem. */
const eqTroca = [
  pessoa('t1','MANHA','CAIXA', semIntervalo('08:00','14:00')),
  pessoa('t2','TARDE','CAIXA', semIntervalo('14:00','20:00')),
];
const pTroca = {
  expediente:{'1':[{ini:'08:00', fim:'20:00'}]},
  faixas:{'1':[{funcao:'caixa', ini:'08:00', fim:'20:00', obrigatorio:1, meta:1}]},
};
const troca = cenarioIntra(eqTroca, pTroca, {});
conferir('troca de turno exata não abre lacuna nem conta a mesma vaga duas vezes',
  troca.analise.resumo.bloqueios === 0 &&
  troca.analise.dias[0].segmentos.every(s=>s.escalados===1) ? 1 : 0, 1);

/* (f) Dia fechado: nenhuma falta de cobertura, mesmo sem ninguém escalado. */
const pFechada = {
  expediente:{'1':false},
  faixas:{'1':[{funcao:'caixa', ini:'08:00', fim:'20:00', obrigatorio:2}]},
};
const fechada = cenarioIntra(eqConcentrada, pFechada, {k1:['X'], k2:['X']});
conferir('dia fechado não recebe falta de cobertura',
  fechada.analise.resumo.bloqueios === 0 && fechada.analise.resumo.diasFechados === 1 ? 1 : 0, 1);

/* (g) Dados incompletos. Três situações que não podem ser confundidas:
   jornada ausente, intervalo declarado vazio e intervalo desconhecido. */
const eqSemJornada = [pessoa('s1','SEM HORARIO','CAIXA', null)];
const semJornada = cenarioIntra(eqSemJornada, pTroca, {});
conferir('jornada ausente vira lacuna e não presença zero silenciosa',
  semJornada.analise.resumo.lacunas === 1 &&
  semJornada.analise.lacunas[0].motivo === 'jornada-incompleta' ? 1 : 0, 1);

const eqIntervaloDesconhecido = [
  Object.assign(pessoa('d1','COM ALMOCO','CAIXA', null),
    {jornada:{entrada:'08:00', saida:'18:00', intervalo:60}}),   // duração sem horário
];
const intervaloDesconhecido = cenarioIntra(eqIntervaloDesconhecido, pAlmoco, {});
conferir('intervalo de horário desconhecido é lacuna, distinta de "sem intervalo"',
  intervaloDesconhecido.analise.resumo.lacunas === 1 &&
  intervaloDesconhecido.analise.lacunas[0].motivo === 'intervalo-desconhecido' ? 1 : 0, 1);

conferir('intervalo declarado vazio significa sem intervalo e não gera lacuna',
  almocoCoberto.analise.lacunas.filter(l=>l.colab==='CAIXA APOIO').length, 0, '<=');

/* (h) Lacuna não contorna bloqueio: a faixa continua descoberta porque a outra
   pessoa, essa sim conhecida, não cobre o horário. */
const eqLacunaEBloqueio = eqSemJornada.concat([pessoa('s2','CAIXA MANHA','CAIXA', semIntervalo('08:00','12:00'))]);
const lacunaEBloqueio = cenarioIntra(eqLacunaEBloqueio, pTroca, {});
conferir('faltar dado não libera o bloqueio da faixa descoberta',
  lacunaEBloqueio.analise.resumo.bloqueios > 0 &&
  lacunaEBloqueio.analise.resumo.lacunas > 0 ? 1 : 0, 1);

/* (i) Meta opcional não atendida: aviso, nunca bloqueio. */
const pMeta = {
  expediente:{'1':[{ini:'08:00', fim:'20:00'}]},
  faixas:{'1':[{funcao:'caixa', ini:'08:00', fim:'20:00', meta:3}]},
};
const soMeta = cenarioIntra(eqTroca, pMeta, {});
conferir('meta de faixa não atendida gera aviso e não bloqueio',
  soMeta.analise.resumo.bloqueios === 0 && soMeta.analise.resumo.avisos > 0 ? 1 : 0, 1);

/* (j) Cargos atendem função só quando declarado: repositor não é balcão por
   conta própria, e quem acumula competências conta uma vez no total. */
const eqRepositor = [pessoa('r1','REPOSITOR','REPOSITOR', semIntervalo('08:00','18:00'))];
const pBalcao = {
  expediente:{'1':[{ini:'08:00', fim:'18:00'}]},
  faixas:{'1':[{funcao:'balcao', ini:'08:00', fim:'18:00', obrigatorio:1}]},
};
const repositor = cenarioIntra(eqRepositor, pBalcao, {});
conferir('repositor não conta como balcão sem declaração explícita',
  repositor.analise.resumo.bloqueios > 0 ? 1 : 0, 1);

const pRepositorNoBalcao = Object.assign({}, pBalcao, {
  funcoes:{balcao:{nome:'Balcão', cargos:['BALCONISTA','REPOSITOR']}},
});
const repositorDeclarado = cenarioIntra(eqRepositor, pRepositorNoBalcao, {});
conferir('repositor conta como balcão quando a loja declara o cargo na função',
  repositorDeclarado.analise.resumo.bloqueios, 0, '<=');

/* Múltipla competência: SUB/FARMA atende farmacêutico e subgerente ao mesmo
   tempo, mas é uma pessoa só — o total de presentes no segmento não pode
   contá-la duas vezes. */
const eqDuplaCompetencia = [pessoa('m1','SUB FARMA','SUB/FARMA', semIntervalo('08:00','18:00'))];
const pDupla = {
  expediente:{'1':[{ini:'08:00', fim:'18:00'}]},
  faixas:{'1':[{funcao:'farmaceutico', ini:'08:00', fim:'18:00', obrigatorio:1},
               {funcao:'subgerente',   ini:'08:00', fim:'18:00', obrigatorio:1}]},
};
const dupla = cenarioIntra(eqDuplaCompetencia, pDupla, {});
conferir('múltipla competência atende duas funções sem virar duas pessoas',
  dupla.analise.resumo.bloqueios === 0 &&
  dupla.analise.dias[0].segmentos.length === 2 &&
  dupla.analise.dias[0].segmentos.every(s=>s.totalPresentes===1) ? 1 : 0, 1);

/* (k) Loja sem faixas configuradas não ganha cobrança nova: a etapa anterior
   continua valendo exatamente como estava. */
const semFaixas = cenarioIntra(eqTroca, {expediente:{'1':[{ini:'08:00', fim:'20:00'}]}}, {});
conferir('loja sem faixas configuradas não passa a ser cobrada por horário',
  semFaixas.analise.resumo.configurado === false &&
  semFaixas.analise.resumo.bloqueios === 0 ? 1 : 0, 1);

/* (l) Segmentação fina: uma lacuna de 10 minutos não pode sumir numa grade
   grosseira de 30 ou 60 minutos. */
const eqLacunaCurta = [
  pessoa('c1','ANTES','CAIXA', semIntervalo('08:00','13:50')),
  pessoa('c2','DEPOIS','CAIXA', semIntervalo('14:00','20:00')),
];
const lacunaCurta = cenarioIntra(eqLacunaCurta, pTroca, {});
conferir('lacuna de 10 minutos aparece com o horário exato',
  lacunaCurta.analise.alertas.some(a=>a.txt.includes('13:50–14:00')) ? 1 : 0, 1);

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
  {nome:'Pessoa Teste 1'}, {nome:'Pessoa Teste 2'}
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
