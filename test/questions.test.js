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

test('비교 질문: 달라짐·새로 기재됨·한쪽 미기재·모호함에 질문, 동일·분석 불가·앞 문서만 모호하면 재질문하지 않음', () => {
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
  assert.doesNotMatch(qs[0].text, /지급일/, '뒤 문서에 구체적으로 적힌 부가 정보는 반복 질문하지 않음');
  assert.match(qs[1].text, /근로계약서에서 근무장소에 관한 내용을 찾지 못했습니다\. 채용공고에 적힌 조건\(서울 마포구\)이 그대로 적용되는지/);
  assert.match(qs[2].text, /구체적인 수습 기간을 알려 주실 수 있을까요/);
  assert.match(qs[3].text, /두 문서 모두에서 고용형태에 관한 내용을 찾지 못했습니다/);
  for (const q of qs) assert.doesNotMatch(q.text, /위반|불법|위법|신뢰|추천/, '법률 판정·평가를 하지 않음');
});

test('비교 질문: 새로 등장한 수습 조건과 간략한 오퍼의 미기재는 변경으로 단정하지 않고 적용 여부를 묻는다', () => {
  const q1 = buildCompareQuestions(comparison([
    { id: '07', label: '수습기간', facets: [fct('07-a', '수습 적용', 'added', side('MISSING'), side('CONFIRMED', '수습기간 3개월'))] },
  ]));
  assert.equal(q1.length, 1);
  assert.match(q1[0].text, /수습기간 3개월/);
  assert.match(q1[0].text, /실제로 적용되는지 확인 부탁드립니다/);
  assert.doesNotMatch(q1[0].text, /변경되었|위반|삭제되었/);

  const offerComparison = { docs: [{ docTypeLabel: '오퍼 안내' }, { docTypeLabel: '근로계약서' }], items: [
    { id: '06', label: '계약기간', facets: [fct('06-a', '기간의 정함', 'not_comparable', side('MISSING'), side('CONFIRMED', '계약기간 1년'))] },
  ] };
  const q2 = buildCompareQuestions(offerComparison);
  assert.equal(q2.length, 1);
  assert.match(q2[0].text, /오퍼 안내에서는 기간의 정함에 관한 내용을 찾지 못했지만 근로계약서에는 ‘계약기간 1년’/);
  assert.doesNotMatch(q2[0].text, /변경되었|위반|삭제되었/);
});

test('비교 질문: 새로 기재된 핵심 조건만 확인 질문으로, 세부 정보는 원문 비교에 남긴다', () => {
  const qs = buildCompareQuestions(comparison([
    { id: '01', label: '급여 및 지급 조건', facets: [
      fct('01-a', '급여 금액', 'added', side('MISSING'), side('CONFIRMED', '연봉 3,600만 원')),
      fct('01-f', '지급일', 'added', side('MISSING'), side('CONFIRMED', '매월 25일')),
    ] },
    { id: '02', label: '근무시간 및 휴게시간', facets: [
      fct('02-b', '출퇴근 시각', 'added', side('MISSING'), side('CONFIRMED', '09:00~18:00')),
      fct('02-c', '휴게시간', 'added', side('MISSING'), side('CONFIRMED', '12:00~13:00')),
    ] },
  ]));
  assert.deepEqual(qs.map((q) => q.itemId), ['01']);
  assert.match(qs[0].text, /연봉 3,600만 원/);
  assert.doesNotMatch(qs[0].text, /지급일/);
});

test('근로계약서 단독: 핵심 기재됨이어도 지정된 세부 조건이 미기재·미확정이면 질문한다', () => {
  const criteria = (...vals) => vals.map(([id, status]) => ({ id, role: 'D', status }));
  const qs = buildContractQuestions({ docType: 'contract', topics: [
    { id: '01', label: '임금', visible: true, status: 'MAIN_FOUND', criteria: criteria(['01-e', 'MISSING'], ['01-f', 'MISSING'], ['01-g', 'MISSING']) },
    { id: '02', label: '근무시간', visible: true, status: 'MAIN_FOUND', criteria: criteria(['02-c', 'UNCLEAR']) },
    { id: '03', label: '근무장소', visible: true, status: 'MAIN_FOUND', criteria: criteria(['03-b', 'MISSING']) },
    { id: '04', label: '담당업무', visible: true, status: 'MAIN_FOUND', criteria: criteria(['04-b', 'UNAVAILABLE']) },
  ] });
  assert.deepEqual(qs.map((q) => q.itemId), ['01', '02']);
  assert.match(qs[0].text, /급여 지급방법·급여 지급일/);
  assert.doesNotMatch(qs[0].text, /세전|세후/);
  assert.match(qs[1].text, /휴게시간/);
});

