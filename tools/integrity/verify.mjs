import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const trusted = execFileSync('git', ['show', 'task05-freeze:protocol/frozen-files.json']);
if (!trusted.equals(await readFile('protocol/frozen-files.json')))
  throw new Error('Freeze manifest differs from task05-freeze commit');
const manifest = JSON.parse(await readFile('protocol/frozen-files.json', 'utf8'));
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  if (actual !== expected) throw new Error('Frozen file changed: ' + file);
}
console.log(`Frozen files verified: ${Object.keys(manifest.files).length}`);
