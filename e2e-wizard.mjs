import { chromium } from 'playwright';

const BASE = 'http://localhost:5173/';
const SHOT = '/tmp/wizard-e2e.png';

const results = [];
const pass = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.waitForSelector('.wizard-overlay', { timeout: 5000 });
  pass('wizard-overlay rendered', true);

  const title = (await page.textContent('.wizard-title'))?.trim();
  pass('wizard title text', title === '🎯 渐进执行', `got "${title}"`);

  const subtitle = (await page.textContent('.wizard-subtitle'))?.trim();
  pass('wizard subtitle present', /Vault/.test(subtitle || ''), `got "${subtitle}"`);

  const primaryBtn = (await page.textContent('.btn-wizard-primary'))?.trim();
  pass('wizard primary button label', /选择 Vault/.test(primaryBtn || ''), `got "${primaryBtn}"`);

  const settingsBtn = await page.$('.topbar-settings-btn');
  pass('topbar settings button present', !!settingsBtn);

  const mainVisible = await page.isVisible('main');
  pass('main view hidden during wizard', !mainVisible, `isVisible=${mainVisible}`);

  const browserLayoutVisible = await page.isVisible('.browser-layout');
  pass('browser layout hidden during wizard', !browserLayoutVisible, `isVisible=${browserLayoutVisible}`);

  await page.click('.btn-wizard-primary');
  await page.waitForTimeout(500);

  const errorVisible = await page.isVisible('.wizard-error');
  pass('wizard error shown after click (no Tauri)', errorVisible, `isVisible=${errorVisible}`);

  if (errorVisible) {
    const errText = (await page.textContent('.wizard-error'))?.trim();
    pass('wizard error message non-empty', !!errText && errText.length > 0, `got "${errText}"`);
  }

  await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`\n📸 Screenshot: ${SHOT}`);

  pass('no console errors', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.join(' | ') : '');
  pass('no page errors', pageErrors.length === 0,
    pageErrors.length ? pageErrors.join(' | ') : '');

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(r => console.log(`  ✗ ${r.name}  → ${r.detail}`));
    process.exit(1);
  }
})();