test('근로계약서 단독: 분석 불가나 해당 없음은 문서 미기재 질문으로 만들지 않는다', () => {
  const qs = buildContractQuestions({ docType: 'contract', topics: [
    { id: '01', label: '임금', visible: true, status: 'MAIN_FOUND', criteria: [{ id: '01-e', role: 'D', status: 'UNAVAILABLE' }] },
    { id: '02', label: '근무시간', visible: true, status: 'MAIN_UNAVAILABLE', criteria: [{ id: '02-c', role: 'D', status: 'MISSING' }] },
    { id: '08', label: '수습 중 급여', visible: false, status: null },
  ] });
  assert.equal(qs.length, 0);
});

test('확인 질문: 뒤 문서에 처음 등장한 핵심 조건이 추후 협의라면 구체적인 내용을 묻는다', () => {
  const cs = comparison([
    { id: '08', label: '수습기간 중 급여', facets: [
      fct('08-a', '수습 중 지급 기준', 'added', side('MISSING'), side('UNCLEAR', '수습 중 급여: 별도 협의')),
    ] },
  ]);
  const qs = buildCompareQuestions(cs);
  assert.equal(qs.length, 1);
  assert.match(qs[0].text, /별도 협의/);
  assert.match(qs[0].text, /구체적인 수습 중 지급 기준을 알려 주실 수 있을까요/);
  assert.doesNotMatch(qs[0].text, /실제로 적용되는지|삭제되었|위반/);

  const offerToContract = { ...cs, docs: [{ docTypeLabel: '오퍼 안내' }, { docTypeLabel: '근로계약서' }] };
  offerToContract.items[0].facets[0].state = 'not_comparable';
  const q2 = buildCompareQuestions(offerToContract);
  assert.equal(q2.length, 1);
  assert.match(q2[0].text, /구체적인 수습 중 지급 기준/);
});

test('확인 질문: 앞 문서도 추후 협의였으면 그대로 적용되느냐고 묻지 않는다', () => {
  const qs = buildCompareQuestions(comparison([
    { id: '08', label: '수습기간 중 급여', facets: [
      fct('08-a', '수습 중 지급 기준', 'missing_one', side('PARTIAL', '별도 협의'), side('MISSING')),
    ] },
  ]));
  assert.equal(qs.length, 1);
  assert.match(qs[0].text, /구체적으로 알려 주실 수 있을까요/);
  assert.doesNotMatch(qs[0].text, /그대로 적용되는지/);

  const offerVersion = { docs: [{ docTypeLabel: '채용공고' }, { docTypeLabel: '오퍼 안내' }], items: [
    { id: '08', label: '수습기간 중 급여', facets: [
      fct('08-a', '수습 중 지급 기준', 'not_comparable', side('UNCLEAR', '추후 협의'), side('MISSING')),
    ] },
  ] };
  const q2 = buildCompareQuestions(offerVersion);
  assert.equal(q2.length, 1);
  assert.doesNotMatch(q2[0].text, /그대로 적용되는지/);
});

test('확인 질문: 분석 불가·세부항목의 새 기재·동일 조건에는 불필요한 질문을 만들지 않는다', () => {
  const qs = buildCompareQuestions(comparison([
    { id: '01', label: '급여 및 지급 조건', facets: [
      fct('01-f', '지급일', 'added', side('MISSING'), side('PARTIAL', '별도 협의')),
    ] },
    { id: '08', label: '수습기간 중 급여', facets: [
      fct('08-a', 'added', 'added', side('MISSING'), side('UNAVAILABLE')),
    ] },
    { id: '02', label: '근로시간', facets: [
      fct('02-a', '소정근로시간', 'same', side('CONFIRMED', '주 40시간'), side('CONFIRMED', '주 40시간')),
    ] },
  ]));
  assert.deepEqual(qs, []);
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
