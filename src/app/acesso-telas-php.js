/* ============================================================
   FLUXO DE ACESSO
   ============================================================ */
const S = {usuario:null, lojas:null, loja:null, res:null, val:null, salvo:true};
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const CODES = ['','X','FC','F','AT','LC'];

function mostrarTela(nome){
  ['entrar','cadastro','recuperar','novaSenha','vinculo'].forEach(t=>{
    const el = document.getElementById('tela-'+t);
    if(el) el.style.display = (t===nome) ? 'block' : 'none';
  });
  $('#login').style.display = nome === 'app' ? 'none' : 'grid';
  $('#app').style.display   = nome === 'app' ? 'block' : 'none';
}
function erroEm(id, msg){ const el=$(id); if(el) el.textContent = msg || ''; }

/* ---------- medidor de senha ---------- */
function ligarMedidor(inputId, medidorId, emailId){
  const inp = $(inputId), med = $(medidorId);
  if(!inp || !med) return;
  inp.addEventListener('input', ()=>{
    const f = forcaSenha(inp.value);
    const email = emailId ? ($(emailId)?.value || '') : '';
    const av = avaliarSenha(inp.value, email);
    med.innerHTML = `
      <div style="display:flex;gap:3px;margin:6px 0 4px">
        ${[1,2,3,4].map(i=>`<div style="height:3px;flex:1;border-radius:2px;background:${i<=f.nivel?f.cor:'var(--linha)'}"></div>`).join('')}
      </div>
      <div style="font-size:11.5px;color:${f.nivel>=3?'var(--v-fg)':'var(--fraco)'}">
        ${inp.value ? f.txt : ''}${inp.value && f.nivel<3 ? ` · ${SENHA_RECOMENDADA}+ caracteres é o recomendado` : ''}
      </div>
      ${av.problemas.length && inp.value ? `<div style="font-size:11.5px;color:var(--alerta);margin-top:3px">${av.problemas[0]}</div>` : ''}`;
  });
}

/* ---------- entrar ---------- */
async function fazerEntrar(){
  const email = $('#in-email').value.trim().toLowerCase();
  const senha = $('#in-senha').value;
  const btn = $('#btn-entrar');
  if(!email || !senha){ erroEm('#erro-entrar', 'Informe e-mail e senha.'); return; }
  btn.disabled = true; btn.textContent = 'Entrando…'; erroEm('#erro-entrar','');
  try{ await auth({acao:'entrar', email, senha}); }
  catch(e){ btn.disabled=false; btn.textContent='Entrar'; erroEm('#erro-entrar', erroAmigavel(e)); return; }
  btn.disabled = false; btn.textContent = 'Entrar';
  await aposLogin();
}

/* ---------- criar conta ---------- */
async function fazerCadastro(){
  const nome  = $('#cd-nome').value.trim();
  const email = $('#cd-email').value.trim().toLowerCase();
  const senha = $('#cd-senha').value;
  const conf  = $('#cd-senha2').value;
  const btn = $('#btn-cadastrar');
  erroEm('#erro-cadastro','');

  if(nome.length < 2){ erroEm('#erro-cadastro','Informe seu nome.'); return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ erroEm('#erro-cadastro','E-mail inválido.'); return; }
  const av = avaliarSenha(senha, email);
  if(!av.ok){ erroEm('#erro-cadastro', av.problemas[0]); return; }
  if(senha !== conf){ erroEm('#erro-cadastro','As senhas não são iguais.'); return; }

  btn.disabled = true; btn.textContent = 'Verificando senha…';
  const vazamentos = await senhaVazada(senha);
  if(vazamentos > 0){
    btn.disabled = false; btn.textContent = 'Criar conta';
    erroEm('#erro-cadastro', `Esta senha aparece em ${vazamentos.toLocaleString('pt-BR')} vazamentos conhecidos. Escolha outra.`);
    return;
  }

  btn.textContent = 'Criando conta…';
  try{ await auth({acao:'cadastrar', nome, email, senha}); }
  catch(e){ btn.disabled=false; btn.textContent='Criar conta'; erroEm('#erro-cadastro', erroAmigavel(e)); return; }
  btn.disabled = false; btn.textContent = 'Criar conta';
  $('#cd-form').style.display = 'none';
  $('#cd-enviado').style.display = 'block';
  $('#cd-email-mostrado').textContent = email;
}

