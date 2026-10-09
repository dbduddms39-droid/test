// 점검 기준 v2.2 규칙 엔진 테스트: F01~F11 기획상 기대 판정(오라클)과 서버 검증·규칙의 결과를 비교한다.
// 추출값은 사람이 작성한 '올바른 AI 응답'이며, 실제 Gemini 결과가 아니다 (test/v22-fixtures.js 참고).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, planHolds } from '../src/analyze.js';
import { CRITERION_IDS, CRITERIA, TOPICS, NOTES, criteriaOfTopics } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { verifyResponse } from '../src/verify.js';
import { FIXTURES, TOP_CODE, buildExtraction, rangesOf } from './v22-fixtures.js';
import { scriptedAI } from './helpers.js';

const fx = (key) => FIXTURES.find((f) => f.key === key);
const sub = (result, id) => result.topics.find((t) => t.id === id.slice(0, 2)).criteria.find((c) => c.id === id);
const topic = (result, id) => result.topics.find((t) => t.id === id);

// 문서와 추출 사양으로 분석을 실행한다. specs 일부를 바꿔 AI의 잘못된 응답을 흉내 낼 수 있다.
async function run({ text, docType = 'job_posting', specs, retrySpecs, lowConfidence = [] }) {
  const segments = segmentText(text);
  const first = buildExtraction(segments, specs, CRITERION_IDS);
  const responses = [first];
  if (retrySpecs) responses.push((args) => buildExtraction(segments, retrySpecs, args.criterionIds));
  const ai = scriptedAI(...responses);
  const result = await analyzeDocument({ text, docType, ai, lowConfidence: rangesOf(text, lowConfidence) });
  return { result, ai };
}

test('기준 데이터: 10개 주제, 32개 세부기준, 핵심(C)·추가(D)·조건부 핵심이 동결 기준표와 같음', () => {
  assert.equal(TOPICS.length, 10);
  assert.equal(CRITERIA.length, 32);
  const C = CRITERIA.filter((c) => c.role === 'C').map((c) => c.id);
  assert.deepEqual(C, ['01-a', '01-b', '02-a', '03-a', '04-a', '05-a', '06-a', '06-b', '07-a', '07-b', '08-a', '09-a', '10-a', '10-b']);
  assert.deepEqual(CRITERIA.filter((c) => c.condition).map((c) => `${c.id}:${c.condition}`), ['06-b:fixed_term', '07-b:probation_applies', '10-b:leave_granted']);
  assert.deepEqual(TOPICS.filter((t) => t.conditional).map((t) => t.id), ['08']);
});

for (const f of FIXTURES) {
  test(`${f.key} ${f.title}: 기획상 기대 판정과 일치`, async () => {
    const { result, ai } = await run({ text: f.text, docType: f.docType, specs: f.extraction, lowConfidence: f.lowConfidence });
    assert.equal(ai.calls.length, 1, '올바른 인용이면 재분석하지 않음');
    // 상위 상태와 08 미표시
    const got = result.topics.map((t) => (t.visible ? Object.entries(TOP_CODE).find(([, v]) => v === t.status)[0] : '-'));
    assert.deepEqual(got, f.oracle.top);
    assert.equal(result.counts.shown, f.oracle.top.includes('-') ? 9 : 10, '표시 항목 수는 9개 또는 10개');
    // 숨긴 08에는 상태를 만들지 않음
    const t08 = topic(result, '08');
    if (!t08.visible) assert.equal(t08.status, null);
    // 세부 상태
    for (const [id, status] of Object.entries(f.oracle.detail)) assert.equal(sub(result, id).status, status, `${id}`);
    // 안내 노출 (채점 제외 칸은 건너뜀)
    for (const t of result.topics.filter((x) => x.visible)) {
      if (f.oracle.notesExcluded?.includes(t.id)) continue;
      assert.deepEqual(Object.keys(t.notes).sort(), [...(f.oracle.notes[t.id] ?? [])].sort(), `${t.id} 안내`);
    }
    // 화면에 보이는 근거는 모두 입력 원문의 해당 줄에 실제로 있음
    for (const t of result.topics) for (const c of t.criteria) for (const e of c.evidence) {
      assert.ok(result.lines[e.line - 1].text.includes(e.text), `${c.id} 근거`);
    }
  });
}

test('F06·F09: 원래 오라클과 다른 칸은 동결 기준표·사전등록 보완값을 따른다 (차이 기록)', async () => {
  for (const key of ['F06', 'F09']) {
    const f = fx(key);
    const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction });
    for (const [id, original] of Object.entries(f.originalOracle)) {
      assert.notEqual(sub(result, id).status, original, `${key} ${id}: 원래 오라클(${original})이 아니라 보완값`);
      assert.equal(sub(result, id).status, f.oracle.detail[id]);
    }
  }
});

test("'급여 300만원': AI가 단위를 확인됨으로 내도 단위 언급이 없으면 01-b 확인되지 않음, 01 일부 내용만", async () => {
  const { result } = await run({
    text: '급여 300만원',
    specs: { '01-a': { f: 'specific', q: ['급여 300만원'], sv: '300만원' }, '01-b': { f: 'specific', q: ['급여 300만원'] } },
  });
  assert.equal(sub(result, '01-a').status, 'CONFIRMED');
  assert.equal(sub(result, '01-b').status, 'MISSING');
  assert.equal(topic(result, '01').status, 'MAIN_PARTIAL');
});

