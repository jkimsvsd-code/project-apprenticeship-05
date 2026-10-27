import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
if (existsSync('protocol/frozen-files.json')) throw new Error('Already frozen; do not replace');
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    result.push(...(entry.isDirectory() ? await walk(file) : [file]));
  }
  return result;
}
const files = {};
const paths = [
  ...(await walk('protocol')),
  ...(await walk('tests/acceptance')),
  ...(await walk('tools/integrity')),
  'tools/checks/run-acceptance.mjs',
  'AGENTS.md',
  'package.json',
  'package-lock.json',
];
for (const file of paths.sort())
  files[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const manifest = {
  version: 1,
  frozenAt: new Date().toISOString(),
  sourceBeforeFreeze: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files,
};
await writeFile('protocol/frozen-files.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Freeze prepared: ${paths.length} files. Commit and tag task05-freeze before implementation.`,
);
