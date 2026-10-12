// QA 시나리오(채용공고 → 최종합격 안내 → 근로계약서) 회귀 테스트. 모의 AI 응답(test/qa-docs.js) 사용, 실제 Gemini 호출 없음.
// 검사: 근무시간 기재 상태 설명, 계약서 임금 '분석 확인 불가' 원인 재현·표시, 연봉/월 지급액 비교(환산 없음),
//       계약기간·고용형태 분리, 수습기간 길이·날짜 비교, 새롭게 구체화된 수습 중 급여, 대표 질문 1개·중복 제거.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { relateRecord } from '../public/relate.js';
import { buildFollowUps, euro } from '../public/followups.js';
import { buildExtraction } from './v22-fixtures.js';
import {
  QA_POSTING, QA_OFFER, QA_CONTRACT, QA_POSTING_SPECS, QA_OFFER_SPECS, QA_CONTRACT_SPECS, WAGE_FAILURE_MODES,
} from './qa-docs.js';

const fixedAI = (text, specs, mutate = (x) => x) => ({
  name: 'scripted',
  calls: 0,
  async analyze({ criterionIds }) {
    this.calls += 1;
    const all = mutate(buildExtraction(segmentText(text), specs, CRITERION_IDS));
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
});
const analyze = (docType, text, specs, mutate) => analyzeDocument({ text, docType, ai: fixedAI(text, specs, mutate), withCriteria: true });
let n = 0;
const entry = async (docType, text, specs, mutate) => ({ id: `d${n += 1}`, docType, confirmedText: text, analysis: await analyze(docType, text, specs, mutate) });
const topic = (a, id) => a.topics.find((t) => t.id === id);
const item = (rel, id) => rel.items.find((i) => i.id === id);
const facet = (rel, id) => rel.items.flatMap((i) => i.facets).find((f) => f.id === id);
const all = (f) => [...f.primary, ...f.more];

test('오류 1: 출퇴근 시각이 적힌 근무시간 — 상태(기준표 그대로)와 이유(주 소정근로시간 숫자 없음)를 구분해 남긴다', async () => {
  const p = await analyze('job_posting', QA_POSTING, QA_POSTING_SPECS);
  const t02 = topic(p, '02');
  assert.equal(t02.status, 'MAIN_PARTIAL', '기준표 v2.2: 주 N시간 숫자나 검증된 계산값이 없으면 02-a는 일부 확인 (판정 규칙 변경 없음)');
  const c02a = t02.criteria.find((c) => c.id === '02-a');
  assert.equal(c02a.boundary, 'hours_not_quoted', '왜 일부 확인인지 이유 코드를 남긴다');
  assert.equal(t02.criteria.find((c) => c.id === '02-b').status, 'CONFIRMED', '출퇴근 시각은 확인됨');
  // 계약서는 휴게시간이 적혀 있어 검증된 계산값(주 40시간)으로 확인됨
  const c = await analyze('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  assert.equal(topic(c, '02').status, 'MAIN_FOUND');
  assert.equal(topic(c, '02').criteria.find((x) => x.id === '02-a').derived[0].value, '주 40시간');
  // 질문·이유는 '일부만 적혀 있거나 정해지지 않았어요'가 아니라 빠진 세부 정보를 말한다
  const f = buildFollowUps({ documents: [{ id: 'p', docType: 'job_posting', analysis: p }] });
  const w = all(f).find((x) => x.topicIds.includes('02'));
  assert.equal(w.kind, 'partial_detail');
  assert.equal(w.tier, 'more', '세부 숫자만 빠진 경우는 우선 확인으로 올리지 않는다');
  assert.match(w.reasons[0], /주 소정근로시간 숫자/);
  assert.match(w.question, /출퇴근 시각.*적혀 있지만 주 소정근로시간/);
});

test('오류 2: 계약서 임금이 분석 확인 불가가 되는 원인을 재현하고, 원인 코드를 남기며, 검증되지 않은 값은 보이지 않는다', async () => {
  const cases = [
    ['rewritten_value', QA_CONTRACT_SPECS, WAGE_FAILURE_MODES.rewritten_value, 'source_value_not_in_quote', '3,600만원'],
    ['joined_unit', QA_CONTRACT_SPECS, WAGE_FAILURE_MODES.joined_unit, 'source_value_not_in_quote', '연봉/월'],
    ['respaced_quote', QA_CONTRACT_SPECS, null, 'quote_not_in_line', '36,000,000 원'],
  ];
  for (const [mode, specs, toSpecs, code, leak] of cases) {
    const mutate = mode === 'respaced_quote'
      ? (x) => { for (const q of x.criteria.find((c) => c.id === '01-a').quotes) q.text = q.text.replace('36,000,000원', '36,000,000 원'); return x; }
      : undefined;
    const a = await analyze('contract', QA_CONTRACT, toSpecs ? toSpecs(specs) : specs, mutate);
    const wage = topic(a, '01');
    assert.equal(wage.status, 'MAIN_UNAVAILABLE', `${mode}: 재분석까지 같은 오류면 분석 확인 불가 유지 (검증을 느슨하게 하지 않음)`);
    const bad = wage.criteria.find((c) => c.status === 'UNAVAILABLE' && c.unavailableCodes.includes(code));
    assert.ok(bad, `${mode}: 원인 코드 ${code}를 남김`);
    assert.ok(!JSON.stringify(a).includes(leak), `${mode}: 검증되지 않은 값(${leak})이 결과에 없음`);
    const f = buildFollowUps({ documents: [{ id: 'c', docType: 'contract', analysis: a }] });
    assert.ok(f.reanalyze.some((x) => x.topicId === '01' && x.codes.includes(code)), `${mode}: 재분석 안내에 원인 코드`);
    assert.ok(!all(f).some((x) => x.topicIds.includes('01')), `${mode}: 회사 질문 없음`);
  }
  // 'conflict'로 잘못 분류하면 분석 확인 불가가 아니라 '모호함'이 된다 (다른 증상)
  const conflict = await analyze('contract', QA_CONTRACT, { ...QA_CONTRACT_SPECS, '01-a': { f: 'conflict', q: ['연봉 36,000,000원(세전)', '월 지급 기준액 3,000,000원(세전)'] } });
  assert.equal(topic(conflict, '01').status, 'MAIN_PARTIAL');
  // 올바른 응답이면 확인됨이고 두 원문을 모두 근거로 남긴다
  const ok = await analyze('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  assert.equal(topic(ok, '01').status, 'MAIN_FOUND');
  assert.deepEqual(topic(ok, '01').criteria.find((c) => c.id === '01-a').evidence.map((e) => e.text), ['연봉 36,000,000원(세전)', '월 지급 기준액 3,000,000원(세전)']);
});

test('오류 2-1: 연봉 3,600만원(오퍼) ↔ 연봉 36,000,000원·월 3,000,000원(계약서): 같은 단위끼리만 비교, 월↔연 환산 없음', async () => {
  const offer = await entry('offer', QA_OFFER, QA_OFFER_SPECS);
  const contract = await entry('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  const f = facet(relateRecord([offer, contract]), '01-a');
  assert.equal(f.relation, 'same');
  assert.match(f.notes.join(' '), /연봉 3,600만원로 같아요/);
  assert.match(f.notes.join(' '), /월급 300만원도 적혀 있어요\. 서로 환산하지 않았어요/);
  // 월 금액만 적힌 자료와 연봉만 적힌 자료는 같다고 보지 않는다
  const monthlyOnly = await entry('offer', '[가상] 안내\n급여: 월 3,000,000원', { '01-a': { f: 'specific', q: ['급여: 월 3,000,000원'], sv: '3,000,000원' }, '01-b': { f: 'specific', q: ['급여: 월 3,000,000원'], sv: '월' } });
  const offerAnnual = await entry('offer', QA_OFFER, QA_OFFER_SPECS);
  assert.equal(facet(relateRecord([offerAnnual, monthlyOnly]), '01-a').relation, 'incomparable');
});

test('오류 3: 계약기간과 고용형태 분리 — 정규직 문구는 계약기간 근거가 아니고, 계약서의 기간의 정함 없음만 근거', async () => {
  const p = await analyze('job_posting', QA_POSTING, QA_POSTING_SPECS);
  const c06a = p.criteria['06-a'];
  assert.equal(c06a.status, 'MISSING', '공고의 고용형태: 정규직은 06-a 근거에서 제외');
  assert.equal(topic(p, '05').status, 'MAIN_FOUND', '고용형태는 그대로 확인됨');
  const c = await analyze('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  assert.equal(c.criteria['06-a'].status, 'CONFIRMED');
  assert.deepEqual(c.criteria['06-a'].evidence.map((e) => e.text), ['근로계약 기간의 정함 없음']);
});

test('오류 4: 수습기간 3개월(공고·오퍼) ↔ 날짜와 3개월(계약서): 같은 기간으로 보고 날짜는 따로 알림, 날짜와 기간이 어긋나면 알림', async () => {
  const posting = await entry('job_posting', QA_POSTING, QA_POSTING_SPECS);
  const offer = await entry('offer', QA_OFFER, QA_OFFER_SPECS);
  const contract = await entry('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  const f = facet(relateRecord([posting, offer, contract]), '07-b');
  assert.equal(f.relation, 'same');
  assert.match(f.notes.join(' '), /적용 날짜\(2026\.11\.01~2027\.01\.31\)/);
  // 날짜와 기간이 맞지 않는 계약서
  const wrongText = QA_CONTRACT.replace('2027년 1월 31일까지(3개월)', '2027년 4월 30일까지(3개월)');
  const wrongSpecs = { ...QA_CONTRACT_SPECS, '07-a': { f: 'specific', q: ['수습기간: 2026년 11월 1일부터 2027년 4월 30일까지(3개월)'], sv: '수습기간' }, '07-b': { f: 'specific', q: ['수습기간: 2026년 11월 1일부터 2027년 4월 30일까지(3개월)'], sv: '2026년 11월 1일부터 2027년 4월 30일까지(3개월)' } };
  const wrong = await entry('contract', wrongText, wrongSpecs);
  const fw = facet(relateRecord([posting, wrong]), '07-b');
  assert.equal(fw.relation, 'incomparable');
  assert.match(fw.notes.join(' '), /날짜\(2026\.11\.01~2027\.04\.30\)와 기간\(3개월\)이 서로 맞는지 확인이 필요해요/);
  // 날짜만 적힌 자료: 같다고 확정하지 않고 공통점(3개월에 해당)을 알림
  const datesOnly = await entry('contract', '[가상] 계약서\n수습기간: 2026년 11월 1일부터 2027년 1월 31일까지', { '07-a': { f: 'specific', q: ['수습기간: 2026년 11월 1일부터 2027년 1월 31일까지'], sv: '수습기간' }, '07-b': { f: 'specific', q: ['수습기간: 2026년 11월 1일부터 2027년 1월 31일까지'], sv: '2026년 11월 1일부터 2027년 1월 31일까지' } });
  const fd = facet(relateRecord([posting, datesOnly]), '07-b');
  assert.equal(fd.relation, 'incomparable');
  assert.match(fd.notes.join(' '), /3개월에 해당하지만, 적용 시작일은 따로 확인/);
});

test('시나리오 1~3: 공고 → 오퍼 → 계약서. 요약(다름·구체화·확인 필요), 대표 질문 1개, 이전 자료 보존', async () => {
  const posting = await entry('job_posting', QA_POSTING, QA_POSTING_SPECS);
  // 1) 공고 하나
  const f1 = buildFollowUps({ documents: [posting] });
  assert.equal(facet(f1.relation, '01-a').sides[0].display, '3,400만원');
  assert.equal(facet(f1.relation, '02-b').sides[0].display, '09:00~18:00');
  assert.equal(topic(posting.analysis, '08').status, 'MAIN_PARTIAL', "수습 급여 '별도 안내'는 구체적인 금액이 아님");
  assert.equal(posting.analysis.criteria['08-a'].sourceValue, null);
  assert.deepEqual(f1.summary.different, []);
  assert.deepEqual(f1.summary.specified, []);

  // 2) 오퍼 추가
  const offer = await entry('offer', QA_OFFER, QA_OFFER_SPECS);
  const f2 = buildFollowUps({ documents: [posting, offer] });
  assert.deepEqual(f2.summary.different.map((x) => x.topicId).sort(), ['01', '02']);
  assert.equal(item(f2.relation, '03').relation, 'same', '근무장소 공통');
  assert.equal(item(f2.relation, '05').relation, 'same', '고용형태 공통');
  const hours = all(f2).find((x) => x.topicIds.includes('02'));
  assert.equal(hours.question, '채용공고에는 근무시간이 09:00~18:00, 오퍼·합격 안내에는 10:00~19:00으로 기재되어 있습니다. 실제 적용되는 근무시간을 확인 부탁드립니다.');
  assert.ok(hours.extraQuestions.length <= 2, '추가 질문은 선택형으로 최대 2개');
  assert.ok(!hours.extraQuestions.some((q) => q === hours.question), '대표 질문과 같은 추가 질문 없음');
  assert.ok(hours.extraQuestions.some((q) => /휴게시간/.test(q)), '휴게 시각 차이는 추가 질문으로');
  assert.equal(item(f2.relation, '02').facets.find((x) => x.id === '02-a').relation, null, '두 자료 모두 주 N시간 숫자가 없으면 비교 어려움으로 표시하지 않음');
  for (const x of all(f2)) assert.ok(!x.question || x.question.length < 180, `질문이 짧음: ${x.label} ${x.question?.length}`);

  // 3) 계약서 추가
  const contract = await entry('contract', QA_CONTRACT, QA_CONTRACT_SPECS);
  const before = JSON.stringify([posting, offer]);
  const f3 = buildFollowUps({ documents: [posting, offer, contract] });
  assert.equal(JSON.stringify([posting, offer]), before, '이전 자료는 바뀌지 않음');
  const wage = all(f3).find((x) => x.topicIds.includes('01'));
  assert.equal(wage.kind, 'different_stated');
  assert.match(wage.question, /^채용공고에는 급여가 3,400만원, 오퍼·합격 안내에는 3,600만원, 근로계약서에는 연봉 36,000,000원\(세전\)/);
  assert.equal(topic(contract.analysis, '01').status, 'MAIN_FOUND', '올바른 응답에서 계약서 임금은 확인됨');
  // 수습 중 급여: 처음 구체화
  assert.equal(item(f3.relation, '08').relation, 'newly_specified');
  const spec08 = f3.summary.specified.find((x) => x.topicId === '08');
  assert.equal(spec08.line, '이전 자료에는 구체적인 수습 중 급여가 없었지만, 근로계약서에는 정규 급여의 90%, 월 2,700,000원(세전)으로 적혀 있어요.');
  assert.doesNotMatch(spec08.line, /변경|위반/);
  // 계약기간은 계약서에 처음 적힘, 수습기간은 같은 3개월
  assert.equal(item(f3.relation, '06').relation, 'newly_stated');
  assert.equal(item(f3.relation, '07').relation, 'same');
  // 대표 질문은 항목마다 하나, 같은 문장 반복 없음
  const qs = all(f3).flatMap((x) => [x.question, ...x.extraQuestions]).filter(Boolean);
  assert.equal(new Set(qs).size, qs.length);
  assert.equal(new Set(all(f3).map((x) => x.key)).size, all(f3).length);
  for (const x of all(f3)) for (const q of [x.question, ...x.extraQuestions].filter(Boolean)) assert.doesNotMatch(q, /(위반|불법|무효|합법)/);
});

test('조사: 으로/로', () => {
  assert.equal(euro('10:00~19:00'), '10:00~19:00으로');
  assert.equal(euro('3,400만원'), '3,400만원으로');
  assert.equal(euro('정규 급여의 90%'), '정규 급여의 90%로');
  assert.equal(euro('월 2,700,000원(세전)'), '월 2,700,000원(세전)으로');
  assert.equal(euro('3개월'), '3개월로');
  assert.equal(euro('09:00~18:07'), '09:00~18:07로');
});
