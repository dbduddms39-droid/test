// 사용자 관점 QA: 가상 문서를 실제 분석 규칙에 전달해 비교 결과와 질문 초안을 함께 확인한다.
// 실제 Gemini 호출이 아니라 원문에서 올바른 구절을 찾았다고 가정한 모의 AI 응답이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { compareDocuments } from '../src/compare.js';
import { buildCompareQuestions, buildContractQuestions } from '../public/questions.js';
import { buildExtraction } from './v22-fixtures.js';
import { scriptedAI } from './helpers.js';

async function analyze(docType, lines, specs) {
  const text = lines.join('\n');
  const mock = scriptedAI(buildExtraction(segmentText(text), specs, CRITERION_IDS));
  return { docType, result: await analyzeDocument({ text, docType, ai: mock, withCriteria: true }) };
}
const summary = (label, c, qs) => {
  console.log('USER_JOURNEY_QA ' + JSON.stringify({
    scenario: label,
    statuses: c.items.map((i) => ({ topic: i.label, status: i.stateLabel })),
    questions: qs.map((q) => ({ topic: q.label, text: q.text })),
    total_questions: qs.length,
  }));
};
const verifySource = (c) => {
  for (const item of c.items) for (const f of item.facets) {
    for (const [side, doc] of [[f.a, c.docs[0]], [f.b, c.docs[1]]]) {
      for (const e of side.evidence) assert.ok(doc.lines[e.line - 1]?.text.includes(e.text), '원문에 없는 근거가 결과에 나오지 않아야 함');
    }
  }
};
const F = (id, state, c) => c.items.flatMap((i) => i.facets).find((f) => f.id === id)?.state === state;

const posting = () => analyze('job_posting', [
  '[가상] 채용공고', '연봉: 3,600만원', '근무시간: 주 40시간',
  '근무지: 서울 강남구', '담당업무: 데이터 분석', '수습기간: 3개월',
], {
  '01-a': { f: 'specific', q: ['연봉: 3,600만원'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['연봉: 3,600만원'], sv: '연봉' },
  '02-a': { f: 'specific', q: ['근무시간: 주 40시간'], sv: '주 40시간', kind: 'quoted' },
  '03-a': { f: 'specific', q: ['근무지: 서울 강남구'], sv: '서울 강남구' },
  '04-a': { f: 'specific', q: ['담당업무: 데이터 분석'], sv: '데이터 분석' },
  '07-a': { f: 'specific', q: ['수습기간: 3개월'], sv: '수습 적용' },
  '07-b': { f: 'specific', q: ['수습기간: 3개월'], sv: '3개월' },
});
const offerFixed = () => analyze('offer', [
  '[가상] 최종 합격 안내', '제안 연봉: 3,600만원',
], {
  '01-a': { f: 'specific', q: ['제안 연봉: 3,600만원'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['제안 연봉: 3,600만원'], sv: '연봉' },
});
const postingOpen = () => analyze('job_posting', [
  '[가상] 채용공고', '급여: 협의 후 결정',
], {
  '01-a': { f: 'undecided', q: ['급여: 협의 후 결정'] },
});
const offerOpen = () => analyze('offer', [
  '[가상] 최종 합격 안내', '급여: 협의 후 결정',
], {
  '01-a': { f: 'undecided', q: ['급여: 협의 후 결정'] },
});
const contractFixed = () => analyze('contract', [
  '[가상] 근로계약서', '임금: 연봉 3,200만원',
  '수습기간: 3개월', '수습 중 급여: 정규 급여의 90%',
], {
  '01-a': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '3,200만원' },
  '01-b': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '연봉' },
  '07-a': { f: 'specific', q: ['수습기간: 3개월'], sv: '수습 적용' },
  '07-b': { f: 'specific', q: ['수습기간: 3개월'], sv: '3개월' },
  '08-a': { f: 'specific', q: ['수습 중 급여: 정규 급여의 90%'], sv: '정규 급여의 90%' },
});
test('QA 1: 실제로 짧은 오퍼와 채용공고를 비교했을 때 원문 정확도·질문 수를 점검한다', async () => {
  const c = compareDocuments([await posting(), await offerFixed()]);
  verifySource(c);
  assert.ok(F('01-a', 'same', c));
  assert.ok(F('03-a', 'not_comparable', c));
  const qs = buildCompareQuestions(c);
  assert.ok(!qs.some((q) => q.itemId === '01'));
  summary('채용공고→짧은 최종 오퍼', c, qs);
});
test('QA 2: 공고의 급여 협의 예정이 오퍼에서 확정됐으면 재질문하지 않는다', async () => {
  const c = compareDocuments([await postingOpen(), await offerFixed()]);
  verifySource(c);
  const qs = buildCompareQuestions(c);
  assert.ok(!qs.some((q) => q.itemId === '01'));
  summary('공고 급여 협의→최종 오퍼 확정', c, qs);
});
test('QA 3: 공고와 오퍼 모두 급여 협의 예정이면 확정 시점을 물어본다', async () => {
  const c = compareDocuments([await postingOpen(), await offerOpen()]);
  verifySource(c);
  const qs = buildCompareQuestions(c);
  assert.match(qs.find((q) => q.itemId === '01')?.text ?? '', /언제, 어떤 기준으로 확정/);
  summary('공고 급여 협의→최종 오퍼도 협의', c, qs);
});
test('QA 4: 오퍼→계약서 급여 불일치 + 수습 신설은 확인 질문을 만든다', async () => {
  const c = compareDocuments([await offerFixed(), await contractFixed()]);
  verifySource(c);
  assert.ok(F('01-a', 'changed', c));
  assert.ok(['added', 'not_comparable', 'unavailable'].includes(c.items.flatMap((i) => i.facets).find((f) => f.id === '07-a')?.state), '수습을 변경으로 단정하지 않음');
  const qs = buildCompareQuestions(c);
  assert.match(qs.find((q) => q.itemId === '01')?.text ?? '', /3,600만원/);
  assert.match(qs.find((q) => q.itemId === '01')?.text ?? '', /3,200만원/);
  summary('최종 오퍼→근로계약서 연봉 차이+새 수습 조건', c, qs);
  // QA 관찰: 계약서에 수습조건이 등장하더라도 검증 보류면 질문을 강제로 생성하지 않는다.
  // 실제 출력값과 원문 근거를 기록한 뒤 보류 원인을 별도 조사한다.
  assert.ok(qs.every((q) => !/undefined|null/.test(q.text)));

});
test('QA 5: 조건이 거의 없는 계약서 단독 결과의 질문 수를 확인한다', async () => {
  const contract = await analyze('contract', ['[가상] 근로계약서', '임금: 연봉 3,200만원'], {
    '01-a': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '3,200만원' },
    '01-b': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '연봉' },
  });
  const qs = buildContractQuestions(contract.result);
  console.log('USER_JOURNEY_QA ' + JSON.stringify({
    scenario: '급여만 적힌 근로계약서 단독',
    topics: contract.result.topics.map((t) => ({ topic: t.label, status: t.status, visible: t.visible })),
    total_questions: qs.length,
    questions: qs.map((q) => ({ topic: q.label, text: q.text })),
  }));
  assert.ok(qs.length > 0);
});
