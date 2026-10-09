import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestion } from '../public/questions.js';
import { TOPIC_IDS } from '../src/criteria.js';

const DOC_TYPES = ['job_posting', 'offer', 'contract'];
const ASKED = ['MAIN_PARTIAL', 'MAIN_MISSING'];

test('일부 내용만 기재됨·관련 내용 찾지 못함인 10개 주제 모두 정중한 질문을 만든다', () => {
  for (const id of TOPIC_IDS) for (const docType of DOC_TYPES) for (const status of ASKED) {
    const q = buildQuestion({ id, status, visible: true }, docType);
    assert.ok(q, `${id}/${docType}/${status}`);
    assert.ok(q.startsWith('안녕하세요.') && q.endsWith('감사합니다.'), q);
    assert.match(q, /알려 주실 수 있을까요\?/);
    assert.ok(!q.includes('undefined') && !q.includes('null'), q);
    assert.doesNotMatch(q, /\d/, '숫자(금액·날짜)를 넣지 않음');
  }
});

test('문서 내용(근거 원문)을 질문에 넣지 않는다', () => {
  const topic = { id: '01', status: 'MAIN_PARTIAL', visible: true, criteria: [{ evidence: [{ text: '급여: 월 230만원 (가상)' }] }] };
  const q = buildQuestion(topic, 'job_posting');
  assert.ok(!q.includes('230') && !q.includes('만원'));
});

test('주요 내용 기재됨·분석 확인 불가·미표시 주제에는 질문을 만들지 않는다', () => {
  assert.equal(buildQuestion({ id: '01', status: 'MAIN_FOUND', visible: true }, 'offer'), null);
  assert.equal(buildQuestion({ id: '01', status: 'MAIN_UNAVAILABLE', visible: true }, 'offer'), null);
  assert.equal(buildQuestion({ id: '08', status: null, visible: false }, 'contract'), null);
  assert.equal(buildQuestion({ id: '99', status: 'MAIN_MISSING', visible: true }, 'offer'), null);
});

test('문서 유형에 맞는 표현을 쓴다', () => {
  const nf = (docType) => buildQuestion({ id: '03', status: 'MAIN_MISSING', visible: true }, docType);
  assert.match(nf('job_posting'), /채용공고에서 근무장소에 관한 내용을 찾지 못해/);
  assert.match(nf('offer'), /안내해 주신 내용에서/);
  assert.match(nf('contract'), /근로계약서에서/);
  assert.match(buildQuestion({ id: '10', status: 'MAIN_PARTIAL', visible: true }, 'offer'), /연차 유급휴가에 관한 내용 중 정해지지 않았거나 일부만 적힌 부분/);
});
