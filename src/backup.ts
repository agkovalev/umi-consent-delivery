import Database from 'better-sqlite3';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { digest, version } from './store.js';
import { files, verifyEnvelope, type Manifest } from './releases.js';

const maxDatabase = 256 * 1024 * 1024;
function regular(path: string, maxSize: number) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maxSize) throw new Error('Invalid backup file type or size');
  return readFileSync(path);
}
function directory(path: string) {
  if (!lstatSync(path).isDirectory()) throw new Error('Expected a real directory');
}
function database(root: string) {
  regular(join(root, 'delivery.sqlite'), maxDatabase);
  return new Database(join(root, 'delivery.sqlite'), { readonly: true, fileMustExist: true });
}
function inventory(db: Database.Database, publicPem: string) {
  if (db.pragma('user_version', { simple: true }) !== 1 ||
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('Database integrity/schema failure');
  const releases = db.prepare('SELECT version,envelope FROM releases ORDER BY version').all() as {version:string;envelope:string}[];
  return releases.map(row => {
    version(row.version);
    if (row.envelope.length > 128 * 1024) throw new Error('Oversized envelope');
    const manifest: Manifest = verifyEnvelope(JSON.parse(row.envelope), publicPem);
    if (manifest.schema !== 1 || manifest.version !== row.version || !Array.isArray(manifest.files) ||
        manifest.files.length !== files.length || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) throw new Error('Invalid manifest');
    const names = new Set<string>();
    for (const file of manifest.files) {
      if (!files.includes(file.name as typeof files[number]) || names.has(file.name) ||
          !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 5 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid manifest file');
      names.add(file.name);
    }
    return manifest;
  });
}
function releaseFiles(root: string, manifests: Manifest[], destination?: string) {
  if (manifests.length) directory(join(root, 'releases'));
  for (const manifest of manifests) {
    directory(join(root, 'releases', manifest.version));
    if (destination) mkdirSync(join(destination, 'releases', manifest.version), { recursive: true, mode: 0o700 });
    for (const file of manifest.files) {
      const data = regular(join(root, 'releases', manifest.version, file.name), 5 * 1024 * 1024);
      if (data.length !== file.size || digest(data) !== file.sha256) throw new Error('Release integrity failure');
      if (destination) writeFileSync(join(destination, 'releases', manifest.version, file.name), data, { flag: 'wx', mode: 0o600 });
    }
  }
}

/** A completed backup contains no signing key, raw site token or unregistered file. */
export function verifyBackup(root: string, publicPem: string) {
  directory(root);
  const marker = JSON.parse(regular(join(root, 'snapshot.json'), 4096).toString());
  if (marker.schema !== 1 || marker.databaseSha256 !== digest(regular(join(root, 'delivery.sqlite'), maxDatabase))) {
    throw new Error('Incomplete or damaged snapshot');
  }
  const db = database(root);
  try {
    const manifests = inventory(db, publicPem);
    releaseFiles(root, manifests);
    return { releases: manifests.length, sites: (db.prepare('SELECT count(*) AS count FROM sites').get() as {count:number}).count };
  } finally { db.close(); }
}

/** Snapshot the WAL database first, then copy immutable files named by that snapshot. */
export async function backup(source: string, destination: string, publicPem: string) {
  const sourceRoot = realpathSync(source);
  const target = join(realpathSync(dirname(resolve(destination))), resolve(destination).split(sep).at(-1)!);
  const rel = relative(sourceRoot, target);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))) throw new Error('Backup must be outside source data');
  const sourceDb = database(sourceRoot);
  let created = false;
  try {
    // mkdir is exclusive: never overwrite an existing directory, even an empty one.
    mkdirSync(target, { mode: 0o700 }); created = true;
    await sourceDb.backup(join(target, 'delivery.sqlite'));
    chmodSync(join(target, 'delivery.sqlite'), 0o600);
    const snapshot = new Database(join(target, 'delivery.sqlite'), { fileMustExist: true });
    let manifests: Manifest[];
    try {
      snapshot.pragma('journal_mode = DELETE');
      manifests = inventory(snapshot, publicPem);
    } finally { snapshot.close(); }
    releaseFiles(sourceRoot, manifests, target);
    writeFileSync(join(target, 'snapshot.json'), JSON.stringify({ schema: 1, createdAt: new Date().toISOString(),
      databaseSha256: digest(regular(join(target, 'delivery.sqlite'), maxDatabase)) }) + '\n', { flag: 'wx', mode: 0o600 });
    return verifyBackup(target, publicPem);
  } catch (error) {
    if (created) rmSync(target, { recursive: true, force: true });
    throw error;
  } finally { sourceDb.close(); }
}

export async function restore(source: string, destination: string, publicPem: string) {
  verifyBackup(source, publicPem);
  return backup(source, destination, publicPem);
}
