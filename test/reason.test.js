// '분명하지 않음' 상세 설명: 문서에 적힌 사실과 추가 확인이 필요한 부분을 구분하고, 원문에 없는 사유를 말하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { findVerbatim, josa, payNoun } from '../src/reason.js';
import { FOLLOW_UPS } from '../src/items.js';
import { buildQuestion } from '../public/questions.js';
import { SAMPLES } from './samples.js';
import { idealResponse, scriptedAI } from './helpers.js';

const byKey = (k) => SAMPLES.find((s) => s.key === k);
const run = async (sample, response = idealResponse(sample), docType = sample.docType) =>
  analyzeDocument({ text: sample.text, docType, ai: scriptedAI(response) });
const salaryOf = (r) => r.items.find((i) => i.id === 'salary');
const NO_GENERIC_REASON = /내규|서로 다른|면접/;

test('연봉 범위 + 경력에 따라 협의: 분명하지 않음 유지, 적힌 사실과 확인이 필요한 부분을 구분', async () => {
  const sample = byKey('X7_salary_range_negotiable');
  const salary = salaryOf(await run(sample));
  assert.equal(salary.status, 'unclear');
  assert.equal(salary.reasonKind, 'partial');
  assert.equal(salary.reasonFact, "채용공고에 '연봉 3000만원 ~ 5,000만원'의 범위가 적혀 있어요.");
  assert.equal(salary.reasonPending, "다만 '경력에 따라 협의'라고 안내되어 있어, 실제 적용될 연봉은 이 문서만으로 확인하기 어려워요.");
  assert.doesNotMatch(salary.reasonFact + salary.reasonPending, NO_GENERIC_REASON);
  // 원문 근거와 줄 번호는 그대로
  assert.deepEqual(salary.evidence.map((s) => [s.id, s.text]), [[6, '급여 연봉 3000만원 ~ 5,000만원'], [7, '(경력에 따라 협의, 인센티브 별도)']]);
  // 추가로 확인해 보세요: 핵심 질문이 맨 앞
  assert.equal(salary.followUps[0], '실제 적용될 연봉 금액');
  assert.deepEqual(salary.followUps.slice(1), FOLLOW_UPS.salary);
  // 담당자 질문: 정해지지 않은 부분을 묻고, 숫자는 넣지 않음
  const q = buildQuestion(salary, sample.docType);
  assert.match(q, /급여에 관한 내용은 있지만, 실제 적용될 내용이 정해지지 않은 부분이 있어/);
  assert.doesNotMatch(q, /\d/);
});

test('정확한 급여 금액: 명시됨, 분명하지 않음 설명·핵심 질문 없음', async () => {
  const salary = salaryOf(await run(byKey('S1_clear')));
  assert.equal(salary.status, 'stated');
  assert.equal(salary.reasonFact, null);
  assert.equal(salary.reasonPending, null);
  assert.deepEqual(salary.followUps, FOLLOW_UPS.salary);
});

test('모호한 표현만 있는 급여: 원문에 있는 표현만 인용', async () => {
  const sample = byKey('S2_vague');
  const result = await run(sample);
  const salary = salaryOf(result);
  assert.equal(salary.status, 'unclear');
  assert.equal(salary.reasonKind, 'vague');
  assert.equal(salary.reasonFact, "채용공고에 급여에 관한 내용은 있지만, '회사 내규에 따름', '면접 후 협의'처럼 구체적인 값 대신 정해지지 않은 표현으로 적혀 있어요.");
  assert.equal(salary.reasonPending, '실제 적용될 급여는 이 문서만으로 확인하기 어려워요.');
  assert.equal(salary.followUps[0], '실제 적용될 급여 금액');
  const hours = result.items.find((i) => i.id === 'work_hours');
  assert.equal(hours.reasonFact, "채용공고에 근무시간에 관한 내용은 있지만, '세부 시간은 협의'처럼 구체적인 값 대신 정해지지 않은 표현으로 적혀 있어요.");
  assert.equal(hours.reasonPending, '실제 적용될 근무시간은 이 문서만으로 확인하기 어려워요.');
  assert.equal(hours.followUps[0], '실제 적용될 근무시간');
});

test('급여 자체가 없음: 찾지 못함, 분명하지 않음 설명 없음', async () => {
  const sample = byKey('X7_salary_range_negotiable');
  const text = sample.text.split('\n').slice(0, 5).join('\n'); // 급여 두 줄을 뺀 문서
  const response = idealResponse(sample);
  Object.assign(response.items.find((i) => i.id === 'salary'), { presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [], stated_text: null, unclear_texts: [] });
  const salary = salaryOf(await analyzeDocument({ text, docType: 'job_posting', ai: scriptedAI(response) }));
  assert.equal(salary.status, 'not_found');
  assert.equal(salary.reasonFact, null);
  assert.equal(salary.notFoundMessage, '이 채용공고에는 임금에 관한 안내가 확인되지 않아요.');
  assert.deepEqual(salary.followUps, FOLLOW_UPS.salary);
});