test("'주 5일 근무': AI가 휴일 근거로 인용해도 휴일 지정으로 보지 않음 (09 관련 내용 찾지 못함, 근거는 02에만)", async () => {
  const { result } = await run({
    text: '근무: 주 5일 근무',
    specs: { '02-a': { f: 'coarse', q: ['주 5일 근무'] }, '09-a': { f: 'specific', q: ['주 5일 근무'] } },
  });
  assert.equal(sub(result, '09-a').status, 'MISSING');
  assert.equal(topic(result, '09').status, 'MAIN_MISSING');
  assert.equal(sub(result, '09-a').evidence.length, 0);
  assert.equal(sub(result, '02-a').evidence[0].text, '주 5일 근무');
});

test("'토·일 휴무'·'휴무일: 매주 일요일': 휴무만으로 지정된 휴일을 추론하지 않음 (09-a 최대 일부 확인)", async () => {
  for (const line of ['휴일·휴무: 토요일과 일요일 휴무', '휴무일: 매주 일요일']) {
    const { result } = await run({ text: line, specs: { '09-a': { f: 'specific', q: [line.split(': ')[1]] } } });
    assert.equal(sub(result, '09-a').status, 'PARTIAL', line);
    assert.equal(topic(result, '09').status, 'MAIN_PARTIAL');
  }
});

test("'연차 15일': 부여 사실(10-a 확인됨)과 부여 기준(10-b 일부 확인)을 구분, 상위 일부 내용만", async () => {
  const { result } = await run({
    text: '연차: 연차 15일',
    specs: { '10-a': { f: 'specific', q: ['연차 15일'], sv: '연차 15일' }, '10-b': { f: 'coarse', q: ['연차 15일'] } },
  });
  assert.equal(sub(result, '10-a').status, 'CONFIRMED');
  assert.equal(sub(result, '10-b').status, 'PARTIAL');
  assert.equal(topic(result, '10').status, 'MAIN_PARTIAL');
});

test("연차 외부 참조만('관계 법령에 따름'): AI가 확인됨으로 내도 10-a 일부 확인, 10-b는 부여가 확인되지 않아 조건부 핵심 아님", async () => {
  const { result } = await run({ text: '연차는 관계 법령에 따른다', specs: { '10-a': { f: 'specific', q: ['연차는 관계 법령에 따른다'] } } });
  assert.equal(sub(result, '10-a').status, 'PARTIAL');
  assert.equal(sub(result, '10-b').status, 'MISSING');
  assert.equal(sub(result, '10-b').required, false);
  assert.equal(topic(result, '10').status, 'MAIN_PARTIAL');
});

test('수습 미적용·미정·언급 없음이면 08 미표시 (상태 없음, 9개 표시), 미정·언급 없음은 07에 보류 안내', async () => {
  const cases = [
    ['수습기간: 없음', { '07-a': { f: 'negated', q: ['수습기간: 없음'], sv: '없음' } }, 'MAIN_FOUND', false],
    ['수습 여부 추후 결정, 적용 시 급여 90% 예정', { '07-a': { f: 'undecided', q: ['수습 여부 추후 결정'] }, '08-a': { f: 'specific', q: ['적용 시 급여 90% 예정'] } }, 'MAIN_PARTIAL', true],
    ['연봉 4,000만원', {}, 'MAIN_MISSING', true],
  ];
  for (const [text, specs, s07, hold] of cases) {
    const { result } = await run({ text, specs });
    assert.equal(topic(result, '08').visible, false, text);
    assert.equal(topic(result, '08').status, null);
    assert.equal(result.counts.shown, 9);
    assert.equal(topic(result, '07').status, s07, text);
    assert.equal(Boolean(topic(result, '07').notes.probationHold), hold, text);
    if (hold) assert.equal(topic(result, '07').notes.probationHold, NOTES.probationHold);
  }
});

