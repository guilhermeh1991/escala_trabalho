const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8877';
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL;
const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD;
const OPERADOR_EMAIL = process.env.OPERADOR_EMAIL;
const OPERADOR_PASSWORD = process.env.OPERADOR_PASSWORD;
const SUPERVISOR_EMAIL = process.env.SUPERVISOR_EMAIL;
const STORE_A = process.env.STORE_A;
const STORE_B = process.env.STORE_B;
const OUT = process.env.SCREENSHOT_DIR || 'artifacts/painel-admin';
fs.mkdirSync(OUT, {recursive:true});

const DEFAULT_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 20000);
const NAVIGATION_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS || 30000);

async function waitText(page, selector, text, timeout = DEFAULT_TIMEOUT_MS) {
  await page.locator(selector).filter({hasText:text}).first().waitFor({state:'visible', timeout});
}

async function collectAdminDiagnostics(page) {
  if (!page || page.isClosed()) return {pageClosed: true};
  try {
    return await page.evaluate(() => {
      const txt = el => (el && el.textContent ? el.textContent.trim() : '');
      const empresas = Array.from(document.querySelectorAll('#admin-empresas .admin-row, #admin-empresas .admin-empty')).map(txt);
      const lojas = Array.from(document.querySelectorAll('#admin-lojas .admin-row, #admin-lojas .admin-empty')).map(txt);
      const supervisores = Array.from(document.querySelectorAll('#admin-supervisores .admin-supervisor')).map(row => ({
        email: row.dataset.supervisorEmail || txt(row.querySelector('small')),
        nome: txt(row.querySelector('strong')),
        chips: Array.from(row.querySelectorAll('.admin-chip')).map(c => ({
          lojaId: c.dataset.lojaId || '',
          texto: txt(c)
        })),
        options: Array.from(row.querySelectorAll('select option')).map(o => ({
          value: o.value,
          label: txt(o)
        }))
      }));
      return {
        url: location.href,
        status: txt(document.getElementById('admin-status')),
        lojasTitulo: txt(document.getElementById('admin-lojas-titulo')),
        buscaEmpresa: document.getElementById('admin-busca-empresa')?.value || '',
        buscaSupervisor: document.getElementById('admin-busca-supervisor')?.value || '',
        empresas,
        lojas,
        supervisoresTexto: txt(document.getElementById('admin-supervisores')),
        supervisores
      };
    });
  } catch (err) {
    return {diagnosticError: err.message};
  }
}

async function login(page, email, password) {
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await page.goto(BASE, {waitUntil:'domcontentloaded', timeout:NAVIGATION_TIMEOUT_MS});
  await page.locator('#in-email').fill(email);
  await page.locator('#in-senha').fill(password);
  await page.locator('#btn-entrar').click();
  await page.locator('#app').waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
}

async function selectCompany(page, name) {
  await page.locator('#admin-busca-empresa').fill(name);
  const row = page.locator('#admin-empresas .admin-row').filter({hasText:name}).first();
  await row.waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
  await row.click();
  await waitText(page, '#admin-lojas-titulo', `Lojas · ${name}`);
  await page.locator('#admin-lojas .admin-row').first().waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
  await page.waitForFunction(() => {
    const box = document.getElementById('admin-supervisores');
    return Boolean(box && !box.textContent.includes('Carregando supervisores'));
  }, {timeout:DEFAULT_TIMEOUT_MS});
}

async function selectAuthorizedStore(page, supervisorEmail, storeId) {
  const row = page.locator('.admin-supervisor').filter({hasText:supervisorEmail}).first();
  await row.waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
  const select = row.locator('select').first();
  await select.waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
  try {
    await select.locator(`option[value="${storeId}"]`).waitFor({state:'attached', timeout:DEFAULT_TIMEOUT_MS});
  } catch (err) {
    const diag = await collectAdminDiagnostics(page);
    throw new Error(
      `Opção de loja autorizada "${storeId}" não encontrada no seletor do supervisor "${supervisorEmail}". ` +
      `Diagnóstico do painel: ${JSON.stringify(diag)}`,
      {cause: err}
    );
  }
  await select.selectOption(storeId);
}

async function closeQuietly(resource) {
  if (!resource) return;
  try { await resource.close(); } catch (_) {}
}

