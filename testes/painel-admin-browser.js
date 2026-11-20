const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8877';
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL;
const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD;
const OPERADOR_EMAIL = process.env.OPERADOR_EMAIL;
const OPERADOR_PASSWORD = process.env.OPERADOR_PASSWORD;
const STORE_A = process.env.STORE_A;
const STORE_B = process.env.STORE_B;
const OUT = process.env.SCREENSHOT_DIR || 'artifacts/painel-admin';
fs.mkdirSync(OUT, {recursive:true});

async function waitText(page, selector, text) {
  await page.locator(selector).filter({hasText:text}).first().waitFor({state:'visible'});
}

async function login(page, email, password) {
  page.setDefaultTimeout(15000);
  await page.goto(BASE, {waitUntil:'domcontentloaded', timeout:30000});
  await page.locator('#in-email').fill(email);
  await page.locator('#in-senha').fill(password);
  await page.locator('#btn-entrar').click();
  await page.locator('#app').waitFor({state:'visible'});
}

async function selectCompany(page, name) {
  await page.locator('#admin-busca-empresa').fill(name);
  const row = page.locator('#admin-empresas .admin-row').filter({hasText:name}).first();
  await row.click();
  await waitText(page, '#admin-lojas-titulo', 'Lojas');
}

async function main() {
  assert(PLATFORM_EMAIL && PLATFORM_PASSWORD && OPERADOR_EMAIL && OPERADOR_PASSWORD);
  assert(STORE_A && STORE_B);
  const browser = await chromium.launch({headless:true});
  const errors = [];
  const context = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if(message.type() === 'error') errors.push(`console: ${message.text()}`); });

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
  await lojaNova.click();
  await page.locator('#admin-loja-nome').fill('Loja Browser Editada');
  await page.locator('#admin-form-loja button[type="submit"]').click();
  await waitText(page, '#admin-status', 'Alteração confirmada');
  await page.screenshot({path:`${OUT}/desktop-lojas.png`, fullPage:true});

  await selectCompany(page, 'Empresa Operacional Teste');
  await page.locator('#admin-busca-supervisor').fill('supervisor@exemplo.test');
  await page.locator('.admin-supervisor').filter({hasText:'supervisor@exemplo.test'}).waitFor({state:'visible'});
  const assign = () => page.locator('.admin-supervisor').filter({hasText:'supervisor@exemplo.test'}).locator('select').first();
  await assign().selectOption(STORE_A);
  await waitText(page, '#admin-status', 'Alteração confirmada');
  await assign().selectOption(STORE_B);
  await waitText(page, '#admin-status', 'Alteração confirmada');
  let supervisor = page.locator('.admin-supervisor').filter({hasText:'supervisor@exemplo.test'});
  await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).waitFor({state:'visible'});
  await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional B'}).waitFor({state:'visible'});
  await page.screenshot({path:`${OUT}/desktop-supervisores.png`, fullPage:true});

  page.once('dialog', dialog => dialog.accept());
  await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).locator('button').click();
  await waitText(page, '#admin-status', 'Alteração confirmada');
  supervisor = page.locator('.admin-supervisor').filter({hasText:'supervisor@exemplo.test'});
  assert.equal(await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional A'}).count(), 0);
  assert.equal(await supervisor.locator('.admin-chip').filter({hasText:'Loja Operacional B'}).count(), 1);

  await page.reload({waitUntil:'domcontentloaded', timeout:30000});
  await page.locator('#tab-administracao').waitFor({state:'visible'});
  await selectCompany(page, 'Empresa Browser Ficticia');
  await waitText(page, '#admin-lojas', 'Loja Browser Editada');

  const deniedContext = await browser.newContext({viewport:{width:1440,height:1000}});
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
  await deniedContext.close();

  const mobile = await browser.newContext({viewport:{width:390,height:844}, deviceScaleFactor:1});
  const mobilePage = await mobile.newPage();
  const mobileErrors = [];
  mobilePage.on('pageerror', error => mobileErrors.push(error.message));
  await login(mobilePage, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  await mobilePage.locator('#tab-administracao').waitFor({state:'visible'});
  await selectCompany(mobilePage, 'Empresa Operacional Teste');
  await mobilePage.screenshot({path:`${OUT}/mobile-supervisores.png`, fullPage:true});
  assert.equal(mobileErrors.length, 0);
  await mobile.close();

  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ok:true, screenshots:fs.readdirSync(OUT).sort()}));
}

main().catch(async error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
