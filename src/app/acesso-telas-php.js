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
  let retorno;
  try{ retorno = await auth({acao:'cadastrar', nome, email, senha}); }
  catch(e){ btn.disabled=false; btn.textContent='Criar conta'; erroEm('#erro-cadastro', erroAmigavel(e)); return; }
  btn.disabled = false; btn.textContent = 'Criar conta';
  $('#cd-form').style.display = 'none';
  $('#cd-enviado').style.display = 'block';
  $('#cd-email-mostrado').textContent = email;
  const status = $('#cd-email-status');
  if(status){
    status.textContent = retorno && retorno.email_enviado === false
      ? 'A conta foi criada, mas o e-mail não pôde ser enviado. Tente novamente mais tarde antes de entrar.'
      : retorno && retorno.email_enviado === true
        ? 'Enviamos um link de confirmação. Abra o e-mail e clique no link para ativar a conta.'
        : 'Se este cadastro puder ser confirmado, você receberá instruções por e-mail. Confira também a caixa de spam.';
    status.className = retorno && retorno.email_enviado === false ? 'erro' : '';
  }
}

/* ---------- recuperar senha ---------- */
async function fazerRecuperar(){
  const email = $('#rc-email').value.trim().toLowerCase();
  const btn = $('#btn-recuperar');
  erroEm('#erro-recuperar','');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ erroEm('#erro-recuperar','Informe um e-mail válido.'); return; }
  btn.disabled = true; btn.textContent = 'Enviando…';
  try{
    const retorno = await auth({acao:'recuperar', email});
    btn.disabled = false; btn.textContent = 'Enviar link';
    // A resposta é neutra para não revelar cadastros; falhas reais continuam erro.
    $('#rc-form').style.display = 'none';
    $('#rc-enviado').style.display = 'block';
    const status = $('#rc-email-status');
    if(status) status.textContent = retorno && retorno.email_enviado === false
      ? 'Não foi possível enviar o link agora. Tente novamente mais tarde.'
      : 'Se existir conta com esse e-mail, o link chegará em instantes. Confira também a caixa de spam.';
    if(status && retorno && retorno.email_enviado === false) status.className = 'erro';
  }catch(e){
    btn.disabled = false; btn.textContent = 'Enviar link';
    erroEm('#erro-recuperar', erroAmigavel(e));
  }
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
  const nomeLoja = ($('#vn-loja') && $('#vn-loja').value.trim()) || ''; const chave = ($('#vn-chave') && $('#vn-chave').value.trim()) || '';
  try{ await auth({acao:'criar_empresa', nome, loja: nomeLoja, chave}); }
  catch(e){ btn.disabled=false; btn.textContent='Criar empresa'; erroEm('#erro-vinculo', erroAmigavel(e)); return; }
  await DB.carregarEmpresa();
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

/* ---------- pós-login ---------- */
async function aposLogin(){
  let r;
  try{ r = await DB.carregarEmpresa(); }
  catch(e){ erroEm('#erro-entrar', erroAmigavel(e)); mostrarTela('entrar'); return; }
  if(!r.logado){ mostrarTela('entrar'); return; }
  if(r.plataforma){ await abrirApp(true); return; }
  if(!SESSAO.usuario || !SESSAO.usuario.empresa_id){ mostrarTela('vinculo'); return; }
  await abrirApp(false);
}

function abrirAdministracao(){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.setAttribute('aria-current', 'false'));
  document.querySelectorAll('.view').forEach(v=>v.dataset.ativa = String(v.dataset.view==='administracao'));
  carregarAdministracao();
}

