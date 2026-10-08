// 테스트 샘플을 분석기에 돌려 기대 상태·실제 상태·근거 번호 정확성을 기록한다.
//   npm run report      → 데모 분석기(키워드 규칙)로 실행, docs/test-report-demo.md 작성
//   npm run eval:live   → Gemini API로 실행 (GEMINI_API_KEY 필요), docs/test-report-live.md 작성
//     -- --samples=S1_clear,X3_intern_word  처럼 일부 샘플만 실행할 수 있다 (무료 사용량 절약)
// 샘플 문서는 모두 가상 문서다. 실제 개인정보가 담긴 문서를 넣지 않는다.
// 로그·보고서에는 API 키와 문서 원문을 남기지 않는다 (오류는 코드·HTTP 상태·가린 제공업체 메시지만).
//
// 종료 코드 1 (GitHub Actions 실패 처리):
//   - 실제 API 호출이 한 번도 성공하지 못했거나, 분석이 오류로 중단됐거나,
//   - '분석 확인 불가' 항목이 하나라도 있으면.
//   상태·근거 불일치(정확도)는 측정값이므로 실패로 처리하지 않는다.
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

// AI 호출마다 성공 여부와 오류 진단, 원본 JSON(항목 ID·코드·번호만 있고 문서 원문 없음)을 기록한다.
const apiCalls = [];
let rawResponses = [];
let currentSample = null;
const ai = {
  ...baseAI,
  async analyze(args) {
    const call = { sample: currentSample, n: apiCalls.length + 1, items: args.itemIds.length, retry: Boolean(args.feedback) };
    apiCalls.push(call);
    try {
      const raw = await baseAI.analyze(args);
      call.ok = true;
      rawResponses.push(raw);
      return raw;
    } catch (err) {
      Object.assign(call, { ok: false, code: err.code ?? 'unknown_error', httpStatus: err.httpStatus ?? null, providerStatus: err.providerStatus ?? null, providerMessage: err.providerMessage ?? null });
      throw err;
    }
  },
};
const describeCall = (c) => (c.ok
  ? `호출 ${c.n} (${c.sample}, 항목 ${c.items}개${c.retry ? ', 재분석' : ''}): 성공`
  : `호출 ${c.n} (${c.sample}, 항목 ${c.items}개${c.retry ? ', 재분석' : ''}): 실패 — ${c.code}, HTTP ${c.httpStatus ?? '-'}, ${c.providerStatus ?? '-'}${c.providerMessage ? `, "${c.providerMessage}"` : ''}`);

const out = `docs/test-report-${live ? 'live' : 'demo'}.md`;
const STATUS_KO = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가', hidden: '(숨김)' };
const fmtIds = (ids) => (ids.length ? ids.join(',') : '-');

// 사전 점검: 모델이 존재하는지 (메타데이터 조회, 토큰 사용 없음)
let modelCheck = null;
if (live) {
  modelCheck = await baseAI.checkModel();
  console.log(modelCheck.ok
    ? `모델 확인: ${modelCheck.name} (${modelCheck.displayName ?? '-'})`
    : `모델 확인 실패: ${modelCheck.code}, HTTP ${modelCheck.httpStatus ?? '-'}, ${modelCheck.providerStatus ?? '-'}${modelCheck.providerMessage ? `, "${modelCheck.providerMessage}"` : ''}`);
  if (modelCheck.availableFlashModels) console.log(`사용 가능한 flash 모델(참고용, 자동 전환 안 함): ${modelCheck.availableFlashModels.join(', ') || '없음'}`);
}

const allRows = [];
const sections = [];
let analysisAborted = null;
let unavailableItems = 0;
let analyzedItems = 0;
for (const [i, sample] of SAMPLES.entries()) {
  if (i > 0 && PAUSE_MS) await sleep(PAUSE_MS);
  currentSample = sample.key;
  rawResponses = [];
  let result;
  try {
    result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  } catch (err) {
    analysisAborted = `${sample.key}: ${err.code ?? 'unknown_error'}`;
    console.error(`${sample.key}: 분석 중단 (${err.code ?? 'unknown_error'}${err.httpStatus ? `, HTTP ${err.httpStatus}` : ''})`);
    break;
  }
  const unavailable = result.items.filter((it) => it.status === 'unavailable');
  unavailableItems += unavailable.length;
  analyzedItems += result.items.length - unavailable.length;
  const rows = scoreSample(sample, result);
  allRows.push(...rows);
  const errorCodes = Object.fromEntries(unavailable.map((it) => [it.id, it.errorCodes]));
  const lines = [
    `### ${sample.key} — ${sample.title} (${result.docTypeLabel})`,
    '',
    `- 항목 분석 성공: ${result.items.length - unavailable.length}/${result.items.length}, 분석 확인 불가: ${unavailable.length}${unavailable.length ? ` ${JSON.stringify(errorCodes)}` : ''}`,
    '',
    '| 항목 | 기대 상태 | 실제 상태 | 일치 | 기대 근거 | 실제 근거 | 근거 정확성 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${ITEM_BY_ID[r.item].label} | ${STATUS_KO[r.expectedStatus]} | ${STATUS_KO[r.actualStatus]} | ${r.statusMatch ? '✓' : '✗'} | ${fmtIds(r.expectedIds)} | ${fmtIds(r.actualIds)} | ${r.evidence}${r.falseNotFound ? ' (잘못된 not_found)' : ''} |`),
    '',
  ];
  if (live) {
    lines.push('<details><summary>AI 원본 응답 JSON</summary>', '', '```json', ...(rawResponses.length ? rawResponses.map((r) => JSON.stringify(r, null, 1)) : ['(성공한 응답 없음)']), '```', '</details>', '');
  }
  sections.push(lines.join('\n'));
  console.log(`${sample.key}: 항목 분석 성공 ${result.items.length - unavailable.length}/${result.items.length}, 상태 일치 ${rows.filter((r) => r.statusMatch).length}/${rows.length}`);
}
for (const c of apiCalls) console.log(describeCall(c));

