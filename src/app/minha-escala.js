/* ============================================================
   MINHA ESCALA — visão individual do colaborador
   Recebe do servidor apenas a própria linha. A extração acontece
   no PHP: se viesse a grade inteira, bastaria abrir as ferramentas
   do navegador para ler a escala de todo mundo.
   ============================================================ */

const CORES_TIPO = {
  folga:    ['#D8EDE2', '#04342C', '#085041'],
  ferias:   ['#D7E5F0', '#042C53', '#185FA5'],
  atestado: ['#F3DBD7', '#501313', '#A32D2D'],
  licenca:  ['#E3DDF2', '#26215C', '#534AB7'],
  trabalho: ['', '', '']
};
const DIAS_CURTO = ['dom','seg','ter','qua','qui','sex','sáb'];

function dataBR(iso){
  if(!iso) return '';
  const [a,m,d] = iso.split('-');
  return `${d}/${m}`;
}

async function pintarMinhaEscala(periodo){
  const cx = $('#minha-escala');
  if(!cx) return;
  cx.innerHTML = `<p class="vazio">Carregando…</p>`;

  let r;
  try{
    r = await chamar('minha.php', Object.assign({acao:'minha_escala'}, periodo || {}));
  }catch(e){
    cx.innerHTML = `<div class="painel"><p class="vazio">${esc(erroAmigavel(e))}</p></div>`;
    return;
  }

  const c = r.colaborador || {};
  const e = r.escala;

  // seletor de período, quando houver mais de um publicado
  let seletor = '';
  try{
    const p = await chamar('minha.php', {acao:'meus_periodos'});
    if((p.periodos||[]).length > 1){
      seletor = `<select id="sel-periodo" class="inp" style="width:auto;font-size:13px">${
        p.periodos.map(x=>{
          const sel = e && x.inicio===e.inicio && x.fim===e.fim ? ' selected' : '';
          return `<option value="${x.inicio}_${x.fim}"${sel}>${dataBR(x.inicio)} a ${dataBR(x.fim)}</option>`;
        }).join('')}</select>`;
    }
  }catch(err){}

  if(!e){
    cx.innerHTML = `
      <div class="painel">
        <div class="me-topo">
          <div>
            <h2 style="margin:0">${esc(c.nome || 'Minha escala')}</h2>
            <p class="desc" style="margin:2px 0 0">${esc(c.cargo||'')}${c.loja?' · '+esc(c.loja):''}</p>
          </div>
          ${seletor}
        </div>
        <p class="vazio" style="padding:32px 0">${esc(r.aviso || 'Nada publicado ainda.')}</p>
      </div>`;
    ligarSeletorPeriodo();
    return;
  }

  const resumo = r.resumo || {folgas:0, trabalhados:0, proximas:[]};

  // calendário: alinhar a primeira semana pelo dia da semana
  const vazios = e.dias.length ? e.dias[0].semana : 0;
  const celulas = [];
  for(let i=0;i<vazios;i++) celulas.push('<div></div>');
  e.dias.forEach(d=>{
    const [bg, fg, sec] = CORES_TIPO[d.tipo] || CORES_TIPO.trabalho;
    const trabalho = d.tipo === 'trabalho';
    const rotulo = trabalho
      ? `<div class="me-hora">${esc((d.rotulo||'').slice(0,5))}</div>`
      : `<div class="me-tipo" style="color:${sec}">${esc(d.rotulo.toLowerCase())}</div>`;
    celulas.push(`
      <div class="me-dia${trabalho?'':' me-dia-marcado'}" style="${bg?`background:${bg}`:''}">
        <div class="me-num" style="${fg?`color:${fg}`:''}">${d.dia}</div>
        ${rotulo}
      </div>`);
  });

  cx.innerHTML = `
    <div class="painel">
      <div class="me-topo">
        <div>
          <h2 style="margin:0">${esc(c.nome||'')}</h2>
          <p class="desc" style="margin:2px 0 0">${esc(c.cargo||'')}${c.loja?' · '+esc(c.loja):''}</p>
        </div>
        ${seletor}
      </div>
      <p class="desc" style="margin:6px 0 18px">
        ${dataBR(e.inicio)} a ${dataBR(e.fim)}${e.publicada_em
          ? ' · publicada em ' + new Date(e.publicada_em.replace(' ','T')).toLocaleDateString('pt-BR')
          : ''}
      </p>

      <div class="me-cartoes">
        <div class="me-cartao"><div class="me-rot">Folgas no período</div><div class="me-val">${resumo.folgas}</div></div>
        <div class="me-cartao"><div class="me-rot">Dias de trabalho</div><div class="me-val">${resumo.trabalhados}</div></div>
        <div class="me-cartao"><div class="me-rot">Meu horário</div><div class="me-val me-val-hora">${esc(c.horario||'—')}</div></div>
      </div>

      ${(resumo.proximas||[]).length ? `
        <div class="me-proximas">
          <div class="me-proximas-rot">Próximas folgas</div>
          <div class="me-proximas-lista">
            ${resumo.proximas.map(d=>`<span>${DIAS_CURTO[d.semana]} ${String(d.dia).padStart(2,'0')}/${String(d.mes).padStart(2,'0')}</span>`).join('')}
          </div>
        </div>` : ''}

      <div class="me-grade">
        ${DIAS_CURTO.map(d=>`<div class="me-cab">${d}</div>`).join('')}
        ${celulas.join('')}
      </div>

      <div class="legenda" style="margin-top:16px">
        <span><b style="background:#D8EDE2"></b>folga</span>
        <span><b style="background:#D7E5F0"></b>férias</span>
        <span><b style="background:#F3DBD7"></b>atestado</span>
        <span><b style="background:#E3DDF2"></b>licença</span>
        <span><b style="background:#F4F6F4;border:1px solid var(--linha)"></b>trabalho</span>
      </div>
    </div>

    <div class="painel">
      <h2>Confira e avise</h2>
      <p class="desc" style="margin:0">A escala acima é a que está publicada para a sua loja. Se
      algum dia estiver diferente do combinado, fale com o responsável pela escala — a alteração
      é feita por ele e aparece aqui em seguida.</p>
    </div>`;

  ligarSeletorPeriodo();
}

function ligarSeletorPeriodo(){
  const s = $('#sel-periodo');
  if(!s) return;
  s.onchange = ()=>{
    const [inicio, fim] = s.value.split('_');
    pintarMinhaEscala({inicio, fim});
  };
}

/* Ajusta a interface ao papel de quem entrou. */
function aplicarPapel(){
  const papel = (SESSAO.usuario && SESSAO.usuario.papel) || 'gestor';
  const soMinha = papel === 'colaborador';

  $$('nav.tabs button').forEach(b=>{
    const paraTodos = b.dataset.view === 'minha';
    b.style.display = (soMinha && !paraTodos) ? 'none' : '';
  });

  // colaborador não escolhe loja nem período de geração
  const sel = $('#sel-loja');
  if(sel) sel.parentElement.style.display = soMinha ? 'none' : '';

  const abaMinha = $$('nav.tabs button').find(b=>b.dataset.view === 'minha');
  if(abaMinha) abaMinha.style.display = SESSAO.usuario && SESSAO.usuario.colaborador_id ? '' : 'none';

  if(soMinha){
    irPara('minha');
    pintarMinhaEscala();
  }
}

function irPara(view){
  $$('nav.tabs button').forEach(x=>x.setAttribute('aria-current', String(x.dataset.view===view)));
  $$('.view').forEach(v=>v.dataset.ativa = String(v.dataset.view===view));
}