async function abrirApp(plataforma=false){
  mostrarTela('app');
  S.usuario = {papel: SESSAO.usuario.papel, nome: SESSAO.usuario.nome, plataforma};
  if(plataforma){
    S.lojas = {}; S.loja = null;
    document.querySelectorAll('nav.tabs button').forEach(b=>{
      b.hidden = b.dataset.view !== 'administracao';
      b.setAttribute('aria-current', b.dataset.view === 'administracao' ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach(v=>{ v.hidden = v.dataset.view !== 'administracao'; v.dataset.ativa = String(v.dataset.view === 'administracao'); });
    montarAdministracao(); abrirAdministracao(); return;
  }
  pintarIdentidade({
    nome:    SESSAO.usuario.nome,
    email:   SESSAO.usuario.email,
    papel:   SESSAO.usuario.papel,
    empresa: SESSAO.empresa ? SESSAO.empresa.nome : ''
  });
  const adminTab = document.getElementById('tab-administracao');
  if(adminTab) adminTab.hidden = !SESSAO.plataforma;
  S.lojas = await store.get('escala:lojas');
  if(!S.lojas || !Object.keys(S.lojas).length){
    // Empresa sem loja: acontece se a criação falhou pela metade. Em vez de
    // encher com dados de exemplo, a pessoa nomeia a própria loja.
    const nome = prompt('Qual o nome da sua loja?', SESSAO.empresa ? SESSAO.empresa.nome : 'Minha loja');
    if(nome && nome.trim()){
      try{ await DB.criarLoja(nome.trim(), {}); }catch(e){}
      S.lojas = await store.get('escala:lojas');
    }
  }
  if(!S.lojas || !Object.keys(S.lojas).length){ S.lojas = {}; }
  S.loja = Object.keys(S.lojas)[0] || null;
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
  const cxl = document.getElementById('codigos-loja');
  if(cxl){
    const lojas = Object.entries(S.lojas || {}).filter(([,l])=>l.codigo);
    cxl.innerHTML = lojas.length
      ? lojas.map(([id,l])=>`<div class="cod-loja"><span>${esc(l.nome)}</span>
          <b class="mono">${esc(l.codigo)}</b></div>`).join('')
      : '';
    const bloco = document.getElementById('bloco-codigos-loja');
    if(bloco) bloco.style.display = lojas.length ? '' : 'none';
  }
  $('#nome-empresa').textContent = SESSAO.empresa?.nome || '—';
  try{
    const gente = await DB.listarAcessos();
    const souAdmin = SESSAO.usuario && SESSAO.usuario.papel === 'admin';
    const lojas = S.lojas || {};
    const opcoesLoja = (sel)=> '<option value="">todas as lojas</option>' +
      Object.entries(lojas).map(([id,l])=>
        `<option value="${id}"${String(sel)===id?' selected':''}>${esc(l.nome)}</option>`).join('');

    cx.innerHTML = `<table class="simples"><thead><tr>
        <th>Nome</th><th>E-mail</th><th>Perfil</th><th>Enxerga</th><th>Último acesso</th>
      </tr></thead><tbody>${
      gente.map(p=>{
        const euMesmo = SESSAO.usuario && p.id === SESSAO.usuario.id;
        const podeMexer = souAdmin && !euMesmo && p.papel !== 'colaborador';
        const enxerga = podeMexer
          ? `<select data-loja-de="${p.id}" style="font-size:12px;padding:3px 5px">${opcoesLoja(p.loja_id)}</select>`
          : esc(p.loja || (p.papel === 'admin' ? 'todas as lojas' : 'todas as lojas'));
        return `<tr>
          <td>${esc(p.nome||'—')}${euMesmo?' <span class="chip">você</span>':''}</td>
          <td>${esc(p.email||'')}</td>
          <td>${esc(p.papel)}</td>
          <td>${enxerga}</td>
          <td class="mono">${p.ultimo_acesso ? new Date(p.ultimo_acesso.replace(' ','T')).toLocaleDateString('pt-BR') : '—'}</td>
        </tr>`;
      }).join('')
    }</tbody></table>`;

    cx.querySelectorAll('[data-loja-de]').forEach(sel=>{
      sel.onchange = async ()=>{
        try{
          await auth({acao:'definir_loja', usuario_id: sel.dataset.lojaDe, loja_id: sel.value});
          sel.style.borderColor = 'var(--v-fg)';
          setTimeout(()=>{ sel.style.borderColor = ''; }, 1200);
        }catch(e){ alert(erroAmigavel(e)); pintarAcessos(); }
      };
    });
  }catch(e){ cx.innerHTML = `<p class="vazio">${esc(erroAmigavel(e))}</p>`; }
}

/* ---------- administração da plataforma ---------- */
const ADMIN = {empresa:null, empresas:[], lojas:[], supervisores:[], usuarios:[], escalas:[], lojaConsulta:null, configuracaoLoja:null, carregando:false, _reqEmp:0, _reqLoj:0, _reqSup:0, _reqUsers:0, _reqEscalas:0, _reqConfig:0};
function adminStatus(txt, tipo='info'){
  const el = document.getElementById('admin-status');
  if(!el) return;
  el.textContent = txt || '';
  el.className = 'chip ' + (tipo==='erro'?'mal':tipo==='ok'?'ok':'info');
}
function adminTexto(el, txt){ if(el) el.textContent = txt == null ? '' : String(txt); }
function adminBotao(txt, acao, dados={}){
  const b=document.createElement('button'); b.type='button'; b.className='btn ghost small'; b.textContent=txt;
  Object.entries(dados).forEach(([k,v])=>b.dataset[k]=v);
  b.addEventListener('click', acao); return b;
}
async function adminRequisicao(dados, apos){
  adminStatus('Salvando…');
  try{
    const r=await auth(dados);
    if(typeof apos==='function') await apos(r);
    adminStatus('Alteração confirmada','ok');
    return r;
  }
  catch(e){ adminStatus(erroAmigavel(e),'erro'); throw e; }
}
function adminRenderEmpresas(){
  const box=document.getElementById('admin-empresas'); if(!box) return; box.replaceChildren();
  if(!ADMIN.empresas.length){ const p=document.createElement('div'); p.className='admin-empty'; p.textContent='Nenhuma empresa encontrada.'; box.appendChild(p); return; }
  ADMIN.empresas.forEach(e=>{
    const b=adminBotao('',()=>adminSelecionarEmpresa(e)); b.className='admin-row';
    b.setAttribute('aria-current', ADMIN.empresa && ADMIN.empresa.id===e.id ? 'true':'false');
    const wrap=document.createElement('span'), strong=document.createElement('strong'), small=document.createElement('small');
    strong.textContent=e.nome; small.textContent=e.descricao || 'Sem descrição cadastral'; wrap.append(strong,small); b.appendChild(wrap); box.appendChild(b);
  });
}
async function adminCarregarEmpresas(){
  const reqId=++ADMIN._reqEmp;
  const q=(document.getElementById('admin-busca-empresa')?.value||'').trim();
  const box=document.getElementById('admin-empresas'); if(box){box.replaceChildren(); const p=document.createElement('div');p.className='admin-empty';p.textContent='Carregando empresas…';box.appendChild(p);}
  try{
    const r=await auth({acao:'plataforma_listar_empresas',q});
    if(reqId!==ADMIN._reqEmp) return;
    ADMIN.empresas=r.empresas||[];
    adminRenderEmpresas();
  }
  catch(e){ adminStatus(erroAmigavel(e),'erro'); }
}
function adminAtualizarResumoEmpresa(empresa){
  const resumo=document.getElementById('admin-resumo-empresa'); if(!resumo)return;
  resumo.hidden=!empresa;
  const nome=document.getElementById('admin-resumo-empresa-nome');
  const descricao=document.getElementById('admin-resumo-empresa-descricao');
  if(nome) nome.textContent=empresa?.nome||'Nenhuma empresa selecionada';
  if(descricao) descricao.textContent=empresa?.descricao||'Sem descrição cadastral';
}
function adminPreencherEmpresa(empresa, abrir=false){
  const form=document.getElementById('admin-form-empresa'); if(!form)return;
  form.hidden=!abrir;
  const painel=document.getElementById('admin-painel-empresas'); if(painel) painel.classList.toggle('admin-editando-empresa',abrir);
  document.getElementById('admin-empresa-nome').value=empresa?.nome||'';
  document.getElementById('admin-empresa-descricao').value=empresa?.descricao||'';
  adminAtualizarResumoEmpresa(empresa);
}
async function adminSelecionarEmpresa(empresa){
  ADMIN.empresa=empresa; ADMIN.lojas=[]; ADMIN.supervisores=[]; ADMIN.usuarios=[]; ADMIN.escalas=[]; ADMIN.lojaConsulta=null; ADMIN.configuracaoLoja=null;
  const detalhe=document.getElementById('admin-central-escala-detalhe'); if(detalhe) detalhe.hidden=true;
  const config=document.getElementById('admin-central-configuracao'); if(config) config.hidden=true;
  const contexto=document.getElementById('admin-consulta-contexto'); if(contexto){const label=contexto.querySelector('.admin-consulta-label'); if(label) label.textContent='Selecione uma loja para consultar escalas publicadas.';}
  const tabs=document.getElementById('admin-consulta-tabs'); if(tabs) tabs.hidden=true;
  const painel=document.getElementById('admin-painel-empresas'); if(painel) painel.classList.add('admin-empresa-selecionada');
  const central=document.getElementById('admin-painel-central'); if(central) central.hidden=false;
  adminRenderEmpresas(); adminPreencherEmpresa(empresa, false);
  document.getElementById('admin-painel-lojas').hidden=false; document.getElementById('admin-painel-supervisores').hidden=false;
  adminTexto(document.getElementById('admin-lojas-titulo'),'Lojas · '+empresa.nome);
  adminTexto(document.getElementById('admin-supervisores-titulo'),'Supervisores · '+empresa.nome);
  const boxSup=document.getElementById('admin-supervisores'); if(boxSup) boxSup.textContent='Carregando supervisores…';
  await adminCarregarLojas();
  await adminCarregarSupervisores();
  await adminCarregarUsuarios();
}
async function adminCarregarLojas(){
  if(!ADMIN.empresa)return;
  const reqId=++ADMIN._reqLoj, empresaId=ADMIN.empresa.id;
  const box=document.getElementById('admin-lojas'); if(box){box.replaceChildren();const p=document.createElement('div');p.className='admin-empty';p.textContent='Carregando lojas…';box.appendChild(p);}
  try{
    const r=await auth({acao:'plataforma_listar_lojas',empresa_id:empresaId});
    if(reqId!==ADMIN._reqLoj || !ADMIN.empresa || ADMIN.empresa.id!==empresaId) return;
    ADMIN.lojas=r.lojas||[];
    adminRenderLojas();
    if(ADMIN.supervisores.length) adminRenderSupervisores();
  }
  catch(e){adminStatus(erroAmigavel(e),'erro');}
}
function adminCentralStatus(txt, tipo='info'){
  const el=document.getElementById('admin-central-status'); if(!el) return;
  el.textContent=txt||''; el.className='chip '+(tipo==='erro'?'mal':tipo==='ok'?'ok':'info');
}
function adminRenderUsuarios(){
  const box=document.getElementById('admin-usuarios'); if(!box) return;
  box.replaceChildren();
  if(!ADMIN.usuarios.length){ const p=document.createElement('div'); p.className='admin-empty'; p.textContent='Nenhum usuário encontrado.'; box.appendChild(p); return; }
  ADMIN.usuarios.forEach(u=>{
    const row=document.createElement('div'); row.className='admin-row admin-user-row';
    const w=document.createElement('span'), s=document.createElement('strong'), p=document.createElement('small');
    s.textContent=u.nome||'Sem nome';
    p.textContent=[u.email,u.papel==='gestor'?'Supervisor':u.papel,u.empresa||'Sem empresa',u.loja||'Sem loja'].filter(Boolean).join(' · ');
    w.append(s,p); row.appendChild(w);
    const souContaPlataforma = SESSAO.usuario && u.id === SESSAO.usuario.id;
    if(!souContaPlataforma && ['admin','gestor'].includes(u.papel)){
      const botao=adminBotao(u.papel==='gestor'?'Tornar administrador':'Promover a supervisor',()=>adminMudarPapel(u));
      botao.classList.add('small'); botao.setAttribute('aria-label',botao.textContent+' '+(u.nome||'usuário'));
      row.appendChild(botao);
    }
    box.appendChild(row);
  });
}
async function adminMudarPapel(usuario){
  const promovendo=usuario.papel==='admin';
  const destino=promovendo?'supervisor':'administrador';
  const aviso=promovendo
    ? `Promover ${usuario.nome||usuario.email} a supervisor? A conta deixará de enxergar todas as lojas e só acessará unidades vinculadas no painel.`
    : `Tornar ${usuario.nome||usuario.email} administrador? Os vínculos de supervisor serão removidos e a conta voltará a enxergar toda a empresa.`;
  if(!confirm(aviso)) return;
  try{
    await adminRequisicao({acao:'plataforma_mudar_papel',empresa_id:ADMIN.empresa.id,usuario_id:usuario.id,papel:promovendo?'gestor':'admin'},async()=>{
      await adminCarregarUsuarios();
      await adminCarregarSupervisores();
    });
    adminCentralStatus(`${usuario.nome||usuario.email} agora é ${destino}. ${promovendo?'Vincule as lojas no painel de supervisores.':''}`,'ok');
  }catch(e){}
}
async function adminCarregarUsuarios(){
  if(!ADMIN.empresa) return;
  const reqId=++ADMIN._reqUsers, empresaId=ADMIN.empresa.id;
  const q=(document.getElementById('admin-busca-usuario')?.value||'').trim();
  adminCentralStatus('Carregando usuários…');
  try{
    const r=await auth({acao:'plataforma_listar_usuarios',empresa_id:empresaId,q});
    if(reqId!==ADMIN._reqUsers || !ADMIN.empresa || ADMIN.empresa.id!==empresaId) return;
    ADMIN.usuarios=r.usuarios||[]; adminRenderUsuarios(); adminCentralStatus('Usuários atualizados','ok');
  }catch(e){ adminCentralStatus(erroAmigavel(e),'erro'); }
}
function adminMostrarConsulta(tipo){
  const escalas=document.getElementById('admin-central-escalas');
  const detalhe=document.getElementById('admin-central-escala-detalhe');
  const config=document.getElementById('admin-central-configuracao');
  const tabs=document.getElementById('admin-consulta-tabs');
  if(tabs) tabs.hidden=!ADMIN.lojaConsulta;
  if(escalas) escalas.hidden=tipo!=='escalas';
  if(detalhe && tipo==='escalas' && detalhe.dataset.aberta!=='true') detalhe.hidden=true;
  if(config) config.hidden=tipo!=='configuracao';
}
function adminRenderEscalas(){
  const box=document.getElementById('admin-central-escalas'); if(!box) return;
  box.replaceChildren();
  if(!ADMIN.lojaConsulta){
    const p=document.createElement('div'); p.className='admin-empty'; p.textContent='Selecione uma loja para consultar as escalas publicadas.'; box.appendChild(p); return;
  }
  if(!ADMIN.escalas.length){
    const p=document.createElement('div'); p.className='admin-empty';
    p.textContent='Nenhuma escala publicada nesta loja. Rascunhos não aparecem na consulta central.';
    box.appendChild(p); return;
  }
  ADMIN.escalas.forEach(x=>{
    const b=adminBotao('',()=>adminCarregarEscalaPublicada(x)); b.className='admin-row admin-escala-row';
    b.dataset.escalaVersao=x.versao; b.dataset.escalaInicio=x.inicio;
    const w=document.createElement('span'), s=document.createElement('strong'), p=document.createElement('small');
    s.textContent=`${x.inicio} a ${x.fim}`;
    p.textContent=x.incompleto
      ? `Versão ${x.versao} · publicada em ${x.publicada_em||'—'} · dados históricos parciais`
      : `Versão ${x.versao} · publicada em ${x.publicada_em||'—'} · ${x.pessoas||'?'} pessoas · ${x.dias||'?'} dias`;
    w.append(s,p);
    const chip=document.createElement('span'); chip.className='chip ok'; chip.textContent='Publicado';
    b.append(w,chip); box.appendChild(b);
  });
}
function adminRenderEscalaDetalhe(escala){
  const box=document.getElementById('admin-central-escala-detalhe'); if(!box) return;
  box.hidden=false; box.dataset.aberta='true'; adminMostrarConsulta('escalas');
  const porId=Object.fromEntries((escala.participantes||[]).map(p=>[String(p.id),p]));
  const dias=[]; const ini=new Date(escala.inicio+'T12:00:00'), fim=new Date(escala.fim+'T12:00:00');
  for(const d=new Date(ini);d<=fim;d.setDate(d.getDate()+1)) dias.push(new Date(d));
  let h=`<div class="admin-leitura-meta"><div><b>${esc(escala.empresa)} · ${esc(escala.loja)}</b><span class="chip ok">Publicado</span></div><small>${esc(escala.inicio)} a ${esc(escala.fim)} · versão ${esc(escala.versao)} · publicada em ${esc(escala.publicada_em||'')}</small><em>Leitura somente — publicação protegida</em></div><table><thead><tr><th>Pessoa</th>${dias.map(d=>`<th>${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}</th>`).join('')}</tr></thead><tbody>`;
  Object.entries(escala.grade||{}).forEach(([id,linha])=>{const p=porId[id]||{};h+=`<tr><th>${esc(p.nome||id)}</th>${dias.map((_,i)=>`<td>${esc((linha||[])[i]||'')}</td>`).join('')}</tr>`;});
  h+='</tbody></table>'; box.innerHTML=h;
}
async function adminCarregarEscalaPublicada(x){
  adminCentralStatus('Carregando publicação…');
  try{
    const r=await auth({acao:'plataforma_carregar_escala_publicada',loja_id:x.loja_id||ADMIN.lojaConsulta?.id,inicio:x.inicio,fim:x.fim,versao:x.versao});
    adminRenderEscalaDetalhe(r.escala); adminCentralStatus('Publicação carregada · somente leitura','ok');
  }catch(e){ adminCentralStatus(erroAmigavel(e),'erro'); }
}
async function adminCarregarEscalas(lojaId){
  if(!lojaId) return;
  const reqId=++ADMIN._reqEscalas;
  try{
    const r=await auth({acao:'plataforma_listar_escalas_publicadas',loja_id:lojaId});
    if(reqId!==ADMIN._reqEscalas) return;
    ADMIN.escalas=r.escalas||[]; adminRenderEscalas();
  }catch(e){ adminCentralStatus(erroAmigavel(e),'erro'); }
}

function adminSelecionarLojaConsulta(loja){
  ADMIN.lojaConsulta=loja; ADMIN.escalas=[]; ADMIN.configuracaoLoja=null;
  const contexto=document.getElementById('admin-consulta-contexto');
  if(contexto) contexto.querySelector('.admin-consulta-label').textContent=`${loja.nome} · somente escalas publicadas`;
  const detalhe=document.getElementById('admin-central-escala-detalhe'); if(detalhe){detalhe.hidden=true;detalhe.dataset.aberta='false';}
  adminMostrarConsulta('escalas'); adminCarregarEscalas(loja.id);
}
async function adminAbrirConfiguracaoLoja(loja){
  ADMIN.lojaConsulta=loja; ADMIN.configuracaoLoja=null;
  const contexto=document.getElementById('admin-consulta-contexto');
  if(contexto) contexto.querySelector('.admin-consulta-label').textContent=`${loja.nome} · configuração operacional somente leitura`;
  const detalhe=document.getElementById('admin-central-escala-detalhe'); if(detalhe){detalhe.hidden=true;detalhe.dataset.aberta='false';}
  adminMostrarConsulta('configuracao');
  const box=document.getElementById('admin-central-configuracao');
  if(box){box.hidden=false;box.innerHTML='<div class="admin-empty">Carregando configuração operacional…</div>';}
  const reqId=++ADMIN._reqConfig;
  try{
    const r=await auth({acao:'plataforma_carregar_configuracao_loja',loja_id:loja.id});
    if(reqId!==ADMIN._reqConfig)return;
    ADMIN.configuracaoLoja=r.loja; adminRenderConfiguracaoLoja(r.loja);
  }catch(e){if(box)box.innerHTML=`<div class="admin-empty">${esc(erroAmigavel(e))}</div>`;}
}
function adminValor(v){return v===undefined||v===null||v===''?'Não configurado':String(v);}
function adminRenderConfiguracaoLoja(loja){
  const box=document.getElementById('admin-central-configuracao'); if(!box)return;
  const c=loja.configuracao||{}, faixas=Array.isArray(c.faixas)?c.faixas:Object.keys(c.faixas||{});
  const perfis=Object.keys(c.perfis||{}).length, funcoes=Object.keys(c.funcoes||{}).length;
  box.innerHTML=`<div class="admin-config-head"><strong>${esc(loja.empresa)} · ${esc(loja.nome)}</strong><span class="chip info">Somente leitura</span></div><div class="admin-config-grid"><div><small>Modelo</small><b>${esc(adminValor(c.modelo))}</b></div><div><small>Folgas por semana</small><b>${esc(adminValor(c.folgasSemana))}</b></div><div><small>Ciclo de domingo</small><b>${esc(adminValor(c.cicloDomingo))}</b></div><div><small>Máximo de sequência</small><b>${esc(adminValor(c.maxSeq))}</b></div><div><small>Versão da configuração</small><b>${esc(adminValor(loja.versao))}</b></div><div><small>Perfis operacionais</small><b>${perfis?perfis+' configurado(s)':'Não configurado'}</b></div><div><small>Faixas de cobertura</small><b>${faixas.length?faixas.length+' dia(s) configurado(s)':'Não configurado'}</b></div><div><small>Funções de cobertura</small><b>${funcoes?funcoes+' configurada(s)':'Não configurado'}</b></div></div><div class="admin-config-note">Os parâmetros ajudam a entender a montagem da escala. A configuração só pode ser alterada no ambiente operacional da loja.</div>`;
}
function adminRenderLojas(){
  const box=document.getElementById('admin-lojas');if(!box)return;box.replaceChildren();
  if(!ADMIN.lojas.length){const p=document.createElement('div');p.className='admin-empty';p.textContent='Nenhuma loja cadastrada.';box.appendChild(p);return;}
  ADMIN.lojas.forEach(l=>{
    const row=document.createElement('div'); row.className='admin-row admin-loja-row'; row.dataset.lojaId=l.id;
    const w=document.createElement('span'),s=document.createElement('strong'),p=document.createElement('small');
    s.textContent=l.nome; p.textContent=l.descricao||'Sem descrição cadastral'; w.append(s,p);
    const actions=document.createElement('span'); actions.className='admin-row-actions';
    const ver=adminBotao('Ver escalas',()=>adminSelecionarLojaConsulta(l)); ver.dataset.acao='ver-escalas'; ver.dataset.lojaId=l.id;
    const config=adminBotao('Configuração',()=>adminAbrirConfiguracaoLoja(l)); config.dataset.acao='ver-configuracao'; config.dataset.lojaId=l.id;
    const editar=adminBotao('Editar',()=>adminEditarLoja(l)); editar.dataset.acao='editar-loja'; editar.dataset.lojaId=l.id;
    actions.append(ver,config,editar); row.append(w,actions); box.appendChild(row);
  });
}
function adminEditarLoja(loja){const f=document.getElementById('admin-form-loja');f.hidden=false;f.dataset.id=loja?.id||'';document.getElementById('admin-loja-nome').value=loja?.nome||'';document.getElementById('admin-loja-descricao').value=loja?.descricao||'';}
async function adminCarregarSupervisores(){
  if(!ADMIN.empresa)return;
  const reqId=++ADMIN._reqSup, empresaId=ADMIN.empresa.id;
  const q=(document.getElementById('admin-busca-supervisor')?.value||'').trim();
  const box=document.getElementById('admin-supervisores');if(box)box.textContent='Carregando supervisores…';
  try{
    const r=await auth({acao:'plataforma_listar_supervisores',empresa_id:empresaId,q});
    const lista=r.supervisores||[];
    const dados=await Promise.all(lista.map(async s=>({p:s,r:await auth({acao:'plataforma_listar_supervisor_lojas',usuario_id:s.id})})));
    if(reqId!==ADMIN._reqSup || !ADMIN.empresa || ADMIN.empresa.id!==empresaId) return;
    ADMIN.supervisores=dados;
    adminRenderSupervisores();
  }
  catch(e){adminStatus(erroAmigavel(e),'erro');}
}
function adminRenderSupervisores(){
  const box=document.getElementById('admin-supervisores');if(!box)return;box.replaceChildren();if(!ADMIN.supervisores.length){const p=document.createElement('div');p.className='admin-empty';p.textContent='Nenhum supervisor encontrado.';box.appendChild(p);return;}
  ADMIN.supervisores.forEach(({p, r})=>{const row=document.createElement('div');row.className='admin-supervisor';row.dataset.supervisorId=p.id;row.dataset.supervisorEmail=p.email;const main=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small'),chips=document.createElement('div');strong.textContent=p.nome;small.textContent=p.email;chips.className='admin-chips';const vinculadas=r.lojas||[];vinculadas.forEach(l=>{const chip=document.createElement('span');chip.className='admin-chip';chip.dataset.lojaId=l.id;const x=adminBotao('×',()=>adminRevogar(p,l),{acao:'revogar',lojaId:l.id});x.className='';x.setAttribute('aria-label','Revogar '+l.nome+' de '+p.nome);x.title='Revogar acesso a '+l.nome;chip.append(document.createTextNode(l.nome),x);chips.appendChild(chip);});main.append(strong,small);if(vinculadas.length){main.appendChild(chips);}else{const aviso=document.createElement('span');aviso.className='admin-sem-vinculo';aviso.textContent='Sem loja vinculada — não enxerga nenhuma escala.';main.appendChild(aviso);}const select=document.createElement('select');select.className='inp';select.setAttribute('aria-label','Atribuir loja a '+p.nome);const disponiveis=ADMIN.lojas.filter(l=>!vinculadas.some(x=>x.id===l.id));select.innerHTML='<option value="">'+(disponiveis.length?'Vincular outra loja…':'Todas as lojas já vinculadas')+'</option>';select.disabled=!disponiveis.length;disponiveis.forEach(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.nome;select.appendChild(o);});select.addEventListener('change',async()=>{if(!select.value)return;const lojaId=select.value;select.disabled=true;try{await adminRequisicao({acao:'plataforma_atribuir_supervisor_loja',usuario_id:p.id,loja_id:lojaId},()=>adminCarregarSupervisores());}catch(e){select.disabled=false;} });row.append(main,select);box.appendChild(row);});
}
async function adminRevogar(p,l){if(!confirm('Revogar o acesso de '+p.nome+' à loja '+l.nome+'?'))return;try{await adminRequisicao({acao:'plataforma_revogar_supervisor_loja',usuario_id:p.id,loja_id:l.id},()=>adminCarregarSupervisores());}catch(e){}}
async function carregarAdministracao(){
  if(!SESSAO.plataforma){mostrarTela('entrar');return;} adminStatus('Carregando…'); await adminCarregarEmpresas(); adminStatus('Pronto','ok');
}
function montarAdministracao(){
  const tab=document.getElementById('tab-administracao');if(tab){tab.hidden=!SESSAO.plataforma;tab.onclick=e=>{e.preventDefault();abrirAdministracao();};}
  const busca=document.getElementById('admin-busca-empresa');if(busca)busca.addEventListener('input',()=>adminCarregarEmpresas());
  const buscaS=document.getElementById('admin-busca-supervisor');if(buscaS)buscaS.addEventListener('input',()=>adminCarregarSupervisores());
  const buscaU=document.getElementById('admin-busca-usuario');if(buscaU)buscaU.addEventListener('input',()=>adminCarregarUsuarios());
  document.getElementById('admin-recarregar-usuarios')?.addEventListener('click',()=>adminCarregarUsuarios());
  document.querySelectorAll('[data-consulta]').forEach(b=>b.addEventListener('click',()=>adminMostrarConsulta(b.dataset.consulta)));
  document.getElementById('admin-nova-empresa')?.addEventListener('click',()=>{ADMIN.empresa=null;adminRenderEmpresas();adminPreencherEmpresa({},true);document.getElementById('admin-painel-lojas').hidden=true;document.getElementById('admin-painel-supervisores').hidden=true;document.getElementById('admin-painel-central').hidden=true;});
  document.getElementById('admin-editar-empresa')?.addEventListener('click',()=>adminPreencherEmpresa(ADMIN.empresa,true));
  document.getElementById('admin-cancelar-empresa')?.addEventListener('click',()=>document.getElementById('admin-form-empresa').hidden=true);
  document.getElementById('admin-form-empresa')?.addEventListener('submit',async e=>{e.preventDefault();const nome=document.getElementById('admin-empresa-nome').value.trim(),descricao=document.getElementById('admin-empresa-descricao').value.trim();try{const payload=ADMIN.empresa?{acao:'plataforma_editar_empresa',empresa_id:ADMIN.empresa.id,nome,descricao}:{acao:'plataforma_criar_empresa',nome,descricao};await adminRequisicao(payload,async()=>{e.target.hidden=true;await adminCarregarEmpresas();});}catch(x){}});
  document.getElementById('admin-nova-loja')?.addEventListener('click',()=>adminEditarLoja({}));
  document.getElementById('admin-cancelar-loja')?.addEventListener('click',()=>document.getElementById('admin-form-loja').hidden=true);
  document.getElementById('admin-form-loja')?.addEventListener('submit',async e=>{e.preventDefault();const nome=document.getElementById('admin-loja-nome').value.trim(),descricao=document.getElementById('admin-loja-descricao').value.trim(),id=e.target.dataset.id;try{const payload=id?{acao:'plataforma_editar_loja',loja_id:id,nome,descricao}:{acao:'plataforma_criar_loja',empresa_id:ADMIN.empresa.id,nome,descricao};await adminRequisicao(payload,async()=>{e.target.hidden=true;await adminCarregarLojas();});}catch(x){}});
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
