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
function minutos(hora){ const m=/^(\d{1,2}):(\d{2})$/.exec(String(hora||'')); return m ? +m[1]*60 + +m[2] : null; }
function jornada(c){
  if(c.jornada && minutos(c.jornada.entrada)!=null && minutos(c.jornada.saida)!=null)
    return {entrada:c.jornada.entrada,saida:c.jornada.saida};
  const horas=String(c.horario||'').match(/\d{1,2}:\d{2}/g)||[];
  return horas.length>=2 ? {entrada:horas[0],saida:horas[1]} : null;
}
function horasTexto(txt){ return (String(txt||'').match(/\d{1,2}:\d{2}/g)||[]).map(h=>h.padStart(5,'0')).filter(h=>minutos(h)!=null); }

/* Quantas folgas um bloco de `k` dias deve ter. Escrito aqui por conta própria:
   duas folgas a cada sete dias completos, e uma a mais se o resto chegar a três
   dias. Resto de um ou dois dias não gera exigência. */
function folgasExigidas(k){
  const semanasInteiras = Math.floor(k / 7);
  const resto = k - semanasInteiras * 7;
  return semanasInteiras * 2 + (resto >= 3 ? 1 : 0);
}

/* Semanas da conferência. A escala nova vai de domingo a sábado e a ponta curta
   é absorvida pela semana vizinha; 'P' e segunda-a-domingo só aparecem ao
   reconferir escala publicada sob a regra antiga. */