test("수습 적용·기간 미정: 08 표시, 07 일부 내용만 / '수습 3개월'+'수습 중 급여 90%': 08 주요 내용 기재됨(금액 환산 없음)", async () => {
  const a = (await run({ text: '수습 적용, 기간은 추후 안내', specs: { '07-a': { f: 'specific', q: ['수습 적용'], sv: '수습' }, '07-b': { f: 'undecided', q: ['기간은 추후 안내'] } } })).result;
  assert.equal(topic(a, '08').visible, true);
  assert.equal(topic(a, '07').status, 'MAIN_PARTIAL');
  assert.equal(a.counts.shown, 10);
  const b = (await run({ text: '수습 3개월\n수습 중 급여 90%', specs: { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'], sv: '3개월' }, '08-a': { f: 'specific', q: ['수습 중 급여 90%'], sv: '90%' } } })).result;
  assert.equal(topic(b, '07').status, 'MAIN_FOUND');
  assert.equal(topic(b, '08').status, 'MAIN_FOUND');
  assert.equal(sub(b, '08-a').sourceValue, '90%');
  assert.equal(sub(b, '08-a').derived, null);
});

test('상충하는 두 임금값: 두 원문을 모두 보존하고 01-a 불분명함, 01 일부 내용만 (하나를 고르지 않음)', async () => {
  const f = fx('F05');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction, lowConfidence: f.lowConfidence });
  const ev = sub(result, '01-a').evidence.map((e) => e.text);
  assert.deepEqual(ev, ['연봉 4,200만원', '연봉 3,900만원']);
  assert.equal(sub(result, '01-a').status, 'UNCLEAR');
  assert.equal(topic(result, '01').status, 'MAIN_PARTIAL');
  // 상충인데 인용이 하나뿐이면 검증 실패 → 보류·재분석
  const one = buildExtraction(segmentText(f.text), { ...f.extraction, '01-a': { f: 'conflict', q: ['연봉 4,200만원'] } }, CRITERION_IDS);
  assert.ok(verifyResponse(one, CRITERION_IDS, segmentText(f.text))['01-a'].errors.includes('conflict_needs_two'));
});

test('허위 인용(F05-X1 월급 500만원): 항목 보류 → 1회 재분석 → 다시 실패하면 01-a·01 분석 확인 불가 (확인되지 않음으로 처리하지 않음)', async () => {
  const f = fx('F05');
  const segments = segmentText(f.text);
  const line = segments.find((s) => s.text.includes('임금 1')).id;
  const fake = buildExtraction(segments, f.extraction, CRITERION_IDS);
  fake.criteria.find((c) => c.id === '01-a').quotes = [{ line, text: '월급 500만원' }];
  const fakeRetry = (args) => {
    const r = buildExtraction(segments, f.extraction, args.criterionIds);
    r.criteria.find((c) => c.id === '01-a').quotes = [{ line, text: '월급 500만원' }];
    return r;
  };
  const ai = scriptedAI(fake, fakeRetry);
  const result = await analyzeDocument({ text: f.text, docType: f.docType, ai, lowConfidence: rangesOf(f.text, f.lowConfidence) });
  assert.equal(ai.calls.length, 2);
  assert.deepEqual(ai.calls[1].criterionIds, criteriaOfTopics(['01']), '실패한 상위 항목(01)만 재분석');
  assert.ok(ai.calls[1].feedback['01-a'].includes('quote_not_in_line'));
  assert.equal(sub(result, '01-a').status, 'UNAVAILABLE');
  assert.equal(topic(result, '01').status, 'MAIN_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('월급 500만원'), '허위 구절을 화면에 보이지 않음');
  // 다른 항목의 검증된 결과는 유지
  assert.equal(topic(result, '04').status, 'MAIN_FOUND');
});

test('허위 인용 후 재분석에서 근거가 모두 검증되면 정상 상태 (상충 두 근거 → 01-a 불분명함)', async () => {
  const f = fx('F05');
  const segments = segmentText(f.text);
  const fake = buildExtraction(segments, f.extraction, CRITERION_IDS);
  fake.criteria.find((c) => c.id === '01-a').quotes[1].text = '연봉 9,900만원';
  const ai = scriptedAI(fake, (args) => buildExtraction(segments, f.extraction, args.criterionIds));
  const result = await analyzeDocument({ text: f.text, docType: f.docType, ai, lowConfidence: rangesOf(f.text, f.lowConfidence) });
  assert.equal(ai.calls.length, 2);
  assert.equal(sub(result, '01-a').status, 'UNCLEAR');
  assert.equal(topic(result, '01').status, 'MAIN_PARTIAL');
});

test('추가(D)만 검증 실패하고 핵심(C) 근거와 다른 줄이면 그 D만 분석 확인 불가, 재분석 없음, 상위 유지', async () => {
  const text = '연봉 4,000만원\n급여는 매월 25일 지급';
  const segments = segmentText(text);
  const specs = { '01-a': { f: 'specific', q: ['연봉 4,000만원'], sv: '4,000만원' }, '01-b': { f: 'specific', q: ['연봉 4,000만원'], sv: '연봉' }, '01-f': { f: 'specific', q: ['매월 25일 지급'] } };
  const raw = buildExtraction(segments, specs, CRITERION_IDS);
  raw.criteria.find((c) => c.id === '01-f').quotes[0].text = '매월 15일 지급';
  const ai = scriptedAI(raw);
  const result = await analyzeDocument({ text, docType: 'offer', ai });
  assert.equal(ai.calls.length, 1);
  assert.equal(sub(result, '01-f').status, 'UNAVAILABLE');
  assert.equal(topic(result, '01').status, 'MAIN_FOUND');
});

test('추가(D) 오류가 핵심(C) 근거와 같은 줄이면 독립성이 입증되지 않아 상위 항목 전체를 재분석', async () => {
  const text = '연봉 4,000만원, 매월 25일 지급';
  const segments = segmentText(text);
  const specs = { '01-a': { f: 'specific', q: ['연봉 4,000만원'], sv: '4,000만원' }, '01-b': { f: 'specific', q: ['연봉 4,000만원'], sv: '연봉' }, '01-f': { f: 'specific', q: ['매월 25일 지급'] } };
  const raw = buildExtraction(segments, specs, CRITERION_IDS);
  raw.criteria.find((c) => c.id === '01-f').quotes[0].text = '매월 15일 지급';
  const entries = verifyResponse(raw, CRITERION_IDS, segments);
  assert.deepEqual(planHolds(entries, segments), { held: ['01'], independentD: [] });
  const ai = scriptedAI(raw, (args) => buildExtraction(segments, specs, args.criterionIds));
  const result = await analyzeDocument({ text, docType: 'offer', ai });
  assert.equal(ai.calls.length, 2);
  assert.equal(sub(result, '01-f').status, 'CONFIRMED');
  assert.equal(topic(result, '01').status, 'MAIN_FOUND');
});

test('세부기준 응답 누락·없는 줄 번호는 독립 오류가 아니므로 항목 재분석, 재분석 호출 실패 시 핵심은 분석 확인 불가', async () => {
  const text = '연봉 4,000만원';
  const segments = segmentText(text);
  const specs = { '01-a': { f: 'specific', q: ['연봉 4,000만원'], sv: '4,000만원' }, '01-b': { f: 'specific', q: ['연봉 4,000만원'], sv: '연봉' } };
  const raw = buildExtraction(segments, specs, CRITERION_IDS);
  raw.criteria = raw.criteria.filter((c) => c.id !== '01-g');
  const err = Object.assign(new Error('x'), { code: 'upstream_error', httpStatus: 503 });
  const ai = scriptedAI(raw, err);
  const result = await analyzeDocument({ text, docType: 'offer', ai });
  assert.equal(ai.calls.length, 2);
  assert.equal(topic(result, '01').status, 'MAIN_UNAVAILABLE');
  assert.equal(topic(result, '02').status, 'MAIN_MISSING', '다른 항목 결과는 유지');
});

test('핵심 OCR 저신뢰(F08-X1 주소 번지): 03-a 분석 확인 불가, 03 분석 확인 불가 (일부 확인·확인되지 않음으로 바꾸지 않음)', async () => {
  const f = fx('F08');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction, lowConfidence: ['상도로 77'] });
  assert.equal(sub(result, '03-a').status, 'UNAVAILABLE');
  assert.equal(sub(result, '03-a').evidence.length, 0);
  assert.equal(topic(result, '03').status, 'MAIN_UNAVAILABLE');
  assert.equal(topic(result, '01').status, 'MAIN_FOUND', '다른 항목 유지');
  // 저신뢰 구절이 텍스트에서 고쳐졌다면(사용자 수정) 근거에 없으므로 영향 없음
  const fixed = f.text.replace('2O일', '20일');
  const r2 = (await run({ text: fixed, docType: f.docType, specs: { ...f.extraction, '01-f': { f: 'specific', q: ['매월 20일 지급'], sv: '매월 20일' } }, lowConfidence: f.lowConfidence })).result;
  assert.equal(sub(r2, '01-f').status, 'CONFIRMED');
});

test('저신뢰 메타데이터가 없으면 오탈자처럼 보여도 분석 확인 불가를 만들지 않음 (근거 없는 자동 OCR 판정 금지)', async () => {
  const f = fx('F05');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction });
  assert.equal(sub(result, '03-a').status, 'CONFIRMED');
});

