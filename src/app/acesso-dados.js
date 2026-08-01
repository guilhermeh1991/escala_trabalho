/* ============================================================
   ACESSO E ARMAZENAMENTO — Supabase
   Substitui o armazenamento local. A interface do resto do
   aplicativo não muda: continua chamando store.get / store.set.
   ============================================================ */

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const SESSAO = { usuario: null, perfil: null, empresa: null };

/* ---------- regras de senha (NIST SP 800-63B-4) ----------
   Sem exigência de maiúscula, número ou símbolo: a norma proíbe
   regras de composição. O que vale é comprimento e não estar
   em vazamento conhecido. */
const SENHA_MIN = 12;
const SENHA_RECOMENDADA = 15;
const SENHA_MAX = 64;

async function senhaVazada(senha){
  try{
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(senha));
    const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
    const prefixo = hash.slice(0,5), sufixo = hash.slice(5);
    // k-anonymity: só os 5 primeiros caracteres do hash saem do navegador
    const r = await fetch('https://api.pwnedpasswords.com/range/' + prefixo, {headers:{'Add-Padding':'true'}});
    if(!r.ok) return 0;
    const txt = await r.text();
    for(const linha of txt.split('\n')){
      const [suf, qtd] = linha.trim().split(':');
      if(suf === sufixo) return parseInt(qtd, 10) || 0;
    }
    return 0;
  }catch(e){ return 0; }   // sem rede: não bloqueia o cadastro
}

function avaliarSenha(senha, email){
  const problemas = [];
  const n = [...senha].length;                      // conta code points, não bytes
  if(n < SENHA_MIN) problemas.push(`Use pelo menos ${SENHA_MIN} caracteres (tem ${n}).`);
  if(n > SENHA_MAX) problemas.push(`Máximo de ${SENHA_MAX} caracteres.`);
  const local = (email||'').split('@')[0].toLowerCase();
  const baixa = senha.toLowerCase();
  if(local && local.length >= 4 && baixa.includes(local)) problemas.push('Não use o seu e-mail na senha.');
  ['escala','farmacia','drogaria','123456','senha','password','qwerty','bauru']
    .forEach(p=>{ if(baixa.includes(p)) problemas.push(`Evite "${p}" na senha.`); });
  if(/^(.)\1+$/.test(senha)) problemas.push('Não repita o mesmo caractere.');
  return {ok: problemas.length === 0, problemas, n};
}

function forcaSenha(senha){
  const n = [...senha].length;
  const variedade = (/[a-z]/.test(senha)?1:0) + (/[A-Z]/.test(senha)?1:0)
                  + (/[0-9]/.test(senha)?1:0) + (/[^a-zA-Z0-9]/.test(senha)?1:0);
  if(n === 0) return {nivel:0, txt:'', cor:'var(--linha)'};
  if(n < SENHA_MIN) return {nivel:1, txt:'curta demais', cor:'var(--alerta)'};
  if(n < SENHA_RECOMENDADA) return {nivel:2, txt:'aceitável', cor:'#A8730B'};
  if(n >= SENHA_RECOMENDADA && variedade >= 2) return {nivel:4, txt:'forte', cor:'var(--v-fg)'};
  return {nivel:3, txt:'boa', cor:'var(--v-fg)'};
}

