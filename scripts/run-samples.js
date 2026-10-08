// 테스트 샘플을 분석기에 돌려 기대 상태·실제 상태·근거 번호 정확성을 기록한다.
//   npm run report      → 데모 분석기(키워드 규칙)로 실행, docs/test-report-demo.md 작성
//   npm run eval:live   → Gemini API로 실행 (GEMINI_API_KEY 필요), docs/test-report-live.md 작성
//     -- --samples=S1_clear,X3_intern_word  처럼 일부 샘플만 실행할 수 있다 (무료 사용량 절약)
// 샘플 문서는 모두 가상 문서다. 실제 개인정보가 담긴 문서를 넣지 않는다.
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { analyzeDocument } from '../src/analyze.js';
import { scoreSample, summarize } from '../src/eval/score.js';
import { ITEM_BY_ID } from '../src/items.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { createGeminiAnalyzer } from '../src/ai/gemini.js';
import { SAMPLES as ALL_SAMPLES } from '../test/samples.js';

const live = process.argv.includes('--live');
const only = process.argv.find((a) => a.startsWith('--samples='))?.slice('--samples='.length).split(',');
const SAMPLES = only ? ALL_SAMPLES.filter((s) => only.includes(s.key)) : ALL_SAMPLES;
if (!SAMPLES.length) {
  console.error(`일치하는 샘플이 없어요: ${only.join(', ')}`);
  process.exit(1);
}
// 무료 등급 분당 요청 한도를 넘지 않도록 실제 API 실행 시 샘플 사이에 쉰다.
const PAUSE_MS = live ? Number(process.env.EVAL_PAUSE_MS) || 15_000 : 0;
if (live && !process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY 환경변수가 없어요. 키를 등록한 뒤 다시 실행해 주세요.');
  process.exit(1);
}
const baseAI = live ? createGeminiAnalyzer() : createDemoAnalyzer();
// AI가 돌려준 원본 JSON을 기록한다 (항목 ID·코드·번호만 있고 문서 원문은 없다).
let rawResponses = [];
const ai = {
  ...baseAI,
  async analyze(args) {
    const raw = await baseAI.analyze(args);
    rawResponses.push(raw);
    return raw;
  },
};
const apiErrors = [];
let callFailure = null;
const log = (e) => { if (e.event === 'analysis_done' && Object.keys(e.firstPassErrors).length) apiErrors.push(e); };
const out = `docs/test-report-${live ? 'live' : 'demo'}.md`;

const STATUS_KO = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가', hidden: '(숨김)' };
const fmtIds = (ids) => (ids.length ? ids.join(',') : '-');

const allRows = [];
const sections = [];
for (const [i, sample] of SAMPLES.entries()) {
  if (i > 0 && PAUSE_MS) await sleep(PAUSE_MS);
  let result;
  rawResponses = [];
  try {
    result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai, log });
  } catch (err) {
    // 오류 코드만 남긴다 (키·원문이 섞일 수 있는 원본 메시지는 출력하지 않음)
    callFailure = `${sample.key}: ${err.code ?? 'unknown_error'}`;
    console.error(`${sample.key}: AI 호출 실패 (${err.code ?? 'unknown_error'}) — 중단합니다.`);
    process.exitCode = 1;
    break;
  }
  const rows = scoreSample(sample, result);
  allRows.push(...rows);
  const lines = [
    `### ${sample.key} — ${sample.title} (${result.docTypeLabel})`,
    '',
    '| 항목 | 기대 상태 | 실제 상태 | 일치 | 기대 근거 | 실제 근거 | 근거 정확성 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${ITEM_BY_ID[r.item].label} | ${STATUS_KO[r.expectedStatus]} | ${STATUS_KO[r.actualStatus]} | ${r.statusMatch ? '✓' : '✗'} | ${fmtIds(r.expectedIds)} | ${fmtIds(r.actualIds)} | ${r.evidence}${r.falseNotFound ? ' (잘못된 not_found)' : ''} |`),
    '',
  ];
  if (live) {
    lines.push('<details><summary>AI 원본 응답 JSON</summary>', '', '```json', ...rawResponses.map((r) => JSON.stringify(r, null, 1)), '```', '</details>', '');
  }
  sections.push(lines.join('\n'));
  console.log(`${sample.key}: 상태 일치 ${rows.filter((r) => r.statusMatch).length}/${rows.length}`);
}

const s = summarize(allRows);
const header = [
  `# 샘플 테스트 결과 — ${live ? `실제 AI 분석: Gemini API (${ai.model})` : '데모 분석기 (키워드 규칙, AI 아님)'}`,
  '',
  `- 실행 시각: ${new Date().toISOString()}`,
  `- 분석기: ${ai.name}${live ? ` / ${ai.model}` : ''}`,
  `- 샘플: ${SAMPLES.map((x) => x.key).join(', ')} (모두 가상 문서)`,
  `- AI 호출 실패: ${callFailure ?? '없음'}`,
  `- 1차 응답 검증 실패(재분석 발생): ${apiErrors.length ? apiErrors.map((e) => JSON.stringify(e.firstPassErrors)).join('; ') : '없음'}`,
  `- 상태 일치: ${s.statusOk}/${s.total} (${(s.statusAccuracy * 100).toFixed(1)}%)`,
  `- 근거 정확(정확히 일치): ${s.evidenceExact}/${s.evidenceTotal}, 부분 일치: ${s.evidencePartial}, 틀림·누락: ${s.evidenceWrongOrMissing}`,
  `- 잘못된 not_found: ${s.falseNotFound}`,
  `- 분석 확인 불가: ${s.unavailable}`,
  '',
  '근거 정확성: exact = 기대 번호와 정확히 일치, partial = 일부만 일치하거나 추가 번호 포함, wrong = 겹치는 번호 없음, n/a = 근거가 필요 없는 항목.',
  '',
].join('\n');

await mkdir('docs', { recursive: true });
await writeFile(out, `${header}\n${sections.join('\n')}`);
console.log(`\n요약: 상태 ${s.statusOk}/${s.total}, 근거 exact ${s.evidenceExact}/${s.evidenceTotal}, 잘못된 not_found ${s.falseNotFound}\n→ ${out}`);
