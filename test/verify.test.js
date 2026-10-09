// AI 추출 응답 검증 (src/verify.js) — 기존 8개 형식의 validate 테스트를 대체한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyResponse, verifyCalc, isCatchAll, isWorkdayOnly } from '../src/verify.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildExtraction } from './v22-fixtures.js';

const TEXT = '연봉 4,000만원\n계약기간: 2026년 1월 1일부터 12월 31일까지';
const SEG = segmentText(TEXT);
const base = () => buildExtraction(SEG, {
  '01-a': { f: 'specific', q: ['연봉 4,000만원'], sv: '4,000만원' },
  '06-a': { f: 'specific', q: ['계약기간: 2026년 1월 1일부터 12월 31일까지'], term: 'fixed' },
}, CRITERION_IDS);
const errorsFor = (mutate, id) => {
  const raw = base();
  mutate(raw);
  return verifyResponse(raw, CRITERION_IDS, SEG)[id].errors;
};
const crit = (raw, id) => raw.criteria.find((c) => c.id === id);

test('올바른 응답은 오류 없이 근거·원문 기재값을 그대로 남김', () => {
  const e = verifyResponse(base(), CRITERION_IDS, SEG);
  assert.ok(CRITERION_IDS.every((id) => e[id].errors.length === 0));
  assert.deepEqual(e['01-a'].quotes, [{ line: 1, text: '연봉 4,000만원' }]);
  assert.equal(e['01-a'].sourceValue, '4,000만원');
  assert.equal(e['06-a'].termType, 'fixed');
});

test('응답 형식 오류·세부기준 누락·중복은 해당 세부기준 오류', () => {
  const malformed = verifyResponse({ items: [] }, CRITERION_IDS, SEG);
  assert.ok(CRITERION_IDS.every((id) => malformed[id].errors.includes('malformed_response')));
  assert.deepEqual(errorsFor((r) => { r.criteria = r.criteria.filter((c) => c.id !== '01-c'); }, '01-c'), ['missing_criterion']);
  assert.deepEqual(errorsFor((r) => { r.criteria.push({ ...crit(r, '01-a') }); }, '01-a'), ['duplicate_criterion']);
});

test('표현 유형과 인용의 일관성: 알 수 없는 유형, absent인데 인용, 판단했는데 인용 없음', () => {
  assert.ok(errorsFor((r) => { crit(r, '01-a').finding = 'probably'; }, '01-a').includes('invalid_finding'));
  assert.ok(errorsFor((r) => { crit(r, '01-a').finding = 'absent'; }, '01-a').includes('absent_with_quotes'));
  assert.ok(errorsFor((r) => { crit(r, '01-c').finding = 'specific'; }, '01-c').includes('no_quotes'));
});

test('인용 검증: 없는 줄, 그 줄에 없는 구절, 빈 구절 (공백 차이만 허용)', () => {
  assert.ok(errorsFor((r) => { crit(r, '01-a').quotes[0].line = 9; }, '01-a').includes('unknown_line'));
  assert.ok(errorsFor((r) => { crit(r, '01-a').quotes[0].text = '연봉 5,000만원'; }, '01-a').includes('quote_not_in_line'));
  assert.ok(errorsFor((r) => { crit(r, '01-a').quotes[0].text = '  '; }, '01-a').includes('empty_quote'));
  assert.deepEqual(errorsFor((r) => { crit(r, '01-a').quotes[0].text = '연봉  4,000만원'; }, '01-a'), []);
});

test('원문 기재값은 인용 구절 안에 있어야 하고, 06-a 확인에는 기간 유형이 필요', () => {
  assert.ok(errorsFor((r) => { crit(r, '01-a').source_value = '5,000만원'; }, '01-a').includes('source_value_not_in_quote'));
  assert.ok(errorsFor((r) => { crit(r, '06-a').term_type = null; }, '06-a').includes('missing_term_type'));
});

test('포괄 문구·근무일수 문구 판별 (특정 근로조건을 가리키면 포괄 문구가 아님)', () => {
  assert.ok(isCatchAll('기타 조건은 별도 안내'));
  assert.ok(isCatchAll('- 세부 안내가 없는 나머지 사항은 회사 공통 정책을 참고합니다.'));
  assert.ok(!isCatchAll('담당 세부업무 및 계약기간: 입사 시 안내'));
  assert.ok(!isCatchAll('세부 사업장은 입사 전 안내'));
  assert.ok(isWorkdayOnly('근무: 주 5일, 09:00~18:00'));
  assert.ok(!isWorkdayOnly('주 5일 근무, 토·일 휴무'));
});

test('계산값 검증: 원문 시각·휴게로 다시 계산해 맞을 때만, 휴게 가정 금지', () => {
  const ok = verifyCalc({ entries: [{ label: '주', hours: 40, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 60 }] }] }, ['월~금 09:00~18:00, 휴게 12:00~13:00']);
  assert.equal(ok.ok, true);
  assert.equal(ok.derived[0].value, '주 40시간');
  assert.equal(verifyCalc({ entries: [{ label: '주', hours: 40, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 60 }] }] }, ['월~금 09:00~18:00']).reason, 'calc_break_not_quoted');
  assert.equal(verifyCalc({ entries: [{ label: '주', hours: 40, segments: [{ days: 5, start: '09:00', end: '18:00', break_minutes: 0 }] }] }, ['09:00~18:00 휴게 없음']).reason, 'calc_mismatch');
  assert.equal(verifyCalc({ entries: [{ label: '주', hours: 40, segments: [{ days: 5, start: '08:00', end: '17:00', break_minutes: 60 }] }] }, ['09:00~18:00, 휴게 1시간']).reason, 'calc_time_not_quoted');
});
