import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  const requests=[];const errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://localhost:8088'?route.continue():route.abort());
  await page.goto('http://localhost:8088');
  await page.waitForFunction(()=>window.UmiConsent?.version==='0.6.0');
  await page.getByRole('button',{name:'Настройки cookies',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.classList.contains('show--preferences'));
  assert.ok(requests.some(url=>url.endsWith('/0.6.0/umi-cookie-consent.min.js')));
  assert.ok(requests.some(url=>url.endsWith('/0.6.0/umi-cookie-consent.min.css')));
  assert.ok(requests.every(url=>new URL(url).origin==='http://localhost:8088'));
  assert.deepEqual(errors,[]);
  console.log('Browser pilot passed: v0.6.0, matching local JS/CSS, preferences open, zero delivery/provider requests.');
} finally {await browser.close();}
