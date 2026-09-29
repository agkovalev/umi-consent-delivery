import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { digest } from '../build/src/store.js';
import { files } from '../build/src/releases.js';

const root = resolve('.');
mkdirSync(join(root, '.local'), { recursive: true });
const work = mkdtempSync(join(root, '.local/installer-e2e-'));
const serverName = `delivery-installer-test-${randomBytes(6).toString('hex')}`;
const phpImage = process.env.PHP_TEST_IMAGE ?? 'umi-consent-delivery-site';
const serverImage = process.env.DELIVERY_TEST_IMAGE ?? 'umi-consent-delivery-delivery';
let started = false;
function run(command, args, expected = 0, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  // Do not include captured output: operator commands can return a site token.
  const diagnostic = args.includes('/app/client/doctor.php') ? result.stdout.replace(/[a-f0-9]{64}/gi, '[redacted]') : '';
  assert.equal(result.status, expected, `${command}: unexpected exit status ${diagnostic}`);
  return result.stdout;
}
try {
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'))).version;
  const zip = readFileSync(join(root, `release/umi-consent-delivery-client-v${packageVersion}.zip`));
  const expected = readFileSync(join(root, `release/umi-consent-delivery-client-v${packageVersion}.zip.sha256`), 'utf8').split(/\s/)[0];
  assert.equal(digest(zip), expected);
  const unpacked = join(work, 'package'); mkdirSync(unpacked);
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const target = join(unpacked, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data);
  }
  const clientDir = join(unpacked, `umi-consent-delivery-client-v${packageVersion}`);
  const dataDir = join(work, 'service');
  const clientState = join(work, 'site'); mkdirSync(clientState);
  mkdirSync(join(clientState, 'state')); mkdirSync(join(clientState, 'public'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const keyPath = join(work, 'private.pem'); writeFileSync(keyPath, keys.privateKey, { mode: 0o600 });
  writeFileSync(join(clientState, 'public.pem'), keys.publicKey);
  const entries = {}; const checks = [];
  for (const name of files) {
    const bytes = Buffer.from(`/*! umi-cookie-consent v0.6.0 | installer fixture */\n`);
    entries[`dist/${name}`] = bytes; checks.push(`${digest(bytes)}  ${name}`);
  }
  entries['dist/checksums.sha256'] = Buffer.from(checks.join('\n') + '\n');
  const archive = Buffer.from(zipSync(entries)); const releasePath = join(work, 'release.zip');
  writeFileSync(releasePath, archive); writeFileSync(`${releasePath}.sha256`, digest(archive));
  const admin = (...args) => started
    ? run('docker', ['exec', serverName, 'node', 'build/src/cli.js', ...args]).trim()
    : run(process.execPath, [join(root, 'build/src/cli.js'), ...args], 0, { env: { ...process.env, DELIVERY_DATA: dataDir } }).trim();
  admin('import', '0.6.0', releasePath, `${releasePath}.sha256`, keyPath);
  let token = admin('site-add', 'installer-test', 'installer.test');
  const config = { baseUrl: 'http://127.0.0.1:3100', token, publicKey: '/fixture/public.pem', stateDir: '/fixture/state', assetDir: '/fixture/public/assets' };
  const saveConfig = () => writeFileSync(join(clientState, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  saveConfig();
  run('docker', ['run', '-d', '--rm', '--name', serverName, '--network', 'none', '-v', `${dataDir}:/data`, serverImage]); started = true;
  const php = (args, expected = 0) => run('docker', ['run', '--rm', '--network', `container:${serverName}`, '--entrypoint', 'php',
    '-v', `${clientDir}:/app/client:ro`, '-v', `${clientState}:/fixture`, phpImage, ...args], expected);
  let ready = false;
  for (let n = 0; n < 30; n++) {
    const result = spawnSync('docker', ['exec', serverName, 'node', '-e', "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Temporary server ready');
  const doctor = ['/app/client/doctor.php', '/fixture/config.json', '--online', '--web-root', '/fixture/public'];
  assert.ok(php(doctor, 1).includes('403'));
  admin('approve', 'installer-test', '0.6.0');
  assert.ok(php(doctor).includes('0.6.0'));
  const update = ['/app/client/update.php', '/fixture/config.json'];
  assert.ok(php([...update, 'install']).includes('installed'));
  assert.ok(php([...update, 'activate', '0.6.0']).includes('Active: 0.6.0'));
  token = admin('site-rotate', 'installer-test');
  assert.ok(php(doctor, 1).includes('401'));
  config.token = token; saveConfig(); assert.ok(php(doctor).includes('0.6.0'));
  admin('site-revoke', 'installer-test'); assert.ok(php(doctor, 1).includes('401'));
  assert.equal(readFileSync(join(clientState, 'state/active-version'), 'utf8'), '0.6.0');
  assert.ok(php([...update, 'rollback', '0.6.0']).includes('Active: 0.6.0'));
  console.log('Installer ZIP E2E passed: key issuance, grant, doctor, install, activate, rotation and revocation; active files preserved.');
} finally {
  if (started) spawnSync('docker', ['rm', '-f', serverName], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
}
