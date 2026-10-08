import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestion } from '../public/questions.js';
import { ITEM_IDS, ITEM_BY_ID } from '../src/items.js';

const DOC_TYPES = ['job_posting', 'offer', 'contract'];
const CASES = [
  ['not_found', null],
  ['unclear', 'vague_expression'],
  ['unclear', 'conflicting_values'],
  ['unclear', 'candidate_unclear'],
];

test('분명하지 않음·찾지 못함인 8개 항목 모두 정중한 질문을 만든다', () => {
  for (const id of ITEM_IDS) for (const docType of DOC_TYPES) for (const [status, reasonCode] of CASES) {
    const q = buildQuestion({ id, status, reasonCode, visible: true }, docType);
    assert.ok(q, `${id}/${docType}/${status}/${reasonCode}`);
    assert.ok(q.startsWith('안녕하세요.') && q.endsWith('감사합니다.'), q);
    assert.match(q, /알려 주실 수 있을까요\?/);
    assert.ok(!q.includes('이(가)') && !q.includes('undefined') && !q.includes('null'), q);
  }
});

test('질문에 숫자(금액·날짜·시간)를 넣지 않는다', () => {
  for (const id of ITEM_IDS) for (const docType of DOC_TYPES) for (const [status, reasonCode] of CASES) {
    assert.doesNotMatch(buildQuestion({ id, status, reasonCode, visible: true }, docType), /\d/);
  }
});

test('문서 내용(근거 원문)을 질문에 넣지 않는다', () => {
  const item = { id: 'salary', status: 'unclear', reasonCode: 'conflicting_values', visible: true, evidence: [{ text: '급여: 월 230만원 (가상)' }, { text: '월 210만원' }] };
  const q = buildQuestion(item, 'job_posting');
  assert.ok(!q.includes('230') && !q.includes('210') && !q.includes('만원'));
});

test('명시됨·분석 확인 불가·숨김 항목에는 질문을 만들지 않는다', () => {
  assert.equal(buildQuestion({ id: 'salary', status: 'stated', visible: true }, 'offer'), null);
  assert.equal(buildQuestion({ id: 'salary', status: 'unavailable', visible: true }, 'offer'), null);
  assert.equal(buildQuestion({ id: 'contract_period', status: 'not_found', visible: false }, 'job_posting'), null);
  assert.equal(buildQuestion({ id: 'probation_pay', status: 'not_found', visible: false }, 'contract'), null);
  assert.equal(buildQuestion({ id: 'unknown', status: 'not_found', visible: true }, 'offer'), null);
});

test('문서 유형과 사유에 맞는 표현을 쓴다', () => {
  const nf = (docType) => buildQuestion({ id: 'workplace', status: 'not_found', visible: true }, docType);
  assert.match(nf('job_posting'), /채용공고에서 근무장소에 관한 내용을 찾지 못해/);
  assert.match(nf('offer'), /안내해 주신 내용에서/);
  assert.match(nf('contract'), /근로계약서에서/);
  assert.match(buildQuestion({ id: 'salary', status: 'unclear', reasonCode: 'conflicting_values', visible: true }, 'offer'), /급여가 서로 다르게 적힌 부분이 있어, 어느 내용이 적용되는지/);
  assert.match(buildQuestion({ id: 'work_hours', status: 'unclear', reasonCode: 'vague_expression', visible: true }, 'offer'), /근무시간이 구체적으로 정해지지 않은 표현/);
  // 질문에서는 담당자에게 익숙한 말로 부른다 (임금 → 급여, 수습 중 급여 → 수습 기간 중 급여)
  const TOPIC = { salary: '급여', probation_pay: '수습 기간 중 급여' };
  for (const id of ITEM_IDS) {
    const topic = TOPIC[id] ?? ITEM_BY_ID[id].label;
    assert.ok(buildQuestion({ id, status: 'not_found', visible: true }, 'offer').includes(`${topic}에 관한 내용을 찾지 못해`), id);
  }
});
