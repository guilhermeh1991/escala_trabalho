/* =========================================================================
   VERIFICADOR INDEPENDENTE
   Reimplementa a checagem das regras do zero, sem usar nada do motor,
   para não herdar os mesmos enganos. Recebe a grade pronta e devolve
   a lista de violações por regra.
   ========================================================================= */

const FOLGA_X   = ['X','FC'];               // folga concedida pela escala
const AUSENCIA  = ['F','AT','LC'];          // afastamento
const DESCANSO  = FOLGA_X.concat(AUSENCIA); // qualquer dia sem trabalhar

function ehCaixa(c){ return !c.gerente && (c.cargo||'').toUpperCase().includes('CAIXA'); }
function ehFarma(c){ return (c.cargo||'').toUpperCase().includes('FARMA'); }
function ehSubger(c){ const x=(c.cargo||'').toUpperCase(); return x.includes('SUBGER')||x.startsWith('SUB/'); }
function ehBalcao(c){ return !c.gerente && !ehCaixa(c); }

function dd(d){ return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); }

/**
 * @param res    saída de gerarEscala
 * @param colabs lista original de colaboradores
 * @param P      parâmetros usados
 * @param estadoInicial  {id: diasJaTrabalhadosSemFolga} usado na geração
 */
function verificar(res, colabs, P, estadoInicial){
  const {days, grid} = res;
  const N = days.length;
  const ativos = colabs.filter(c=>c.ativo!==false);
  const V = [];                                  // violações
  const add = (regra, quem, txt) => V.push({regra, quem, txt});

  // semanas, recalculadas aqui de propósito
  const semanas = [];
  if(P.inicioSemana === 'P'){
    for(let i=0;i<N;i+=7) semanas.push({ini:i, fim:Math.min(i+6,N-1)});
  } else {
    let i=0;
    while(i<N){
      let j=i;
      while(j+1<N && days[j+1].getDay()!==P.inicioSemana) j++;
      semanas.push({ini:i, fim:j}); i=j+1;
    }
  }
  semanas.forEach(s=>{ s.dias=[]; for(let k=s.ini;k<=s.fim;k++) s.dias.push(k); });

  ativos.forEach(c=>{
    const arr = grid[c.id];
    if(!arr){ add('R0-grade','—',`${c.nome} não tem linha na escala`); return; }
    if(arr.length !== N) add('R0-grade', c.nome, `linha com ${arr.length} dias, esperado ${N}`);
    const descansa = i => i>=0 && i<N && DESCANSO.includes(arr[i]);
    const trabalha = i => i>=0 && i<N && arr[i]==='';

    // R8 — ausências preservadas exatamente como lançadas
    (c.ausencias||[]).forEach(a=>{
      days.forEach((d,i)=>{
        const s = d.toISOString().slice(0,10);
        const dt = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if(a.ini <= dt && dt <= (a.fim||a.ini)){
          const tiposDoDia = (c.ausencias||[]).filter(z=>z.ini<=dt && dt<=(z.fim||z.ini)).map(z=>z.tipo);
          if(!tiposDoDia.includes(arr[i]))
            add('R8-ausencia', c.nome, `${dd(d)} deveria ser ${tiposDoDia.join('/')} e está "${arr[i]}"`);
        }
      });
    });

    // R6 — gerente folga todo sábado e domingo
    if(c.gerente){
      days.forEach((d,i)=>{
        if((d.getDay()===0||d.getDay()===6) && !descansa(i))
          add('R6-gerente', c.nome, `trabalhando em ${dd(days[i])} (${d.getDay()===0?'domingo':'sábado'})`);
      });
      return;   // as demais regras não se aplicam ao gerente
    }

    // R2 — nunca mais de maxSeq dias seguidos trabalhados
    let seq = (estadoInicial && estadoInicial[c.id]) || 0;
    for(let i=0;i<N;i++){
      if(descansa(i)){ seq=0; continue; }
      seq++;
      if(seq === P.maxSeq+1) add('R2-sequencia', c.nome, `${seq} dias seguidos até ${dd(days[i])}`);
    }

    // R1 — folgas por semana
    semanas.forEach(s=>{
      if(s.dias.length < 7) return;                       // semana parcial: proporcional, ver R1b
      const afast = s.dias.filter(i=>AUSENCIA.includes(arr[i])).length;
      if(afast >= 6) return;                              // semana praticamente toda de férias
      const n = s.dias.filter(i=>FOLGA_X.includes(arr[i])).length + Math.min(afast, P.folgasSemana);
      if(n < P.folgasSemana)
        add('R1-folgas-semana', c.nome, `semana de ${dd(days[s.ini])}: ${n} folga(s), pedido ${P.folgasSemana}`);
    });

    // R3 — domingos: no máximo (ciclo-1) trabalhados seguidos
    let corrida=0, jaAvisou=false;
    days.forEach((d,i)=>{
      if(d.getDay()!==0) return;
      if(trabalha(i)){
        corrida++;
        if(corrida > P.cicloDomingo-1 && !jaAvisou){
          add('R3-domingo', c.nome, `${corrida} domingos seguidos trabalhados (até ${dd(d)})`);
          jaAvisou = true;
        }
      } else { corrida=0; jaAvisou=false; }
    });

    // R10 — no 6x1, a semana que tem folga de domingo deve ter também a folga comum
    if(P.modelo === '6x1'){
      semanas.forEach(s=>{
        if(s.dias.length < 7) return;
        const afast = s.dias.filter(i=>AUSENCIA.includes(arr[i])).length;
        if(afast >= 4) return;
        const domFolga = s.dias.filter(i=>days[i].getDay()===0 && FOLGA_X.includes(arr[i]));
        if(!domFolga.length) return;
        const total = s.dias.filter(i=>FOLGA_X.includes(arr[i])).length;
        if(total < 2)
          add('R10-6x1-domingo', c.nome, `semana de ${dd(days[s.ini])}: folgou o domingo do ciclo mas não teve a folga da semana`);
      });
    }

    // R4 — folga em par nas semanas sem domingo de folga (não vale no 6x1)
    semanas.forEach(s=>{
      if(P.modelo === '6x1') return;
      if(s.dias.length < 7) return;
      const folgas = s.dias.filter(i=>FOLGA_X.includes(arr[i]));
      if(folgas.length < 2) return;
      const temDomingoFolga = s.dias.some(i=>days[i].getDay()===0 && FOLGA_X.includes(arr[i]));
      const soltas = folgas.filter(i=>!descansa(i-1) && !descansa(i+1));
      if(soltas.length===0) return;
      // se a semana tem ao menos um par, o dia solto é folga extra (normalmente
      // exigida pelo limite de dias seguidos), não descumprimento da regra do par
      const temPar = folgas.some(i=>descansa(i+1) || descansa(i-1));
      if(temPar || temDomingoFolga)
        soltas.forEach(i=>add('R5-par-domingo-nota', c.nome, `${dd(days[i])} folga avulsa (a semana já tem par)`));
      else
        soltas.forEach(i=>add('R4-par', c.nome, `${dd(days[i])} folga isolada e a semana não tem nenhum par`));
    });

    // R9 — folga longa demais também é sinal de erro (3+ dias seguidos fora de férias)
    let bloco=0;
    for(let i=0;i<=N;i++){
      if(i<N && FOLGA_X.includes(arr[i])) bloco++;
      else { if(bloco>=4) add('R9-bloco', c.nome, `${bloco} dias de folga seguidos terminando em ${dd(days[i-1])}`); bloco=0; }
    }
  });

  // R7 — cobertura por dia
  days.forEach((d,i)=>{
    const trab = c => grid[c.id] && grid[c.id][i]==='';
    const cx = ativos.filter(c=>ehCaixa(c) && trab(c)).length;
    const bl = ativos.filter(c=>ehBalcao(c) && trab(c)).length;
    const fa = ativos.filter(c=>ehFarma(c) && trab(c)).length;
    const sg = ativos.filter(c=>ehSubger(c) && trab(c)).length;
    const tot= ativos.filter(c=>trab(c)).length;
    if(ativos.some(ehCaixa)  && cx < P.minCaixa)  add('R7-caixa','—',   `${dd(d)}: ${cx}/${P.minCaixa}`);
    if(ativos.some(ehBalcao) && bl < P.minBalcao) add('R7-balcao','—',  `${dd(d)}: ${bl}/${P.minBalcao}`);
    const alvoFa = P.minFarma != null ? P.minFarma : 2;
    const faDisp = ativos.filter(c=>ehFarma(c) && grid[c.id] && !AUSENCIA.includes(grid[c.id][i])).length;
    if(faDisp >= 1 && fa < 1) add('R7-farma-zero','—', `${dd(d)}: nenhum farmacêutico`);
    else if(faDisp >= alvoFa && fa < alvoFa) add('R7-farma-alvo-nota','—', `${dd(d)}: ${fa}/${alvoFa} (tolerado)`);
    const sgDisp = ativos.filter(c=>ehSubger(c) && grid[c.id] && !AUSENCIA.includes(grid[c.id][i])).length;
    const alvoSg = P.minSubger != null ? P.minSubger : 1;
    if(sgDisp >= alvoSg && sg < alvoSg) add('R7-subgerente','—', `${dd(d)}: ${sg}/${alvoSg} subgerente`);
    if(P.minDia){
      const alvo = Number(P.minDia[d.getDay()]||0);
      if(alvo && tot < alvo) add('R7-equipe','—', `${dd(d)}: ${tot}/${alvo}`);
    }
    if(tot === 0) add('R7-loja-vazia','—', `${dd(d)}: ninguém na loja`);
  });

  return V;
}

