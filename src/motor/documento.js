/* =========================================================================
   DOCUMENTOS DA ESCALA
   Regras de apresentação compartilhadas pela impressão e pelo PDF, além do
   gerador de PDF em JavaScript puro. Não depende de biblioteca externa.
   ========================================================================= */

const CARACTERES_INVISIVEIS_DOCUMENTO = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');
const ACENTOS_DOCUMENTO = new RegExp('[\\u0300-\\u036f]', 'g');

function limparEspacosDocumento(valor){
  return String(valor == null ? '' : valor)
    .replace(CARACTERES_INVISIVEIS_DOCUMENTO, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizarTextoDocumento(valor){
  const texto = limparEspacosDocumento(valor);
  return (typeof texto.normalize === 'function' ? texto.normalize('NFD') : texto)
    .replace(ACENTOS_DOCUMENTO, '')
    .toUpperCase();
}

/* O cabeçalho da faixa já informa o cargo principal. O subtítulo só aparece
   quando acrescenta algo, e abreviações internas viram texto legível. */
function descricaoCargoImpressao(c, chaveFaixa){
  const cargo = limparEspacosDocumento(c && c.cargo);
  const normalizado = normalizarTextoDocumento(cargo);
  if(!normalizado) return '';

  if(/^SUB(?:GERENTE)?\s*\/\s*FARMA(?:CEUTIC[OA])?$/.test(normalizado))
    return 'Subgerente · Farmacêutico';

  if(/^(?:(?:AX|AUX)\.?|AUXILIAR)\s*(?:DE\s+)?LOJA$/.test(normalizado))
    return 'Auxiliar de loja';

  const redundante = {
    gerencia: /^(?:GERENTE|GERENCIA)$/,
    subger: /^(?:SUBGERENTE|SUBGERENCIA)$/,
    farma: /^FARMACEUTIC[OA]S?$/,
    balcao: /^(?:BALCONISTAS?|BALCAO)$/,
    caixa: /^CAIXAS?$/,
    apoio: /^APOIO$/
  };
  if(redundante[chaveFaixa] && redundante[chaveFaixa].test(normalizado)) return '';

  const descricoes = {
    GERENTE: 'Gerente',
    GERENCIA: 'Gerência',
    SUBGERENTE: 'Subgerente',
    SUBGERENCIA: 'Subgerência',
    FARMACEUTICO: 'Farmacêutico',
    FARMACEUTICA: 'Farmacêutica',
    BALCONISTA: 'Balconista',
    CAIXA: 'Caixa',
    REPOSITOR: 'Repositor',
    REPOSITORA: 'Repositora'
  };
  return descricoes[normalizado] || cargo;
}

/* Nomes iguais não são removidos: podem representar pessoas diferentes. A
   emissão é interrompida para que o responsável diferencie os cadastros. */
/* Classes e marcadores textuais são compartilhados pelas saídas impressas.
   A cor fica como reforço visual, nunca como a única informação. */
function marcaMonocromaticaDocumento(codigo){
  const marcas = {X:'status-x', FC:'status-fc', F:'status-f', AT:'status-at', LC:'status-lc'};
  return marcas[codigo] || '';
}
function marcadorCoberturaDocumento(tipo){
  return tipo === 'minimo' ? '!' : (tipo === 'alvo' ? '~' : '');
}

function nomesDuplicadosDocumento(lista){
  const grupos = new Map();
  (lista || []).forEach((c, indice)=>{
    const nome = limparEspacosDocumento(c && c.nome);
    const chave = normalizarTextoDocumento(nome);
    if(!chave) return;
    if(!grupos.has(chave)) grupos.set(chave, {nome, quantidade:0, indices:[], ids:[]});
    const grupo = grupos.get(chave);
    grupo.quantidade++;
    grupo.indices.push(indice);
    grupo.ids.push(c && c.id != null ? c.id : null);
  });
  return Array.from(grupos.values()).filter(g=>g.quantidade > 1);
}

/* ---------- texto para bytes WinAnsi (Latin-1) ---------- */
const WINANSI_EXTRA = {
  '€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,
  'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,
  '–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159
};
function winAnsi(txt){
  const saida = [];
  for(const ch of String(txt == null ? '' : txt)){
    const c = ch.codePointAt(0);
    if(c < 256) saida.push(c);
    else if(WINANSI_EXTRA[ch] != null) saida.push(WINANSI_EXTRA[ch]);
    else saida.push(63);
  }
  return saida;
}
function textoPdf(txt){
  return winAnsi(txt).map(b=>{
    if(b === 40 || b === 41 || b === 92) return '\\' + String.fromCharCode(b);
    if(b < 32 || b > 126) return '\\' + b.toString(8).padStart(3, '0');
    return String.fromCharCode(b);
  }).join('');
}

/* ---------- medida aproximada para centralizar e cortar texto ---------- */
const LARG_HELV = (()=>{
  const m = {};
  const def = 556;
  const tab = {
    ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,
    '*':389,'+':584,',':278,'-':333,'.':278,'/':278,':':278,';':278,'<':584,'=':584,
    '>':584,'?':556,'@':1015,'[':278,'\\':278,']':278,'^':469,'_':556,'`':333,
    '{':334,'|':260,'}':334,'~':584
  };
  for(let i=48;i<=57;i++) m[String.fromCharCode(i)] = 556;
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c,k)=>{
    m[c] = [667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
            667,778,722,667,611,722,667,944,667,667,611][k];
  });
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c,k)=>{
    m[c] = [556,556,500,556,556,278,556,556,222,222,500,222,833,556,
            556,556,556,333,500,278,556,500,722,500,500,500][k];
  });
  Object.assign(m, tab);
  return {m, def};
})();

