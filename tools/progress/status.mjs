import { readFile, readdir } from 'node:fs/promises';
const root = 'evidence/runs/run-001';
const usage = JSON.parse(await readFile(`${root}/usage.json`, 'utf8'));
for (const name of ['A', 'B']) {
  const session = usage[name];
  if (!session) {
    console.log(`${name}: 시작 전`);
    continue;
  }
  const end = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  const seconds = (end - Date.parse(session.startedAt)) / 1000;
  console.log(
    `${name}: ${session.endedAt ? '종료' : '진행 중'}, ${seconds.toFixed(1)}/3600초, ${session.requestCount}/12요청`,
  );
}
const reports = [];
for (const file of await readdir(`${root}/test-runs`)) {
  const report = JSON.parse(await readFile(`${root}/test-runs/${file}`, 'utf8'));
  if (report.phase.startsWith('A') && report.complete) reports.push(report);
}
reports.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const last = reports.at(-1);
if (last) {
  console.log(`최신 A: ${last.passed}/10 PASS`);
  for (const row of last.cases.filter((c) => c.status === 'FAIL'))
    console.log(`다음 작업 ${row.id}: ${row.expected}`);
}
console.log('B는 다른 모델/서비스의 새 대화에서 저장소·원본 인수인계만 받아야 합니다.');
