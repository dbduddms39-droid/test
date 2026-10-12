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

// ---------- 확인 질문 목록 (2문서 비교·근로계약서 단독) ----------
import { buildCompareQuestions, buildContractQuestions, dedupeQuestions } from '../public/questions.js';

const side = (status, value = null) => ({ status, value, evidence: value ? [{ line: 1, text: value }] : [] });
const fct = (id, label, state, a, b) => ({ id, label, state, a, b });
const comparison = (items) => ({ docs: [{ docTypeLabel: '채용공고' }, { docTypeLabel: '근로계약서' }], items });

test('비교 질문: 달라진·한쪽 미기재·모호한 조건만 질문, 동일·새로 추가·앞 문서만 모호한 조건은 재질문하지 않음', () => {
  const qs = buildCompareQuestions(comparison([
    { id: '01', label: '급여 및 지급 조건', facets: [fct('01-a', '급여 금액', 'changed', side('CONFIRMED', '3,600만원'), side('CONFIRMED', '3,200만원')), fct('01-f', '지급일', 'added', side('MISSING'), side('CONFIRMED', '매월 25일'))] },
    { id: '02', label: '근무시간 및 휴게시간', facets: [fct('02-a', '소정근로시간', 'same', side('CONFIRMED', '주 40시간'), side('CONFIRMED', '주 40시간'))] },
    { id: '03', label: '근무장소 및 근무형태', facets: [fct('03-a', '근무장소', 'missing_one', side('CONFIRMED', '서울 마포구'), side('MISSING'))] },
    { id: '08', label: '수습기간 중 급여', facets: [fct('08-a', '수습 중 지급 기준', 'unclear', side('UNCLEAR', '별도 협의'), side('CONFIRMED', '90%'))] },
    { id: '07', label: '수습기간', facets: [fct('07-b', '수습 기간', 'unclear', side('CONFIRMED', '3개월'), side('UNCLEAR', '추후 협의'))] },
    { id: '05', label: '고용형태', facets: [fct('05-a', '계약 형태', 'both_missing', side('MISSING'), side('MISSING'))] },
    { id: '06', label: '계약기간', facets: [fct('06-a', '기간의 정함', 'unavailable', side('UNAVAILABLE'), side('CONFIRMED', '정규직'))] },
  ]));
  assert.deepEqual(qs.map((q) => q.itemId), ['01', '03', '07', '05']);
  assert.match(qs[0].text, /급여 금액이 문서마다 다르게 적혀 있습니다\(채용공고: 3,600만원 \/ 근로계약서: 3,200만원\)/);
  assert.doesNotMatch(qs[0].text, /지급일/, '뒤 문서에 새로 구체적으로 적힌 지급일은 묻지 않음');
  assert.match(qs[1].text, /근로계약서에서 근무장소에 관한 내용을 찾지 못했습니다\. 채용공고에 적힌 조건\(서울 마포구\)이 그대로 적용되는지/);
  assert.match(qs[2].text, /구체적인 수습 기간을 알려 주실 수 있을까요/);
  assert.match(qs[3].text, /두 문서 모두에서 고용형태에 관한 내용을 찾지 못했습니다/);
  for (const q of qs) assert.doesNotMatch(q.text, /위반|불법|위법|신뢰|추천/, '법률 판정·평가를 하지 않음');
});

test('질문 중복 제거: 같은 문장은 하나만 (공백 차이 무시), 한 항목은 질문 하나로 묶음', () => {
  assert.equal(dedupeQuestions([{ text: '급여를 알려 주세요.' }, { text: ' 급여를  알려 주세요. ' }, { text: '' }]).length, 1);
  const same = fct('02-a', '소정근로시간', 'changed', side('CONFIRMED', '주 40시간'), side('CONFIRMED', '주 45시간'));
  const qs = buildCompareQuestions(comparison([{ id: '02', label: '근무시간 및 휴게시간', facets: [same, { ...same, id: '02-a2' }] }]));
  assert.equal(qs.length, 1);
  assert.equal(qs[0].text.match(/소정근로시간이 문서마다/g).length, 1, '같은 문장은 한 번만');
});

test('근로계약서 단독 질문: 일부 기재·미기재 주제만, 기재됨·분석 확인 불가·숨긴 주제는 질문하지 않음', () => {
  const qs = buildContractQuestions({ docType: 'contract', topics: [
    { id: '01', label: '임금', visible: true, status: 'MAIN_FOUND' },
    { id: '02', label: '근무시간', visible: true, status: 'MAIN_PARTIAL' },
    { id: '03', label: '근무장소', visible: true, status: 'MAIN_MISSING' },
    { id: '04', label: '담당업무', visible: true, status: 'MAIN_UNAVAILABLE' },
    { id: '08', label: '수습 중 급여', visible: false, status: null },
  ] });
  assert.deepEqual(qs.map((q) => q.itemId), ['02', '03']);
  assert.ok(qs.every((q) => q.text.startsWith('안녕하세요. 근로계약서에서')));
});

