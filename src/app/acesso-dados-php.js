/* ============================================================
   ACESSO E ARMAZENAMENTO — API PHP na HostGator
   Mesma interface da versão Supabase: a tela continua chamando
   store.get e store.set sem saber o que há por baixo.
   ============================================================ */

const API = CONFIG.API || 'api';
const SESSAO = { usuario: null, empresa: null, csrf: null };

async function chamar(arquivo, dados){
  const r = await fetch(`${API}/${arquivo}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: Object.assign(
      {'Content-Type': 'application/json'},
      SESSAO.csrf ? {'X-CSRF': SESSAO.csrf} : {}
    ),
    body: JSON.stringify(dados)
  });
  let corpo;
  try { corpo = await r.json(); }
  catch(e){ throw new Error('O servidor respondeu algo inesperado. Recarregue a página.'); }
  if(corpo && corpo.csrf) SESSAO.csrf = corpo.csrf;
  if(!r.ok) throw new Error(corpo.erro || 'Falha na comunicação.');
  return corpo;
}

const auth  = (dados) => chamar('auth.php', dados);
const dadosApi = (dados) => chamar('dados.php', dados);

/* ---------- regras de senha (NIST SP 800-63B-4) ----------
   Iguais às do servidor. Aqui servem para avisar antes de enviar;
   quem decide é o PHP, porque validação só no navegador não vale nada. */
const SENHA_MIN = 12;
const SENHA_RECOMENDADA = 15;
const SENHA_MAX = 64;

async function senhaVazada(senha){
  try{
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(senha));
    const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
    const r = await fetch('https://api.pwnedpasswords.com/range/' + hash.slice(0,5), {headers:{'Add-Padding':'true'}});
    if(!r.ok) return 0;
    const txt = await r.text();
    for(const linha of txt.split('\n')){
      const [suf, qtd] = linha.trim().split(':');
      if(suf === hash.slice(5)) return parseInt(qtd, 10) || 0;
    }
    return 0;
  }catch(e){ return 0; }
}

function avaliarSenha(senha, email){
  const problemas = [];
  const n = [...senha].length;
  if(n < SENHA_MIN) problemas.push(`Use pelo menos ${SENHA_MIN} caracteres (tem ${n}).`);
  if(n > SENHA_MAX) problemas.push(`Máximo de ${SENHA_MAX} caracteres.`);
  const baixa = senha.toLowerCase(), e = (email||'').trim().toLowerCase();
  if(e && baixa.includes(e)) problemas.push('Não use o seu e-mail na senha.');
  const local = e.split('@')[0] || '';
  if(local.length >= 3 && baixa.includes(local)) problemas.push('Não use o seu e-mail na senha.');
  ['escala','farmacia','drogaria','123456','senha','password','qwerty']
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
  if(variedade >= 2) return {nivel:4, txt:'forte', cor:'var(--v-fg)'};
  return {nivel:3, txt:'boa', cor:'var(--v-fg)'};
}

function erroAmigavel(e){
  return (e && e.message) || 'Não foi possível concluir. Tente de novo.';
}

/* ============================================================
   SINCRONIZAÇÃO
   ============================================================ */
const DB = {
  async carregarEmpresa(){
    const r = await auth({acao:'sessao'});
    SESSAO.usuario = r.usuario || null;
    SESSAO.empresa = r.empresa || null;
    SESSAO.perfil  = r.usuario || null;     // nome usado pela tela
    return r;
  },
  async carregarLojas(){
    const r = await dadosApi({acao:'carregar'});
    return r.lojas || {};
  },
  async salvarLojas(lojas){
    await dadosApi({acao:'salvar', lojas});
  },
  async carregarEscala(lojaId, inicio, fim){
    const r = await dadosApi({acao:'carregar_escala', loja_id:lojaId, inicio, fim});
    return r.escala ? Object.assign({}, r.escala, {inicio, fim}) : null;
  },
  async salvarEscala(lojaId, inicio, fim, grade, params){
    await dadosApi({acao:'salvar_escala', loja_id:lojaId, inicio, fim, grade, parametros:params});
  },
  async criarLoja(nome, params){
    const r = await dadosApi({acao:'criar_loja', nome, params});
    return r.id;
  },
  async listarAcessos(){
    const r = await auth({acao:'listar_acessos'});
    return r.acessos || [];
  },
  async registrar(){ /* o servidor registra sozinho */ }
};

/* ---------- store: mesma interface de sempre ---------- */
let _timerSync = null, _pendente = null, _sincronizando = false;
const store = {
  async get(chave){
    if(chave === 'escala:lojas') return await DB.carregarLojas();
    if(chave.startsWith('escala:grade:')){
      const [, , , lojaId, periodo] = chave.split(':');
      const [inicio, fim] = (periodo||'').split('_');
      if(!lojaId || !inicio || !fim) return null;
      try { return await DB.carregarEscala(lojaId, inicio, fim); }
      catch(e){ return null; }
    }
    return null;
  },
  async set(chave, valor){
    if(chave === 'escala:lojas'){
      _pendente = valor;
      marcarSync('salvando');
      clearTimeout(_timerSync);
      _timerSync = setTimeout(async ()=>{
        if(_sincronizando){ _timerSync = setTimeout(()=>store.set(chave, _pendente), 600); return; }
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