function larguraTexto(txt, tamanho, negrito){
  let total = 0;
  for(const ch of String(txt||'')){
    let w = LARG_HELV.m[ch];
    if(w == null){
      const base = typeof ch.normalize === 'function' ? ch.normalize('NFD')[0] : ch;
      w = LARG_HELV.m[base] != null ? LARG_HELV.m[base] : LARG_HELV.def;
    }
    total += w;
  }
  if(negrito) total *= 1.06;
  return total * tamanho / 1000;
}

function cortarTexto(txt, tamanho, limite, negrito){
  if(larguraTexto(txt, tamanho, negrito) <= limite) return txt;
  let s = String(txt||'');
  while(s.length > 1 && larguraTexto(s + '…', tamanho, negrito) > limite) s = s.slice(0, -1);
  return s + '…';
}

/* ---------- construtor de página ---------- */
function PaginaPdf(largura, altura){
  this.largura = largura;
  this.altura  = altura;
  this.ops = [];
}
PaginaPdf.prototype.retangulo = function(x, y, l, a, cor){
  if(!cor) return;
  const [r,g,b] = cor;
  this.ops.push(`${r} ${g} ${b} rg`);
  this.ops.push(`${x.toFixed(2)} ${(this.altura-y-a).toFixed(2)} ${l.toFixed(2)} ${a.toFixed(2)} re f`);
};
PaginaPdf.prototype.linha = function(x1, y1, x2, y2, cor, esp){
  const [r,g,b] = cor || [0.85,0.88,0.86];
  this.ops.push(`${r} ${g} ${b} RG ${(esp||0.4).toFixed(2)} w`);
  this.ops.push(`${x1.toFixed(2)} ${(this.altura-y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.altura-y2).toFixed(2)} l S`);
};
PaginaPdf.prototype.texto = function(txt, x, y, opc){
  const o = opc || {};
  const tam = o.tamanho || 8;
  const fonte = o.negrito ? '/F2' : '/F1';
  const [r,g,b] = o.cor || [0.09,0.14,0.17];
  let px = x;
  if(o.centro){
    const larg = larguraTexto(txt, tam, o.negrito);
    px = x + (o.largura - larg) / 2;
  }
  this.ops.push('BT');
  this.ops.push(`${r} ${g} ${b} rg`);
  this.ops.push(`${fonte} ${tam} Tf`);
  this.ops.push(`${px.toFixed(2)} ${(this.altura - y - tam * 0.78).toFixed(2)} Td`);
  this.ops.push(`(${textoPdf(txt)}) Tj`);
  this.ops.push('ET');
};
PaginaPdf.prototype.conteudo = function(){ return this.ops.join('\n'); };

