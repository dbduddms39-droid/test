// 근로조건 2문서 비교 (src/compare.js). 문서마다 기존 분석(추출·인용 검증·v2.2 규칙)을 거친 뒤 규칙으로만 비교한다.
// 추출값은 사람이 작성한 '올바른 AI 응답'이며 실제 Gemini 결과가 아니다. 외부 AI를 호출하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import {
  compareDocuments, parseAmounts, payUnit, parseHours, parseTimeRanges, normalizeText, employmentKinds, parsePeriod, formatWon,
} from '../src/compare.js';
import { buildExtraction } from './v22-fixtures.js';
import { scriptedAI } from './helpers.js';

// 가상 문서 한 개를 분석한다 (AI 응답은 specs로 정한다)
async function doc(docType, lines, specs) {
  const text = lines.join('\n');
  const ai = scriptedAI(buildExtraction(segmentText(text), specs, CRITERION_IDS));
  return { docType, result: await analyzeDocument({ text, docType, ai, withCriteria: true }) };
}
const item = (c, id) => c.items.find((i) => i.id === id);
const facet = (c, id) => c.items.flatMap((i) => i.facets).find((f) => f.id === id);

// ---- 가상 문서 (실제 회사·인물과 무관) ----
const POSTING = ['[가상] 채용공고 — 바른데이터', '고용형태: 정규직', '연봉: 3,600만원', '근무시간: 주 40시간, 09:00~18:00', '근무지: 서울특별시 강남구 테헤란로 100', '담당업무: 데이터 품질 점검', '수습기간: 3개월'];
const POSTING_SPECS = {
  '01-a': { f: 'specific', q: ['연봉: 3,600만원'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['연봉: 3,600만원'], sv: '연봉' },
  '02-a': { f: 'specific', q: ['근무시간: 주 40시간, 09:00~18:00'], sv: '주 40시간', kind: 'quoted' },
  '02-b': { f: 'specific', q: ['근무시간: 주 40시간, 09:00~18:00'], sv: '09:00~18:00' },
  '03-a': { f: 'specific', q: ['근무지: 서울특별시 강남구 테헤란로 100'], sv: '서울특별시 강남구 테헤란로 100' },
  '04-a': { f: 'specific', q: ['담당업무: 데이터 품질 점검'], sv: '데이터 품질 점검' },
  '05-a': { f: 'specific', q: ['고용형태: 정규직'], sv: '정규직' },
  '06-a': { f: 'specific', q: ['고용형태: 정규직'], sv: '정규직', term: 'indefinite' },
  '07-a': { f: 'specific', q: ['수습기간: 3개월'], sv: '3개월' },
  '07-b': { f: 'specific', q: ['수습기간: 3개월'], sv: '3개월' },
};
// 간략한 오퍼 안내: 금액·수습 중 급여만, 수습 중 급여는 '별도 협의'
const OFFER = ['[가상] 최종합격 안내', '제안 연봉은 3,600만원입니다.', '수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'];
const OFFER_SPECS = {
  '01-a': { f: 'specific', q: ['제안 연봉은 3,600만원입니다.'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['제안 연봉은 3,600만원입니다.'], sv: '연봉' },
  '07-a': { f: 'specific', q: ['수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'], sv: '수습 3개월' },
  '07-b': { f: 'specific', q: ['수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'], sv: '3개월' },
  '08-a': { f: 'undecided', q: ['수습 중 급여는 별도 협의드리겠습니다.'] },
};
// 근로계약서: 표현은 다르지만 같은 금액·장소, 지급일 추가, 근무시간 변경, 수습 중 급여 90%
const CONTRACT = ['[가상] 근로계약서', '1. 근무장소: 서울 강남구 테헤란로 100', '2. 업무내용: 데이터 품질 점검', '3. 소정근로시간: 주 45시간 (09:00~19:00)', '4. 임금: 연 36,000,000원, 매월 25일 지급', '5. 고용형태: 정규직(기간의 정함이 없음)', '6. 수습: 입사일부터 3개월, 수습 기간 중 급여는 정규 급여의 90%'];
const CONTRACT_SPECS = {
  '01-a': { f: 'specific', q: ['4. 임금: 연 36,000,000원, 매월 25일 지급'], sv: '36,000,000원' },
  '01-b': { f: 'specific', q: ['4. 임금: 연 36,000,000원, 매월 25일 지급'], sv: '연' },
  '01-f': { f: 'specific', q: ['매월 25일 지급'], sv: '매월 25일' },
  '02-a': { f: 'specific', q: ['3. 소정근로시간: 주 45시간 (09:00~19:00)'], sv: '주 45시간', kind: 'quoted' },
  '02-b': { f: 'specific', q: ['3. 소정근로시간: 주 45시간 (09:00~19:00)'], sv: '09:00~19:00' },
  '03-a': { f: 'specific', q: ['1. 근무장소: 서울 강남구 테헤란로 100'], sv: '서울 강남구 테헤란로 100' },
  '04-a': { f: 'specific', q: ['2. 업무내용: 데이터 품질 점검'], sv: '데이터 품질 점검' },
  '05-a': { f: 'specific', q: ['5. 고용형태: 정규직(기간의 정함이 없음)'], sv: '정규직' },
  '06-a': { f: 'specific', q: ['5. 고용형태: 정규직(기간의 정함이 없음)'], sv: '기간의 정함이 없음', term: 'indefinite' },
  '07-a': { f: 'specific', q: ['6. 수습: 입사일부터 3개월, 수습 기간 중 급여는 정규 급여의 90%'], sv: '입사일부터 3개월' },
  '07-b': { f: 'specific', q: ['6. 수습: 입사일부터 3개월, 수습 기간 중 급여는 정규 급여의 90%'], sv: '3개월' },
  '08-a': { f: 'specific', q: ['수습 기간 중 급여는 정규 급여의 90%'], sv: '90%' },
};

test('값 읽기: 금액·단위·시간·표기 정리 (원문에 있는 값만, 하나로 특정할 수 없으면 비교하지 않음)', () => {
  assert.deepEqual(parseAmounts('연봉 3,600만원'), [36_000_000]);
  assert.deepEqual(parseAmounts('연 36,000,000원'), [36_000_000]);
  assert.deepEqual(parseAmounts('3천만 원'), [30_000_000]);
  assert.deepEqual(parseAmounts('2억 4천만원'), [240_000_000]);
  assert.deepEqual(parseAmounts('기본급 200만원, 식대 20만원'), [2_000_000, 200_000]);
  assert.equal(formatWon(36_000_000), '3,600만원');
  assert.equal(formatWon(10_030), '10,030원');
  assert.equal(payUnit('연봉 3,600만원').key, 'annual');
  assert.equal(payUnit('월 250만원').key, 'monthly');
  assert.equal(payUnit('시급 10,030원').key, 'hourly');
  assert.equal(payUnit('연봉 3,600만원(월 300만원)'), null, '서로 다른 단위가 함께 있으면 특정하지 않음');
  assert.deepEqual(parseHours('주 40시간'), [{ per: 'week', h: 40 }]);
  assert.deepEqual(parseHours('1일 8시간'), [{ per: 'day', h: 8 }]);
  assert.deepEqual(parseTimeRanges('9시~18시'), ['09:00~18:00']);
  assert.equal(normalizeText('서울특별시 강남구 테헤란로 100', { place: true }), normalizeText('근무장소: 서울 강남구 테헤란로 100', { place: true }));
  assert.deepEqual(employmentKinds('기간제 계약직'), ['기간제(계약직)']);
  assert.deepEqual(parsePeriod('2026년 11월 1일부터 2027년 10월 31일까지'), { kind: 'dates', value: '2026-11-01~2027-10-31' });
});

test('1) 채용공고 ↔ 오퍼 안내: 같은 금액은 동일, 간략한 오퍼에 없는 조건은 변경·삭제가 아니라 비교 불가·추가 확인 필요', async () => {
  const c = compareDocuments([await doc('job_posting', POSTING, POSTING_SPECS), await doc('offer', OFFER, OFFER_SPECS)]);
  assert.deepEqual(c.docs.map((d) => d.docType), ['job_posting', 'offer']);
  assert.equal(facet(c, '01-a').state, 'same');
  for (const id of ['03-a', '04-a', '05-a', '02-a']) {
    assert.equal(facet(c, id).state, 'not_comparable', id);
    assert.doesNotMatch(facet(c, id).note, /삭제|폐지|없어졌/);
  }
  assert.equal(facet(c, '08-a').state, 'added', '채용공고에는 없고 오퍼에 적힘 (모호한 표현이어도 한쪽에만 있음)');
  assert.ok(!c.items.some((i) => i.state === 'changed'), '확인되지 않은 것을 변경으로 보지 않음');
});

test('2) 채용공고 ↔ 근로계약서: 표현은 달라도 같은 조건(연봉 3,600만원 = 연 36,000,000원, 서울특별시 = 서울)은 동일, 계약서에만 있는 지급일은 새로 추가', async () => {
  const c = compareDocuments([await doc('contract', CONTRACT, CONTRACT_SPECS), await doc('job_posting', POSTING, POSTING_SPECS)]);
  assert.deepEqual(c.docs.map((d) => d.docType), ['job_posting', 'contract'], '입력 순서와 무관하게 앞 단계 문서가 A');
  assert.equal(facet(c, '01-a').state, 'same');
  assert.match(facet(c, '01-a').note, /3,600만원/);
  assert.equal(facet(c, '03-a').state, 'same');
  assert.equal(facet(c, '04-a').state, 'same');
  assert.equal(facet(c, '05-a').state, 'same');
  assert.equal(facet(c, '06-a').state, 'same');
  assert.equal(facet(c, '01-f').state, 'added');
  assert.equal(facet(c, '02-a').state, 'changed');
  assert.match(facet(c, '02-a').note, /주 40시간 → 주 45시간 \(5시간 늘었어요\)/);
  assert.equal(facet(c, '02-b').state, 'changed');
  assert.equal(item(c, '02').state, 'changed');
  assert.ok(c.summary.highlights.some((h) => h.facetId === '02-a' && h.state === 'changed'), '핵심 차이 요약에 포함');
});

test('3) 오퍼 안내 ↔ 근로계약서: 서로 충돌하는 급여는 같은 단위일 때만 차이를 계산, 모호한 수습 중 급여는 비교 어려움', async () => {
  const offer = await doc('offer', ['[가상] 오퍼 안내', '연봉 3,600만원, 근무 주 40시간', '수습 중 급여: 추후 협의'], {
    '01-a': { f: 'specific', q: ['연봉 3,600만원, 근무 주 40시간'], sv: '3,600만원' },
    '01-b': { f: 'specific', q: ['연봉 3,600만원, 근무 주 40시간'], sv: '연봉' },
    '02-a': { f: 'specific', q: ['연봉 3,600만원, 근무 주 40시간'], sv: '주 40시간', kind: 'quoted' },
    '07-a': { f: 'specific', q: ['수습 중 급여: 추후 협의'], sv: '수습' },
    '08-a': { f: 'undecided', q: ['수습 중 급여: 추후 협의'] },
  });
  const contract = await doc('contract', ['[가상] 근로계약서', '임금: 연봉 3,200만원', '소정근로시간: 주 40시간', '수습 기간 중 급여는 정규 급여의 90%'], {
    '01-a': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '3,200만원' },
    '01-b': { f: 'specific', q: ['임금: 연봉 3,200만원'], sv: '연봉' },
    '02-a': { f: 'specific', q: ['소정근로시간: 주 40시간'], sv: '주 40시간', kind: 'quoted' },
    '07-a': { f: 'specific', q: ['수습 기간 중 급여는 정규 급여의 90%'], sv: '수습 기간' },
    '08-a': { f: 'specific', q: ['수습 기간 중 급여는 정규 급여의 90%'], sv: '90%' },
  });
  const c = compareDocuments([offer, contract]);
  assert.equal(facet(c, '01-a').state, 'changed');
  assert.equal(facet(c, '01-a').note, '연봉 3,600만원 → 3,200만원 (400만원 적어요)');
  assert.equal(facet(c, '02-a').state, 'same');
  assert.equal(facet(c, '08-a').state, 'unclear', "'추후 협의'는 구체적인 조건으로 보지 않음");
  assert.match(facet(c, '08-a').note, /추후 협의/);
});

test('급여 단위가 다르면(연봉 ↔ 월급) 환산하지 않고 직접 비교 어려움', async () => {
  const a = await doc('job_posting', ['[가상] 공고', '연봉 3,600만원'], { '01-a': { f: 'specific', q: ['연봉 3,600만원'], sv: '3,600만원' }, '01-b': { f: 'specific', q: ['연봉 3,600만원'], sv: '연봉' } });
  const b = await doc('offer', ['[가상] 오퍼', '월 300만원 지급'], { '01-a': { f: 'specific', q: ['월 300만원 지급'], sv: '300만원' }, '01-b': { f: 'specific', q: ['월 300만원 지급'], sv: '월' } });
  const f = facet(compareDocuments([a, b]), '01-a');
  assert.equal(f.state, 'unclear');
  assert.match(f.note, /산정 단위가 달라요/);
  assert.doesNotMatch(f.note, /→/, '차이를 계산하지 않음');
});

test("'회사 내규에 따름'·한 문서 안의 서로 다른 급여는 구체적인 조건이 아님 → 모호하거나 직접 비교 어려움", async () => {
  const a = await doc('job_posting', ['[가상] 공고', '급여: 회사 내규에 따름'], { '01-a': { f: 'coarse', q: ['급여: 회사 내규에 따름'] } });
  const b = await doc('contract', ['[가상] 계약서', '임금: 월 250만원', '제5조 임금은 월 270만원으로 한다'], {
    '01-a': { f: 'conflict', q: ['임금: 월 250만원', '제5조 임금은 월 270만원으로 한다'] },
    '01-b': { f: 'specific', q: ['임금: 월 250만원'], sv: '월' },
  });
  const f = facet(compareDocuments([a, b]), '01-a');
  assert.equal(f.state, 'unclear');
  assert.match(f.note, /다른 규정 참조/);
  assert.match(f.note, /서로 다른 값/);
});

test('한쪽 문서에만 있는 조건: 앞 문서에만 있으면 한쪽 미기재(삭제 아님), 뒤 문서에만 있으면 새로 추가, 둘 다 없으면 두 문서 모두 미기재', async () => {
  const a = await doc('job_posting', ['[가상] 공고', '근무지: 부산 해운대구'], { '03-a': { f: 'specific', q: ['근무지: 부산 해운대구'], sv: '부산 해운대구' } });
  const b = await doc('contract', ['[가상] 계약서', '담당 업무: 매장 관리'], { '04-a': { f: 'specific', q: ['담당 업무: 매장 관리'], sv: '매장 관리' } });
  const c = compareDocuments([a, b]);
  assert.equal(facet(c, '03-a').state, 'missing_one');
  assert.match(facet(c, '03-a').note, /없어지거나 바뀌었다는 뜻은 아니에요/);
  assert.equal(facet(c, '04-a').state, 'added');
  assert.equal(facet(c, '05-a').state, 'both_missing');
});

test('원문 근거: 모든 비교 결과에 각 문서의 검증된 인용 줄을 붙이고, 근거가 없는 쪽은 비워 둠', async () => {
  const c = compareDocuments([await doc('job_posting', POSTING, POSTING_SPECS), await doc('contract', CONTRACT, CONTRACT_SPECS)]);
  for (const f of c.items.flatMap((i) => i.facets)) {
    for (const [side, d] of [['a', c.docs[0]], ['b', c.docs[1]]]) {
      for (const e of f[side].evidence) assert.ok(d.lines[e.line - 1].text.includes(e.text), `${f.id}.${side} 근거가 그 줄에 있음`);
      if (f[side].status === 'MISSING') assert.deepEqual(f[side].evidence, []);
    }
  }
  assert.deepEqual(facet(c, '01-a').b.evidence, [{ line: 5, text: '4. 임금: 연 36,000,000원, 매월 25일 지급' }]);
});

test('AI가 근거를 제시하지 못한 세부기준(분석 확인 불가)은 비교하지 않고, 같은 유형 두 개는 비교하지 않음', async () => {
  const text = '[가상] 계약서\n임금: 월 250만원';
  const bad = { criteria: CRITERION_IDS.map((id) => ({ id, finding: id === '01-a' ? 'specific' : 'absent', quotes: id === '01-a' ? [{ line: 2, text: '월 999만원' }] : [], source_value: null, term_type: null, value_kind: null, calc: null })) };
  const contract = { docType: 'contract', result: await analyzeDocument({ text, docType: 'contract', ai: scriptedAI(bad, bad), withCriteria: true }) };
  const posting = await doc('job_posting', ['[가상] 공고', '월 250만원'], { '01-a': { f: 'specific', q: ['월 250만원'], sv: '250만원' } });
  const f = facet(compareDocuments([posting, contract]), '01-a');
  assert.equal(f.state, 'unavailable');
  assert.deepEqual(f.b.evidence, [], '검증되지 않은 인용은 보여 주지 않음');
  assert.throws(() => compareDocuments([posting, posting]), /invalid pair/);
});

test('비교 결과 → 확인 질문: 엔진 결과로 바로 질문을 만들고, 동일한 조건은 묻지 않음', async () => {
  const { buildCompareQuestions } = await import('../public/questions.js');
  const c = compareDocuments([await doc('job_posting', POSTING, POSTING_SPECS), await doc('offer', OFFER, OFFER_SPECS)]);
  const qs = buildCompareQuestions(c);
  const ids = qs.map((q) => q.itemId);
  assert.ok(!ids.includes('01'), '급여 금액이 같으면 묻지 않음');
  assert.ok(ids.includes('03'), '오퍼에 없는 근무장소는 채용공고 조건이 그대로인지 질문');
  assert.match(qs.find((q) => q.itemId === '03').text, /오퍼·합격 안내에서 근무장소에 관한 내용을 찾지 못했습니다\. 채용공고에 적힌 조건\(서울특별시 강남구 테헤란로 100\)/);
});

test('출퇴근 시각에서 휴게 시각은 빼고 비교, 보조 항목이 두 문서 모두 없으면 항목 대표 상태를 바꾸지 않음, 미기재 ↔ 해당 없음은 해당 없음', async () => {
  const a = await doc('job_posting', ['[가상] 공고', '근무시간: 09:00~18:00', '근무지: 서울 마포구 양화로 00'], {
    '02-b': { f: 'specific', q: ['근무시간: 09:00~18:00'], sv: '09:00~18:00' },
    '03-a': { f: 'specific', q: ['근무지: 서울 마포구 양화로 00'], sv: '서울 마포구 양화로 00' },
  });
  const b = await doc('contract', ['[가상] 계약서', '근로시간: 09:00~18:00 (휴게 12:00~13:00)', '근무장소: 서울특별시 마포구 양화로 00', '계약기간: 기간의 정함이 없음'], {
    '02-b': { f: 'specific', q: ['근로시간: 09:00~18:00 (휴게 12:00~13:00)'] },
    '03-a': { f: 'specific', q: ['근무장소: 서울특별시 마포구 양화로 00'], sv: '서울특별시 마포구 양화로 00' },
    '06-a': { f: 'specific', q: ['계약기간: 기간의 정함이 없음'], sv: '기간의 정함이 없음', term: 'indefinite' },
  });
  const c = compareDocuments([a, b]);
  assert.equal(facet(c, '02-b').state, 'same');
  assert.equal(facet(c, '03-b').state, 'both_missing');
  assert.equal(item(c, '03').state, 'same', '재택·파견 여부가 두 문서 모두 없어도 근무장소가 같으면 동일');
  assert.equal(facet(c, '06-b').state, 'not_applicable');
  assert.equal(facet(c, '02-b').b.value, null, '원문 기재값이 없으면 값을 만들지 않고 인용 줄만');
  assert.equal(facet(c, '02-b').b.evidence[0].text, '근로시간: 09:00~18:00 (휴게 12:00~13:00)');
});