test('02-a 계산값: 원문 기재값과 분리(value_kind calculated, 산식), 격주 근무는 주별 값을 평균 없이 보존', async () => {
  const f5 = (await run({ text: fx('F05').text, specs: fx('F05').extraction })).result;
  const a = sub(f5, '02-a');
  assert.equal(a.valueKind, 'calculated');
  assert.deepEqual(a.derived.map((d) => d.value), ['주 40시간']);
  assert.match(a.derived[0].derivation, /18:00−09:00 − 휴게 60분\) × 5일 = 주 40시간/);
  const f9 = (await run({ text: fx('F09').text, specs: fx('F09').extraction })).result;
  assert.deepEqual(sub(f9, '02-a').derived.map((d) => d.value), ['주 40시간', '주 43시간']);
  const f1 = (await run({ text: fx('F01').text, specs: fx('F01').extraction })).result;
  assert.equal(sub(f1, '02-a').valueKind, 'quoted', '원문에 적힌 주 40시간은 계산값으로 둔갑하지 않음');
  assert.equal(sub(f1, '02-a').derived, null);
});

test("'월~금 09:00~18:00'만 있으면 휴게를 가정해 계산하지 않음 (02-a 일부 확인, 02-b 확인됨)", async () => {
  const text = '월~금 09:00~18:00';
  const { result } = await run({
    text,
    specs: {
      '02-a': { f: 'specific', q: [text], kind: 'calculated', calc: { entries: [{ label: '월~금', hours: 40, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 60 }] }] } },
      '02-b': { f: 'specific', q: ['09:00~18:00'] },
    },
  });
  assert.equal(sub(result, '02-a').status, 'PARTIAL');
  assert.equal(sub(result, '02-a').derived, null);
  assert.equal(sub(result, '02-b').status, 'CONFIRMED');
  assert.equal(topic(result, '02').status, 'MAIN_PARTIAL');
  // 계산이 틀려도 확정하지 않음
  const bad = (await run({ text: '월~금 09:00~18:00, 휴게 12:00~13:00', specs: { '02-a': { f: 'specific', q: ['월~금 09:00~18:00, 휴게 12:00~13:00'], kind: 'calculated', calc: { entries: [{ label: 'x', hours: 45, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 60 }] }] } } } })).result;
  assert.equal(sub(bad, '02-a').status, 'PARTIAL');
});

test('포괄 문구는 어느 항목의 근거로도 쓰지 않음 (AI가 인용해도 제외 → 확인되지 않음)', async () => {
  const text = '기타 조건은 별도 안내';
  const { result } = await run({ text, specs: { '01-a': { f: 'undecided', q: [text] }, '06-a': { f: 'undecided', q: [text] } } });
  assert.equal(sub(result, '01-a').status, 'MISSING');
  assert.equal(topic(result, '06').status, 'MAIN_MISSING');
});

