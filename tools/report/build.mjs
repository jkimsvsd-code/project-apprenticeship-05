import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
const root = 'evidence/runs/run-001',
  usage = JSON.parse(await readFile(`${root}/usage.json`, 'utf8'));
const reports = [];
for (const file of await readdir(`${root}/test-runs`))
  reports.push(JSON.parse(await readFile(`${root}/test-runs/${file}`, 'utf8')));
const summary = { generatedAt: new Date().toISOString(), status: 'incomplete', tools: [] };
for (const name of ['A', 'B']) {
  const session = usage[name],
    runs = reports
      .filter((r) => r.phase.startsWith(name) && r.complete)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  summary.tools.push({
    name: `도구 ${name}`,
    started: Boolean(session),
    finished: Boolean(session?.endedAt),
    seconds: session?.endedAt
      ? (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000
      : null,
    requests: session?.requestCount ?? null,
    errorRounds: session ? runs.filter((r) => r.errorRound).length : null,
    passCount: runs.at(-1)?.passed ?? null,
    cases: runs.at(-1)?.cases.map(({ id, status }) => ({ id, status })) ?? [],
  });
}
if (summary.tools.every((t) => t.finished) && summary.tools[1].passCount === 10)
  summary.status = 'tests-complete-publication-pending';
await mkdir('report/data', { recursive: true });
await writeFile('report/data/summary.json', JSON.stringify(summary, null, 2) + '\n');
const escape = (value) =>
  String(value ?? '미기록')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;');
const rows = summary.tools
  .map(
    (t) =>
      `<tr><td>${t.name}</td><td>${t.finished ? '종료' : t.started ? '진행 중' : '시작 전'}</td><td>${escape(t.seconds)}</td><td>${escape(t.requests)}</td><td>${escape(t.errorRounds)}</td><td>${escape(t.passCount)}/10</td></tr>`,
  )
  .join('');
await writeFile(
  'report/index.html',
  `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>과제5 ZIP 기능 인수인계 비교</title><style>body{max-width:960px;margin:48px auto;padding:0 20px;font:16px/1.6 system-ui;color:#17212d}table{border-collapse:collapse;width:100%}th,td{padding:12px;border-bottom:1px solid #ccd3dc;text-align:left}a{color:#3654bd}</style><h1>ZIP 다운로드 기능 인수인계 비교</h1><p>상태: ${escape(summary.status)}. B 검증과 공개 URL 검증을 마친 뒤 최종 제출합니다.</p><table><thead><tr><th>도구</th><th>단계</th><th>시간(초)</th><th>요청</th><th>실패 회차</th><th>통과</th></tr></thead><tbody>${rows}</tbody></table><p>실패 회차는 고정 검사 10개 중 하나 이상 FAIL이 나온 실행입니다. 준비 실행은 제외합니다. 재작업량은 수기 산출하지 않습니다.</p><h2>빠른 확인</h2><ol><li>편집기 저장 → 전체 자료 ZIP 다운로드를 엽니다.</li><li>버튼을 눌러 ZIP을 받습니다.</li><li>ZIP 목록과 현재 카드·템플릿·원본 파일을 확인합니다.</li></ol><p>통과: 모든 자료와 올바른 해시가 포함된 ZIP 1개. 실패: 원인을 알리고 기존 자료를 보존하며 다운로드하지 않습니다.</p><p>현재 미완료 항목과 근거는 저장소의 고정 검사 결과 및 인수인계를 확인하세요.</p></html>`,
);
console.log('report/index.html 및 익명 summary.json 생성');
