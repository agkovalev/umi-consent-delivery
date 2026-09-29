import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { zipSync } from 'fflate';
import { Store,digest } from '../src/store.js';
import { importRelease,files,verifyEnvelope } from '../src/releases.js';
import { buildApp } from '../src/app.js';

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