test("명시적 부정: 06 '기간의 정함이 없음'은 중립 안내 없음, '휴일 없음'·'수습 중 급여 미지급'은 일부 내용만 + 중립 안내", async () => {
  const r6 = (await run({ text: '기간의 정함이 없는 근로계약', specs: { '06-a': { f: 'specific', q: ['기간의 정함이 없는 근로계약'], term: 'indefinite' } } })).result;
  assert.equal(topic(r6, '06').status, 'MAIN_FOUND');
  assert.equal(sub(r6, '06-b').status, 'NOT_APPLICABLE');
  assert.deepEqual(topic(r6, '06').notes, {});
  const r9 = (await run({ text: '휴일: 없음', specs: { '09-a': { f: 'negated', q: ['휴일: 없음'], sv: '없음' } } })).result;
  assert.equal(sub(r9, '09-a').status, 'PARTIAL');
  assert.equal(topic(r9, '09').status, 'MAIN_PARTIAL');
  assert.deepEqual(topic(r9, '09').notes, { neutral: NOTES.neutral, applicability: NOTES.applicability });
  const r8 = (await run({ text: '수습 3개월\n수습 중 급여 미지급', specs: { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'] }, '08-a': { f: 'negated', q: ['수습 중 급여 미지급'] } } })).result;
  assert.equal(topic(r8, '08').status, 'MAIN_PARTIAL');
  assert.deepEqual(topic(r8, '08').notes, { neutral: NOTES.neutral }, '08은 휴일·연차가 아니므로 적용 안내 없음');
});

test("'휴게시간을 두지 않음'(02-c)에는 중립 안내를 붙이지 않음 (D04 미결정, 진단만)", async () => {
  const f = fx('F10');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction });
  assert.deepEqual(topic(result, '02').notes, {});
});

test('사업장 인원·주당 시간 숫자만으로 적용 안내를 만들거나 해당 없음으로 바꾸지 않음 (F04·F10·F11)', async () => {
  for (const key of ['F04', 'F10', 'F11']) {
    const f = fx(key);
    const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction, lowConfidence: f.lowConfidence });
    const withApplicability = result.topics.filter((t) => t.notes.applicability).map((t) => t.id);
    assert.ok(withApplicability.every((id) => id === '09' || id === '10'), key);
  }
});

test('출처 코드: 기간제·단시간 문서는 03-a·04-a L-W, 단시간은 02-d L-W, 그 외는 L-M·S', async () => {
  const f3 = (await run({ text: fx('F03').text, specs: fx('F03').extraction })).result;
  assert.deepEqual(sub(f3, '03-a').sources, ['L-W']);
  assert.deepEqual(sub(f3, '02-d').sources, ['L-W']);
  const f1 = (await run({ text: fx('F01').text, specs: fx('F01').extraction })).result;
  assert.deepEqual(sub(f1, '03-a').sources, ['L-M']);
  assert.deepEqual(sub(f1, '02-d').sources, ['S']);
});

test('문서 유형이 달라도 기재 상태는 같고 출처 안내 문구만 다름', async () => {
  const f = fx('F04');
  const a = (await run({ text: f.text, docType: 'offer', specs: f.extraction })).result;
  const b = (await run({ text: f.text, docType: 'contract', specs: f.extraction })).result;
  assert.deepEqual(a.topics.map((t) => t.status), b.topics.map((t) => t.status));
  assert.notEqual(a.sourceGuide, b.sourceGuide);
});

