import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from './store.js';
import { importRelease } from './releases.js';
const [command,...args]=process.argv.slice(2);
let store:Store|undefined;
try {
  if(command==='keygen') {
    if(args.length!==2) throw new Error('keygen PRIVATE.pem PUBLIC.pem');
    const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    writeFileSync(args[0],pair.privateKey,{mode:0o600,flag:'wx'});writeFileSync(args[1],pair.publicKey,{mode:0o644,flag:'wx'});
  } else {
    store=new Store(process.env.DELIVERY_DATA ?? '.local/service');
    switch(command) {
      case 'site-add': if(args.length!==2) throw new Error('site-add ID DOMAIN'); console.log(store.createSite(args[0],args[1]));break;
      case 'site-rotate': if(args.length!==1) throw new Error('site-rotate ID'); console.log(store.rotate(args[0]));break;
      case 'site-revoke': if(args.length!==1) throw new Error('site-revoke ID');store.revoke(args[0]);break;
      case 'approve': if(args.length!==2) throw new Error('approve SITE VERSION');store.approve(args[0],args[1]);break;
      case 'import': if(args.length!==4) throw new Error('import VERSION ZIP SHA256_FILE PRIVATE_KEY');importRelease(store,args[0],args[1],readFileSync(args[2],'utf8').trim().split(/\s+/)[0],args[3]);break;
      case 'sites': console.log(JSON.stringify(store.db.prepare('SELECT id,domain,active,target FROM sites').all(),null,2));break;
      default: throw new Error('Commands: keygen, import, site-add, site-rotate, site-revoke, approve, sites');
    }
  }
} catch(error) {console.error(error instanceof Error?error.message:'Command failed');process.exitCode=1;} finally {store?.close();}