/* ---------- arquivo PDF e tabela de referência cruzada ---------- */
function montarPdf(paginas, meta){
  const objetos = [];
  const add = (txt)=>{ objetos.push(txt); return objetos.length; };

  const nCatalogo = 1, nPaginas = 2;
  objetos.push('', '');

  const idsFontes = [];
  idsFontes.push(add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  idsFontes.push(add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

  const idsPaginas = [];
  paginas.forEach(pg=>{
    const fluxo = pg.conteudo();
    const nFluxo = add(`<< /Length ${winAnsi(fluxo).length} >>\nstream\n${fluxo}\nendstream`);
    const nPag = add(`<< /Type /Page /Parent ${nPaginas} 0 R `
      + `/MediaBox [0 0 ${pg.largura} ${pg.altura}] `
      + `/Resources << /Font << /F1 ${idsFontes[0]} 0 R /F2 ${idsFontes[1]} 0 R >> >> `
      + `/Contents ${nFluxo} 0 R >>`);
    idsPaginas.push(nPag);
  });

  const nInfo = add(`<< /Title (${textoPdf(meta && meta.titulo || 'Escala')}) `
    + `/Producer (Shiftflow) /Creator (Shiftflow) >>`);

  objetos[nCatalogo-1] = `<< /Type /Catalog /Pages ${nPaginas} 0 R >>`;
  objetos[nPaginas-1]  = `<< /Type /Pages /Kids [${idsPaginas.map(i=>i+' 0 R').join(' ')}] `
                       + `/Count ${idsPaginas.length} >>`;

  let corpo = '%PDF-1.4\n';
  const posicoes = [];
  objetos.forEach((obj, i)=>{
    posicoes.push(winAnsi(corpo).length);
    corpo += `${i+1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = winAnsi(corpo).length;
  corpo += `xref\n0 ${objetos.length+1}\n0000000000 65535 f \n`;
  posicoes.forEach(p=>{ corpo += String(p).padStart(10,'0') + ' 00000 n \n'; });
  corpo += `trailer\n<< /Size ${objetos.length+1} /Root ${nCatalogo} 0 R /Info ${nInfo} 0 R >>\n`
         + `startxref\n${inicioXref}\n%%EOF\n`;

  return new Uint8Array(winAnsi(corpo));
}

const COR_PDF = {
  texto:    [0.09, 0.14, 0.17],
  fraco:    [0.42, 0.47, 0.45],
  linha:    [0.84, 0.87, 0.85],
  cabecalho:[0.09, 0.14, 0.17],
  branco:   [1, 1, 1],
  faixa:    [0.96, 0.97, 0.96],
  fds:      [0.94, 0.96, 0.95],
  X:  [[0.847,0.929,0.886],[0.078,0.400,0.247]],
  FC: [[0.965,0.906,0.769],[0.541,0.369,0.024]],
  F:  [[0.843,0.898,0.941],[0.122,0.333,0.502]],
  AT: [[0.953,0.859,0.843],[0.588,0.200,0.165]],
  LC: [[0.890,0.867,0.949],[0.314,0.251,0.494]]
};
const DIA_ABREV_PDF = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function ddmmPdf(d){ return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'); }

/* A4 paisagem, com quebra automática quando a equipe não cabe em uma página. */
function gerarPdfEscala(D, nomeLoja){
  if(!D) throw new Error('Dados da escala não fornecidos.');
  const days = Array.isArray(D.days) ? D.days : [];
  const grid = D.grid || {};
  const ativos = Array.isArray(D.ativos) ? D.ativos : [];
  const P = D.P || {};
  const cob = Array.isArray(D.cob) ? D.cob : [];
  const nome = String(nomeLoja || 'Escala');
  const periodo = String(D.periodo || '');

  if(!days.length) throw new Error('A escala precisa ter ao menos um dia para gerar o PDF.');
  if(days.length > 62) throw new Error('O PDF aceita períodos de até 62 dias.');
  const L = 842, A = 595;
  const margem = 22;
  const larguraNome = 96, larguraJornada = 58, larguraIntervalo = 44;
  const areaDias = L - margem*2 - larguraNome - larguraJornada - larguraIntervalo;
  const largDia = areaDias / days.length;
  const altLinha = 17;
  const topoTabela = 74;

  const rodapes = [
    ['Caixa',        (c)=>c.cx,  P.minCaixa,  null],
    ['Balcão',       (c)=>c.bl,  P.minBalcao, null],
    ['Farmacêutico', (c)=>c.fa,  1,           P.minFarma != null ? P.minFarma : 2],
    ['Subgerente',   (c)=>c.sg||0, P.minSubger != null ? P.minSubger : 1, null],
    ['Total na loja',(c)=>c.total, null, null],
    ['De folga',     (c,i)=>ativos.filter(x=>grid[x.id] && (grid[x.id][i]==='X'||grid[x.id][i]==='FC')).length, null, null]
  ];

  const notaInterjornada = ativos.some(c=>Object.keys((D.interjornadas && D.interjornadas[c.id]) || {}).length);
  const alturaUtil = A - topoTabela - margem - (rodapes.length * altLinha) - 26 - 6*11 - (notaInterjornada ? 10 : 0);
  // Reserva duas linhas de respiro para que a última página continue cabendo
  // quando a equipe alterna entre várias faixas de cargo antes da cobertura.
  const porPagina = Math.max(1, Math.floor(alturaUtil / altLinha) - 2);
  const paginas = [];
  const totalPag = Math.max(1, Math.ceil(ativos.length / porPagina));

  for(let pg = 0; pg < totalPag; pg++){
    const p = new PaginaPdf(L, A);
    const fatia = ativos.slice(pg * porPagina, (pg+1) * porPagina);

    p.texto('Escala — ' + nome, margem, 22, {tamanho:15, negrito:true});
    p.texto(periodo + '  ·  ' + ativos.length + ' colaboradores  ·  emitida em '
            + new Date().toLocaleDateString('pt-BR'),
            margem, 43, {tamanho:8.5, cor:COR_PDF.fraco});
    if(totalPag > 1){
      const rot = 'Página ' + (pg+1) + ' de ' + totalPag;
      p.texto(rot, L - margem - larguraTexto(rot, 8.5, false), 43, {tamanho:8.5, cor:COR_PDF.fraco});
    }

    let y = topoTabela;
    p.retangulo(margem, y, L - margem*2, altLinha, COR_PDF.cabecalho);
    p.texto('COLABORADOR', margem + 4, y + 4, {tamanho:6.5, negrito:true, cor:COR_PDF.branco});
    p.texto('JORNADA', margem + larguraNome + 2, y + 4,
            {tamanho:6.5, negrito:true, cor:COR_PDF.branco, centro:true, largura:larguraJornada});
    p.texto('INTERVALO', margem + larguraNome + larguraJornada, y + 4,
            {tamanho:5.5, negrito:true, cor:COR_PDF.branco, centro:true, largura:larguraIntervalo});
    days.forEach((d,i)=>{
      const x = margem + larguraNome + larguraJornada + larguraIntervalo + i*largDia;
      p.texto(DIA_ABREV_PDF[d.getDay()], x, y + 4,
              {tamanho:5.8, negrito:true, cor:COR_PDF.branco, centro:true, largura:largDia});
    });

    y += altLinha;
    p.retangulo(margem, y, L - margem*2, altLinha, COR_PDF.faixa);
    days.forEach((d,i)=>{
      const x = margem + larguraNome + larguraJornada + larguraIntervalo + i*largDia;
      if(d.getDay()===0 || d.getDay()===6) p.retangulo(x, y, largDia, altLinha, [0.88,0.91,0.89]);
      p.texto(ddmmPdf(d), x, y + 4, {tamanho:6, negrito:true, centro:true, largura:largDia});
    });

    y += altLinha;
    let faixaPdf = null;
    fatia.forEach((c)=>{
      const g = D.faixaDe ? D.faixaDe(c) : null;
      if(g !== null && g !== faixaPdf){
        const rotulo = D.rotuloFaixa ? D.rotuloFaixa(g) : '';
        p.retangulo(margem, y, L - margem*2, 11, [0.93,0.945,0.935]);
        p.texto(String(rotulo).toUpperCase(), margem + 4, y + 2.5,
                {tamanho:5.5, negrito:true, cor:COR_PDF.fraco});
        p.linha(margem, y + 11, L - margem, y + 11, COR_PDF.linha);
        y += 11;
        faixaPdf = g;
      }
      const descricao = D.descricaoCargo
        ? D.descricaoCargo(c, g)
        : limparEspacosDocumento(c.cargo);
      p.retangulo(margem, y, L - margem*2, altLinha, COR_PDF.branco);
      p.texto(cortarTexto(c.nome, 7.5, larguraNome - 8, true), margem + 4, y + (descricao ? 2.5 : 4.5),
              {tamanho:7.5, negrito:true});
      if(descricao){
        p.texto(cortarTexto(descricao, 5, larguraNome - 8, false), margem + 4, y + 9.5,
                {tamanho:5, cor:COR_PDF.fraco});
      }
      const horaEntrada = String(D.horaDe ? D.horaDe(c, 0) : '').slice(0,5);
      const horaSaida = String(D.horaSaidaDe ? D.horaSaidaDe(c, 0) : '').slice(0,5);
      const temEnt = Boolean(horaEntrada && horaEntrada !== '--:--');
      const temSai = Boolean(horaSaida && horaSaida !== '--:--');
      const txtJornada = (temEnt && temSai) ? (horaEntrada + '–' + horaSaida) : (temEnt ? horaEntrada : '--:--');
      p.texto(txtJornada, margem + larguraNome, y + 6.5,
              {tamanho:5.7, cor:COR_PDF.fraco, centro:true, largura:larguraJornada});
      const intervalo = String(D.intervaloDe ? D.intervaloDe(c) : (c.jornada && c.jornada.intervalo ? c.jornada.intervalo + ' min' : ''));
      p.texto(cortarTexto(intervalo, 5.2, larguraIntervalo - 3, false), margem + larguraNome + larguraJornada, y + 6.5,
              {tamanho:5.2, cor:COR_PDF.fraco, centro:true, largura:larguraIntervalo});

      days.forEach((d,i)=>{
        const x = margem + larguraNome + larguraJornada + larguraIntervalo + i*largDia;
        const cod = (grid[c.id] && grid[c.id][i]) || '';
        const interjornada = D.interjornadas && D.interjornadas[c.id] && D.interjornadas[c.id][i];
        const fds = d.getDay()===0 || d.getDay()===6;
        if(COR_PDF[cod]){
          p.retangulo(x, y, largDia, altLinha, COR_PDF[cod][0]);
          p.texto(cod, x, y + 4.5, {tamanho:6.5, negrito:true, cor:COR_PDF[cod][1],
                                    centro:true, largura:largDia});
          p.linha(x, y, x + largDia, y, COR_PDF[cod][1], 0.65);
        } else {
          if(interjornada) p.retangulo(x, y, largDia, altLinha, [0.90,0.90,0.90]);
          else if(fds) p.retangulo(x, y, largDia, altLinha, COR_PDF.fds);
          const horaDia = String(D.horaDe ? D.horaDe(c, i) : '').slice(0,5) || '--:--';
          const saidaDia = String(D.horaSaidaDe ? D.horaSaidaDe(c, i) : '').slice(0,5);
          const temSaidaDia = Boolean(saidaDia && saidaDia !== '--:--');
          p.texto((interjornada?'* ':'') + horaDia, x, y + (temSaidaDia ? 3.6 : 6.2),
                  {tamanho:5.6, negrito:true, cor:COR_PDF.texto, centro:true, largura:largDia});
          if(temSaidaDia){
            p.texto(saidaDia, x, y + 11.2,
                    {tamanho:4.7, cor:COR_PDF.fraco, centro:true, largura:largDia});
          }
        }
        p.linha(x, y, x, y + altLinha, COR_PDF.linha, d.getDay()===0 ? 0.9 : 0.35);
        if(d.getDay()===0) p.linha(x + 1.4, y, x + 1.4, y + altLinha, COR_PDF.texto, 0.35);
      });
      p.linha(margem, y + altLinha, L - margem, y + altLinha, COR_PDF.linha);
      y += altLinha;
    });

    if(pg === totalPag - 1){
      y += 3;
      rodapes.forEach(([rot, fn, minimo, alvo])=>{
        p.retangulo(margem, y, L - margem*2, altLinha, COR_PDF.faixa);
        p.texto(rot.toUpperCase(), margem + 4, y + 4.5, {tamanho:6, negrito:true, cor:COR_PDF.fraco});
        cob.forEach((c,i)=>{
          const x = margem + larguraNome + larguraJornada + larguraIntervalo + i*largDia;
          const v = fn(c, i);
          let corFundo = null, corTexto = COR_PDF.texto, marca = '';
          const lim = typeof minimo === 'function' ? minimo(c,i) : minimo;
          if(lim != null && v < lim){ corFundo = COR_PDF.AT[0]; corTexto = COR_PDF.AT[1]; marca = marcadorCoberturaDocumento('minimo'); }
          else if(alvo != null && v < alvo){ corFundo = COR_PDF.FC[0]; corTexto = COR_PDF.FC[1]; marca = marcadorCoberturaDocumento('alvo'); }
          if(corFundo) p.retangulo(x, y, largDia, altLinha, corFundo);
          p.texto(marca + String(v != null ? v : 0), x, y + 4.5, {tamanho:6.5, negrito:!!corFundo, cor:corTexto,
                                          centro:true, largura:largDia});
        });
        p.linha(margem, y + altLinha, L - margem, y + altLinha, COR_PDF.linha);
        y += altLinha;
      });

      y += 8;
      let x = margem;
      [['X','folga'],['FC','compensatória'],['F','férias'],['AT','atestado'],['LC','licença']]
      .forEach(([k, rot])=>{
        p.retangulo(x, y, 8, 6, COR_PDF[k][0]);
        p.linha(x, y, x + 8, y, COR_PDF[k][1], 0.7);
        p.texto(k + ' ' + rot, x + 11, y - 0.5, {tamanho:6.5, cor:COR_PDF.fraco});
        x += 13 + larguraTexto(k + ' ' + rot, 6.5, false) + 10;
      });
      p.texto('* descanso menor que 11h   ! abaixo do mínimo   ~ abaixo do alvo', margem, y + 11, {tamanho:6.5, cor:COR_PDF.fraco});
      const notas=[];
      ativos.forEach(c=>Object.values((D.interjornadas && D.interjornadas[c.id]) || {}).forEach(a=>notas.push(c.nome + ': ' + a.txt)));
      if(notas.length) p.texto('Revisar descanso: ' + cortarTexto(notas.join(' · '), 5.6, L-margem*2, false), margem, y + 20, {tamanho:5.6, cor:COR_PDF.fraco});
    }

    p.linha(margem, topoTabela, L - margem, topoTabela, COR_PDF.linha, 0.6);
    paginas.push(p);
  }

  return montarPdf(paginas, {titulo: 'Escala ' + nome + ' — ' + periodo});
}

if(typeof module !== 'undefined' && typeof module.exports !== 'undefined')
  module.exports = {limparEspacosDocumento, normalizarTextoDocumento,
    descricaoCargoImpressao, marcaMonocromaticaDocumento, marcadorCoberturaDocumento,
    nomesDuplicadosDocumento, gerarPdfEscala, montarPdf};
