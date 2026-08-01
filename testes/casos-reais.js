const E=require('../src/motor/motor.js'); const {verificar, metricas}=require('./verificador.js');
const mk = l => l.map((r,i)=>({id:'c'+i, nome:r[0], cargo:r[1], horario:r[2], gerente:!!r[3],
                               ativo:true, ausencias:r[4]||[], domTrabConsec:null, diasDesdeFolga:null}));
const L330 = mk([
 ['GUILHERME','GERENTE','07:00 AS 16:20',true],['RENATA','SUBGERENTE','10:00 AS 18:20'],
 ['QUESNEL','SUBGERENTE','14:40 AS 23:00'],['ROBERTA','FARMACÊUTICO','07:00 AS 15:20'],
 ['PRISCILA','FARMACÊUTICO','11:00 AS 19:20'],['MIANGUE','FARMACÊUTICO','14:40 AS 23:00'],
 ['JESSICA','BALCONISTA','08:00 AS 16:20'],['LUCAS ARAUJO','BALCONISTA','10:00 AS 18:20'],
 ['MIRIÃ','CAIXA','07:00 AS 15:20'],['JULIA','CAIXA','11:00 AS 19:20'],
 ['GIANE','CAIXA','13:00 AS 21:20'],['LUCAS HATEWA','CAIXA','14:40 AS 23:00'],
 ['LORENZO','AX. LOJA','09:00 AS 18:00']]);
const L332 = mk([
 ['MAYARA','GERENTE','07:00 AS 16:20',true],['MIRIAN','SUB/FARMA','07:00 AS 15:20'],
 ['VANDERLEIA','SUBGERENTE','14:40 AS 23:00'],['EDUARDA','SUBGERENTE','14:40 AS 23:00'],
 ['LETICIA','FARMACÊUTICO','11:00 AS 19:20'],['ANA PAULA','FARMACÊUTICO','14:40 AS 23:00'],
 ['MARIA','BALCONISTA','09:00 AS 18:00'],['ANNA','BALCONISTA','12:00 AS 20:20'],
 ['RAQUEL','CAIXA','07:00 AS 15:20'],['NICOLE','CAIXA','07:00 AS 15:20'],
 ['FELIPE','CAIXA','13:00 AS 21:20'],['ELOISA','CAIXA','14:40 AS 23:00'],
 ['ESMERALDA','CAIXA','14:40 AS 23:00'],['ALINE','CAIXA','14:40 AS 23:00'],
 ['LIVIA','REPOSITOR','08:00 AS 17:00'],['ROSA','AX. LOJA','08:00 AS 17:00']]);

const base = {folgasSemana:2, cicloDomingo:3, maxSeq:6, minFarma:1, subgerFds:true};
const casos = [
  ['330 · jul→ago',  L330, {inicio:'2026-07-11', fim:'2026-08-10', minCaixa:2, minBalcao:4, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}, inicioSemana:'P'}],
  ['330 · ago→set',  L330, {inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:4, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}, inicioSemana:'P'}],
  ['330 · sem dom→sáb', L330, {inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:4, minDia:{0:7,1:7,2:9,3:9,4:9,5:9,6:9}, inicioSemana:0}],
  ['332 · ago→set',  L332, {inicio:'2026-08-11', fim:'2026-09-10', minCaixa:4, minBalcao:4, minDia:{0:10,1:9,2:12,3:9,4:12,5:9,6:12}, inicioSemana:'P'}],
  ['332 · curva mais folgada', L332, {inicio:'2026-08-11', fim:'2026-09-10', minCaixa:3, minBalcao:4, minDia:{0:9,1:9,2:11,3:9,4:11,5:9,6:11}, inicioSemana:'P'}],
  ['330 · com 2 de férias', L330.map((c,i)=>i===2?Object.assign({},c,{ausencias:[{tipo:'F',ini:'2026-08-11',fim:'2026-09-05'}]}):i===7?Object.assign({},c,{ausencias:[{tipo:'F',ini:'2026-08-20',fim:'2026-09-10'}]}):c),
      {inicio:'2026-08-11', fim:'2026-09-10', minCaixa:2, minBalcao:3, minDia:{0:6,1:6,2:8,3:8,4:8,5:8,6:8}, inicioSemana:'P'}],
];
casos.forEach(([rot, equipe, extra])=>{
  const P = Object.assign({}, base, extra);
  const res = E.gerarEscala(equipe, P);
  const est = {}; equipe.filter(c=>!c.gerente).forEach((c,k)=>{ est[c.id] = k % Math.max(2, P.maxSeq-1); });
  const V = verificar(res, equipe, P, est);
  const M = metricas(res, equipe, P);
  const graves = V.filter(v=>!v.regra.endsWith('-nota'));
  const porRegra = {};
  graves.forEach(v=>porRegra[v.regra]=(porRegra[v.regra]||0)+1);
  console.log(`\n### ${rot}`);
  console.log(`   violações: ${graves.length ? Object.entries(porRegra).map(([k,v])=>k+'×'+v).join('  ') : 'NENHUMA'}`);
  console.log(`   notas: ${V.length-graves.length} | par ${M.pctPar.toFixed(1)}% | equipe ${M.minEquipe}–${M.maxEquipe} (desvio ${M.desvioEquipe.toFixed(2)}) | folgas ${M.folgasMin}–${M.folgasMax}`);
  graves.slice(0,5).forEach(v=>console.log(`     ! ${v.regra} ${v.quem} — ${v.txt}`));
});
