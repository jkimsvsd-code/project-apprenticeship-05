import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('protocol/frozen-files.json', 'utf8'));
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  if (actual !== expected) throw new Error('Frozen file changed: ' + file);
}
console.log(`Frozen files verified: ${Object.keys(manifest.files).length}`);
