import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) throw new Error('Set SITE_URL to the authorized test site');
const origin = new URL(siteUrl).origin;
const expectedVersion = process.env.EXPECTED_VERSION ?? '0.6.0';
const deliveryOrigin = 'https://umi-consent-delivery.cloudpub.ru';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  // Observe attempted third-party traffic without contacting providers.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  const response = await page.goto(siteUrl, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(version => window.UmiConsent?.version === version, expectedVersion);
  const assetBase = `${origin}/assets/umi-consent/${expectedVersion}/`;
  for (const name of ['umi-cookie-consent.min.js', 'umi-cookie-consent.min.css']) {
    assert.equal(requests.filter(url => url === assetBase + name).length, 1, name);
    const asset = await page.request.get(assetBase + name);
    assert.equal(asset.status(), 200);
    assert.ok((await asset.text()).startsWith(`/*! umi-cookie-consent v${expectedVersion} |`));
  }
  await page.evaluate(() => window.UmiConsent.showPreferences());
  await page.waitForFunction(() => document.documentElement.classList.contains('show--preferences'));
  await page.evaluate(() => window.UmiConsent.rejectAll());
  await page.waitForFunction(() => document.cookie.includes('umi_consent='));
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'umi_consent');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(version => window.UmiConsent?.version === version, expectedVersion);
  assert.equal((await page.context().cookies()).find(cookie => cookie.name === 'umi_consent')?.value, cookie.value);
  assert.ok(!requests.some(url => new URL(url).origin === deliveryOrigin), 'Browser must not call delivery API');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ site: origin, version: expectedVersion, localAssets: true, preferences: true, persistence: true, attemptedExternalOrigins: [...new Set(requests.filter(url => new URL(url).origin !== origin).map(url => new URL(url).origin))] }));
} finally {
  await browser.close();
}
