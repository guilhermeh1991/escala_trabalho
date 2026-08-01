/* =========================================================================
   BANCADA DE SIMULAÇÃO
   Gera centenas de cenários variados, roda o motor e passa cada resultado
   pelo verificador independente. Conta violações por regra.
   ========================================================================= */
const E = require('../src/motor/motor.js');
const {verificar, metricas} = require('./verificador.js');

/* random determinístico, para os testes serem reproduzíveis */
let semente = 12345;
function rnd(){ semente = (semente*1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; }
const ri = (a,b) => a + Math.floor(rnd()*(b-a+1));
const pick = arr => arr[ri(0,arr.length-1)];

function cenario(n){
  const nCaixa  = ri(2,7);
  const nFarma  = ri(1,4);
  const nSubger = ri(0,3);
  const nBalcao = ri(1,6);
  const nGerente= pick([0,1,1,1,2]);
  const equipe = [];
  let id = 0;
  const add = (cargo, gerente) => equipe.push({
    id:'p'+(id++), nome:cargo.slice(0,3)+id, cargo, gerente:!!gerente, ativo:true,
    horario: pick(['07:00 AS 15:20','08:00 AS 16:20','11:00 AS 19:20','14:40 AS 23:00','13:00 AS 21:20']),
    ausencias: [],
    domTrabConsec: pick([null,null,null,0,1,2]),
    diasDesdeFolga: pick([null,null,0,1,2,3,4,5])
  });
  for(let k=0;k<nGerente;k++) add('GERENTE', true);
  for(let k=0;k<nSubger;k++) add('SUBGERENTE');
  for(let k=0;k<nFarma;k++)  add('FARMACÊUTICO');
  for(let k=0;k<nBalcao;k++) add('BALCONISTA');
  for(let k=0;k<nCaixa;k++)  add('CAIXA');
  if(rnd()<0.3) add('AX. LOJA');
  if(rnd()<0.2) add('REPOSITOR');

  // período
  const ano = 2026, mes = ri(0,11), diaIni = pick([1,11,16,21]);
  const ini = new Date(ano, mes, diaIni);
  const dur = pick([28,30,31,35,14,7]);
  const fim = new Date(ini.getTime()); fim.setDate(fim.getDate()+dur-1);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // férias e atestados
  const nAus = ri(0, Math.min(3, Math.floor(equipe.length/4)));
  for(let k=0;k<nAus;k++){
    const c = pick(equipe);
    const a = new Date(ini.getTime()); a.setDate(a.getDate()+ri(0,dur-3));
    const b = new Date(a.getTime());   b.setDate(b.getDate()+ri(2, 20));
    c.ausencias.push({tipo:pick(['F','F','AT','LC']), ini:iso(a), fim:iso(b)});
  }

  const nCx = equipe.filter(c=>!c.gerente && c.cargo==='CAIXA').length;
  const nBl = equipe.filter(c=>!c.gerente && c.cargo!=='CAIXA').length;
  const P = {
    inicio: iso(ini), fim: iso(fim),
    modelo: pick(['5x2','5x2','5x2','6x1','6x1']),
    cicloDomingo: pick([3,3,2]),
    maxSeq: pick([6,6,6,5,7]),
    inicioSemana: pick(['P',0,1]),
    minCaixa:  Math.max(0, nCx - ri(2,4)),
    minBalcao: Math.max(0, nBl - ri(2,5)),
    minFarma: 2,
    minSubger: 1,
    subgerFds: rnd()<0.7,
  };
  P.folgasSemana = P.modelo === '6x1' ? 1 : 2;
  if(rnd()<0.5){
    const base = Math.max(1, equipe.length - ri(3,6));
    P.minDia = {0:Math.max(1,base-2), 1:Math.max(1,base-2), 2:base, 3:base, 4:base, 5:base, 6:base};
  }
  return {nome:'cenário '+n, equipe, P};
}

/* Um cenário é viável se a mão de obra que sobra depois das folgas obrigatórias
   ainda cobre a soma dos mínimos exigidos. Se não cobre, nenhuma escala resolve. */
function viabilidade(equipe, P, days){
  const N = days.length;
  const ativos = equipe.filter(c=>c.ativo!==false);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const ausente = (c,d) => (c.ausencias||[]).some(a=>a.ini<=iso(d) && iso(d)<=(a.fim||a.ini));
  let disponivel = 0;
  days.forEach(d=>ativos.forEach(c=>{ if(!ausente(c,d)) disponivel++; }));
  const semanasCheias = Math.floor(N/7), resto = N%7;
  let folgas = 0;
  ativos.forEach(c=>{
    if(c.gerente) folgas += days.filter(d=>d.getDay()===0||d.getDay()===6).length;
    else folgas += P.folgasSemana*semanasCheias + (resto>=3?1:0);
  });
  const capacidade = disponivel - folgas;
  let demanda = 0;
  days.forEach(d=>{
    if(P.minDia) demanda += Number(P.minDia[d.getDay()]||0);
    else demanda += (P.minCaixa||0) + (P.minBalcao||0);
  });
  // viabilidade por função: a categoria consegue cobrir o próprio mínimo todo dia?
  function porPapel(filtro, minimo){
    if(!minimo) return true;
    const gente = ativos.filter(filtro);
    if(!gente.length) return true;
    let disp = 0;
    days.forEach(d=>gente.forEach(c=>{ if(!ausente(c,d)) disp++; }));
    let fg = 0;
    gente.forEach(c=>{ fg += c.gerente ? days.filter(d=>d.getDay()===0||d.getDay()===6).length
                                       : P.folgasSemana*semanasCheias + (resto>=3?1:0); });
    return (disp - fg) >= minimo * N;
  }
  const ehCx = c=>!c.gerente && (c.cargo||'').toUpperCase().includes('CAIXA');
  const ehFa = c=>(c.cargo||'').toUpperCase().includes('FARMA');
  const ehSg = c=>{const x=(c.cargo||'').toUpperCase(); return x.includes('SUBGER')||x.startsWith('SUB/');};
  const ehBl = c=>!c.gerente && !ehCx(c);
  const papeis = {
    caixa:  porPapel(ehCx, P.minCaixa),
    balcao: porPapel(ehBl, P.minBalcao),
    farmaZero: porPapel(ehFa, 1),                 // pelo menos um farmacêutico
    farma:  porPapel(ehFa, P.minFarma||2),        // o alvo de dois
    subger: porPapel(ehSg, P.minSubger||1)
  };
  return {capacidade, demanda, viavel: capacidade >= demanda, papeis};
}

function rodar(qtd){
  const contagem = {}, exemplos = {}, contagemViavel = {};
  let nViaveis = 0, nInviaveis = 0;
  const agregado = {desvioEquipe:0, pctPar:0, diasSemFolga:0};
  let erros = 0, piorCaso = null;
  const t0 = Date.now();

  for(let n=1;n<=qtd;n++){
    const {equipe, P} = cenario(n);
    let res;
    try { res = E.gerarEscala(equipe, P); }
    catch(err){ erros++; console.log(`  !! cenário ${n} quebrou: ${err.message}`); continue; }

    // estado inicial igual ao que o motor usa
    const estadoInicial = {};
    equipe.filter(c=>!c.gerente).forEach((c,k)=>{
      estadoInicial[c.id] = (c.diasDesdeFolga!=null && c.diasDesdeFolga!=='')
        ? Number(c.diasDesdeFolga) : (k % Math.max(2, P.maxSeq-1));
    });

    const viab = viabilidade(equipe, Object.assign({folgasSemana:2}, P), res.days);
    if(viab.viavel) nViaveis++; else nInviaveis++;
    const V = verificar(res, equipe, Object.assign({cicloDomingo:3,maxSeq:6,minFarma:2,minSubger:1}, P), estadoInicial);
    if(viab.viavel) V.forEach(v=>{
      const p = viab.papeis;
      if(v.regra==='R7-caixa'  && !p.caixa)  return;
      if(v.regra==='R7-balcao' && !p.balcao) return;
      if(v.regra==='R7-farma-zero' && !p.farmaZero) return;
      if(v.regra==='R7-farma-alvo-nota' && !p.farma) return;
      if(v.regra==='R7-subgerente' && !p.subger) return;
      contagemViavel[v.regra]=(contagemViavel[v.regra]||0)+1;
    });
    const M = metricas(res, equipe, P);
    agregado.desvioEquipe += M.desvioEquipe;
    agregado.pctPar += M.pctPar;
    agregado.diasSemFolga += M.diasSemFolga;

    const graves = V.filter(v=>!v.regra.endsWith('-nota'));
    if(!piorCaso || graves.length > piorCaso.qtd) piorCaso = {n, qtd:graves.length, P, equipe};
    V.forEach(v=>{
      contagem[v.regra] = (contagem[v.regra]||0)+1;
      if(!exemplos[v.regra]) exemplos[v.regra] = `cenário ${n}: ${v.quem} — ${v.txt}`;
    });
  }

  console.log(`\n${qtd} cenários em ${((Date.now()-t0)/1000).toFixed(1)}s | falhas de execução: ${erros}`);
  console.log('\nVIOLAÇÕES POR REGRA (total de ocorrências):');
  const chaves = Object.keys(contagem).sort((a,b)=>contagem[b]-contagem[a]);
  if(!chaves.length) console.log('  nenhuma');
  chaves.forEach(k=>{
    console.log(`  ${k.padEnd(22)} ${String(contagem[k]).padStart(6)}   ex: ${exemplos[k]}`);
  });
  console.log(`\nSÓ NOS CENÁRIOS VIÁVEIS (${nViaveis} de ${qtd}; ${nInviaveis} têm gente de menos para os mínimos pedidos):`);
  const ck = Object.keys(contagemViavel).sort((a,b)=>contagemViavel[b]-contagemViavel[a]);
  if(!ck.length) console.log('  nenhuma violação');
  ck.forEach(k=>console.log(`  ${k.padEnd(22)} ${String(contagemViavel[k]).padStart(6)}`));
  console.log('\nQUALIDADE MÉDIA:');
  console.log(`  desvio da equipe/dia: ${(agregado.desvioEquipe/qtd).toFixed(2)}`);
  console.log(`  folgas em par:        ${(agregado.pctPar/qtd).toFixed(1)}%`);
  console.log(`  dias sem folga:       ${(agregado.diasSemFolga/qtd).toFixed(2)} por escala`);
  if(piorCaso) console.log(`\n  pior cenário: #${piorCaso.n} com ${piorCaso.qtd} violações graves`);
  return contagem;
}

if(require.main === module) rodar(Number(process.argv[2]||200));
module.exports = {rodar, cenario, resetar: (s)=>{ semente = s||12345; }};