/* ---------- tradução de erros do Supabase ---------- */
function erroAmigavel(e){
  const m = (e && (e.message || e.error_description) || '').toLowerCase();
  if(m.includes('invalid login')) return 'E-mail ou senha não conferem.';
  if(m.includes('email not confirmed')) return 'Confirme o e-mail pelo link que enviamos antes de entrar.';
  if(m.includes('user already registered')) return 'Já existe conta com esse e-mail. Use "Entrar" ou recupere a senha.';
  if(m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere alguns minutos.';
  if(m.includes('password should be at least')) return `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  if(m.includes('código de convite')) return 'Código de convite inválido.';
  if(m.includes('já pertence')) return 'Este usuário já está vinculado a uma empresa.';
  return (e && e.message) || 'Não foi possível concluir. Tente de novo.';
}

/* ============================================================
   SINCRONIZAÇÃO — mapeia as tabelas para o formato que a
   interface já usa (S.lojas), e de volta.
   ============================================================ */
const DB = {
  async carregarEmpresa(){
    const {data: perfil, error} = await sb.from('perfis')
      .select('id, nome, papel, empresa_id, empresas(id, nome, codigo_convite)')
      .eq('id', SESSAO.usuario.id).single();
    if(error) throw error;
    SESSAO.perfil = perfil;
    SESSAO.empresa = perfil.empresas || null;
    return perfil;
  },

  async carregarLojas(){
    const {data, error} = await sb.from('lojas')
      .select(`id, nome, parametros, ordem,
               colaboradores ( id, nome, cargo, horario, gerente, ativo,
                               folga_fixa, primeiro_domingo, dias_desde_folga, ordem,
                               ausencias ( id, tipo, ini, fim ) )`)
      .order('ordem', {ascending:true});
    if(error) throw error;
    const saida = {};
    (data||[]).forEach(l=>{
      const colabs = (l.colaboradores||[])
        .sort((a,b)=>(a.ordem||0)-(b.ordem||0))
        .map(c=>({
          id: c.id, nome: c.nome, cargo: c.cargo, horario: c.horario,
          gerente: !!c.gerente, ativo: c.ativo !== false,
          folgaFixa: c.folga_fixa, primeiroDomingo: c.primeiro_domingo,
          diasDesdeFolga: c.dias_desde_folga,
          ausencias: (c.ausencias||[]).map(a=>({id:a.id, tipo:a.tipo, ini:a.ini, fim:a.fim}))
        }));
      saida[l.id] = {nome: l.nome, params: l.parametros || {}, colabs, _ordem: l.ordem};
    });
    return saida;
  },

  async salvarLojas(lojas){
    const empresaId = SESSAO.perfil.empresa_id;
    for(const [lojaId, loja] of Object.entries(lojas)){
      const {error: e1} = await sb.from('lojas').upsert({
        id: lojaId, empresa_id: empresaId, nome: loja.nome,
        parametros: loja.params || {}, ordem: loja._ordem || 0
      });
      if(e1) throw e1;

      const linhas = (loja.colabs||[]).map((c,i)=>({
        id: c.id, loja_id: lojaId, nome: c.nome, cargo: c.cargo,
        horario: c.horario, gerente: !!c.gerente, ativo: c.ativo !== false,
        folga_fixa: (c.folgaFixa === '' || c.folgaFixa == null) ? null : Number(c.folgaFixa),
        primeiro_domingo: c.primeiroDomingo || null,
        dias_desde_folga: (c.diasDesdeFolga == null || c.diasDesdeFolga === '') ? null : Number(c.diasDesdeFolga),
        ordem: i
      }));
      if(linhas.length){
        const {error: e2} = await sb.from('colaboradores').upsert(linhas);
        if(e2) throw e2;
      }
      // remove do banco quem saiu da lista
      const ids = linhas.map(l=>l.id);
      let q = sb.from('colaboradores').delete().eq('loja_id', lojaId);
      if(ids.length) q = q.not('id', 'in', '(' + ids.join(',') + ')');
      const {error: e3} = await q;
      if(e3) throw e3;

      // ausências
      for(const c of (loja.colabs||[])){
        const aus = (c.ausencias||[]).filter(a=>a.ini && a.fim);
        if(aus.length){
          const {error: e4} = await sb.from('ausencias').upsert(
            aus.map(a=>({id: a.id, colaborador_id: c.id, tipo: a.tipo, ini: a.ini, fim: a.fim})));
          if(e4) throw e4;
        }
        const idsA = aus.map(a=>a.id).filter(Boolean);
        let qa = sb.from('ausencias').delete().eq('colaborador_id', c.id);
        if(idsA.length) qa = qa.not('id', 'in', '(' + idsA.join(',') + ')');
        await qa;
      }
    }
  },

  async carregarEscala(lojaId, inicio, fim){
    const {data, error} = await sb.from('escalas')
      .select('grade, parametros, atualizado_em')
      .eq('loja_id', lojaId).eq('inicio', inicio).eq('fim', fim).maybeSingle();
    if(error) throw error;
    return data ? {grid: data.grade, params: data.parametros, inicio, fim} : null;
  },

  async salvarEscala(lojaId, inicio, fim, grade, params){
    const {error} = await sb.from('escalas').upsert(
      {loja_id: lojaId, inicio, fim, grade, parametros: params},
      {onConflict: 'loja_id,inicio,fim'});
    if(error) throw error;
  },

  async listarAcessos(){
    const {data, error} = await sb.from('perfis')
      .select('id, nome, papel, criado_em')
      .eq('empresa_id', SESSAO.perfil.empresa_id);
    if(error) throw error;
    return data || [];
  },

  async registrar(acao, detalhe){
    try{
      await sb.from('registro_acoes').insert({
        usuario: SESSAO.usuario.id, empresa_id: SESSAO.perfil.empresa_id,
        acao, detalhe: detalhe || null});
    }catch(e){}
  }
};

/* ---------- store: mesma interface de antes, agora no banco ---------- */
let _timerSync = null, _pendente = null, _sincronizando = false;
const store = {
  async get(chave){
    if(chave === 'escala:lojas') return await DB.carregarLojas();
    if(chave.startsWith('escala:grade:')){
      const [, , , lojaId, periodo] = chave.split(':');
      const [inicio, fim] = (periodo||'').split('_');
      if(!lojaId || !inicio || !fim) return null;
      return await DB.carregarEscala(lojaId, inicio, fim);
    }
    return null;
  },
  async set(chave, valor){
    if(chave === 'escala:lojas'){
      _pendente = valor;
      marcarSync('salvando');
      clearTimeout(_timerSync);
      _timerSync = setTimeout(async ()=>{
        if(_sincronizando) { _timerSync = setTimeout(()=>store.set(chave, _pendente), 600); return; }
        _sincronizando = true;
        try{ await DB.salvarLojas(_pendente); marcarSync('salvo'); }
        catch(e){ marcarSync('erro', erroAmigavel(e)); }
        finally{ _sincronizando = false; }
      }, 700);
      return;
    }
    if(chave.startsWith('escala:grade:')){
      const [, , , lojaId, periodo] = chave.split(':');
      const [inicio, fim] = (periodo||'').split('_');
      try{
        await DB.salvarEscala(lojaId, inicio, fim, valor.grid, valor.params);
        await DB.registrar('escala_salva', {loja: lojaId, inicio, fim});
        marcarSync('salvo');
      }catch(e){ marcarSync('erro', erroAmigavel(e)); }
    }
  }
};

function marcarSync(estado, msg){
  const el = document.getElementById('sync-estado');
  if(!el) return;
  const mapa = {salvando:['Salvando…','#C6D2CE'], salvo:['Tudo salvo','#8FC9BE'], erro:[msg||'Erro ao salvar','#E9A79F']};
  const [txt, cor] = mapa[estado] || ['',''];
  el.textContent = txt; el.style.color = cor;
  if(estado === 'salvo') setTimeout(()=>{ if(el.textContent === txt) el.textContent = ''; }, 2500);
}