test('새로 적힌 계약기간·수습기간·수습 중 급여: 앞 문서에 없고 뒤 문서에 구체적으로 적히면 두 문서 유형과 원문 조건을 넣어 확정 여부를 질문', () => {
  const qs = buildCompareQuestions(comparison([
    { id: '06', label: '계약기간', facets: [fct('06-a', '기간의 정함', 'added', side('MISSING'), side('CONFIRMED', '기간의 정함이 없음')), fct('06-b', '시작일·종료일', 'not_applicable', side('MISSING'), side('NOT_APPLICABLE'))] },
    { id: '07', label: '수습기간', facets: [fct('07-a', '수습 적용', 'added', side('MISSING'), side('CONFIRMED', '입사일부터 3개월')), fct('07-b', '수습 기간', 'added', side('MISSING'), side('CONFIRMED', '3개월'))] },
    { id: '08', label: '수습기간 중 급여', facets: [fct('08-a', '수습 중 지급 기준', 'added', side('MISSING'), side('CONFIRMED', '정규 급여의 90%'))] },
  ]));
  assert.deepEqual(qs.map((q) => q.itemId), ['06', '07', '08']);
  assert.equal(qs[0].text, '안녕하세요. 계약기간 관련해 여쭤봅니다. 채용공고에서는 계약기간에 관한 내용을 찾지 못했고, 근로계약서에는 다음과 같이 적혀 있습니다(기간의 정함이 없음). 이 조건으로 확정된 것인지, 따로 정해질 내용이 있는지 확인 부탁드립니다. 감사합니다.');
  assert.match(qs[1].text, /\(수습 적용: 입사일부터 3개월 \/ 수습 기간: 3개월\)/, '한 항목의 여러 세부 조건은 질문 하나로');
  assert.equal(qs[1].text.match(/찾지 못했고/g).length, 1);
  assert.match(qs[2].text, /채용공고에서는 수습기간 중 급여에 관한 내용을 찾지 못했고, 근로계약서에는 다음과 같이 적혀 있습니다\(정규 급여의 90%\)/);
  for (const q of qs) assert.doesNotMatch(q.text, /변경되|바뀌|삭제|위반|불법|위법/, '미기재를 변경·법률 문제로 단정하지 않음');
});

test('새로 적힌 조건 질문의 범위: 간략한 오퍼에 없던 경우도 질문, 다른 항목·모호한 조건·해당 없음·같은 원문 반복은 질문하지 않음', () => {
  const offerFirst = { docs: [{ docTypeLabel: '오퍼·합격 안내' }, { docTypeLabel: '근로계약서' }], items: [
    { id: '07', label: '수습기간', facets: [fct('07-a', '수습 적용', 'not_comparable', side('MISSING'), side('CONFIRMED', '수습 3개월')), fct('07-b', '수습 기간', 'not_comparable', side('MISSING'), side('CONFIRMED', '수습 3개월'))] },
    { id: '03', label: '근무장소 및 근무형태', facets: [fct('03-a', '근무장소', 'not_comparable', side('MISSING'), side('CONFIRMED', '서울 마포구'))] },
    { id: '01', label: '급여 및 지급 조건', facets: [fct('01-f', '지급일', 'added', side('MISSING'), side('CONFIRMED', '매월 25일'))] },
    { id: '08', label: '수습기간 중 급여', facets: [fct('08-a', '수습 중 지급 기준', 'added', side('MISSING'), side('UNCLEAR', '추후 협의'))] },
    { id: '06', label: '계약기간', facets: [fct('06-a', '기간의 정함', 'same', side('CONFIRMED', '정규직'), side('CONFIRMED', '정규직')), fct('06-b', '시작일·종료일', 'not_applicable', side('MISSING'), side('NOT_APPLICABLE'))] },
  ] };
  const qs = buildCompareQuestions(offerFirst);
  assert.deepEqual(qs.map((q) => q.itemId), ['07'], '간략한 오퍼에 없던 수습만 질문 (근무장소·지급일·모호한 수습 중 급여·동일한 계약기간은 질문하지 않음)');
  assert.match(qs[0].text, /오퍼·합격 안내에서는 수습기간에 관한 내용을 찾지 못했고, 근로계약서에는 다음과 같이 적혀 있습니다\(수습 3개월\)\./, '같은 원문이면 한 번만');
  // 앞 문서에도 구체적으로 같은 조건이 있으면 반복 질문하지 않음
  const same = buildCompareQuestions(comparison([{ id: '07', label: '수습기간', facets: [fct('07-b', '수습 기간', 'same', side('CONFIRMED', '3개월'), side('CONFIRMED', '3개월'))] }]));
  assert.deepEqual(same, []);
});