// R01~R29: 기준표 4-1과 1:1 대응하는 짧은 예시 (ildan_check_fixtures_expectations_v2.1.md 7장)
// [ID, 입력, 올바른 추출, 기대 세부, 기대 상위 { 주제: 상태 }]
const R = [
  ['R01', '연봉 4,000만원', { '01-a': { f: 'specific', q: ['연봉 4,000만원'] }, '01-b': { f: 'specific', q: ['연봉 4,000만원'] } }, { '01-a': 'CONFIRMED', '01-b': 'CONFIRMED', '01-e': 'MISSING' }, { '01': 'MAIN_FOUND' }],
  ['R02', '급여 300만원', { '01-a': { f: 'specific', q: ['급여 300만원'] } }, { '01-a': 'CONFIRMED', '01-b': 'MISSING' }, { '01': 'MAIN_PARTIAL' }],
  ['R03', '급여 협의', { '01-a': { f: 'undecided', q: ['급여 협의'] } }, { '01-a': 'UNCLEAR', '01-b': 'MISSING' }, { '01': 'MAIN_PARTIAL' }],
  ['R04', '연봉 3,000~5,000만원, 경력 따라 협의', { '01-a': { f: 'undecided', q: ['연봉 3,000~5,000만원, 경력 따라 협의'] }, '01-b': { f: 'specific', q: ['연봉 3,000~5,000만원'] } }, { '01-a': 'UNCLEAR', '01-b': 'CONFIRMED' }, { '01': 'MAIN_PARTIAL' }],
  ['R05', '주 40시간', { '02-a': { f: 'specific', q: ['주 40시간'], kind: 'quoted' } }, { '02-a': 'CONFIRMED' }, { '02': 'MAIN_FOUND' }],
  ['R06', '월~금 09:00~18:00', { '02-a': { f: 'coarse', q: ['월~금 09:00~18:00'] }, '02-b': { f: 'specific', q: ['09:00~18:00'] } }, { '02-a': 'PARTIAL', '02-b': 'CONFIRMED' }, { '02': 'MAIN_PARTIAL' }],
  ['R07', '월~금 09:00~18:00, 휴게 12:00~13:00', { '02-a': { f: 'specific', q: ['월~금 09:00~18:00, 휴게 12:00~13:00'], kind: 'calculated', calc: { entries: [{ label: '월~금', hours: 40, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 60 }] }] } } }, { '02-a': 'CONFIRMED' }, { '02': 'MAIN_FOUND' }],
  ['R08', '서울 근무', { '03-a': { f: 'coarse', q: ['서울 근무'] } }, { '03-a': 'PARTIAL' }, { '03': 'MAIN_PARTIAL' }],
  ['R09', '서비스 기획자', { '04-a': { f: 'coarse', q: ['서비스 기획자'] } }, { '04-a': 'PARTIAL' }, { '04': 'MAIN_PARTIAL' }],
  ['R10', '인턴', { '05-a': { f: 'coarse', q: ['인턴'] } }, { '05-a': 'PARTIAL' }, { '05': 'MAIN_PARTIAL' }],
  ['R11', '정규직', { '05-a': { f: 'specific', q: ['정규직'] } }, { '05-a': 'CONFIRMED', '06-a': 'MISSING' }, { '05': 'MAIN_FOUND', '06': 'MAIN_MISSING' }],
  ['R12', '계약기간 1년', { '06-a': { f: 'specific', q: ['계약기간 1년'], term: 'fixed' }, '06-b': { f: 'coarse', q: ['계약기간 1년'] } }, { '06-a': 'CONFIRMED', '06-b': 'PARTIAL' }, { '06': 'MAIN_PARTIAL' }],
  ['R13', '기간의 정함이 없는 근로계약', { '06-a': { f: 'specific', q: ['기간의 정함이 없는 근로계약'], term: 'indefinite' } }, { '06-a': 'CONFIRMED', '06-b': 'NOT_APPLICABLE' }, { '06': 'MAIN_FOUND' }],
  ['R14', '수습 3개월', { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'] } }, { '07-a': 'CONFIRMED', '07-b': 'CONFIRMED' }, { '07': 'MAIN_FOUND', '08': 'MAIN_MISSING' }],
  ['R15', '수습 없음', { '07-a': { f: 'negated', q: ['수습 없음'], sv: '없음' } }, { '07-b': 'NOT_APPLICABLE' }, { '07': 'MAIN_FOUND', '08': null }],
  ['R16', '수습 여부 추후 결정', { '07-a': { f: 'undecided', q: ['수습 여부 추후 결정'] } }, { '07-a': 'UNCLEAR' }, { '07': 'MAIN_PARTIAL', '08': null }],
  ['R17', '수습 3개월\n수습 중 급여 90%', { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'] }, '08-a': { f: 'specific', q: ['수습 중 급여 90%'] } }, { '08-a': 'CONFIRMED' }, { '08': 'MAIN_FOUND' }],
  ['R18', '주휴일 매주 일요일', { '09-a': { f: 'specific', q: ['주휴일 매주 일요일'] } }, { '09-a': 'CONFIRMED', '09-b': 'MISSING' }, { '09': 'MAIN_FOUND' }],
  ['R19', '휴일 회사 내규', { '09-a': { f: 'coarse', q: ['휴일 회사 내규'] } }, { '09-a': 'PARTIAL' }, { '09': 'MAIN_PARTIAL' }],
  ['R20', '휴일 없음', { '09-a': { f: 'negated', q: ['휴일 없음'] } }, { '09-a': 'PARTIAL' }, { '09': 'MAIN_PARTIAL' }],
  ['R21', '주 5일 근무', { '02-a': { f: 'coarse', q: ['주 5일 근무'] } }, { '09-a': 'MISSING' }, { '09': 'MAIN_MISSING' }],
  ['R22', '연차는 법령에 따름', { '10-a': { f: 'coarse', q: ['연차는 법령에 따름'] } }, { '10-a': 'PARTIAL', '10-b': 'MISSING' }, { '10': 'MAIN_PARTIAL' }],
  ['R23', '연차는 회사 내규에 따름', { '10-a': { f: 'coarse', q: ['연차는 회사 내규에 따름'] } }, { '10-a': 'PARTIAL', '10-b': 'MISSING' }, { '10': 'MAIN_PARTIAL' }],
  ['R24', '연차 15일', { '10-a': { f: 'specific', q: ['연차 15일'] }, '10-b': { f: 'coarse', q: ['연차 15일'] } }, { '10-a': 'CONFIRMED', '10-b': 'PARTIAL' }, { '10': 'MAIN_PARTIAL' }],
  ['R25', '입사 1년 미만 근로자: 1개월 개근 시 1일', { '10-a': { f: 'specific', q: ['1개월 개근 시 1일'] }, '10-b': { f: 'specific', q: ['입사 1년 미만 근로자: 1개월 개근 시 1일'] } }, { '10-a': 'CONFIRMED', '10-b': 'CONFIRMED' }, { '10': 'MAIN_FOUND' }],
  ['R26', '연차 없음', { '10-a': { f: 'negated', q: ['연차 없음'], sv: '없음' } }, { '10-a': 'CONFIRMED', '10-b': 'NOT_APPLICABLE' }, { '10': 'MAIN_FOUND' }],
  ['R27', '연봉 4,200만원\n연봉 3,900만원', { '01-a': { f: 'conflict', q: ['연봉 4,200만원', '연봉 3,900만원'] }, '01-b': { f: 'specific', q: ['연봉 4,200만원'] } }, { '01-a': 'UNCLEAR' }, { '01': 'MAIN_PARTIAL' }],
];

test('R01~R27 짧은 예시: 기준표 4-1 고정 규칙과 일치', async () => {
  for (const [rid, text, specs, detail, tops] of R) {
    const { result } = await run({ text, specs });
    for (const [id, s] of Object.entries(detail)) assert.equal(sub(result, id).status, s, `${rid} ${id}`);
    for (const [id, s] of Object.entries(tops)) assert.equal(topic(result, id).status, s, `${rid} ${id}`);
  }
});

test('R28 핵심 인용이 원문에 없음 / R29 핵심 OCR 저신뢰: 해당 기준·상위 분석 확인 불가', async () => {
  const text = '연봉 4,000만원';
  const segments = segmentText(text);
  const bad = { '01-a': { f: 'specific', q: ['연봉 4,000만원'] }, '01-b': { f: 'specific', q: ['연봉 4,000만원'] } };
  const raw = () => {
    const r = buildExtraction(segments, bad, CRITERION_IDS);
    r.criteria.find((c) => c.id === '01-a').quotes[0].text = '연봉 5,000만원';
    return r;
  };
  const ai = scriptedAI(raw(), (args) => { const r = raw(); r.criteria = r.criteria.filter((c) => args.criterionIds.includes(c.id)); return r; });
  const r28 = await analyzeDocument({ text, docType: 'offer', ai });
  assert.equal(sub(r28, '01-a').status, 'UNAVAILABLE');
  assert.equal(topic(r28, '01').status, 'MAIN_UNAVAILABLE');
  const r29 = (await run({ text: '연봉 4,0O0만원', specs: { '01-a': { f: 'specific', q: ['연봉 4,0O0만원'] }, '01-b': { f: 'specific', q: ['연봉 4,0O0만원'] } }, lowConfidence: ['4,0O0'] })).result;
  assert.equal(sub(r29, '01-a').status, 'UNAVAILABLE');
  assert.equal(topic(r29, '01').status, 'MAIN_UNAVAILABLE');
});


// --- 추가(D) 오류의 독립성: 줄 번호가 다르다는 것만으로 독립으로 보지 않는다 (기준표 7-1-6) ---
const D_TEXT = '연봉 4,000만원\n성과급 별도, 연봉 4,500만원 가능\n급여는 매월 25일 지급';
const D_SPECS = { '01-a': { f: 'specific', q: ['연봉 4,000만원'], sv: '4,000만원' }, '01-b': { f: 'specific', q: ['연봉 4,000만원'], sv: '연봉' }, '01-c': { f: 'specific', q: ['성과급 별도'] }, '01-f': { f: 'specific', q: ['매월 25일 지급'] } };
function dCase(mutate) {
  const segments = segmentText(D_TEXT);
  const raw = buildExtraction(segments, D_SPECS, CRITERION_IDS);
  mutate(raw.criteria);
  return { segments, entries: verifyResponse(raw, CRITERION_IDS, segments) };
}

test('D 독립성: 다른 줄이어도 그 줄에 핵심 판단 표현(다른 금액)이 있으면 상충 근거가 숨어 있을 수 있어 주제 전체 재분석', () => {
  const { segments, entries } = dCase((cs) => { cs.find((c) => c.id === '01-c').quotes[0].text = '성과급 포함'; });
  assert.deepEqual(planHolds(entries, segments).held, ['01']);
});

test('D 독립성: AI가 주장한 허위 구절에 핵심 판단 표현(금액)이 있으면 독립 아님', () => {
  const { segments, entries } = dCase((cs) => { cs.find((c) => c.id === '01-f').quotes[0].text = '연봉 5,000만원 매월 지급'; });
  assert.deepEqual(planHolds(entries, segments).held, ['01']);
});

test('D 독립성: 없는 줄 번호·응답 누락·허용되지 않은 부정 표현은 독립 아님 (주제 전체 재분석)', () => {
  const unknown = dCase((cs) => { cs.find((c) => c.id === '01-f').quotes[0].line = 99; });
  assert.deepEqual(planHolds(unknown.entries, unknown.segments).held, ['01']);
  const missing = dCase((cs) => { cs.splice(cs.findIndex((c) => c.id === '01-g'), 1); });
  assert.deepEqual(planHolds(missing.entries, missing.segments).held, ['01']);
  const negated = dCase((cs) => { Object.assign(cs.find((c) => c.id === '01-c'), { finding: 'negated' }); });
  assert.ok(negated.entries['01-c'].errors.includes('negated_not_allowed'));
  assert.deepEqual(planHolds(negated.entries, negated.segments).held, ['01']);
});

test('D 독립성: 핵심 근거와 다른 줄이고, 그 줄·주장 구절 모두 핵심 판단 표현이 없을 때만 그 D만 분석 확인 불가', () => {
  const { segments, entries } = dCase((cs) => { cs.find((c) => c.id === '01-f').quotes[0].text = '매월 15일 지급'; });
  assert.deepEqual(planHolds(entries, segments), { held: [], independentD: ['01-f'] });
});

test('D 독립성: 조건부 분기 주제(07)에서 수습 관련 줄의 D 오류는 분기에 영향을 줄 수 있어 주제 전체 재분석', () => {
  const text = '수습 3개월\n수습 종료 후 평가를 거쳐 정규직 전환';
  const segments = segmentText(text);
  const raw = buildExtraction(segments, { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'] }, '07-c': { f: 'specific', q: ['평가를 거쳐 정규직 전환'] } }, CRITERION_IDS);
  raw.criteria.find((c) => c.id === '07-c').quotes[0].text = '평가 후 자동 전환';
  assert.deepEqual(planHolds(verifyResponse(raw, CRITERION_IDS, segments), segments).held, ['07']);
});

test('핵심(C) 세부기준에 허용되지 않은 부정 표현을 내면 오류로 보고 재분석 (부정 표현을 공통 규칙으로 일반화하지 않음)', async () => {
  const text = '근무 장소: 없음';
  const { result, ai } = await run({ text, specs: { '03-a': { f: 'negated', q: ['근무 장소: 없음'] } }, retrySpecs: { '03-a': { f: 'negated', q: ['근무 장소: 없음'] } } });
  assert.equal(ai.calls.length, 2);
  assert.equal(sub(result, '03-a').status, 'UNAVAILABLE');
});

test("'휴게 없음'(02-c)·'수습 중 급여 미지급'(08-a)의 일부 확인은 잠정 처리로 표시, 08은 주요 내용 기재됨이 되지 않음", async () => {
  const f = fx('F10');
  const r10 = (await run({ text: f.text, docType: f.docType, specs: f.extraction })).result;
  assert.equal(sub(r10, '02-c').status, 'PARTIAL');
  assert.equal(sub(r10, '02-c').provisional, 'D04');
  const r8 = (await run({ text: '수습 3개월\n수습 중 급여 미지급', specs: { '07-a': { f: 'specific', q: ['수습 3개월'], sv: '수습' }, '07-b': { f: 'specific', q: ['수습 3개월'] }, '08-a': { f: 'negated', q: ['수습 중 급여 미지급'] } } })).result;
  assert.notEqual(topic(r8, '08').status, 'MAIN_FOUND');
  assert.equal(sub(r8, '08-a').provisional, 'probation_pay_negation');
  assert.deepEqual(sub(r8, '08-a').evidence.map((e) => e.text), ['수습 중 급여 미지급'], '원문 그대로 표시');
  assert.equal(sub(r8, '08-a').basis, 'negated');
});

test('OCR 저신뢰는 문자 구간으로 판단: 같은 줄이어도 구간이 겹치지 않는 핵심값은 영향 없음, 겹치면 확정하지 않음', async () => {
  const f = fx('F08');
  const text = f.text;
  const at = text.indexOf('2O');
  const { result } = await run({ text, docType: f.docType, specs: f.extraction });
  // 위 run()은 저신뢰 없음. 구간을 직접 넣어 확인한다.
  const segments = segmentText(text);
  const ai = scriptedAI(buildExtraction(segments, f.extraction, CRITERION_IDS));
  const r = await analyzeDocument({ text, docType: f.docType, ai, lowConfidence: [{ start: at, end: at + 2 }] });
  assert.equal(sub(r, '01-a').status, 'CONFIRMED', '같은 줄의 월 280만원은 겹치지 않음');
  assert.equal(sub(r, '01-f').status, 'UNAVAILABLE');
  assert.equal(sub(r, '01-f').basis, 'ocr_low_confidence');
  assert.equal(topic(r, '01').status, 'MAIN_FOUND');
  assert.equal(sub(result, '01-f').status, 'CONFIRMED', '저신뢰 구간이 없으면(사용자가 수정·확인) 확정');
});

test('출처 링크: 공식 출처 주소를 그대로 연결하고, 자체 기준만 쓰는 주제(05·07·08)에는 법령 링크를 붙이지 않음', async () => {
  const f = fx('F01');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction });
  assert.deepEqual(topic(result, '01').links.map((l) => l.url), ['https://www.law.go.kr/법령/근로기준법/제17조', 'https://www.moel.go.kr/info/etc/dataroom/view.do?bbs_seq=20250300356']);
  for (const id of ['05', '07', '08']) assert.deepEqual(topic(result, id).links, [], id);
  const f4 = (await run({ text: fx('F04').text, specs: fx('F04').extraction })).result;
  assert.deepEqual(topic(f4, '10').applicabilityLinks.map((l) => l.label), ['근로기준법 제18조', '근로기준법 제11조', '근로기준법 시행령 제7조', '근로기준법 시행령 별표 1']);
  assert.deepEqual(topic(f4, '04').applicabilityLinks, []);
});

test("'이 문서에서 확인되지 않은 내용': 확인되지 않음·불분명함인 세부기준만 (분석 확인 불가·해당 없음·일부 확인은 제외)", async () => {
  const f = fx('F05');
  const { result } = await run({ text: f.text, docType: f.docType, specs: f.extraction, lowConfidence: f.lowConfidence });
  assert.deepEqual(topic(result, '01').unconfirmed, ['01-a', '01-c', '01-d', '01-e', '01-f', '01-g']);
  assert.ok(!topic(result, '03').unconfirmed.includes('03-a'), '분석 확인 불가는 미기재 목록에 넣지 않음');
  assert.ok(!topic(result, '06').unconfirmed.includes('06-b'), '일부 확인은 제외');
  const f3 = (await run({ text: fx('F03').text, specs: fx('F03').extraction })).result;
  assert.ok(!topic(f3, '07').unconfirmed.includes('07-b'), '해당 없음은 제외');
});
