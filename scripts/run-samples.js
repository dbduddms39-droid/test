// 테스트 샘플을 분석기에 돌려 기대 상태·실제 상태·근거 번호 정확성을 기록한다.
//   npm run report      → 데모 분석기(키워드 규칙)로 실행, docs/test-report-demo.md 작성
//   npm run eval:live   → Claude API로 실행 (ANTHROPIC_API_KEY 필요), docs/test-report-live.md 작성
import { writeFile, mkdir } from 'node:fs/promises';
import { analyzeDocument } from '../src/analyze.js';
import { scoreSample, summarize } from '../src/eval/score.js';
import { ITEM_BY_ID } from '../src/items.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { createClaudeAnalyzer } from '../src/ai/claude.js';
import { SAMPLES } from '../test/samples.js';

const live = process.argv.includes('--live');
const ai = live ? createClaudeAnalyzer() : createDemoAnalyzer();
const out = `docs/test-report-${live ? 'live' : 'demo'}.md`;

const STATUS_KO = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가', hidden: '(숨김)' };
const fmtIds = (ids) => (ids.length ? ids.join(',') : '-');

const allRows = [];
const sections = [];
for (const sample of SAMPLES) {
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
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
  sections.push(lines.join('\n'));
  console.log(`${sample.key}: 상태 일치 ${rows.filter((r) => r.statusMatch).length}/${rows.length}`);
}

const s = summarize(allRows);
const header = [
  `# 샘플 테스트 결과 — ${live ? 'Claude API (live)' : '데모 분석기 (키워드 규칙, AI 아님)'}`,
  '',
  `- 실행 시각: ${new Date().toISOString()}`,
  `- 분석기: ${ai.name}`,
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