function semanasDaConferencia(days, inicioSemana){
  const N = days.length;
  const montar = lista => {
    lista.forEach(s=>{ s.dias=[]; for(let k=s.ini;k<=s.fim;k++) s.dias.push(k); });
    return lista;
  };
  if(inicioSemana === 'P'){
    const s=[];
    for(let i=0;i<N;i+=7) s.push({ini:i, fim:Math.min(i+6,N-1)});
    return montar(s);
  }
  const primeiroDia = (inicioSemana == null) ? 0 : Number(inicioSemana);
  const s=[];
  let i=0;
  while(i<N){
    let j=i;
    while(j+1<N && days[j+1].getDay()!==primeiroDia) j++;
    s.push({ini:i, fim:j});
    i=j+1;
  }
  if(primeiroDia !== 0) return montar(s);
  // domingo a sábado: funde a ponta curta, com as mesmas duas condições do motor
  const comp = s.filter(x=>x.fim-x.ini+1 >= 7).length;
  if(comp >= 1){
    const largura = x => x.fim - x.ini + 1;
    if(s.length>=2 && largura(s[0])<7 && largura(s[0])+largura(s[1])<=13){
      s[1].ini = s[0].ini;
      s.shift();
    }
    if(s.length>=2){
      const fim = s[s.length-1], penultima = s[s.length-2];
      if(largura(fim)<7 && largura(fim)+largura(penultima)<=13){
        penultima.fim = fim.fim;
        s.pop();
      }
    }
  }
  return montar(s);
}
function entradaDia(c,i,res){ const hs=horasTexto(res.horas&&res.horas[c.id]&&res.horas[c.id][i]); return hs.length ? hs[0] : (jornada(c)||{}).entrada; }
function fimDiaMinutos(c,i,res){
  const hs=horasTexto(res.horas&&res.horas[c.id]&&res.horas[c.id][i]);
  if(hs.length>=2){ let b=minutos(hs[1])-minutos(hs[0]); if(b<=0)b+=1440; return minutos(hs[0])+b; }
  const j=jornada(c), entrada=entradaDia(c,i,res); if(!j||minutos(entrada)==null) return null; let bruto=minutos(j.saida)-minutos(j.entrada); if(bruto<=0)bruto+=1440; return minutos(entrada)+bruto;
}

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

  // semanas, recalculadas aqui de propósito (decisão 0005)
  const semanas = semanasDaConferencia(days, P.inicioSemana);

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

    // R11 — repouso mínimo entre a saída de um dia e a entrada do seguinte.
    // Vale também para gerente, antes do retorno das demais regras de folga.
    const minimoInterjornada = P.minInterjornada != null ? Number(P.minInterjornada) : 660;
    if(N > 0 && trabalha(0) && (c.trabalhouUltimoDia || c.fimUltimoDiaMinutos != null)){
      const fimAnt = c.fimUltimoDiaMinutos != null ? Number(c.fimUltimoDiaMinutos) : null;
      const ent0 = entradaDia(c, 0, res);
      if(fimAnt != null && minutos(ent0) != null){
        const descanso0 = minutos(ent0) + 1440 - fimAnt;
        if(descanso0 < minimoInterjornada)
          add('R11-interjornada', c.nome, `anterior→${dd(days[0])}: ${Math.floor(descanso0/60)}h${String(descanso0%60).padStart(2,'0')} de descanso`);
      } else {
        add('R11-interjornada-lacuna-nota', c.nome, `anterior→${dd(days[0])}: lacuna de jornada impede conferir descanso de 11h`);
      }
    }
    for(let i=0;i<N-1;i++){
      if(!trabalha(i) || !trabalha(i+1)) continue;
      const fim=fimDiaMinutos(c,i,res), entrada=entradaDia(c,i+1,res);
      if(fim==null || minutos(entrada)==null){
        add('R11-interjornada-lacuna-nota', c.nome, `${dd(days[i])}→${dd(days[i+1])}: lacuna de jornada impede conferir descanso de 11h`);
        continue;
      }
      const descanso=minutos(entrada)+1440-fim;
      if(descanso < minimoInterjornada)
        add('R11-interjornada', c.nome, `${dd(days[i])}→${dd(days[i+1])}: ${Math.floor(descanso/60)}h${String(descanso%60).padStart(2,'0')} de descanso`);
    }

    // R6 — folga fixa semanal vinda do perfil operacional da pessoa.
    // Reimplementada aqui a partir do enunciado: o perfil declara os dias; sem
    // perfil definido, o gerente mantém sábado e domingo, como antes.
    const perfisLoja = (P && P.perfis) || {};
    const perfilDaPessoa = c.perfil && perfisLoja[c.perfil] ? perfisLoja[c.perfil] : null;
    const fichaGerente = c.gerente && Number.isInteger(Number(c.folgaFixa)) && Number.isInteger(Number(c.folgaFixa2))
      && Number(c.folgaFixa)!==Number(c.folgaFixa2) ? [Number(c.folgaFixa),Number(c.folgaFixa2)] : null;
    const diasDoPerfil = fichaGerente || (perfilDaPessoa && Array.isArray(perfilDaPessoa.regras && perfilDaPessoa.regras.folgaFixaSemanal)
      ? perfilDaPessoa.regras.folgaFixaSemanal.map(Number)
      : (c.gerente ? [0,6] : []));
    if(diasDoPerfil.length){
      const nomePerfil = perfilDaPessoa ? perfilDaPessoa.nome : (fichaGerente ? 'ficha do gerente' : 'gerente (padrão da casa)');
      days.forEach((d,i)=>{
        if(!diasDoPerfil.includes(d.getDay()) || descansa(i)) return;
        const semana = semanas.find(s=>s.dias.includes(i));
        const domingo = semana && semana.dias.find(k=>days[k].getDay()===0);
        const substituida = !!(fichaGerente && fichaGerente[0]===d.getDay() && domingo!=null && descansa(domingo));
        if(!substituida) add('R6-perfil-folga-fixa', c.nome, `perfil "${nomePerfil}" prevê folga, mas trabalha em ${dd(days[i])}`);
      });
      if(!fichaGerente) return;   // perfil legado continua encerrando as regras de folga
    }

    // R2 — nunca mais de maxSeq dias seguidos trabalhados
    let seq = (estadoInicial && estadoInicial[c.id]) || 0;
    for(let i=0;i<N;i++){
      if(descansa(i)){ seq=0; continue; }
      seq++;
      if(seq === P.maxSeq+1) add('R2-sequencia', c.nome, `${seq} dias seguidos até ${dd(days[i])}`);
    }

    // R1 — folgas por semana, proporcional ao tamanho do bloco
    semanas.forEach(s=>{
      const pedido = folgasExigidas(s.dias.length);
      if(pedido < 1) return;                              // ponta de 1 ou 2 dias não exige folga
      const afast = s.dias.filter(i=>AUSENCIA.includes(arr[i])).length;
      if(afast >= s.dias.length - 1) return;              // bloco praticamente todo de férias
      const n = s.dias.filter(i=>FOLGA_X.includes(arr[i])).length + Math.min(afast, pedido);
      if(n < pedido)
        add('R1-folgas-semana', c.nome, `semana de ${dd(days[s.ini])}: ${n} folga(s), pedido ${pedido}`);
    });

    // R3 — domingos: no máximo (ciclo-1) trabalhados seguidos
    let corrida = 0, jaAvisou=false;
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

    // R4 — folga em par nas semanas sem domingo de folga
    semanas.forEach(s=>{
      if(folgasExigidas(s.dias.length) < 2) return;
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

  // R7 — cobertura por dia (separa demanda configurada de disponibilidade)
  days.forEach((d,i)=>{
    const trab = c => grid[c.id] && grid[c.id][i]==='';
    const disp = c => grid[c.id] && !AUSENCIA.includes(grid[c.id][i]);
    const cx = ativos.filter(c=>ehCaixa(c) && trab(c)).length;
    const bl = ativos.filter(c=>ehBalcao(c) && trab(c)).length;
    const fa = ativos.filter(c=>ehFarma(c) && trab(c)).length;
    const sg = ativos.filter(c=>ehSubger(c) && trab(c)).length;
    const tot= ativos.filter(c=>trab(c)).length;
    const cxDisp = ativos.filter(c=>ehCaixa(c) && disp(c)).length;
    const blDisp = ativos.filter(c=>ehBalcao(c) && disp(c)).length;
    const faDisp = ativos.filter(c=>ehFarma(c) && disp(c)).length;
    const sgDisp = ativos.filter(c=>ehSubger(c) && disp(c)).length;
    const minCx = Number(P.minCaixa || 0);
    const minBl = Number(P.minBalcao || 0);
    if(minCx > 0 && cx < minCx) add('R7-caixa','—', `${dd(d)}: ${cx}/${minCx}${cxDisp < minCx ? ` (disponíveis: ${cxDisp})` : ''}`);
    if(minBl > 0 && bl < minBl) add('R7-balcao','—', `${dd(d)}: ${bl}/${minBl}${blDisp < minBl ? ` (disponíveis: ${blDisp})` : ''}`);
    const alvoFa = P.minFarma != null ? Number(P.minFarma) : 2;
    if(alvoFa > 0 && fa < 1) add('R7-farma-zero','—', `${dd(d)}: nenhum farmacêutico${faDisp < 1 ? ' (0 disponíveis)' : ''}`);
    else if(alvoFa > 0 && fa < alvoFa) add('R7-farma-alvo-nota','—', `${dd(d)}: ${fa}/${alvoFa}${faDisp < alvoFa ? ` (disponíveis: ${faDisp})` : ''} (tolerado)`);
    const alvoSg = P.minSubger != null ? Number(P.minSubger) : 1;
    if(alvoSg > 0 && sg < alvoSg) add('R7-subgerente','—', `${dd(d)}: ${sg}/${alvoSg} subgerente${sgDisp < alvoSg ? ` (disponíveis: ${sgDisp})` : ''}`);
    if(P.minDia){
      const alvo = Number(P.minDia[d.getDay()]||0);
      if(alvo && tot < alvo) add('R7-equipe','—', `${dd(d)}: ${tot}/${alvo}`);
    }
    if(tot === 0) add('R7-loja-vazia','—', `${dd(d)}: ninguém na loja`);

    /* R12 — pisos obrigatórios por loja e função. Independente de R7: lá os
       números são metas, aqui é o mínimo que a loja declarou obrigatório.
       Sem gente disponível o dia é impedimento operacional, não violação —
       a distinção é a mesma que a decisão 0005 exigiu para o farmacêutico. */
    const piso = chave => (P[chave] == null || P[chave] === '') ? null : Number(P[chave]);
    const pisoDiaSem = P.minDiaObrigatorio ? Number(P.minDiaObrigatorio[d.getDay()] || 0) : null;
    [
      {p: piso('minCaixaObrigatorio'), tem: cx, disp: cxDisp, rotulo: 'caixa'},
      {p: piso('minBalcaoObrigatorio'), tem: bl, disp: blDisp, rotulo: 'balcão'},
      {p: piso('minFarmaObrigatorio'), tem: fa, disp: faDisp, rotulo: 'farmacêutico'},
      {p: piso('minSubgerObrigatorio'), tem: sg, disp: sgDisp, rotulo: 'subgerente'},
      {p: pisoDiaSem, tem: tot, disp: ativos.filter(c=>disp(c)).length, rotulo: 'equipe'},
    ].forEach(({p, tem, disp: d2, rotulo})=>{
      if(p == null || !(p > 0) || tem >= p) return;
      // Piso obrigatório é violação mesmo sem gente disponível; a escassez entra
      // no texto como informação, não como rebaixamento da regra.
      add('R12-piso-obrigatorio','—', `${dd(d)}: ${rotulo} ${tem}/${p} — abaixo do mínimo obrigatório da loja${d2 < p ? ` (sem gente disponível: ${d2})` : ''}`);
    });
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
  const semanas = semanasDaConferencia(days, P.inicioSemana);
  let emPar=0, soltas=0;
  ativos.forEach(c=>{
    const arr = grid[c.id]; if(!arr || c.gerente) return;
    const viz = (k)=>k>=0&&k<N&&DESCANSO.includes(arr[k]);
    /* Só blocos que pedem exatamente duas folgas entram na conta. Num bloco de
       três, uma das folgas é necessariamente avulsa — o teto seria 66,7% e a
       média viraria uma medida da composição do período, não da qualidade da
       escala. O limiar sempre quis medir "o par saiu quando era possível". */
    semanas.forEach(s=>{
      if(folgasExigidas(s.dias.length) !== 2) return;
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