/* métricas de qualidade (não são violações) */
function metricas(res, colabs, P){
  const {days, grid} = res;
  const N = days.length;
  const ativos = colabs.filter(c=>c.ativo!==false);
  const folgasDia = days.map((d,i)=>ativos.filter(c=>grid[c.id] && FOLGA_X.includes(grid[c.id][i])).length);
  const equipeDia = days.map((d,i)=>ativos.filter(c=>grid[c.id] && grid[c.id][i]==='').length);
  const m = a => a.reduce((x,y)=>x+y,0)/a.length;
  const dp = a => { const md=m(a); return Math.sqrt(a.reduce((x,y)=>x+(y-md)**2,0)/a.length); };
  // só faz sentido cobrar par onde a semana pede 2 folgas e é semana cheia
  const semanas = [];
  if(P.inicioSemana==='P'){ for(let i=0;i<N;i+=7) semanas.push({ini:i, fim:Math.min(i+6,N-1)}); }
  else { let i=0; while(i<N){ let j=i; while(j+1<N && days[j+1].getDay()!==P.inicioSemana) j++; semanas.push({ini:i,fim:j}); i=j+1; } }
  let emPar=0, soltas=0;
  ativos.forEach(c=>{
    const arr = grid[c.id]; if(!arr || c.gerente) return;
    const viz = (k)=>k>=0&&k<N&&DESCANSO.includes(arr[k]);
    semanas.forEach(s=>{
      if(s.fim - s.ini + 1 < 7) return;
      if((P.folgasSemana||2) < 2 || P.modelo === '6x1') return;
      for(let i=s.ini;i<=s.fim;i++){
        if(!FOLGA_X.includes(arr[i])) continue;
        if(viz(i-1)||viz(i+1)) emPar++; else soltas++;
      }
    });
  });
  const porPessoa = ativos.map(c=>(grid[c.id]||[]).filter(v=>FOLGA_X.includes(v)).length);
  return {
    desvioEquipe: dp(equipeDia), mediaEquipe: m(equipeDia),
    minEquipe: Math.min(...equipeDia), maxEquipe: Math.max(...equipeDia),
    desvioFolgas: dp(folgasDia), diasSemFolga: folgasDia.filter(x=>x===0).length,
    folgasEmPar: emPar, folgasSoltas: soltas,
    pctPar: emPar+soltas ? (100*emPar/(emPar+soltas)) : 100,
    folgasMin: Math.min(...porPessoa), folgasMax: Math.max(...porPessoa)
  };
}

module.exports = {verificar, metricas};
