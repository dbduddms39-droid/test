// 가상 문서 F01~F11을 분석기에 돌려 '기획상 기대 판정(오라클)'과 '실제 실행 결과'를 나란히 기록한다 (점검 기준 v2.2).
//   npm run report      → 데모 분석기(키워드 규칙, AI 아님)로 실행, docs/test-report-demo.md 작성 (API 호출 없음)
//   npm run eval:live   → Gemini API로 실행 (GEMINI_API_KEY 필요, 실제 API 호출), docs/test-report-live.md 작성
//     -- --samples=F01,F05  처럼 일부 문서만 실행할 수 있다 (무료 사용량 절약)
// - 오라클은 사람이 작성한 기획상 기대값이다. 일치율은 측정값이며 모델 정확도 검증 완료를 뜻하지 않는다.
// - OCR 저신뢰 메타데이터(F05·F08·F11)는 테스트 전제로 명시적으로 넣는다 (자동 OCR 신뢰도 판정 아님).
// - 문서는 모두 가상 문서다. 보고서·로그에는 API 키와 문서 원문(인용 구절)을 남기지 않는다. 세부기준 ID·상태·줄 번호만.
//
// 종료 코드 1: 실제 API 호출이 한 번도 성공하지 못했거나 분석이 오류로 중단된 경우.
//   상태 불일치는 측정값이므로 실패로 처리하지 않는다.
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { analyzeDocument } from '../src/analyze.js';
import { MAIN_STATUS, CRITERIA_VERSION } from '../src/criteria.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { createGeminiAnalyzer } from '../src/ai/gemini.js';
import { FIXTURES, TOP_CODE } from '../test/v22-fixtures.js';

const live = process.argv.includes('--live');
const only = process.argv.find((a) => a.startsWith('--samples='))?.slice('--samples='.length).split(',').filter(Boolean);
const DOCS = only?.length ? FIXTURES.filter((f) => only.includes(f.key)) : FIXTURES;
if (!DOCS.length) {
  console.error(`일치하는 문서가 없어요: ${only.join(', ')} (F01~F11)`);
  process.exit(1);
}
const PAUSE_MS = live ? Number(process.env.EVAL_PAUSE_MS) || 15_000 : 0;
if (live && !process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY 환경변수가 없어요. 키를 등록한 뒤 다시 실행해 주세요.');
  process.exit(1);
}
const baseAI = live ? createGeminiAnalyzer() : createDemoAnalyzer();

const apiCalls = [];
let current = null;
const ai = {
  ...baseAI,
  async analyze(args) {
    const call = { doc: current, n: apiCalls.length + 1, criteria: args.criterionIds.length, retry: Boolean(args.feedback) };
    apiCalls.push(call);
    try {
      const raw = await baseAI.analyze(args);
      call.ok = true;
      return raw;
    } catch (err) {
      Object.assign(call, { ok: false, code: err.code ?? 'unknown_error', httpStatus: err.httpStatus ?? null, providerStatus: err.providerStatus ?? null, providerMessage: err.providerMessage ?? null });
      throw err;
    }
  },
};

const short = (status) => (status ? Object.entries(TOP_CODE).find(([, v]) => v === status)[0] : '-');
const rows = [];
let aborted = null;
for (const [i, f] of DOCS.entries()) {
  if (i > 0 && PAUSE_MS) await sleep(PAUSE_MS);
  current = f.key;
  const logs = [];
  let result;
  try {
    result = await analyzeDocument({ text: f.text, docType: f.docType, ai, lowConfidence: f.lowConfidence ?? [], log: (e) => logs.push(e) });
  } catch (err) {
    aborted = `${f.key}: ${err.code ?? 'error'}`;
    rows.push({ f, error: err.code ?? 'error' });
    console.log(`${f.key} 분석 중단: ${err.code}`);
    continue;
  }
  const actualTop = result.topics.map((t) => (t.visible ? short(t.status) : '-'));
  const topMatch = actualTop.filter((s, k) => s === f.oracle.top[k]).length;
  const detail = Object.entries(f.oracle.detail).map(([id, expected]) => {
    const got = result.topics.find((t) => t.id === id.slice(0, 2)).criteria.find((c) => c.id === id)?.status ?? '(미표시)';
    return { id, expected, got, original: f.originalOracle?.[id] ?? null };
  });
  const done = logs.find((l) => l.event === 'analysis_done');
  rows.push({ f, actualTop, topMatch, detail, held: done?.heldTopics ?? [], diag: done?.diagnostics ?? [] });
  console.log(`${f.key} 상위 ${topMatch}/10, 세부 ${detail.filter((d) => d.got === d.expected).length}/${detail.length}`);
}

