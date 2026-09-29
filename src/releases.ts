import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { unzipSync } from 'fflate';
import { Store, digest, version } from './store.js';

export const files = ['umi-cookie-consent.min.js', 'umi-cookie-consent.min.css', 'THIRD_PARTY_NOTICES', 'DOMPURIFY-LICENSE.txt'] as const;
export type Manifest = { schema: 1; version: string; archiveSha256: string; files: {name:string;size:number;sha256:string}[] };
export type Envelope = { manifest: string; signature: string; keyId: string };
export function importRelease(store: Store, release: string, archivePath: string, expectedHash: string, keyPath: string) {
  version(release);
  if (store.envelope(release)) throw new Error('Release is immutable: version already imported');
  const archive = readFileSync(archivePath);
  if (archive.length > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedHash) || digest(archive) !== expectedHash) throw new Error('Archive checksum or size mismatch');
  let total = 0;
  const seen = new Set<string>();
  const entries = unzipSync(archive, { filter(entry) {
    if (seen.has(entry.name) || entry.name.includes('\\') || entry.name.startsWith('/') || entry.name.split('/').includes('..') || !/^(dist\/|examples\/|README\.md$)/.test(entry.name)) throw new Error('Unsafe or duplicate ZIP entry');
    seen.add(entry.name);
    total += entry.originalSize;
    if (entry.originalSize > 5 * 1024 * 1024 || total > 20 * 1024 * 1024 || seen.size > 1000) throw new Error('ZIP limits exceeded');
    return entry.name === 'dist/checksums.sha256' || files.some(name => entry.name === `dist/${name}`);
  }});
  const checksums = Buffer.from(entries['dist/checksums.sha256'] ?? []).toString();
  const manifest: Manifest = {schema:1, version:release, archiveSha256:expectedHash, files:files.map(name => {
    const data = entries[`dist/${name}`];
    if (!data || !data.length) throw new Error(`Missing ${name}`);
    const hash = digest(Buffer.from(data));
    if (!checksums.split('\n').includes(`${hash}  ${name}`)) throw new Error(`Invalid dist checksum: ${name}`);
    if (name.endsWith('.js') || name.endsWith('.css')) {
      if (!Buffer.from(data).toString().startsWith(`/*! umi-cookie-consent v${release} |`)) throw new Error('Version/banner mismatch');
    }
    return {name,size:data.length,sha256:hash};
  })};
  const privateKey = createPrivateKey(readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw new Error('RSA key must be at least 3072 bits');
  const publicPem = createPublicKey(privateKey).export({type:'spki',format:'pem'}).toString();
  const raw = Buffer.from(JSON.stringify(manifest));
  const envelope: Envelope = {manifest:raw.toString('base64'),signature:sign('sha256',raw,privateKey).toString('base64'),keyId:digest(publicPem)};
  const releases = join(store.root,'releases'); mkdirSync(releases,{recursive:true});
  const stage = mkdtempSync(join(releases,'.stage-'));
  const destination = join(releases,release);
  let moved = false;
  try {
    for (const name of files) writeFileSync(join(stage,name),entries[`dist/${name}`],{mode:0o644,flag:'wx'});
    renameSync(stage,destination); moved=true;
    store.db.prepare('INSERT INTO releases(version,envelope) VALUES (?,?)').run(release,JSON.stringify(envelope));
    store.audit('release.import',release);
  } catch (error) { if (moved && !store.envelope(release)) rmSync(destination,{recursive:true,force:true}); throw error; }
  finally { rmSync(stage,{recursive:true,force:true}); }
  return envelope;
}
export function verifyEnvelope(envelope: Envelope, publicPem: string): Manifest {
  const raw = Buffer.from(envelope.manifest,'base64');
  if (envelope.keyId !== digest(publicPem) || !verify('sha256',raw,publicPem,Buffer.from(envelope.signature,'base64'))) throw new Error('Invalid signature');
  return JSON.parse(raw.toString());
}
