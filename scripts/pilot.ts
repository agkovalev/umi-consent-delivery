import { mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { Store } from '../src/store.js';
import { importRelease } from '../src/releases.js';
// Explicit operator command. Never print the installation credential.
const releaseDir=resolve(process.argv[2] ?? '../umi-cookie-consent/release');
const local=resolve('.local'); const privateDir=resolve(local,'pilot/private');
mkdirSync(privateDir,{recursive:true,mode:0o700});
mkdirSync(resolve(local,'pilot/public/assets/umi-consent'),{recursive:true});
mkdirSync(resolve(local,'offline'),{recursive:true,mode:0o700});
const privateKey=resolve(local,'offline/signing.pem');const publicKey=resolve(privateDir,'public.pem');
if (!existsSync(privateKey)) {
  const pair=generateKeyPairSync('rsa',{modulusLength:3072,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
  writeFileSync(privateKey,pair.privateKey,{mode:0o600,flag:'wx'});writeFileSync(publicKey,pair.publicKey,{flag:'wx'});
}
const store=new Store(resolve(local,'service'));
try {
  for (const version of ['0.5.0','0.6.0']) {
    if(!store.envelope(version)) {
      const zip=resolve(releaseDir,`umi-cookie-consent-v${version}.zip`);
      importRelease(store,version,zip,readFileSync(`${zip}.sha256`,'utf8').trim().split(/\s+/)[0],privateKey);
    }
  }
  const configFile=resolve(privateDir,'config.json');
  if (!existsSync(configFile)) {
    const token=store.createSite('pilot','pilot.local');
    writeFileSync(configFile,JSON.stringify({baseUrl:'http://127.0.0.1:3100',token,publicKey:'/pilot/private/public.pem',stateDir:'/pilot/private',assetDir:'/pilot/public/assets/umi-consent'},null,2),{mode:0o600,flag:'wx'});
  }
  store.approve('pilot','0.6.0');
  copyFileSync('pilot/public/index.php',resolve(local,'pilot/public/index.php'));
  console.log('Pilot prepared. Credentials are in .local/pilot/private/config.json; signing key is outside all Docker mounts.');
} finally {store.close();}