/* ---------- recuperar senha ---------- */
async function fazerRecuperar(){
  const email = $('#rc-email').value.trim().toLowerCase();
  const btn = $('#btn-recuperar');
  if(!email){ erroEm('#erro-recuperar','Informe o e-mail.'); return; }
  btn.disabled = true; btn.textContent = 'Enviando…';
  try{ await auth({acao:'recuperar', email}); }catch(e){}
  btn.disabled = false; btn.textContent = 'Enviar link';
  // resposta igual mesmo se o e-mail não existir, para não revelar cadastros
  $('#rc-form').style.display = 'none';
  $('#rc-enviado').style.display = 'block';
}

/* ---------- definir nova senha (voltando do link) ---------- */
async function fazerNovaSenha(){
  const senha = $('#ns-senha').value, conf = $('#ns-senha2').value;
  const btn = $('#btn-nova-senha');
  erroEm('#erro-nova-senha','');
  const av = avaliarSenha(senha, SESSAO.usuario?.email || '');
  if(!av.ok){ erroEm('#erro-nova-senha', av.problemas[0]); return; }
  if(senha !== conf){ erroEm('#erro-nova-senha','As senhas não são iguais.'); return; }
  btn.disabled = true; btn.textContent = 'Salvando…';
  const vaz = await senhaVazada(senha);
  if(vaz > 0){
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
    erroEm('#erro-nova-senha', `Esta senha aparece em ${vaz.toLocaleString('pt-BR')} vazamentos. Escolha outra.`);
    return;
  }
  const token = new URLSearchParams(location.search).get('redefinir') || '';
  try{ await auth({acao:'redefinir', token, senha}); }
  catch(e){ btn.disabled=false; btn.textContent='Salvar nova senha'; erroEm('#erro-nova-senha', erroAmigavel(e)); return; }
  btn.disabled = false; btn.textContent = 'Salvar nova senha';
  history.replaceState({}, '', location.pathname);
  await aposLogin();
}

/* ---------- vínculo com empresa ---------- */
async function criarEmpresa(){
  const nome = $('#vn-empresa').value.trim();
  const btn = $('#btn-criar-empresa');
  erroEm('#erro-vinculo','');
  if(nome.length < 2){ erroEm('#erro-vinculo','Informe o nome da empresa.'); return; }
  btn.disabled = true; btn.textContent = 'Criando…';
  try{ await auth({acao:'criar_empresa', nome}); }
  catch(e){ btn.disabled=false; btn.textContent='Criar empresa'; erroEm('#erro-vinculo', erroAmigavel(e)); return; }
  await DB.carregarEmpresa();
  await semearLojas();
  btn.disabled = false; btn.textContent = 'Criar empresa';
  await abrirApp();
}