test('AI가 원문에 없는 문구를 주면 버리고, 특정 사유를 단정하지 않는다 (판정은 유지)', async () => {
  const sample = byKey('X7_salary_range_negotiable');
  const response = idealResponse(sample);
  Object.assign(response.items.find((i) => i.id === 'salary'), { stated_text: '연봉 4,000만원', unclear_texts: ['회사 내규에 따름'] });
  const salary = salaryOf(await run(sample, response));
  assert.equal(salary.status, 'unclear');
  assert.equal(salary.reasonKind, 'unspecified');
  assert.equal(salary.reasonFact, '채용공고에 연봉에 관한 내용이 있어요. 아래 원문 근거를 함께 확인해 주세요.');
  assert.doesNotMatch(salary.reasonFact + salary.reasonPending, /내규|협의|서로 다른|4,000/);
});

test('설명용 문구가 없는 AI 응답도 재분석·판정 변경 없이 처리', async () => {
  const sample = byKey('X7_salary_range_negotiable');
  const response = idealResponse(sample);
  for (const it of response.items) { delete it.stated_text; delete it.unclear_texts; }
  const ai = scriptedAI(response);
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  assert.equal(ai.calls.length, 1);
  assert.equal(salaryOf(result).status, 'unclear');
  assert.equal(salaryOf(result).reasonKind, 'unspecified');
});

test('서로 다른 값: 원문에서 두 값 이상을 확인했을 때만 그렇게 설명', async () => {
  const text = '급여: 월 230만원 (가상 예시)\n처우 안내: 월 210만원\n근무지: 서울';
  const make = (unclear) => ({ items: [
    { id: 'salary', presence: 'found', specificity: 'vague', reason_code: 'conflicting_values', evidence_ids: [1, 2], stated_text: null, unclear_texts: unclear },
    ...['work_hours', 'duties', 'employment_type', 'contract_period', 'probation_period', 'probation_pay'].map((id) => ({ id, presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [] })),
    { id: 'workplace', presence: 'found', specificity: 'specific', reason_code: null, evidence_ids: [3] },
  ] });
  const two = salaryOf(await analyzeDocument({ text, docType: 'offer', ai: scriptedAI(make(['월 230만원', '월 210만원'])) }));
  assert.equal(two.reasonFact, "입력한 안내 내용에 '월 230만원', '월 210만원'처럼 월급에 관한 서로 다른 내용이 함께 적혀 있어요.");
  assert.equal(two.reasonPending, '어느 내용이 실제로 적용되는지 이 문서만으로 확인하기 어려워요.');
  const one = salaryOf(await analyzeDocument({ text, docType: 'offer', ai: scriptedAI(make(['월 230만원'])) }));
  assert.equal(one.reasonKind, 'unspecified');
  assert.doesNotMatch(one.reasonFact + one.reasonPending, /서로 다른/);
});

test('데모 분석기도 같은 구조로 원문 문구를 인용', async () => {
  const sample = byKey('X7_salary_range_negotiable');
  const salary = salaryOf(await analyzeDocument({ text: sample.text, docType: sample.docType, ai: createDemoAnalyzer() }));
  assert.equal(salary.status, 'unclear');
  assert.equal(salary.reasonFact, "채용공고에 '연봉 3000만원 ~ 5,000만원'의 범위가 적혀 있어요.");
  assert.equal(salary.reasonPending, "다만 '경력에 따라 협의'라고 안내되어 있어, 실제 적용될 연봉은 이 문서만으로 확인하기 어려워요.");
});

test('원문 인용 찾기: 공백 차이만 허용하고 원문 그대로 돌려준다', () => {
  const lines = ['급여 연봉 3000만원 ~ 5,000만원', '(경력에 따라 협의, 인센티브 별도)'];
  assert.equal(findVerbatim('연봉 3000만원~5,000만원', lines), '연봉 3000만원 ~ 5,000만원');
  assert.equal(findVerbatim('(경력에 따라 협의', lines), '경력에 따라 협의');
  assert.equal(findVerbatim('연봉 3,000만원~5,000만원', lines), null); // 원문과 다른 숫자 표기는 인용하지 않음
  assert.equal(findVerbatim('회사 내규에 따름', lines), null);
  assert.equal(findVerbatim('', lines), null);
  assert.equal(findVerbatim(null, lines), null);
});

test('조사 선택', () => {
  assert.equal(josa('연봉', '은', '는'), '은');
  assert.equal(josa('급여', '은', '는'), '는');
  assert.equal(josa('경력에 따라 협의', '이라고', '라고'), '라고');
  assert.equal(josa('5,000만원', '이라고', '라고'), '이라고');
  assert.equal(josa('월 12', '이라고', '라고'), '라고');
  assert.equal(josa('ABC', '이라고', '라고'), '(이)라고');
  assert.equal(payNoun(['시급: 11,000원']), '시급');
  assert.equal(payNoun(['급여: 회사 내규에 따름']), '급여');
});
