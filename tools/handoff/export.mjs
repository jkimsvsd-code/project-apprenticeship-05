import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
execFileSync(process.execPath, ['tools/integrity/verify.mjs'], { stdio: 'inherit' });
const source = execFileSync('git', ['rev-parse', 'task05-A-end'], { encoding: 'utf8' }).trim();
if (source !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
  throw new Error('Checkout must be task05-A-end');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Working tree must be clean before packaging');
const dir = path.resolve('.local/handoff/run-001');
await mkdir(dir, { recursive: true });
const handoff = await readFile('handoff/runs/run-001/A-to-B.md');
await writeFile(path.join(dir, 'A-to-B.md'), handoff);
execFileSync('git', ['bundle', 'create', path.join(dir, 'repository.bundle'), '--all']);
const hash = (b) => createHash('sha256').update(b).digest('hex');
await writeFile(
  path.join(dir, 'delivery.json'),
  JSON.stringify(
    {
      status: 'prepared-not-delivered',
      source,
      handoffSha256: hash(handoff),
      bundleSha256: hash(await readFile(path.join(dir, 'repository.bundle'))),
      receiverVerified: false,
      instruction:
        'Clone repository.bundle; verify task05-freeze and handoff hash. Use a different AI service/model in a new conversation. Do not provide previous chat.',
    },
    null,
    2,
  ) + '\n',
);
console.log('B 전달 준비: .local/handoff/run-001 (아직 실제 전달/수신 증거가 아님)');