async function entrarPorConvite(){
  const cod = $('#vn-codigo').value.trim();
  const btn = $('#btn-entrar-convite');
  erroEm('#erro-vinculo','');
  if(!cod){ erroEm('#erro-vinculo','Informe o código.'); return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  try{ await auth({acao:'entrar_por_convite', codigo: cod}); }
  catch(e){ btn.disabled=false; btn.textContent='Entrar com código'; erroEm('#erro-vinculo', erroAmigavel(e)); return; }
  btn.disabled = false; btn.textContent = 'Entrar com código';
  await DB.carregarEmpresa();
  await abrirApp();
}

/* semeia as duas lojas de exemplo na primeira vez */
async function semearLojas(){
  const base = seedLojas();
  const novas = {};
  for(const [, l] of Object.entries(base)){
    const id = await DB.criarLoja(l.nome, l.params);
    novas[id] = {nome: l.nome, params: l.params, _ordem: Object.keys(novas).length,
                 colabs: l.colabs.map(c=>({nome:c.nome, cargo:c.cargo, horario:c.horario,
                                           gerente:!!c.gerente, ativo:true, ausencias:[]}))};
  }
  await DB.salvarLojas(novas);
}

/* ---------- pós-login ---------- */
async function aposLogin(){
  let r;
  try{ r = await DB.carregarEmpresa(); }
  catch(e){ erroEm('#erro-entrar', erroAmigavel(e)); mostrarTela('entrar'); return; }
  if(!r.logado){ mostrarTela('entrar'); return; }
  if(!SESSAO.usuario || !SESSAO.usuario.empresa_id){ mostrarTela('vinculo'); return; }
  await abrirApp();
}

async function abrirApp(){
  mostrarTela('app');
  $('#quem').textContent = (SESSAO.usuario.nome || SESSAO.usuario.email)
    + ' · ' + SESSAO.usuario.papel + (SESSAO.empresa ? ' · ' + SESSAO.empresa.nome : '');
  S.lojas = await store.get('escala:lojas');
  if(!S.lojas || !Object.keys(S.lojas).length){
    await semearLojas();
    S.lojas = await store.get('escala:lojas');
  }
  S.loja = Object.keys(S.lojas)[0];
  montar();
  pintarAcessos();
}

/* ---------- sair ---------- */
async function sair(){
  try{ await auth({acao:'sair'}); }catch(e){}
  location.reload();
}

/* ---------- aba de acessos ---------- */
async function pintarAcessos(){
  const cx = $('#lista-acessos');
  if(!cx) return;
  $('#codigo-convite').textContent = SESSAO.empresa?.codigo_convite || '—';
  $('#nome-empresa').textContent = SESSAO.empresa?.nome || '—';
  try{
    const gente = await DB.listarAcessos();
    cx.innerHTML = `<table class="simples"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Último acesso</th></tr></thead><tbody>${
      gente.map(p=>`<tr><td>${esc(p.nome||'—')}</td><td>${esc(p.email||'')}</td><td>${esc(p.papel)}</td>
        <td class="mono">${p.ultimo_acesso ? new Date(p.ultimo_acesso.replace(' ','T')).toLocaleDateString('pt-BR') : '—'}</td></tr>`).join('')
    }</tbody></table>`;
  }catch(e){ cx.innerHTML = `<p class="vazio">${esc(erroAmigavel(e))}</p>`; }
}

/* ---------- ligação dos botões ---------- */
function ligarAcesso(){
  $('#btn-entrar').onclick = fazerEntrar;
  $('#in-senha').addEventListener('keydown', e=>{ if(e.key==='Enter') fazerEntrar(); });
  $('#btn-cadastrar').onclick = fazerCadastro;
  $('#btn-recuperar').onclick = fazerRecuperar;
  $('#btn-nova-senha').onclick = fazerNovaSenha;
  $('#btn-criar-empresa').onclick = criarEmpresa;
  $('#btn-entrar-convite').onclick = entrarPorConvite;
  $('#btn-sair').onclick = sair;
  $$('[data-ir]').forEach(a=>a.onclick = e=>{ e.preventDefault(); mostrarTela(a.dataset.ir); });
  ligarMedidor('#cd-senha', '#cd-medidor', '#cd-email');
  ligarMedidor('#ns-senha', '#ns-medidor', null);
  $('#copiar-codigo')?.addEventListener('click', ()=>{
    navigator.clipboard?.writeText(SESSAO.empresa?.codigo_convite || '');
    $('#copiar-codigo').textContent = 'Copiado';
    setTimeout(()=>$('#copiar-codigo').textContent = 'Copiar', 1800);
  });
}

/* ---------- início ---------- */
async function iniciar(){
  ligarAcesso();
  const params = new URLSearchParams(location.search);

  // volta do link de confirmação de e-mail
  const tokenConf = params.get('confirmar');
  if(tokenConf){
    try{
      await auth({acao:'sessao'});                 // pega o token CSRF
      await auth({acao:'confirmar', token: tokenConf});
      history.replaceState({}, '', location.pathname);
      await aposLogin();
      return;
    }catch(e){
      mostrarTela('entrar');
      erroEm('#erro-entrar', erroAmigavel(e));
      return;
    }
  }

  // volta do link de recuperação de senha
  if(params.get('redefinir')){
    try{ await auth({acao:'sessao'}); }catch(e){}
    mostrarTela('novaSenha');
    return;
  }

  try{
    const r = await DB.carregarEmpresa();
    if(r.logado){ await aposLogin(); } else { mostrarTela('entrar'); }
  }catch(e){
    mostrarTela('entrar');
    erroEm('#erro-entrar', erroAmigavel(e));
  }
}
