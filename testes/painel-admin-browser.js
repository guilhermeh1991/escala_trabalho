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
    assert.equal(deniedErrors.length, 0);
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
