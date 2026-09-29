import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { clientArchive, packageFiles } from '../scripts/client-archive.js';
import { digest } from '../src/store.js';

test('installer has exact public contents, valid checksums and reproducible bytes', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const archive = clientArchive(root);
  assert.deepEqual(archive.data, clientArchive(root).data);
  const entries = unzipSync(archive.data);
  const paths = Object.keys(entries).map(path => path.slice(archive.name.length + 1)).sort();
  assert.deepEqual(paths, [...Object.keys(packageFiles), 'checksums.sha256'].sort());
  for (const [name, source] of Object.entries(packageFiles)) {
    assert.deepEqual(Buffer.from(entries[`${archive.name}/${name}`]), readFileSync(`${root}/${source}`));
    assert.ok(!/(^|\/)(config\.json|\.local|node_modules)|\.(pem|sqlite|log)$/.test(name));
  }
  const checksums = Buffer.from(entries[`${archive.name}/checksums.sha256`]).toString();
  for (const name of Object.keys(packageFiles)) assert.ok(checksums.includes(`${digest(Buffer.from(entries[`${archive.name}/${name}`]))}  ${name}\n`));
  const config = JSON.parse(Buffer.from(entries[`${archive.name}/config.example.json`]).toString());
  assert.ok(Object.values(config).every(value => typeof value === 'string' && value.includes('REPLACE_')));
  for (const [name, data] of Object.entries(entries)) {
    const contents = Buffer.from(data).toString();
    assert.ok(!contents.includes('-----BEGIN PRIVATE KEY-----'), name);
  }
});
