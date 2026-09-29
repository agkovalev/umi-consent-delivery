import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const versionPattern = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
export function version(value: string) {
  if (!versionPattern.test(value) || value.split('.').some(x => String(Number(x)) !== x || !Number.isSafeInteger(Number(x)))) throw new Error('Invalid version');
  return value;
}
export class Store {
  db: Database.Database;
  root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.db = new Database(resolve(this.root, 'delivery.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    // Schema v1: additive migrations must preserve grants and immutable releases.
    this.db.exec(`CREATE TABLE IF NOT EXISTS releases(version TEXT PRIMARY KEY, envelope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, domain TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1, target TEXT REFERENCES releases(version));
      CREATE TABLE IF NOT EXISTS grants(site TEXT REFERENCES sites(id), version TEXT REFERENCES releases(version), PRIMARY KEY(site,version));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, action TEXT NOT NULL, subject TEXT NOT NULL);
      PRAGMA user_version = 1;`);
  }
  audit(action: string, subject: string) { this.db.prepare('INSERT INTO audit(action,subject) VALUES (?,?)').run(action, subject); }
  createSite(id: string, domain: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !/^[a-z0-9.-]+$/.test(domain) || domain.includes('..')) throw new Error('Invalid site id or domain');
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sites(id,domain,token_hash) VALUES (?,?,?)').run(id, domain, digest(token));
    this.audit('site.create', id);
    return token;
  }
  rotate(id: string) {
    const token = randomBytes(32).toString('hex');
    if (!this.db.prepare('UPDATE sites SET token_hash=?, active=1 WHERE id=?').run(digest(token), id).changes) throw new Error('Unknown site');
    this.audit('site.rotate', id); return token;
  }
  revoke(id: string) {
    if (!this.db.prepare('UPDATE sites SET active=0 WHERE id=?').run(id).changes) throw new Error('Unknown site');
    this.audit('site.revoke', id);
  }
  approve(id: string, release: string) {
    version(release);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO grants(site,version) VALUES (?,?)').run(id, release);
      if (!this.db.prepare('UPDATE sites SET target=? WHERE id=?').run(release, id).changes) throw new Error('Unknown site');
      this.audit('release.approve', `${id}:${release}`);
    })();
  }
  authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
    return this.db.prepare('SELECT id,target FROM sites WHERE token_hash=? AND active=1').get(digest(token)) as {id:string;target:string|null}|undefined;
  }
  allowed(site: string, release: string) { return !!this.db.prepare('SELECT 1 FROM grants WHERE site=? AND version=?').get(site, release); }
  envelope(release: string) { return (this.db.prepare('SELECT envelope FROM releases WHERE version=?').get(release) as {envelope:string}|undefined)?.envelope; }
  close() { this.db.close(); }
}
