import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { zipSync } from 'fflate';
import { Store,digest } from '../src/store.js';
import { importRelease,files,verifyEnvelope } from '../src/releases.js';
import { buildApp } from '../src/app.js';
import { backup, restore, verifyBackup } from '../src/backup.js';
import { RequestLimits } from '../src/limits.js';

const keys=generateKeyPairSync('rsa',{modulusLength:3072,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'delivery-test-'));const store=new Store(root);
  const key=join(root,'key.pem');writeFileSync(key,keys.privateKey);
  function archive(version:string,extra:Record<string,Uint8Array>={}) {
    const entries:Record<string,Uint8Array>={};const checks:string[]=[];
    for (const name of files) {
      const data=Buffer.from(name.endsWith('.js')||name.endsWith('.css')?`/*! umi-cookie-consent v${version} | test */`:'notice');
      entries[`dist/${name}`]=data;checks.push(`${digest(data)}  ${name}`);
    }
    entries['dist/checksums.sha256']=Buffer.from(checks.join('\n')+'\n');
    const data=Buffer.from(zipSync({...entries,...extra}));const path=join(root,`${version}.zip`);writeFileSync(path,data);
    return {path,hash:digest(data)};
  }
  return {root,store,key,archive,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
test('authorization, per-site grants, rotation, revocation and immutable bytes',async()=>{
  const f=fixture();const app=buildApp(f.store);
  try {
    const zip=f.archive('0.6.0');const signed=importRelease(f.store,'0.6.0',zip.path,zip.hash,f.key);
    assert.equal(verifyEnvelope(signed,keys.publicKey).version,'0.6.0');
    const a=f.store.createSite('a','a.test');const b=f.store.createSite('b','b.test');f.store.approve('a','0.6.0');
    const get=(url:string,token?:string)=>app.inject({url,headers:token?{authorization:`Bearer ${token}`}:{}});
    const path='/v1/releases/0.6.0/files/umi-cookie-consent.min.js';
    assert.equal((await get(path)).statusCode,401);
    assert.equal((await get('/v1/manifest','0'.repeat(64))).statusCode,401);
    assert.equal((await get(path,b)).statusCode,403);
    assert.equal((await get('/v1/manifest',b)).statusCode,403);
    const response=await get('/v1/manifest',a);assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'private, no-store');
    assert.deepEqual(response.json(),signed);
    assert.equal((await get(path,a)).body,readFileSync(join(f.root,'releases/0.6.0/umi-cookie-consent.min.js'),'utf8'));
    assert.equal((await get('/v1/releases/0.6.0/files/unknown',a)).statusCode,403);
    writeFileSync(join(f.root,'releases/0.6.0/umi-cookie-consent.min.js'),'tampered');assert.equal((await get(path,a)).statusCode,503);
    const rotated=f.store.rotate('a');assert.equal((await get('/v1/manifest',a)).statusCode,401);
    assert.equal((await get('/v1/manifest',rotated)).statusCode,200);
    f.store.revoke('a');assert.equal((await get('/v1/manifest',rotated)).statusCode,401);
  } finally {await app.close();f.close();}
});
test('import rejects corruption, version mismatch, unsafe ZIP, and replacement',()=>{
  const f=fixture();try {
    const zip=f.archive('0.6.0');
    assert.throws(()=>importRelease(f.store,'0.6.0',zip.path,'0'.repeat(64),f.key),/checksum/);
    assert.throws(()=>importRelease(f.store,'0.7.0',zip.path,zip.hash,f.key),/banner/);
    const unsafe=f.archive('0.6.0',{'dist/../evil':Buffer.from('bad')});
    assert.throws(()=>importRelease(f.store,'0.6.0',unsafe.path,unsafe.hash,f.key),/Unsafe/);
    const corrupt=f.archive('0.6.0',{'dist/umi-cookie-consent.min.js':Buffer.from('changed')});
    assert.throws(()=>importRelease(f.store,'0.6.0',corrupt.path,corrupt.hash,f.key),/checksum/);
    const good=f.archive('0.6.0');const envelope=importRelease(f.store,'0.6.0',good.path,good.hash,f.key);
    assert.throws(()=>importRelease(f.store,'0.6.0',good.path,good.hash,f.key),/immutable/);
    assert.throws(()=>verifyEnvelope({...envelope,manifest:Buffer.from('{}').toString('base64')},keys.publicKey),/signature/);
  } finally {f.close();}
});