const okCalls = apiCalls.filter((c) => c.ok).length;
const ran = rows.filter((r) => !r.error);
const sumTop = ran.reduce((n, r) => n + r.topMatch, 0);
const sumDetail = ran.reduce((n, r) => n + r.detail.filter((d) => d.got === d.expected).length, 0);
const totalDetail = ran.reduce((n, r) => n + r.detail.length, 0);
const lines = [
  `# 점검 기준 ${CRITERIA_VERSION} 실행 보고서 (${live ? `Gemini 실제 호출, 모델 ${baseAI.model}` : '데모 분석기 — AI 아님, 키워드 규칙'})`,
  '',
  `- 실행 시각: ${new Date().toISOString()}`,
  `- 문서: ${DOCS.map((d) => d.key).join(', ')} (모두 가상 문서)`,
  `- API 호출: ${apiCalls.length}회, 성공 ${okCalls}회`,
  '- **기획상 기대 판정(오라클)은 사람이 작성한 값이다. 아래 일치율은 이번 실행의 측정값이며 모델 정확도나 법률 타당성의 검증 완료를 뜻하지 않는다.**',
  '- OCR 저신뢰 메타데이터(F05 `1O0`, F08 `2O`, F11 `1O`)는 테스트 전제로 명시해 넣었다.',
  '- 보고서에는 문서 원문과 인용 구절을 넣지 않는다.',
  '',
  `## 요약: 상위 ${sumTop}/${ran.length * 10}칸 일치, 오라클에 명시된 세부 ${sumDetail}/${totalDetail}칸 일치`,
  '',
  '| 문서 | 기대(오라클) | 실제 실행 | 상위 일치 | 보류·재분석한 항목 |',
  '|---|---|---|---|---|',
  ...rows.map((r) => (r.error ? `| ${r.f.key} | ${r.f.oracle.top.join(' ')} | 분석 중단(${r.error}) | - | - |`
    : `| ${r.f.key} | ${r.f.oracle.top.join(' ')} | ${r.actualTop.join(' ')} | ${r.topMatch}/10 | ${r.held.join(', ') || '없음'} |`)),
  '',
  `상태 약어: ${Object.entries(TOP_CODE).map(([k, v]) => `${k}=${MAIN_STATUS[v]}`).join(', ')}, -=08 미표시`,
  '',
  '## 세부기준 (오라클에 명시된 칸만)',
  '',
  ...ran.flatMap((r) => [
    `### ${r.f.key} ${r.f.title}`,
    '',
    '| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |',
    '|---|---|---|---|---|',
    ...r.detail.map((d) => `| ${d.id} | ${d.expected} | ${d.got} | ${d.got === d.expected ? 'O' : 'X'} | ${d.original ?? ''} |`),
    '',
    r.diag.length ? `진단: ${r.diag.join(', ')}` : '진단: 없음',
    '',
  ]),
  '## API 호출 기록',
  '',
  ...apiCalls.map((c) => (c.ok ? `- 호출 ${c.n} (${c.doc}, 세부기준 ${c.criteria}개${c.retry ? ', 재분석' : ''}): 성공`
    : `- 호출 ${c.n} (${c.doc}, 세부기준 ${c.criteria}개${c.retry ? ', 재분석' : ''}): 실패 — ${c.code}, HTTP ${c.httpStatus ?? '-'}, ${c.providerStatus ?? '-'}${c.providerMessage ? `, "${c.providerMessage}"` : ''}`)),
];
const out = `docs/test-report-${live ? 'live' : 'demo'}.md`;
await mkdir('docs', { recursive: true });
await writeFile(out, `${lines.join('\n')}\n`);
console.log(`\n보고서: ${out}`);
if (okCalls === 0 || aborted) process.exitCode = 1;
