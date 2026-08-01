/* =========================================================================
   GERADOR DE .XLSX EM JAVASCRIPT PURO
   Monta o pacote OOXML na mão (ZIP sem compressão + XML). Não depende de
   biblioteca externa, então funciona offline. Abre no LibreOffice Calc,
   no Excel e no Google Sheets.
   ========================================================================= */

/* ---------- CRC32, exigido pelo formato ZIP ---------- */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- ZIP com entradas armazenadas (método 0) ---------- */
function zipar(arquivos) {
  const cod = (typeof TextEncoder !== 'undefined')
    ? (s => new TextEncoder().encode(s))
    : (s => Uint8Array.from(Buffer.from(s, 'utf8')));

  const partes = [], central = [];
  let deslocamento = 0;

  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  arquivos.forEach(({ nome, conteudo }) => {
    const dados = cod(conteudo);
    const nomeBytes = cod(nome);
    const crc = crc32(dados);
    // data fixa (1980-01-01) mantém o arquivo reproduzível
    const hora = 0, data = 33;

    const cabecalho = [].concat(
      [0x50, 0x4B, 0x03, 0x04], u16(20), u16(0x0800), u16(0),
      u16(hora), u16(data), u32(crc), u32(dados.length), u32(dados.length),
      u16(nomeBytes.length), u16(0)
    );
    partes.push(new Uint8Array(cabecalho), nomeBytes, dados);

    central.push([].concat(
      [0x50, 0x4B, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0),
      u16(hora), u16(data), u32(crc), u32(dados.length), u32(dados.length),
      u16(nomeBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(deslocamento)
    ), nomeBytes);

    deslocamento += cabecalho.length + nomeBytes.length + dados.length;
  });

  const centralBytes = [];
  central.forEach(p => {
    if (Array.isArray(p)) centralBytes.push(new Uint8Array(p));
    else centralBytes.push(p);
  });
  const tamanhoCentral = centralBytes.reduce((a, b) => a + b.length, 0);

  const fim = new Uint8Array([].concat(
    [0x50, 0x4B, 0x05, 0x06], u16(0), u16(0),
    u16(arquivos.length), u16(arquivos.length),
    u32(tamanhoCentral), u32(deslocamento), u16(0)
  ));

  const todas = partes.concat(centralBytes, [fim]);
  const total = todas.reduce((a, b) => a + b.length, 0);
  const saida = new Uint8Array(total);
  let p = 0;
  todas.forEach(b => { saida.set(b, p); p += b.length; });
  return saida;
}

/* ---------- XML ---------- */
function xesc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function colLetra(n) {                    // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* =========================================================================
   Monta a planilha.
   plan = {
     aba: 'Escala',
     titulo: 'texto da linha 1',
     subtitulo: 'texto da célula ao lado',
     colunas: [larguras...],
     congelar: {coluna: 3, linha: 4},
     linhas: [ [ {v, e} | 'texto' | null, ... ], ... ]     // e = nome do estilo
   }
   ========================================================================= */
const ESTILOS = [
  // ordem importa: o índice é o id usado nas células
  { nome: 'normal' },
  { nome: 'titulo',    negrito: true, tamanho: 14 },
  { nome: 'subtitulo', cor: '556660', tamanho: 10 },
  { nome: 'cabecalho', negrito: true, corTexto: 'FFFFFF', fundo: '16232B', centro: true, borda: true, tamanho: 9 },
  { nome: 'data',      negrito: true, fundo: 'E7EDE9', centro: true, borda: true, tamanho: 9 },
  { nome: 'dataFds',   negrito: true, fundo: 'CFDCD5', centro: true, borda: true, tamanho: 9 },
  { nome: 'nome',      negrito: true, borda: true, tamanho: 10 },
  { nome: 'cargo',     cor: '556660', borda: true, tamanho: 9 },
  { nome: 'hora',      centro: true, borda: true, tamanho: 9 },
  { nome: 'trabalha',  centro: true, borda: true, tamanho: 9, corTexto: '7A8A85' },
  { nome: 'trabalhaFds', centro: true, borda: true, tamanho: 9, corTexto: '7A8A85', fundo: 'F2F5F3' },
  { nome: 'folga',     centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'D8EDE2', corTexto: '14663F' },
  { nome: 'ferias',    centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'D7E5F0', corTexto: '1F5580' },
  { nome: 'compensa',  centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'F6E7C4', corTexto: '8A5E06' },
  { nome: 'atestado',  centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'F3DBD7', corTexto: '96332A' },
  { nome: 'licenca',   centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'E3DDF2', corTexto: '50407E' },
  { nome: 'rotulo',    negrito: true, borda: true, tamanho: 9, fundo: 'E7EDE9' },
  { nome: 'conta',     centro: true, borda: true, tamanho: 9, fundo: 'F4F6F4' },
  { nome: 'contaFuro', centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'F3DBD7', corTexto: '96332A' },
  { nome: 'contaLeve', centro: true, borda: true, tamanho: 9, negrito: true, fundo: 'F6E7C4', corTexto: '8A5E06' },
  { nome: 'legenda',   cor: '556660', tamanho: 9 },
];
const idEstilo = {};
ESTILOS.forEach((e, i) => idEstilo[e.nome] = i);

function montarEstilosXml() {
  const fontes = ESTILOS.map(e =>
    `<font><sz val="${e.tamanho || 11}"/><color rgb="FF${e.corTexto || e.cor || '16232B'}"/>` +
    `<name val="Calibri"/>${e.negrito ? '<b/>' : ''}</font>`).join('');
  const preenchimentos = '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    ESTILOS.map(e => e.fundo
      ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${e.fundo}"/><bgColor indexed="64"/></patternFill></fill>`
      : '<fill><patternFill patternType="none"/></fill>').join('');
  const bordaFina = '<left style="thin"><color rgb="FFD4DBD7"/></left><right style="thin"><color rgb="FFD4DBD7"/></right>' +
                    '<top style="thin"><color rgb="FFD4DBD7"/></top><bottom style="thin"><color rgb="FFD4DBD7"/></bottom>';
  const bordas = '<border><left/><right/><top/><bottom/><diagonal/></border><border>' + bordaFina + '<diagonal/></border>';
  const xfs = ESTILOS.map((e, i) =>
    `<xf numFmtId="0" fontId="${i}" fillId="${e.fundo ? i + 2 : 0}" borderId="${e.borda ? 1 : 0}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">` +
    `<alignment horizontal="${e.centro ? 'center' : 'left'}" vertical="center"/></xf>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${ESTILOS.length}">${fontes}</fonts>
<fills count="${ESTILOS.length + 2}">${preenchimentos}</fills>
<borders count="2">${bordas}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${ESTILOS.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function gerarXLSX(plan) {
  const linhas = plan.linhas || [];
  const cols = (plan.colunas || []).map((l, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join('');

  const linhasXml = linhas.map((cels, r) => {
    const n = r + 1;
    const cs = (cels || []).map((cel, c) => {
      if (cel == null || cel === '') return '';
      const obj = (typeof cel === 'object') ? cel : { v: cel };
      const ref = colLetra(c + 1) + n;
      const est = idEstilo[obj.e] != null ? idEstilo[obj.e] : 0;
      if (obj.n != null && obj.n !== '' && !isNaN(obj.n))
        return `<c r="${ref}" s="${est}"><v>${Number(obj.n)}</v></c>`;
      return `<c r="${ref}" s="${est}" t="inlineStr"><is><t xml:space="preserve">${xesc(obj.v)}</t></is></c>`;
    }).join('');
    return `<row r="${n}"${plan.alturas && plan.alturas[r] ? ` ht="${plan.alturas[r]}" customHeight="1"` : ''}>${cs}</row>`;
  }).join('');

  const cong = plan.congelar
    ? `<pane xSplit="${plan.congelar.coluna}" ySplit="${plan.congelar.linha}" topLeftCell="${colLetra(plan.congelar.coluna + 1)}${plan.congelar.linha + 1}" activePane="bottomRight" state="frozen"/>`
    : '';
  const merges = (plan.merges || []).length
    ? `<mergeCells count="${plan.merges.length}">${plan.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const ultimaCol = colLetra(Math.max(1, (plan.colunas || []).length));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="1">${cong}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${linhasXml}</sheetData>
${merges}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const arquivos = [
    { nome: '[Content_Types].xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { nome: '_rels/.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { nome: 'xl/workbook.xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xesc(plan.aba || 'Escala').slice(0,31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nome: 'xl/styles.xml', conteudo: montarEstilosXml() },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: sheet },
  ];
  return zipar(arquivos);
}

if (typeof module !== 'undefined') module.exports = { gerarXLSX, zipar, crc32 };
