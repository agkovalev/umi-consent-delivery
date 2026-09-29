import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const siteUrl = process.env.SITE_URL ?? 'http://localhost:8081/';
const origin = new URL(siteUrl).origin;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const external = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  // Count attempts even though tests prevent transmission to third parties.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const check = async label => {
    await page.waitForFunction(() => window.UmiConsent?.version === '0.6.0');
    // Legacy widgets include delayed injections; observe beyond their timers.
    await page.waitForTimeout(2500);
    assert.deepEqual(external, [], `${label}: unexpected external request`);
    assert.deepEqual(errors, [], `${label}: JavaScript errors`);
    assert.equal(await page.locator('#uLogin, .ya-share2').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.uLogin), 'undefined');
    assert.equal(await page.locator('script[src="compiled/demomarket.consent.lib.js"]').count(), 1);
    assert.equal(await page.evaluate(() => typeof window.jQuery.fn.modal), 'function');
    assert.equal(await page.evaluate(() => typeof window.jQuery.fn.slick), 'function');
  };
  assert.equal((await page.goto(siteUrl, { waitUntil: 'networkidle' })).status(), 200);
  await check('before consent');
  await page.evaluate(() => window.UmiConsent.rejectAll());
  await page.waitForFunction(() => document.cookie.includes('umi_consent='));
  await page.reload({ waitUntil: 'networkidle' });
  await check('saved rejection');
  await page.evaluate(() => window.jQuery('#logModal').modal('show'));
  await page.locator('#login_form input[name="login"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#login_form input[name="password"]').isVisible(), true);
  assert.equal(await page.locator('#logModal a.blue_link').isVisible(), true);
  await page.evaluate(() => window.jQuery('#logModal').modal('hide'));
  await page.evaluate(() => window.UmiConsent.acceptAll());
  await check('accept all');
  await page.reload({ waitUntil: 'networkidle' });
  await check('saved acceptance');
  await page.evaluate(() => window.UmiConsent.rejectAll());
  await page.reload({ waitUntil: 'networkidle' });
  await check('withdrawal');
  console.log(JSON.stringify({ site: origin, externalAttempts: external.length,
    stages: ['before consent', 'rejection', 'acceptance', 'saved acceptance', 'withdrawal'],
    passwordLoginForm: true, registrationLink: true, legacyWidgetsDisabled: true }));
} finally {
  await browser.close();
}