const okCalls = apiCalls.filter((c) => c.ok).length;
const failReasons = [];
if (live && modelCheck && !modelCheck.ok) failReasons.push(`모델 확인 실패 (${modelCheck.code})`);
if (live && okCalls === 0) failReasons.push('성공한 API 호출 없음');
if (analysisAborted) failReasons.push(`분석 중단 (${analysisAborted})`);
if (unavailableItems > 0) failReasons.push(`분석 확인 불가 ${unavailableItems}개`);

const s = summarize(allRows);
const header = [
  `# 샘플 테스트 결과 — ${live ? `실제 AI 분석: Gemini API (${baseAI.model})` : '데모 분석기 (키워드 규칙, AI 아님)'}`,
  '',
  `- 실행 시각: ${new Date().toISOString()}`,
  `- 샘플: ${SAMPLES.map((x) => x.key).join(', ')} (모두 가상 문서)`,
  `- 판정: **${failReasons.length ? `실패 — ${failReasons.join(', ')}` : '성공'}**`,
  '',
  ...(live ? [
    '## 1. Gemini API 호출',
    '',
    `- 모델 확인: ${modelCheck.ok ? `성공 — ${modelCheck.name} (${modelCheck.displayName ?? '-'}, 입력 ${modelCheck.inputTokenLimit ?? '-'} / 출력 ${modelCheck.outputTokenLimit ?? '-'} 토큰)` : `실패 — ${modelCheck.code}, HTTP ${modelCheck.httpStatus ?? '-'}, ${modelCheck.providerStatus ?? '-'}${modelCheck.providerMessage ? `, "${modelCheck.providerMessage}"` : ''}`}`,
    ...(modelCheck.availableFlashModels ? [`- 사용 가능한 flash 모델(참고용, 자동 전환 안 함): ${modelCheck.availableFlashModels.join(', ') || '없음'}`] : []),
    `- 생성 요청: 성공 ${okCalls} / 실패 ${apiCalls.length - okCalls}`,
    ...apiCalls.map((c) => `  - ${describeCall(c)}`),
    '',
  ] : []),
  `## ${live ? '2' : '1'}. 항목별 분석`,
  '',
  `- 항목 분석 성공: ${analyzedItems}, 분석 확인 불가: ${unavailableItems}${analysisAborted ? `, 분석 중단: ${analysisAborted}` : ''}`,
  `- 상태 일치: ${s.statusOk}/${s.total} (${(s.statusAccuracy * 100).toFixed(1)}%)`,
  `- 근거 정확(정확히 일치): ${s.evidenceExact}/${s.evidenceTotal}, 부분 일치: ${s.evidencePartial}, 틀림·누락: ${s.evidenceWrongOrMissing}`,
  `- 잘못된 not_found: ${s.falseNotFound}`,
  '',
  '근거 정확성: exact = 기대 번호와 정확히 일치, partial = 일부만 일치하거나 추가 번호 포함, wrong = 겹치는 번호 없음, n/a = 근거가 필요 없는 항목.',
  '',
].join('\n');

await mkdir('docs', { recursive: true });
await writeFile(out, `${header}\n${sections.join('\n')}`);
console.log(`\n판정: ${failReasons.length ? `실패 — ${failReasons.join(', ')}` : '성공'}`);
console.log(`요약: 항목 분석 성공 ${analyzedItems}, 분석 확인 불가 ${unavailableItems}, 상태 일치 ${s.statusOk}/${s.total}, 근거 exact ${s.evidenceExact}/${s.evidenceTotal}, 잘못된 not_found ${s.falseNotFound}\n→ ${out}`);
if (failReasons.length) process.exitCode = 1;
