/* ============================================================
   MOTOR DE ESCALA - regras de folga
   ============================================================ */

const DIA_NOME = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const DIA_ABREV = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'];

function parseISO(s){ const p = String(s).split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
function ymd(d){ const m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${dd}`; }
function ddmm(d){ return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); }
function addDays(d,n){ const x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }

function listDays(ini, fim){
  const out=[]; let d=parseISO(ini); const f=parseISO(fim);
  while(d<=f){ out.push(new Date(d.getTime())); d=addDays(d,1); }
  return out;
}

function grupoDe(c){
  if(c.gerente) return 'gerencia';
  const cargo = (c.cargo||'').toUpperCase();
  if(cargo.includes('CAIXA')) return 'caixa';
  return 'balcao';
}
function isFarma(c){ return (c.cargo||'').toUpperCase().includes('FARMA'); }
function isSubger(c){ const x=(c.cargo||'').toUpperCase(); return x.includes('SUBGER') || x.startsWith('SUB/'); }
function turnoDe(c){
  const m = /(\d{1,2}):(\d{2})/.exec(c.horario||'');
  if(!m) return 'flex';
  const h = +m[1];
  if(h < 10) return 'abertura';
  if(h < 14) return 'intermediario';
  return 'fechamento';
}
function horaEntrada(c){
  const m = /(\d{1,2}):(\d{2})/.exec(c.horario||'');
  return m ? (m[1].padStart(2,'0')+':'+m[2]) : '--:--';
}

/* ---------- ausências fixas (férias, atestado, licença) ---------- */
function ausenciaEm(c, d){
  const s = ymd(d);
  for(const a of (c.ausencias||[])){
    if(a.ini <= s && s <= (a.fim||a.ini)) return a.tipo;
  }
  return null;
}

/* ============================================================
   GERAÇÃO
   params = {inicio, fim, inicioSemana(0=dom,1=seg), folgasSemana,
             cicloDomingo, maxSeq, minCaixa, minBalcao, farmaPorTurno}
   ============================================================ */
function gerarEscala(colabs, params){
  const days = listDays(params.inicio, params.fim);
  const N = days.length;
  const P = Object.assign({inicioSemana:0, folgasSemana:2, cicloDomingo:3, maxSeq:6,
                           minCaixa:2, minBalcao:3, minFarma:2, minSubger:1, subgerFds:true}, params);

  const AUS_INI = ['F','AT','LC'];
  const ativos = colabs.filter(c=>c.ativo!==false);
  const grid = {};
  ativos.forEach(c=>{
    grid[c.id] = days.map(d => ausenciaEm(c,d) || null);   // null = a definir; '' = trabalha
  });

  /* ---- semanas ---- */
  const semanas = [];
  if(P.inicioSemana === 'P'){
    for(let i=0;i<N;i+=7) semanas.push({ini:i, fim:Math.min(i+6,N-1), idx:semanas.length});
  } else {
    let i = 0;
    while(i < N){
      let j = i;
      while(j+1 < N && days[j+1].getDay() !== P.inicioSemana) j++;
      semanas.push({ini:i, fim:j, idx:semanas.length});
      i = j+1;
    }
  }
  semanas.forEach(s => { s.dias = []; for(let i=s.ini;i<=s.fim;i++) s.dias.push(i); });

  /* ---- alvo de folgas por dia: espalhar em vez de empilhar ---- */
  let previsto = 0;
  const semanasCompletas = () => semanas.filter(s2=>s2.dias.length>=7).length;
  const semanasParciais  = () => semanas.filter(s2=>s2.dias.length>=3 && s2.dias.length<7).length;
  ativos.forEach(c=>{
    if(c.gerente){ previsto += days.filter(d=>d.getDay()===0||d.getDay()===6).length; }
    else { previsto += P.folgasSemana * semanasCompletas() + semanasParciais(); }
  });
  const alvoDia    = previsto / N;

  /* Se o usuário não informou o mínimo por dia da semana, o motor deduz um alvo
     plano a partir da própria capacidade: sem isso ele não tem noção de demanda
     diária e empilha folga no mesmo dia. */
  let minDiaEfetivo = P.minDia || null;
  if(!minDiaEfetivo){
    let disponivelTotal = 0;
    days.forEach((d,i)=>{ disponivelTotal += ativos.filter(c=>!AUS_INI.includes(grid[c.id][i])).length; });
    const capacidadeMedia = (disponivelTotal - previsto) / N;
    const alvoPlano = Math.max(1, Math.floor(capacidadeMedia));
    minDiaEfetivo = {0:alvoPlano,1:alvoPlano,2:alvoPlano,3:alvoPlano,4:alvoPlano,5:alvoPlano,6:alvoPlano};
    P.minDiaAuto = alvoPlano;
  }
  const tetoRigido = Math.max(2, Math.ceil(alvoDia) + (P.tetoExtra != null ? P.tetoExtra : 1));

  /* ---- capacidade por dia (quantos podem folgar sem furar o mínimo) ---- */
  function disponiveis(i, grupo){
    return ativos.filter(c => grupoDe(c)===grupo && grid[c.id][i]!== 'F' && grid[c.id][i]!=='AT' && grid[c.id][i]!=='LC').length;
  }
  function trabalhando(i, grupo){
    return ativos.filter(c => grupoDe(c)===grupo && (grid[c.id][i]===null || grid[c.id][i]==='')).length;
  }
  function farmaTrabalhando(i){
    return ativos.filter(c => isFarma(c) && (grid[c.id][i]===null||grid[c.id][i]==='')).length;
  }

  function subgerTrabalhando(i){
    return ativos.filter(c => isSubger(c) && (grid[c.id][i]===null||grid[c.id][i]==='')).length;
  }
  /* Só é bloqueio rígido o que torna a atribuição impossível: o dia já estar ocupado
     por férias, atestado ou licença. Todo o resto é custo com peso, em ordem de
     prioridade. Isso evita o beco sem saída do farmacêutico único, que antes ficava
     impedido de folgar em qualquer dia do mês. */
  function bloqueioRigido(c, i){
    if(i<0 || i>=N || grid[c.id][i] !== null) return true;
    if(totalTrabalhando(i) - 1 < 1) return true;        // loja não pode ficar vazia
    return false;
  }
  // pesos das restrições que podem ser furadas, da mais grave para a menos
  const PRIORIDADE = {par:{curva:400}, equilibrado:{curva:800, teto:250}, equipe:{curva:1800, teto:400}};
  const ajustePrioridade = PRIORIDADE[P.prioridade] || PRIORIDADE.par;
  /* Pesos em faixas separadas por ordem de grandeza. A soma de todos os custos de
     cobertura de um mês precisa continuar menor que uma única infração legal —
     senão o motor "compra" a infração para salvar a cobertura, que foi o erro
     encontrado nas simulações do 6x1. */
  const PESO = Object.assign({
    // faixa 1: obrigação legal
    estouroSeq: 200000,        // passar do limite de dias seguidos trabalhados
    pulaDomingo: 150000,       // trabalhar mais domingos seguidos do que o ciclo permite
    // faixa 2: regra da casa
    soDomingo: 30000,          // no 6x1, ficar sem a folga da semana por causa do domingo
    diaFixo: 25000,            // não respeitar o dia de folga fixa escolhido para a pessoa
    // faixa 3: cobertura da loja
    farmaCritico: 5000, farmaAlvo: 900, subger: 1400, subgerFds: 900,
    curva: 400, equipe: 600, teto: 150, outroDomingo: 450,
    // faixa 4: qualidade da escala
    extraFolga: 700, extraFolgaSolta: 1600, blocoLongo: 500, bonusDomColado: 250,
    solto: 95, avulso: 130, separado: 210, domAvulso: 60
  }, ajustePrioridade, P.pesos||{});
  function custoSuave(c, i){
    let custo = 0;
    /* Farmacêutico: o alvo é dois na loja. Ficar com um é tolerado em último caso,
       e por isso custa; ficar sem nenhum é quase proibido. */
    if(isFarma(c)){
      const depois = farmaTrabalhando(i) - 1;
      const alvo = P.minFarma != null ? P.minFarma : 2;
      if(depois < alvo) custo += (alvo - depois) * PESO.farmaAlvo;
      if(depois < 1)    custo += PESO.farmaCritico;
    }
    /* Subgerente: um na loja todo dia, com reforço no fim de semana. */
    if(isSubger(c)){
      const depois = subgerTrabalhando(i) - 1;
      const alvoSg = P.minSubger != null ? P.minSubger : 1;
      if(depois < alvoSg){
        custo += (alvoSg - depois) * PESO.subger;
        const wd = days[i].getDay();
        if(P.subgerFds && (wd===0 || wd===6)) custo += PESO.subgerFds;
      }
    }
    custo += deficitDoDia(i, true) * PESO.curva;
    const g = grupoDe(c);
    if(g === 'caixa'  && trabalhando(i,'caixa')  - 1 < P.minCaixa)
      custo += (P.minCaixa  - (trabalhando(i,'caixa')-1))  * PESO.equipe;
    if(g === 'balcao' && trabalhando(i,'balcao') - 1 < P.minBalcao)
      custo += (P.minBalcao - (trabalhando(i,'balcao')-1)) * PESO.equipe;
    const excesso = folgasTotaisNoDia(i) + 1 - tetoRigido;
    if(excesso > 0) custo += excesso * PESO.teto;       // cresce a cada folga a mais no dia
    return custo;
  }
  function folgasNoDia(i, grupo){
    return ativos.filter(c=>grupoDe(c)===grupo && grid[c.id][i]==='X').length;
  }
  function folgasTotaisNoDia(i){
    return ativos.filter(c=>grid[c.id][i]==='X').length;
  }
  function totalTrabalhando(i){
    return ativos.filter(c=>grid[c.id][i]===null || grid[c.id][i]==='').length;
  }
  // quanto o dia fica abaixo do mínimo daquele dia da semana (0 = dentro do combinado)
  function deficitDoDia(i, jaContando){
    if(!minDiaEfetivo) return 0;
    const alvo = Number(minDiaEfetivo[days[i].getDay()] || 0);
    if(!alvo) return 0;
    const d = alvo - (totalTrabalhando(i) - (jaContando?1:0));
    return d > 0 ? d : 0;
  }

  /* ---- 1) GERENTES: folga todo sábado e domingo ---- */
  ativos.filter(c=>c.gerente).forEach(c=>{
    days.forEach((d,i)=>{
      if(grid[c.id][i]===null && (d.getDay()===0 || d.getDay()===6)) grid[c.id][i]='X';
    });
  });

  /* ---- 2) domingos de folga (a cada N domingos trabalhados, 1 folga) ---- */
  const domingos = [];
  days.forEach((d,i)=>{ if(d.getDay()===0) domingos.push(i); });

  const contadorOffset = {caixa:0, balcao:0, gerencia:0};
  const domFolga = {};   // id -> Set de índices

  /* Converte uma data ISO para o índice do domingo correspondente no período,
     ou null se estiver fora do intervalo. */
  function indiceDomingo(isoDate){
    if(!isoDate) return null;
    const [y,m,d] = String(isoDate).split('-').map(Number);
    const alvo = new Date(y, m-1, d);
    const idx = days.findIndex(dd => dd.getFullYear()===alvo.getFullYear()
      && dd.getMonth()===alvo.getMonth() && dd.getDate()===alvo.getDate()
      && dd.getDay()===0);
    return idx >= 0 ? idx : null;
  }

  ativos.filter(c=>!c.gerente).forEach(c=>{
    const g = grupoDe(c);
    let primeiro;

    if(c.primeiroDomingo){
      /* Usuário informou o primeiro domingo de folga: âncora exata. */
      const ancora = indiceDomingo(c.primeiroDomingo);
      if(ancora != null){
        /* o índice dentro de domingos[] que contém ancora */
        const posNaLista = domingos.indexOf(ancora);
        primeiro = posNaLista >= 0 ? posNaLista : 0;
      } else {
        /* domingo informado fora do período: calcular a distância e
           extrapolá-la para dentro do período */
        const [y,m,d] = String(c.primeiroDomingo).split('-').map(Number);
        const alvoDt = new Date(y, m-1, d);
        const difMs  = days[domingos[0]].getTime() - alvoDt.getTime();
        const difSem = Math.round(difMs / (7*24*3600*1000));
        const resto  = ((difSem % P.cicloDomingo) + P.cicloDomingo) % P.cicloDomingo;
        primeiro = (P.cicloDomingo - resto) % P.cicloDomingo;
      }
    } else if(Number.isInteger(c.domTrabConsec)){
      primeiro = Math.max(0, (P.cicloDomingo-1) - c.domTrabConsec);
    } else {
      primeiro = contadorOffset[g] % P.cicloDomingo;
    }
    contadorOffset[g]++;
    const set = new Set();
    for(let k=primeiro; k<domingos.length; k+=P.cicloDomingo) set.add(domingos[k]);
    domFolga[c.id] = set;
  });

  /* ---- 3) folgas: cadeia do mês inteiro por colaborador (programação dinâmica) ----
     Escolher semana a semana não fecha: para colar sábado ou segunda no domingo de folga,
     a semana anterior também precisa ter folgado perto do fim de semana. Então, para cada
     pessoa, montamos todas as opções de cada semana e escolhemos a combinação de menor
     custo que respeite o limite de dias seguidos de ponta a ponta. ---- */
  const diag = {tipos:{}, escolhas:{}, semOpcao:0, relaxou:0};
  const naoGerentes = ativos.filter(c=>!c.gerente);
  const ritmo = {}, slotBase = {}, desdeFolga = {}, domInicial = {};
  naoGerentes.forEach((c,k)=>{
    domInicial[c.id] = k % Math.max(1, (params.cicloDomingo||3));
    ritmo[c.id] = Math.max(3, P.maxSeq - 1 - (k % 3));
    slotBase[c.id] = k % 6;
    desdeFolga[c.id] = (c.diasDesdeFolga!=null && c.diasDesdeFolga!=='')
      ? Number(c.diasDesdeFolga) : (k % Math.max(2, P.maxSeq - 1));
  });

  const AUSENTE = ['F','AT','LC'];
  const DESCANSO = ['X','FC'].concat(AUSENTE);
  const ehFolga = (c,i) => i>=0 && i<N && DESCANSO.includes(grid[c.id][i]);

  // maior sequência de descanso que a opção cria (olhando também para fora da semana)
  function maiorBloco(c, novos){
    const conj = new Set(novos);
    const descansa = i => i>=0 && i<N && (conj.has(i) || DESCANSO.includes(grid[c.id][i]));
    let maior = 0;
    novos.forEach(i=>{
      let a=i; while(descansa(a-1)) a--;
      let b=i; while(descansa(b+1)) b++;
      maior = Math.max(maior, b-a+1);
    });
    return maior;
  }
  function pesoBalanceamento(c, dias){
    let n = 0;
    dias.forEach(i=>{
      const fg = folgasNoDia(i, grupoDe(c)), ft = folgasTotaisNoDia(i);
      n += (fg+1)*(fg+1)*4 + (ft+1)*(ft+1)*1;      // espalha só quando a curva não manda
      if(P.pesoDia && P.pesoDia[days[i].getDay()]) n += Number(P.pesoDia[days[i].getDay()]);
      if(ft === 0) n -= 45;
    });
    return n;
  }

  /* Todas as formas de fechar a semana para essa pessoa.
     O domingo deixou de ser pré-fixado: a lei ("no máximo 2 domingos seguidos
     trabalhados") virou restrição da própria cadeia, e o domingo preferido de
     cada um é só um desempate para a equipe não folgar toda no mesmo domingo. */
  function opcoesDaSemana(c, sem){
    const fixos = sem.dias.filter(i => DESCANSO.includes(grid[c.id][i]));
    const jaX   = sem.dias.filter(i => grid[c.id][i]==='X').length;
    const nDias = sem.dias.length;
    const ausentes = sem.dias.filter(i => AUSENTE.includes(grid[c.id][i])).length;
    const domSemana = sem.dias.filter(i => days[i].getDay()===0);
    const meuDomingo = domSemana.find(i => domFolga[c.id] && domFolga[c.id].has(i));

    const marcar = (novos) => {
      const dias = fixos.concat(novos).sort((a,b)=>a-b);
      // domingos da semana em que a pessoa NÃO trabalha
      const domFolgado = domSemana.filter(i => dias.includes(i) || AUSENTE.includes(grid[c.id][i]));
      return {dias, novos, domSemana: domSemana.length, domFolgado: domFolgado.length};
    };

    /* 6x1: a folga da semana e a folga de domingo são direitos separados —
       na semana em que cai o domingo do ciclo, a pessoa folga duas vezes. */
    if(P.modelo === '6x1')
      return opcoes6x1(c, sem, {fixos, jaX, nDias, ausentes, domSemana, marcar});

    let alvo = nDias>=7 ? P.folgasSemana : (nDias>=3 ? 1 : 0);
    const semOpcao = [Object.assign({tipo:'fixo', custo:0}, marcar([]))];
    if(ausentes >= nDias - 1) return semOpcao;
    const faltam = Math.max(0, alvo - jaX);
    const ok = i => sem.dias.includes(i) && !bloqueioRigido(c,i);
    if(faltam === 0){
      // semana já fechada: normalmente não se mexe. Mas em semana curta ou na última,
      // deixa a opção de uma folga a mais, que é o que evita a ponta de 7 dias no fim do mês.
      if(nDias >= 7 && sem.idx < semanas.length-1) return semOpcao;
      const extras = sem.dias.filter(ok).map(i =>
        Object.assign({tipo:'avulso', extra:'ponta', custo:0}, marcar([i])));
      return semOpcao.concat(extras.map(o=>{
        let custo = PESO.extraFolga;
        o.novos.forEach(i=>{
          custo += custoSuave(c,i);
          if(days[i].getDay()===0 && i!==meuDomingo) custo += PESO.outroDomingo;
        });
        custo += pesoBalanceamento(c, o.novos);
        if(ehFolga(c,o.novos[0]-1) || ehFolga(c,o.novos[0]+1)) custo -= 120;
        return Object.assign({}, o, {custo});
      }));
    }
    const brutas = [];

    if(faltam >= 2){
      for(let k=0;k<sem.dias.length-1;k++){
        const a=sem.dias[k], b=sem.dias[k+1];
        if(b===a+1 && ok(a) && ok(b)) brutas.push({novos:[a,b], tipo:'par'});
      }
      if(brutas.length===0){
        const livres = sem.dias.filter(ok);
        for(let x=0;x<livres.length;x++)
          for(let y=x+1;y<livres.length;y++)
            brutas.push({novos:[livres[x],livres[y]], tipo:'separado'});
      }
      /* Dia de folga fixa: se o dia escolhido não puder formar par (por cair na
         virada da semana, por exemplo), vale mais dar as duas folgas separadas
         do que inflar a semana com um terceiro dia. */
      const diaFixoPessoa = (c.folgaFixa != null && c.folgaFixa !== '') ? Number(c.folgaFixa) : null;
      if(diaFixoPessoa != null){
        const oDia = sem.dias.filter(i => days[i].getDay()===diaFixoPessoa && ok(i));
        oDia.forEach(f=>{
          sem.dias.forEach(i=>{
            if(i===f || !ok(i) || Math.abs(i-f)===1) return;
            brutas.push({novos:[Math.min(i,f), Math.max(i,f)], tipo:'separado'});
          });
        });
      }
    }
    if(brutas.length===0) sem.dias.filter(ok).forEach(i=>brutas.push({novos:[i], tipo:'avulso'}));
    if(brutas.length===0) return semOpcao;

    // variantes com um dia a mais, para quando a cadeia dos dias seguidos não fecha
    const comExtra = [];
    if(faltam >= 2){
      brutas.slice(0,10).forEach(o=>{
        sem.dias.forEach(i=>{
          if(o.novos.includes(i) || !ok(i)) return;
          const colado = o.novos.some(j=>Math.abs(j-i)===1);
          comExtra.push({novos:o.novos.concat([i]).sort((a,b)=>a-b), tipo:o.tipo,
                         extra: colado?'colado':'solto'});
        });
      });
    }
    brutas.push(...comExtra);

    return brutas.map(o=>{
      const info = marcar(o.novos);
      let custo = (o.tipo==='separado' ? PESO.separado : o.tipo==='avulso' ? PESO.avulso : 0);
      if(o.extra) custo += (o.extra==='colado' ? PESO.extraFolga : PESO.extraFolgaSolta);

      o.novos.forEach(i=>{
        custo += custoSuave(c,i);
        if(days[i].getDay()===0 && i !== meuDomingo) custo += PESO.outroDomingo;
      });

      // par que inclui o domingo dele: é o formato que a regra pede
      if(meuDomingo != null && o.novos.includes(meuDomingo) && o.tipo==='par') custo -= PESO.bonusDomColado;
      // metade cola no sábado, metade na segunda, senão a segunda fica deserta
      if(o.novos.length>=2 && o.novos.includes(meuDomingo)){
        const pegaSegunda = o.novos.includes(meuDomingo+1);
        const querSegunda = ((slotBase[c.id] + sem.idx) % 2 === 1);
        if(pegaSegunda !== querSegunda) custo += 55;
      }
      custo += pesoBalanceamento(c, o.novos);
      const bloco = maiorBloco(c, o.novos);
      if(bloco >= 4) custo += (bloco - 3) * (PESO.blocoLongo || 500);
      const fixo = (c.folgaFixa != null && c.folgaFixa !== '') ? Number(c.folgaFixa) : null;
      if(fixo != null){
        // no 5x2 o par de folgas precisa incluir o dia escolhido
        const temODia = o.novos.some(i => days[i].getDay() === fixo);
        const cabeNaSemana = sem.dias.some(i => days[i].getDay() === fixo && !AUSENTE.includes(grid[c.id][i]));
        if(!temODia && cabeNaSemana && o.novos.length) custo += PESO.diaFixo;
      } else if(o.tipo==='par' && !o.novos.some(i=>days[i].getDay()===0)){
        const desejado = (slotBase[c.id] + sem.idx) % Math.max(1, nDias-3);
        custo += Math.abs((o.novos[0] - sem.ini) - desejado) * 18;
      }
      if(o.novos.length===1 && (ehFolga(c,o.novos[0]-1) || ehFolga(c,o.novos[0]+1))) custo -= 80;
      return Object.assign({tipo:o.tipo, extra:o.extra, custo}, info);
    });
  }

  /* Opções de uma semana no modelo 6x1: uma folga na semana e, quando for a vez
     do domingo dele, o domingo por cima — sem exigência de dias colados. */
  function opcoes6x1(c, sem, ctx){
    const {fixos, jaX, nDias, ausentes, domSemana, marcar} = ctx;
    const semOpcao = [Object.assign({tipo:'fixo', custo:0}, marcar([]))];
    if(ausentes >= nDias - 1) return semOpcao;

    const ok = i => sem.dias.includes(i) && !bloqueioRigido(c,i);
    const domingo = domSemana.find(i => ok(i));
    const domJaFolga = domSemana.some(i => DESCANSO.includes(grid[c.id][i]));
    const comuns = sem.dias.filter(i => ok(i) && days[i].getDay() !== 0);
    const alvoSemana = nDias >= 7 ? 1 : (nDias >= 3 ? 1 : 0);
    const faltamSemana = Math.max(0, alvoSemana - jaX);

    const brutas = [];
    if(faltamSemana >= 1){
      comuns.forEach(i => brutas.push({novos:[i], tipo:'semanal'}));
      // mesma folga da semana somada ao domingo do ciclo
      if(domingo != null && !domJaFolga)
        comuns.forEach(i => brutas.push({novos:[i, domingo].sort((a,b)=>a-b), tipo:'semanal-e-domingo'}));
      // só o domingo: atende a semana, mas perde a folga comum — último caso
      if(domingo != null && !domJaFolga) brutas.push({novos:[domingo], tipo:'so-domingo'});
      if(!comuns.length && domingo != null && !domJaFolga) brutas.push({novos:[domingo], tipo:'so-domingo'});
    } else if(domingo != null && !domJaFolga){
      // a semana já tem a folga comum; falta encaixar o domingo do ciclo
      brutas.push({novos:[domingo], tipo:'domingo-do-ciclo'});
      brutas.push({novos:[], tipo:'fixo'});
    }
    if(!brutas.length) return semOpcao;

    // variantes com um dia a mais, quando a cadeia dos dias seguidos não fecha
    const extras = [];
    brutas.slice(0,10).forEach(o=>{
      if(!o.novos.length) return;
      sem.dias.forEach(i=>{
        if(o.novos.includes(i) || !ok(i) || days[i].getDay()===0) return;
        extras.push({novos:o.novos.concat([i]).sort((a,b)=>a-b), tipo:o.tipo, extra:'solto'});
      });
    });
    brutas.push(...extras);

    const slotFixo = slotBase[c.id] % Math.max(1, nDias);
    const fixo = (c.folgaFixa != null && c.folgaFixa !== '') ? Number(c.folgaFixa) : null;
    return brutas.map(o=>{
      const info = marcar(o.novos);
      let custo = 0;
      // quem tem folga fixa no domingo já cumpre a folga da semana no próprio domingo
      if(o.tipo === 'so-domingo' && fixo !== 0) custo += PESO.soDomingo;
      if(o.tipo === 'domingo-do-ciclo')  custo += 0;
      if(o.tipo === 'fixo' && !o.novos.length) custo += PESO.pulaDomingo;   // deixar o domingo passar
      if(o.extra) custo += PESO.extraFolgaSolta;
      o.novos.forEach(i=>{
        custo += custoSuave(c,i);
        if(days[i].getDay()===0 && i !== ctx.meuDomingo) custo += 0;   // no 6x1 o domingo é do ciclo, não penaliza
      });
      custo += pesoBalanceamento(c, o.novos);
      if(fixo != null){
        // dia de folga escolhido para a pessoa: só cede quando não há alternativa
        const temODia = o.novos.some(i => days[i].getDay() === fixo);
        const cabeNaSemana = sem.dias.some(i => days[i].getDay() === fixo && !AUSENTE.includes(grid[c.id][i]));
        if(!temODia && cabeNaSemana && o.novos.length) custo += PESO.diaFixo;
      } else {
        const comum = o.novos.find(i => days[i].getDay() !== 0);
        if(comum != null) custo += Math.abs((comum - sem.ini) - slotFixo) * 22;
      }
      return Object.assign({tipo:o.tipo, extra:o.extra, custo}, info);
    });
  }

  function intervaloOk(a, b){ return (b - a - 1) <= P.maxSeq; }

  /* Planeja o mês inteiro de uma pessoa: escolhe, entre todas as combinações
     semanais, a de menor custo que respeite o limite de dias seguidos. */
  function planejar(c){
    const maxDomSeguidos = Math.max(1, P.cicloDomingo - 1);
    const domIni = Number.isInteger(c.domTrabConsec) ? c.domTrabConsec : (domInicial[c.id] || 0);
    const chave = (ult, dom, run) => ult + '|' + dom + '|' + run;
    const u0 = -1 - (desdeFolga[c.id]||0), d0 = Math.min(domIni, maxDomSeguidos);
    let estados = new Map([[chave(u0,d0,0), {custo:0, caminho:[], ult:u0, dom:d0, run:0}]]);

    semanas.forEach(sem=>{
      const opcoes = opcoesDaSemana(c, sem);
      const proximos = new Map();
      const guardar = (ult, dom, run, custo, caminho)=>{
        const k = chave(ult,dom,run);
        const atual = proximos.get(k);
        if(!atual || custo < atual.custo) proximos.set(k, {custo, caminho, ult, dom, run});
      };
      /* Nada é descartado: as duas exigências legais (no máximo maxSeq dias
         seguidos e no máximo cicloDomingo-1 domingos seguidos) entram como custo
         altíssimo. Assim a cadeia sempre existe e o motor escolhe, quando não há
         saída limpa, a combinação que infringe o mínimo possível. */
      const passo = (st, op)=>{
        let extra = 0;
        let dom = st.dom;
        if(op.domSemana > 0){
          if(op.domFolgado > 0) dom = 0;
          else {
            dom = st.dom + 1;
            if(dom > maxDomSeguidos){ extra += PESO.pulaDomingo * (dom - maxDomSeguidos); dom = maxDomSeguidos + 1; }
          }
        }
        if(op.dias.length === 0){ guardar(st.ult, dom, 0, st.custo + extra, st.caminho.concat([op])); return; }
        const excede = (a,b) => Math.max(0, (b - a - 1) - P.maxSeq);
        extra += excede(st.ult, op.dias[0]) * PESO.estouroSeq;
        for(let k=1;k<op.dias.length;k++) extra += excede(op.dias[k-1], op.dias[k]) * PESO.estouroSeq;

        // blocos de descanso: o par no fim de uma semana pode encostar no par
        // da semana seguinte e virar 4 dias seguidos parados
        const blocos = [];
        let atual = 1;
        for(let k=1;k<op.dias.length;k++){
          if(op.dias[k] === op.dias[k-1]+1) atual++;
          else { blocos.push(atual); atual = 1; }
        }
        blocos.push(atual);
        if(op.dias[0] === st.ult + 1) blocos[0] += st.run;
        blocos.forEach(b=>{ if(b >= 4) extra += (b-3) * PESO.blocoLongo; });
        const run = Math.min(5, blocos[blocos.length-1]);

        guardar(op.dias[op.dias.length-1], dom, run, st.custo + op.custo + extra, st.caminho.concat([op]));
      };
      estados.forEach(st => opcoes.forEach(op => passo(st, op)));
      if(!proximos.size){ diag.relaxou++; return; }
      estados = proximos;
    });
    // ponta final: os dias trabalhados entre a última folga e o fim do período
    let melhorFim = null, melhorNota = Infinity;
    estados.forEach(st=>{
      const ponta = Math.max(0, (N - st.ult - 1) - P.maxSeq);
      const nota = st.custo + ponta * PESO.estouroSeq;
      if(nota < melhorNota){ melhorNota = nota; melhorFim = st; }
    });
    return melhorFim;
  }
  function aplicar(c, plano){
    if(!plano) return;
    plano.caminho.forEach(op=>op.novos.forEach(i=>{ if(grid[c.id][i]===null) grid[c.id][i]='X'; }));
    diag.escolhas[c.id] = plano.caminho.map(op=>op.tipo);
  }
  function limpar(c){
    for(let i=0;i<N;i++) if(grid[c.id][i]==='X') grid[c.id][i]=null;
  }

  /* Ordem de partida: quem tem menos saída decide primeiro (farmacêutico e
     subgerente únicos são os mais travados). */
  const dificuldade = c => (isFarma(c) ? 1000/Math.max(1,ativos.filter(isFarma).length) : 0)
                         + (isSubger(c) ? 800/Math.max(1,ativos.filter(isSubger).length) : 0)
                         + ((c.ausencias||[]).length * 50);
  const ordemInicial = naoGerentes.slice().sort((a,b)=>dificuldade(b)-dificuldade(a));
  ordemInicial.forEach(c=>{ aplicar(c, planejar(c)); });

  /* Rodadas de replanejamento: cada pessoa é retirada e reencaixada vendo a escala
     dos outros já montada. Corrige a vantagem de quem foi planejado primeiro.
     É o passo de reparo/busca local que a literatura de rostering usa. */
  const rodadas = P.rodadas != null ? P.rodadas : 4;
  for(let r=0; r<rodadas; r++){
    let mudou = false;
    // ordem alternada a cada rodada, para não privilegiar sempre os mesmos
    const ordem = naoGerentes.slice();
    for(let k=0;k<(r % Math.max(1,ordem.length));k++) ordem.push(ordem.shift());
    ordem.forEach(c=>{
      const antes = grid[c.id].slice();
      limpar(c);
      const plano = planejar(c);
      aplicar(c, plano);
      if(grid[c.id].some((v,i)=>v!==antes[i])) mudou = true;
    });
    diag.rodadas = r+1;
    if(!mudou) break;
  }

  /* ---- 4) reparo: sequências acima do máximo (desloca o bloco de folga, sem separá-lo) ---- */
  const semanaDe = i => semanas.find(s2 => i>=s2.ini && i<=s2.fim);
  ativos.forEach(c=>{
    if(c.gerente) return;
    const arr = grid[c.id];
    const descansa = i => i<0 || ['X','F','FC','AT','LC'].includes(arr[i]);
    for(let passe=0; passe<4; passe++){
      let seq = desdeFolga[c.id] || 0, alvo = -1;
      for(let i=0;i<N;i++){
        if(descansa(i)){ seq=0; continue; }
        seq++;
        if(seq > P.maxSeq){ alvo = i; break; }
      }
      if(alvo<0) break;
      // acha o próximo bloco de folga e tenta trazê-lo para dentro da sequência
      let a = -1; for(let i=alvo+1;i<N;i++){ if(arr[i]==='X'){ a=i; break; } }
      if(a<0) break;
      let b=a; while(b+1<N && arr[b+1]==='X') b++;
      let temDomingoDele = false;
      for(let i=a;i<=b;i++) if(days[i].getDay()===0 && domFolga[c.id] && domFolga[c.id].has(i)) temDomingoDele = true;
      if(temDomingoDele) break;
      const sem = semanaDe(a);
      let moveu = false;
      for(let k=alvo; k>=Math.max(sem.ini, alvo-P.maxSeq+1); k--){
        const destino = []; for(let d=0; d<=b-a; d++) destino.push(k+d);
        if(destino.some(i=> i>=N || (arr[i]!==null && arr[i]!=='X'))) continue;
        for(let i=a;i<=b;i++) arr[i]=null;
        let ok = destino.every(i=> !bloqueioRigido(c,i));
        if(!ok){ for(let i=a;i<=b;i++) arr[i]='X'; continue; }
        destino.forEach(i=>arr[i]='X');
        moveu = true; break;
      }
      if(!moveu) break;
    }
  });

  /* ---- 5) fecha: null vira dia trabalhado ---- */
  ativos.forEach(c=>{ for(let i=0;i<N;i++) if(grid[c.id][i]===null) grid[c.id][i]=''; });

  return {days, grid, semanas, ativos, params:P, diag, desdeFolga};
}

/* ============================================================
   VALIDAÇÃO
   ============================================================ */
function validar(res, colabs){
  const {days, grid, semanas, params:P} = res;
  const desdeFolgaGer = res.desdeFolga || {};
  const N = days.length;
  const ativos = res.ativos;
  const alertas = [];
  const porColab = {};

  ativos.forEach(c=>{
    const av = [];
    const arr = grid[c.id];
    const folga = i => ['X','F','FC','AT','LC'].includes(arr[i]);

    // 1) folgas por semana
    semanas.forEach(s=>{
      if(s.dias.length<7) return;
      const n = s.dias.filter(i=>arr[i]==='X'||arr[i]==='FC').length;
      const ferias = s.dias.filter(i=>arr[i]==='F'||arr[i]==='AT'||arr[i]==='LC').length;
      if(ferias>=5) return;
      if(!c.gerente && n < P.folgasSemana)
        av.push({tipo:'folgas-semana', nivel:'regra', txt:`Semana de ${ddmm(days[s.ini])}: ${n} folga(s), mínimo ${P.folgasSemana}`});
    });

    // 2) sequência máxima
    let seq = desdeFolgaGer[c.id] != null ? desdeFolgaGer[c.id]
            : ((c.diasDesdeFolga!=null)?Number(c.diasDesdeFolga):0);
    let pior=0, quando=null;
    for(let i=0;i<N;i++){
      if(folga(i)){ seq=0; continue; }
      seq++; if(seq>pior){ pior=seq; quando=days[i]; }
    }
    if(pior > P.maxSeq) av.push({tipo:'sequencia', nivel:'regra', txt:`${pior} dias seguidos sem folga (até ${ddmm(quando)}), máximo ${P.maxSeq}`});

    // 3) domingos
    const dom = [];
    days.forEach((d,i)=>{ if(d.getDay()===0) dom.push(i); });
    const domTrab = dom.filter(i=>arr[i]===''), domFol = dom.filter(i=>arr[i]!=='');
    let corrida=0, avisouDom=false;
    dom.forEach(i=>{
      if(arr[i]===''){
        corrida++;
        if(corrida > P.cicloDomingo-1 && !avisouDom){
          av.push({tipo:'domingo', nivel:'regra',
                   txt:`${corrida} domingos seguidos trabalhados até ${ddmm(days[i])} — a lei permite no máximo ${P.cicloDomingo-1}`});
          avisouDom = true;
        }
      } else { corrida=0; avisouDom=false; }
    });

    // 3b) dia de folga fixa
    if(c.folgaFixa != null && c.folgaFixa !== ''){
      const diaFixo = Number(c.folgaFixa);
      semanas.forEach(s2=>{
        if(s2.dias.length < 7) return;
        const cabe = s2.dias.filter(i=>days[i].getDay()===diaFixo && !['F','AT','LC'].includes(arr[i]));
        if(!cabe.length) return;                       // semana de férias, não se cobra
        const folgou = cabe.some(i=>arr[i]==='X' || arr[i]==='FC');
        if(!folgou) av.push({tipo:'dia-fixo', nivel:'regra',
          txt:`Folga fixa em ${DIA_NOME[diaFixo]}: a semana de ${ddmm(days[s2.ini])} não teve folga nesse dia`});
      });
    }

    // 4) folgas isoladas (fora do domingo)
    const semanaParcial = new Set();
    semanas.forEach(s2=>{ if(s2.dias.length<7) s2.dias.forEach(i=>semanaParcial.add(i)); });
    if(!c.gerente && P.modelo !== '6x1'){
      for(let i=0;i<N;i++){
        if(arr[i]!=='X' || semanaParcial.has(i)) continue;
        const antes = i>0 && folga(i-1), depois = i<N-1 && folga(i+1);
        if(antes || depois || days[i].getDay()===0) continue;
        const sem = semanas.find(s2=>i>=s2.ini && i<=s2.fim);
        const temPar = sem && sem.dias.some(k=>arr[k]==='X' && (folga(k+1) || folga(k-1)));
        if(temPar){
          av.push({tipo:'avulsa', nivel:'nota',
            txt:`${ddmm(days[i])} (${DIA_NOME[days[i].getDay()]}) é folga avulsa — a semana já tem o par, este dia entrou para não passar de ${P.maxSeq} dias seguidos`});
        } else {
          av.push({tipo:'isolada', nivel:'regra',
            txt:`Folga isolada em ${ddmm(days[i])} (${DIA_NOME[days[i].getDay()]}) e a semana não tem nenhum par de folgas`});
        }
      }
    }

    porColab[c.id] = {av, domTrab:domTrab.length, domFolga:domFol.length, pior,
                      totalFolgas: arr.filter(v=>v==='X'||v==='FC').length};
    av.forEach(a=>alertas.push({colab:c.nome, ...a}));
  });

  // cobertura por dia
  const cobertura = days.map((d,i)=>{
    const cx = ativos.filter(c=>grupoDe(c)==='caixa' && grid[c.id][i]==='').length;
    const bl = ativos.filter(c=>grupoDe(c)==='balcao' && grid[c.id][i]==='').length;
    const gr = ativos.filter(c=>grupoDe(c)==='gerencia' && grid[c.id][i]==='').length;
    const fa = ativos.filter(c=>isFarma(c) && grid[c.id][i]==='').length;
    const falta = [], leve = [];
    if(cx < P.minCaixa) falta.push(`caixa ${cx}/${P.minCaixa}`);
    if(bl < P.minBalcao) falta.push(`balcão ${bl}/${P.minBalcao}`);
    const alvoFa = P.minFarma != null ? P.minFarma : 2;
    const faDisp = ativos.filter(c=>isFarma(c) && !['F','AT','LC'].includes(grid[c.id][i])).length;
    if(faDisp >= 1 && fa < 1) falta.push('SEM farmacêutico');
    else if(faDisp >= alvoFa && fa < alvoFa) leve.push(`farmacêutico ${fa}/${alvoFa}`);
    if(P.minDia){
      const alvoDiaSem = Number(P.minDia[d.getDay()] || 0);
      if(alvoDiaSem && (cx+bl+gr) < alvoDiaSem) falta.push(`equipe ${cx+bl+gr}/${alvoDiaSem}`);
    }
    const sg = ativos.filter(c=>isSubger(c) && grid[c.id][i]==='').length;
    const sgDisp = ativos.filter(c=>isSubger(c) && !['F','AT','LC'].includes(grid[c.id][i])).length;
    const alvoSg = P.minSubger != null ? P.minSubger : 1;
    if(sgDisp >= alvoSg && sg < alvoSg) falta.push(`subgerente ${sg}/${alvoSg}`);
    if(falta.length) alertas.push({colab:'—', tipo:'cobertura', nivel:'regra', txt:`${ddmm(d)}: ${falta.join(', ')}`});
    if(leve.length)  alertas.push({colab:'—', tipo:'cobertura-leve', nivel:'nota', txt:`${ddmm(d)}: ${leve.join(', ')} (tolerado)`});
    return {cx, bl, gr, fa, sg, total:cx+bl+gr, falta, leve};
  });

  return {alertas, porColab, cobertura};
}

if(typeof module !== 'undefined') module.exports = {gerarEscala, validar, listDays, ymd, ddmm, grupoDe, isFarma, isSubger, turnoDe, horaEntrada, DIA_NOME, DIA_ABREV};