async function main() {
  assert(PLATFORM_EMAIL && PLATFORM_PASSWORD && OPERADOR_EMAIL && OPERADOR_PASSWORD && SUPERVISOR_EMAIL);
  assert(STORE_A && STORE_B);
  const browser = await chromium.launch({headless:true});
  const errors = [];
  let context = null;
  let page = null;
  let deniedContext = null;
  let mobile = null;

  try {
    context = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
    page = await context.newPage();
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if(message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 500) {
        errors.push(`api ${response.status()}: ${response.url()}`);
      }
    });

    await login(page, PLATFORM_EMAIL, PLATFORM_PASSWORD);
    await page.locator('#tab-administracao').waitFor({state:'visible'});
    assert.equal(await page.locator('#tab-administracao').isVisible(), true);
    await page.screenshot({path:`${OUT}/desktop-empresas.png`, fullPage:true});

    await page.locator('#admin-nova-empresa').click();
    await page.locator('#admin-empresa-nome').fill('Empresa Browser Ficticia');
    await page.locator('#admin-empresa-descricao').fill('Cadastro criado no runner descartável');
    await page.locator('#admin-form-empresa button[type="submit"]').click();
    await waitText(page, '#admin-status', 'Alteração confirmada');
    await selectCompany(page, 'Empresa Browser Ficticia');

    await page.locator('#admin-nova-loja').click();
    await page.locator('#admin-loja-nome').fill('Loja Browser Ficticia');
    await page.locator('#admin-loja-descricao').fill('Unidade criada no teste de navegador');
    await page.locator('#admin-form-loja button[type="submit"]').click();
    await waitText(page, '#admin-status', 'Alteração confirmada');

    const lojaNova = page.locator('#admin-lojas .admin-row').filter({hasText:'Loja Browser Ficticia'}).first();
    await lojaNova.waitFor({state:'visible'});
    await lojaNova.click();
    await page.locator('#admin-loja-nome').fill('Loja Browser Editada');
    await page.locator('#admin-form-loja button[type="submit"]').click();
    await waitText(page, '#admin-status', 'Alteração confirmada');
    await page.screenshot({path:`${OUT}/desktop-lojas.png`, fullPage:true});

    await selectCompany(page, 'Empresa Operacional Teste');
    await page.locator('#admin-busca-supervisor').fill(SUPERVISOR_EMAIL);
    await page.locator('.admin-supervisor').filter({hasText:SUPERVISOR_EMAIL}).first().waitFor({state:'visible'});
    await selectAuthorizedStore(page, SUPERVISOR_EMAIL, STORE_A);
    await waitText(page, '#admin-status', 'Alteração confirmada');
    let supervisor = page.locator('.admin-supervisor').filter({hasText:SUPERVISOR_EMAIL}).first();
    await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).waitFor({state:'visible'});

    await selectAuthorizedStore(page, SUPERVISOR_EMAIL, STORE_B);
    await waitText(page, '#admin-status', 'Alteração confirmada');
    supervisor = page.locator('.admin-supervisor').filter({hasText:SUPERVISOR_EMAIL}).first();
    await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).waitFor({state:'visible'});
    await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional B'}).waitFor({state:'visible'});
    await page.screenshot({path:`${OUT}/desktop-supervisores.png`, fullPage:true});

    page.once('dialog', dialog => dialog.accept());
    await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).locator('button').click();
    await waitText(page, '#admin-status', 'Alteração confirmada');
    supervisor = page.locator('.admin-supervisor').filter({hasText:SUPERVISOR_EMAIL}).first();
    await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional B'}).waitFor({state:'visible'});
    assert.equal(await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).count(), 0);
    assert.equal(await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional B'}).count(), 1);

    await page.reload({waitUntil:'domcontentloaded', timeout:NAVIGATION_TIMEOUT_MS});
    await page.locator('#tab-administracao').waitFor({state:'visible'});
    await selectCompany(page, 'Empresa Browser Ficticia');
    await waitText(page, '#admin-lojas', 'Loja Browser Editada');

    /* Troca da autoridade de plataforma para o administrador da empresa antes
       de exercitar escala, parâmetros e publicação. */
    await page.locator('#btn-sair').click();
    await page.locator('#login').waitFor({state:'visible'});
    await login(page, OPERADOR_EMAIL, OPERADOR_PASSWORD);
    await page.locator('#esc-rota').waitFor({state:'visible'});

    /* Escala real: 100 pessoas, 30 dias, jornadas cadastradas e cobertura
       intradiária configurada no fixture. Primeiro prova que uma troca de
       período durante a geração descarta o resultado antigo. */
    await page.locator('#sel-loja option').nth(0).waitFor({state:'attached'});
    await page.locator('#sel-loja').selectOption(STORE_A);
    await page.locator('button[data-view="params"]').click();
    await page.locator('#r-mincaixa-obr').waitFor({state:'visible'});
    assert.equal(await page.locator('#r-mincaixa-obr').inputValue(), '1');
    assert.equal(await page.locator('#tab-faixas tbody tr').count() >= 7, true);
    await page.screenshot({path:`${OUT}/ui-parametros-1440.png`, fullPage:true});
    await page.locator('button[data-view="escala"]').click();
    await page.locator('#esc-rota').waitFor({state:'visible'});
    await page.locator('#p-inicio').fill('2026-12-01');
    await page.locator('#p-fim').fill('2026-12-30');
    await page.locator('#btn-gerar').click();
    await page.locator('#gerando').waitFor({state:'visible', timeout:NAVIGATION_TIMEOUT_MS});
    await page.locator('#esc-passos').waitFor({state:'visible'});
    const progressoDuranteGeracao = await page.locator('#gerando-barra').evaluate(el => el.style.width);
    assert.notEqual(progressoDuranteGeracao, '');
    /* Interação permitida enquanto gera: troca de período. O resultado antigo
       não pode ser aplicado ao novo contexto. */
    await page.locator('#p-fim').fill('2026-12-31');
    await page.locator('#gerando').waitFor({state:'hidden', timeout:120000});
    assert.equal(await page.locator('table.esc').count(), 0);
    await page.locator('#p-fim').fill('2026-12-30');

    /* Geração oficial do período de aproximadamente 30 dias. */
    await page.locator('#btn-gerar').click();
    await page.locator('#gerando').waitFor({state:'visible', timeout:NAVIGATION_TIMEOUT_MS});
    await page.locator('#gerando').waitFor({state:'hidden', timeout:120000});
    await page.waitForFunction(() => Boolean(document.querySelector('table.esc') || document.querySelector('#esc-aviso.erro')), null, {timeout:DEFAULT_TIMEOUT_MS});
    if(await page.locator('table.esc').count() === 0){
      throw new Error('geração não apresentou grade: ' + await page.locator('#esc-aviso').textContent());
    }
    await page.locator('table.esc').waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
    assert.equal(await page.locator('table.esc thead tr.datas th').count() >= 30, true);
    assert.equal(await page.locator('table.esc td.fixa .nome').count(), 100);

    /* Edição e teclado: célula -> setas -> Enter -> diálogo -> Escape retorna
       o foco exatamente para a mesma pessoa e dia. */
    const celula = page.locator('table.esc td.cel[data-cod=""]').first();
    await celula.focus();
    const origem = {id:await celula.getAttribute('data-id'), dia:await celula.getAttribute('data-i')};
    await celula.press('ArrowRight');
    const vizinha = page.locator(`table.esc td.cel[data-id="${origem.id}"][data-i="${Number(origem.dia)+1}"]`);
    assert.equal(await vizinha.evaluate(el => document.activeElement === el), true);
    await vizinha.press('Enter');
    await page.locator('#pop-cel').waitFor({state:'visible'});
    await page.screenshot({path:`${OUT}/ui-dialogo-edicao-1440.png`, fullPage:true});
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => ({id:document.activeElement?.dataset?.id, dia:document.activeElement?.dataset?.i})),
      {id:origem.id, dia:String(Number(origem.dia)+1)});

    /* Reabre a célula, aplica horário explícito, salva e recarrega. */
    await vizinha.press('Enter');
    await page.locator('#pc-hora').fill('08:00');
    await page.locator('#pc-saida').fill('16:20');
    await page.locator('#pc-ok').click();
    await page.locator('#btn-salvar').click();
    await waitText(page, '#esc-aviso', 'Rascunho salvo');
    await page.reload({waitUntil:'domcontentloaded', timeout:NAVIGATION_TIMEOUT_MS});
    await page.locator('#sel-loja').selectOption(STORE_A);
    /* Recarregar volta ao período padrão; abrir o registro salvo pela lista
       exercita a recuperação real, sem gerar uma nova grade. */
    await page.locator('#painel-salvas').waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
    const salvo = page.locator('#lista-salvas .salva').filter({hasText:'01/12'}).first();
    await salvo.waitFor({state:'visible'});
    await salvo.locator('button[data-abrir], button[data-editar]').first().click();
    await page.locator('table.esc').waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
    assert.equal(await page.locator('table.esc td.cel-editada').count() >= 1, true);

    /* Publicação válida pelo fluxo real. */
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-publicar').click();
    await waitText(page, '#esc-aviso', 'Escala publicada');

    /* Agora aumenta explicitamente o piso de caixa para criar uma pendência
       obrigatória controlada. A API aceita o rascunho, mas a publicação é
       bloqueada pela validação da interface antes de ser distribuída. */
    await page.locator('button[data-view="params"]').click();
    await page.locator('#r-mincaixa-obr').fill('99');
    await page.locator('#btn-salvar-params').click();
    await waitText(page, '#status-params', 'Parâmetros salvos');
    await page.locator('button[data-view="escala"]').click();
    await page.locator('#btn-gerar').click();
    await page.locator('#gerando').waitFor({state:'hidden', timeout:120000});
    await page.locator('table.esc').waitFor({state:'visible', timeout:DEFAULT_TIMEOUT_MS});
    await page.locator('#btn-salvar').click();
    await waitText(page, '#esc-aviso', 'Rascunho salvo');
    await page.locator('#btn-publicar').click();
    await waitText(page, '#esc-aviso', 'Publicação bloqueada');
    await page.screenshot({path:`${OUT}/ui-pendencias-1440.png`, fullPage:true});

    /* Capturas da grade preenchida e dos estados reais em quatro larguras. */
    for (const [width, height] of [[1440,1000],[1024,900],[390,844],[320,760]]) {
      await page.setViewportSize({width, height});
      await page.screenshot({path:`${OUT}/ui-grade-${width}.png`, fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});

    deniedContext = await browser.newContext({viewport:{width:1440,height:1000}});
    const deniedPage = await deniedContext.newPage();
    const deniedErrors = [];
    deniedPage.on('pageerror', error => deniedErrors.push(error.message));
    await login(deniedPage, OPERADOR_EMAIL, OPERADOR_PASSWORD);
    assert.equal(await deniedPage.locator('#tab-administracao').isVisible().catch(()=>false), false);
    const denied = await deniedPage.evaluate(async () => {
      const session = await fetch('api/auth.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({acao:'sessao'})});
      const s = await session.json();
      const r = await fetch('api/auth.php', {method:'POST', headers:{'Content-Type':'application/json','X-CSRF':s.csrf}, body:JSON.stringify({acao:'plataforma_listar_empresas'})});
      return {status:r.status, body:await r.json()};
    });
    assert.equal(denied.status, 403);

    /* Editor de cobertura real: não escreve JSON. Adiciona uma faixa pelo
       formulário, salva os parâmetros e recarrega para provar persistência.
       O teste também deixa um campo existente intacto, cobrindo a preservação
       de configurações não editadas no mesmo salvamento. */
    await deniedPage.locator('button[data-view="params"]').click();
    await deniedPage.locator('#fx-dia').waitFor({state:'visible'});
    await deniedPage.locator('#fx-funcao').selectOption('caixa');
    await deniedPage.locator('#fx-ini').fill('08:00');
    await deniedPage.locator('#fx-fim').fill('14:00');
    await deniedPage.locator('#fx-meta').fill('1');
    await deniedPage.locator('#fx-obr').fill('1');
    await deniedPage.locator('#btn-add-faixa').click();
    await deniedPage.locator('#btn-salvar-params').click();
    await waitText(deniedPage, '#status-params', 'Parâmetros salvos');
    await deniedPage.reload({waitUntil:'domcontentloaded', timeout:NAVIGATION_TIMEOUT_MS});
    await deniedPage.locator('button[data-view="params"]').click();
    await deniedPage.locator('#tab-faixas').waitFor({state:'visible'});
    await deniedPage.locator('#tab-faixas').getByText('08:00').waitFor({state:'visible'});
    assert.equal(await deniedPage.locator('#tab-faixas').getByText('Caixa').count() > 0, true);
    await deniedPage.screenshot({path:`${OUT}/ui-parametros-1440.png`, fullPage:true});

    await closeQuietly(deniedContext);
    deniedContext = null;

    mobile = await browser.newContext({viewport:{width:390,height:844}, deviceScaleFactor:1});
    const mobilePage = await mobile.newPage();
    const mobileErrors = [];
    mobilePage.on('pageerror', error => mobileErrors.push(error.message));
    await login(mobilePage, PLATFORM_EMAIL, PLATFORM_PASSWORD);
    await mobilePage.locator('#tab-administracao').waitFor({state:'visible'});
    await selectCompany(mobilePage, 'Empresa Operacional Teste');
    await mobilePage.screenshot({path:`${OUT}/mobile-supervisores.png`, fullPage:true});
    assert.equal(mobileErrors.length, 0);
    await closeQuietly(mobile);
    mobile = null;

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ok:true, screenshots:fs.readdirSync(OUT).sort()}));
  } catch (error) {
    const diag = await collectAdminDiagnostics(page);
    console.error('DIAGNOSTICO_PAINEL_ADMIN:', JSON.stringify({
      error: error.message,
      storeA: STORE_A,
      storeB: STORE_B,
      supervisorEmail: SUPERVISOR_EMAIL,
      browserErrors: errors,
      painel: diag
    }));
    if (page && !page.isClosed()) {
      await page.screenshot({path:`${OUT}/falha-diagnostico.png`, fullPage:true}).catch(() => {});
    }
    throw error;
  } finally {
    await closeQuietly(deniedContext);
    await closeQuietly(mobile);
    await closeQuietly(context);
    await closeQuietly(browser);
  }
}

main().catch(async error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
