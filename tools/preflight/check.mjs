import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
execFileSync(process.execPath, ['tools/integrity/verify.mjs'], { stdio: 'inherit' });
const required = [
  'protocol/acceptance-cases.json',
  'evidence/runs/run-001/usage.json',
  'handoff/runs/run-001/A-to-B.md',
  'report/index.html',
  'docs/quick-check.md',
  'evidence/runs/run-001/publication-check.json',
  'handoff/runs/run-001/B-received.md',
];
let incomplete = false;
for (const file of required) {
  const ready = existsSync(file);
  console.log(`${ready ? 'OK' : 'MISSING'} ${file}`);
  if (!ready) incomplete = true;
}
const usage = JSON.parse(readFileSync('evidence/runs/run-001/usage.json', 'utf8'));
if (!usage.B?.endedAt) {
  console.log('PENDING B 완료 및 최종 검사 10개');
  incomplete = true;
}
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const file of tracked.filter((f) =>
  /\.(md|json|[cm]?js|tsx?|html|ya?ml|py|example)$/.test(f),
)) {
  const text = readFileSync(file, 'utf8');
  if (
    /sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
      text,
    )
  ) {
    console.log(`REVIEW potential secret: ${file}`);
    incomplete = true;
  }
}
console.log('자동 비밀값 검사는 알려진 패턴만 탐지하며 최종 수동 검수를 대체하지 않습니다.');
console.log(
  '수동 확인 필요: B 새 대화/다른 모델·서비스, 본인 판단, 원본 전달 동일성, 개인정보 검수, 결과물/소스 URL의 시크릿 창 접근.',
);
if (incomplete) process.exitCode = 1;
