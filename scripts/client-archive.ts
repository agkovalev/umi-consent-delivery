import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import { digest } from '../src/store.js';

// Explicit allowlist: never traverse the workspace or include site credentials.
export const packageFiles = {
  'update.php': 'client/update.php',
  'updater.php': 'client/updater.php',
  'asset-urls.php': 'client/asset-urls.php',
  'doctor.php': 'client/doctor.php',
  'config.example.json': 'client/config.example.json',
  'START-HERE.md': 'START-HERE.md',
  'docs/INTEGRATOR.md': 'docs/INTEGRATOR.md',
  'docs/OPERATOR.md': 'docs/OPERATOR.md',
  'docs/OPERATIONS.md': 'docs/OPERATIONS.md',
};
export function clientArchive(root: string) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid client package version');
  const name = `umi-consent-delivery-client-v${version}`;
  const data: Record<string, Buffer> = {};
  for (const [target, source] of Object.entries(packageFiles)) data[target] = readFileSync(join(root, source));
  data['checksums.sha256'] = Buffer.from(Object.keys(data).sort().map(path => `${digest(data[path])}  ${path}\n`).join(''));
  const entries: Zippable = {};
  for (const path of Object.keys(data).sort()) {
    entries[`${name}/${path}`] = [data[path], { mtime: new Date(2020, 0, 1), os: 3, attrs: 0o100644 * 65536 }];
  }
  return { name, data: Buffer.from(zipSync(entries, { level: 9 })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const archive = clientArchive(root);
  const destination = join(root, 'release'); mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, `${archive.name}.zip`), archive.data);
  writeFileSync(join(destination, `${archive.name}.zip.sha256`), `${digest(archive.data)}  ${archive.name}.zip\n`);
  console.log(`release/${archive.name}.zip\nSHA-256 ${digest(archive.data)}`);
}