test('online WAL backup restores grants, rotated/revoked keys and exact release bytes', async () => {
  const f = fixture();
  const work = mkdtempSync(join(tmpdir(), 'delivery-backup-'));
  let restored: Store | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    for (const release of ['0.5.0', '0.6.0']) {
      const archive = f.archive(release);
      importRelease(f.store, release, archive.path, archive.hash, f.key);
    }
    const oldKey = f.store.createSite('active', 'active.test');
    const token = f.store.rotate('active');
    const revoked = f.store.createSite('revoked', 'revoked.test');
    f.store.approve('active', '0.5.0');
    f.store.approve('active', '0.6.0');
    f.store.approve('revoked', '0.6.0');
    f.store.revoke('revoked');
    assert.ok(existsSync(join(f.root, 'delivery.sqlite-wal')));
    const saved = join(work, 'saved');
    assert.deepEqual(await backup(f.root, saved, keys.publicKey), { releases: 2, sites: 2 });
    assert.deepEqual(readdirSync(saved).sort(), ['delivery.sqlite', 'releases', 'snapshot.json']);
    assert.equal(statSync(saved).mode & 0o777, 0o700);
    assert.equal(statSync(join(saved, 'delivery.sqlite')).mode & 0o777, 0o600);
    f.store.createSite('after-snapshot', 'later.test');
    const target = join(work, 'restored');
    await restore(saved, target, keys.publicKey);
    assert.deepEqual(verifyBackup(target, keys.publicKey), { releases: 2, sites: 2 });
    restored = new Store(target); app = buildApp(restored);
    for (const rejected of [oldKey, revoked]) {
      assert.equal((await app.inject({ url: '/v1/manifest', headers: { authorization: `Bearer ${rejected}` } })).statusCode, 401);
    }
    const response = await app.inject({ url: '/v1/manifest', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(verifyEnvelope(response.json(), keys.publicKey).version, '0.6.0');
    for (const release of ['0.5.0', '0.6.0']) {
      const assetResponse: {statusCode:number;rawPayload:Buffer} = await app.inject({ url: `/v1/releases/${release}/files/umi-cookie-consent.min.js`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(assetResponse.statusCode, 200);
      assert.deepEqual(assetResponse.rawPayload, readFileSync(join(f.root, 'releases', release, 'umi-cookie-consent.min.js')));
    }
    assert.deepEqual(restored.db.prepare('SELECT * FROM audit').all(),
      f.store.db.prepare("SELECT * FROM audit WHERE subject != 'after-snapshot'").all());
  } finally { await app?.close(); restored?.close(); f.close(); rmSync(work, { recursive: true, force: true }); }
});

test('backup refuses overwrite, missing/corrupt files, symlinks, bad signatures and damaged snapshots', async () => {
  const f = fixture(); const work = mkdtempSync(join(tmpdir(), 'delivery-backup-negative-'));
  try {
    const archive = f.archive('0.6.0');
    const signed = importRelease(f.store, '0.6.0', archive.path, archive.hash, f.key);
    const saved = join(work, 'saved');
    await backup(f.root, saved, keys.publicKey);
    await assert.rejects(backup(f.root, saved, keys.publicKey), /EEXIST/);
    await assert.rejects(restore(saved, f.root, keys.publicKey), /EEXIST/);
    await assert.rejects(backup(f.root, join(f.root, 'nested'), keys.publicKey), /outside/);
    const asset = join(f.root, 'releases/0.6.0/umi-cookie-consent.min.js');
    const original = readFileSync(asset);
    const failed = join(work, 'failed');
    writeFileSync(asset, 'corrupt');
    await assert.rejects(backup(f.root, failed, keys.publicKey), /integrity/);
    assert.equal(existsSync(failed), false);
    rmSync(asset);
    await assert.rejects(backup(f.root, failed, keys.publicKey), /ENOENT/);
    symlinkSync(f.key, asset);
    await assert.rejects(backup(f.root, failed, keys.publicKey), /file type/);
    rmSync(asset); writeFileSync(asset, original);
    f.store.db.prepare('UPDATE releases SET envelope=?').run(JSON.stringify({ ...signed, signature: Buffer.from('bad').toString('base64') }));
    await assert.rejects(backup(f.root, failed, keys.publicKey), /signature/);
    assert.equal(existsSync(failed), false);
    writeFileSync(join(saved, 'delivery.sqlite'), 'broken');
    await assert.rejects(restore(saved, failed, keys.publicKey), /snapshot/);
    assert.equal(existsSync(failed), false);
  } finally { f.close(); rmSync(work, { recursive: true, force: true }); }
});

test('request limits cover assets and manifest, isolate sites and ignore spoofed forwarding headers', async () => {
  const f = fixture(); let now = 0;
  const app = buildApp(f.store, false, new RequestLimits(() => now, 60_000, 6, 2));
  try {
    const a = f.store.createSite('a', 'a.test'); const b = f.store.createSite('b', 'b.test');
    const get = (token: string, url = '/v1/manifest', ip = '192.0.2.1') => app.inject({ url,
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip } });
    assert.equal((await get(a)).statusCode, 403);
    assert.equal((await get(a, '/v1/releases/0.6.0/files/umi-cookie-consent.min.js')).statusCode, 403);
    const limited = await get(a, '/v1/manifest', '192.0.2.2');
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers['retry-after'], '60');
    assert.equal(limited.headers['cache-control'], 'private, no-store');
    assert.equal((await get(b)).statusCode, 403);
    assert.equal((await get('wrong')).statusCode, 401);
    f.store.revoke('b'); assert.equal((await get(b)).statusCode, 401);
    assert.equal((await get('another-wrong')).statusCode, 429);
    assert.equal((await app.inject('/health')).statusCode, 200);
    now = 60_000;
    assert.equal((await get(a)).statusCode, 403);
    assert.equal((await get('wrong')).statusCode, 401);
  } finally { await app.close(); f.close(); }
});
