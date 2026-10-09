// '추가로 확인해 보세요': 같은 문서에서 이미 적힌 조건은 다시 묻지 않고, 적히지 않은 조건만 묻는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { followUpsFor, DEFAULT_FOLLOW_UPS } from '../src/followups.js';
import { SAMPLES } from './samples.js';
import { idealResponse, scriptedAI } from './helpers.js';

const byKey = (k) => SAMPLES.find((s) => s.key === k);
const run = async (sample) => analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(idealResponse(sample)) });
const fu = (result, id) => result.items.find((i) => i.id === id).followUps;
const stated = (itemId, ...texts) => followUpsFor(itemId, { status: 'stated', texts });

test('실제 오퍼 안내문: 적힌 조건은 묻지 않고 빠진 조건만 묻는다', async () => {
  const r = await run(byKey('X9_real_offer'));
  // 임금: 연봉 4,000만원·기본급 및 고정수당 포함 → 금액·포함 여부는 묻지 않고, 세전·세후(수습 급여의 '세전'을 연봉에 쓰지 않음)·구성별 금액·지급일
  assert.deepEqual(fu(r, 'salary'), ['세전 금액인지 세후 금액인지', '기본급·고정수당 각각의 금액', '지급일과 지급 방법']);
  // 근무시간: 시각·점심시간·주 5일(월~금) 명시 → 연장·야간·휴일 근무만
  assert.deepEqual(fu(r, 'work_hours'), ['연장·야간·휴일 근무가 있는지와 그 처리 방식']);
  // 근무장소: 도로명 주소 명시 → 주소는 묻지 않음
  assert.deepEqual(fu(r, 'workplace'), ['재택·파견·출장 근무 여부', '근무지가 바뀔 수 있는지']);
  // 계약기간: 기간의 정함이 없는 근로계약 → 종료일·갱신을 묻지 않아 영역을 숨김
  assert.deepEqual(fu(r, 'contract_period'), []);
  // 고용형태: 정규직 명시 → 고용형태·정규직 전환 조건을 묻지 않음
  assert.deepEqual(fu(r, 'employment_type'), []);
  // 수습기간: 3개월 명시 → 길이는 묻지 않음
  assert.deepEqual(fu(r, 'probation_period'), ['수습 종료 후 평가 기준과 결과']);
  // 수습 중 급여: 월 300만원 명시 → 금액은 묻지 않고, 수습 종료 후 급여 기준은 문서에 없어 유지
  assert.deepEqual(fu(r, 'probation_pay'), ['수습 종료 후 적용될 급여 기준']);
});

test('사례 1·2: 수습 중 급여 금액이 적혀 있으면 금액 질문을 빼고, 없으면 유지', () => {
  assert.deepEqual(stated('probation_pay', '수습기간 중 급여 월 300만원 (세전)'), ['수습 종료 후 적용될 급여 기준']);
  assert.deepEqual(stated('probation_pay', '수습 기간 급여는 월 급여의 90% 지급'), ['수습 종료 후 적용될 급여 기준']);
  // 수습은 있지만 급여가 적혀 있지 않음 (찾지 못함) → 금액 질문 유지
  assert.deepEqual(followUpsFor('probation_pay', { status: 'not_found', texts: [] }), DEFAULT_FOLLOW_UPS.probation_pay);
  assert.ok(DEFAULT_FOLLOW_UPS.probation_pay.includes('수습 기간 중 급여 금액 또는 비율'));
});

test('사례 3: 연봉은 적혀 있고 세전·세후는 없으면 세전 질문 유지 (수습 급여의 세전 표기는 연봉에 적용하지 않음)', () => {
  assert.ok(stated('salary', '연봉 4,000만원').includes('세전 금액인지 세후 금액인지'));
  assert.ok(stated('salary', '연봉 4,000만원', '수습기간 중 급여 월 300만원 (세전)').includes('세전 금액인지 세후 금액인지'));
  assert.ok(!stated('salary', '연봉 4,000만원 (세전)').includes('세전 금액인지 세후 금액인지'));
});

test('사례 4: 근무시간·휴게시간이 적혀 있으면 해당 질문을 빼고, 일부만 적혀 있으면 빠진 부분만', () => {
  assert.deepEqual(stated('work_hours', '근무시간 주 5일 (월~금) 10:00 ~ 19:00', '(점심시간 13:00 ~ 14:00)'), ['연장·야간·휴일 근무가 있는지와 그 처리 방식']);
  assert.deepEqual(stated('work_hours', '근무시간: 09:00~18:00'), ['휴게시간', '주당 근무일수', '연장·야간·휴일 근무가 있는지와 그 처리 방식']);
  assert.deepEqual(stated('work_hours', '근로시간 10시 00분부터 19시 00분까지 (휴게 1시간)'), ['주당 근무일수', '연장·야간·휴일 근무가 있는지와 그 처리 방식']);
  // 연장근무가 있다는 말만으로는 처리 방식이 확인되지 않음
  assert.ok(stated('work_hours', '09:00~18:00, 주 5일, 연장근무 있음').includes('연장·야간·휴일 근무가 있는지와 그 처리 방식'));
  assert.ok(!stated('work_hours', '09:00~18:00, 주 5일, 연장근무 시 수당 별도 지급').includes('연장·야간·휴일 근무가 있는지와 그 처리 방식'));
});

test('사례 5: 기간의 정함이 없는 계약은 종료일·갱신을 묻지 않고, 기간만 적힌 계약은 날짜를 묻는다', () => {
  assert.deepEqual(stated('contract_period', '계약기간 기간의 정함이 없는 근로계약'), []);
  assert.deepEqual(stated('contract_period', '근로계약기간: 2026년 11월 1일부터 2027년 10월 31일까지'), ['계약 갱신 여부와 기준']);
  assert.deepEqual(stated('contract_period', '근무 기간: 6개월 (2027년 1월 4일 입사)'), DEFAULT_FOLLOW_UPS.contract_period);
});

test('사례 6: 모호한 급여 표현은 핵심 확인 질문을 맨 앞에 두고 기본 확인 사항도 유지', async () => {
  const r = await run(byKey('S2_vague'));
  assert.deepEqual(fu(r, 'salary'), ['실제 적용될 급여 금액', ...DEFAULT_FOLLOW_UPS.salary]);
  const range = await run(byKey('X7_salary_range_negotiable'));
  assert.deepEqual(fu(range, 'salary'), ['실제 적용될 연봉 금액', ...DEFAULT_FOLLOW_UPS.salary]);
});

test('서로 다른 값이 함께 적힌 경우·찾지 못함·분석 확인 불가는 기본 목록을 그대로 (보수적으로)', async () => {
  const r = await run(byKey('S4_conflict'));
  assert.deepEqual(fu(r, 'salary').slice(1), DEFAULT_FOLLOW_UPS.salary); // '월 210만원 (세전)'이 한쪽 값에만 있음
  assert.deepEqual(fu(r, 'work_hours').slice(1), DEFAULT_FOLLOW_UPS.work_hours);
  assert.deepEqual(followUpsFor('work_hours', { status: 'not_found', texts: [] }), DEFAULT_FOLLOW_UPS.work_hours);
  assert.deepEqual(followUpsFor('work_hours', { status: 'unavailable', texts: ['09:00~18:00'] }), DEFAULT_FOLLOW_UPS.work_hours);
});

test('구성 요소별 금액이 모두 적혀 있으면 구성은 묻지 않고, 지급일만 적혀 있으면 지급 방법만', () => {
  assert.deepEqual(stated('salary', '임금: 월 2,600,000원 (기본급 2,400,000원, 식대 200,000원), 매월 25일 지급'), ['세전 금액인지 세후 금액인지', '지급 방법']);
  // 문구에는 근거에 적힌 낱말만 쓴다 (적히지 않은 수당 이름을 만들지 않음)
  assert.deepEqual(stated('salary', '월 300만원 (기본급, 식대, 주휴수당 포함)')[1], '기본급·식대·주휴수당 각각의 금액');
  assert.equal(stated('salary', '월 기본급 2,800,000원')[1], DEFAULT_FOLLOW_UPS.salary[1]);
});

test('수습 없음이 명시되면 수습기간 확인 사항은 없음, 정규직이 아니면 전환 조건 유지', () => {
  assert.deepEqual(followUpsFor('probation_period', { status: 'stated', texts: ['수습기간: 없음'], probationNone: true }), []);
  assert.deepEqual(followUpsFor('employment_type', { status: 'stated', texts: ['채용형태: 계약직'], employmentCategory: 'fixed_term' }), ['정규직 전환 조건이 있다면 그 기준']);
  assert.deepEqual(followUpsFor('employment_type', { status: 'stated', texts: ['정규직'], employmentCategory: 'permanent' }), []);
});

// ---------- '언급됨'과 '구체적으로 확인됨' 구분 (미확정 표현은 그 조건의 구절 안에서만 본다) ----------
const ALL_HOURS = DEFAULT_FOLLOW_UPS.work_hours;

test('회귀 1: 휴게시간 추후 협의 → 출퇴근 시각은 확인, 휴게시간 질문 유지', () => {
  assert.deepEqual(stated('work_hours', '근무시간 09:00~18:00, 휴게시간은 추후 협의'), ['휴게시간', '주당 근무일수', ALL_HOURS[2]]);
  assert.deepEqual(stated('work_hours', '근무시간 09:00~18:00 (휴게시간 미정)'), ['휴게시간', '주당 근무일수', ALL_HOURS[2]]);
});

test('회귀 2: 휴게시간 13:00~14:00 명시 → 휴게시간 질문 제거', () => {
  assert.deepEqual(stated('work_hours', '근무시간 09:00~18:00, 휴게시간 13:00~14:00'), ['주당 근무일수', ALL_HOURS[2]]);
});

test('회귀 3: 재택근무 여부 추후 결정 → 재택 관련 질문 유지', () => {
  assert.ok(stated('workplace', '근무지: 서울 강남구 테헤란로 123', '재택근무 여부는 추후 결정').includes('재택·파견·출장 근무 여부'));
  assert.ok(stated('workplace', '근무지: 서울 강남구 (재택 가능 여부 별도 안내)').includes('재택·파견·출장 근무 여부'));
});

test('회귀 4: 재택근무 주 2회 확정 → 재택 여부를 다시 묻지 않음', () => {
  assert.deepEqual(stated('workplace', '근무지: 서울 강남구 테헤란로 123', '재택근무 주 2회'), ['근무지가 바뀔 수 있는지']);
});

test('회귀 5: 근무시간은 명시되고 다른 조건만 추후 협의 → 근무시간 질문을 복원하지 않음', async () => {
  // 같은 줄의 다른 구절에 있는 미확정 표현은 근무시간에 영향을 주지 않는다
  assert.deepEqual(stated('work_hours', '근무시간 09:00~18:00, 휴게시간 12:00~13:00, 주 5일, 근무지는 추후 결정'), [ALL_HOURS[2]]);
  // 다른 항목(급여)이 추후 협의여도 근무시간 항목에는 영향 없음
  const text = '[채용] 사무보조 (가상 예시)\n근무시간: 09:00~18:00 (휴게시간 12:00~13:00), 주 5일\n급여: 추후 협의\n근무지: 서울 마포구 양화로 00';
  const response = { items: [
    { id: 'work_hours', presence: 'found', specificity: 'specific', reason_code: null, evidence_ids: [2] },
    { id: 'salary', presence: 'found', specificity: 'vague', reason_code: 'vague_expression', evidence_ids: [3], unclear_texts: ['추후 협의'] },
    { id: 'workplace', presence: 'found', specificity: 'specific', reason_code: null, evidence_ids: [4] },
    ...['duties', 'employment_type', 'contract_period', 'probation_period', 'probation_pay'].map((id) => ({ id, presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [] })),
  ] };
  const r = await analyzeDocument({ text, docType: 'job_posting', ai: scriptedAI(response) });
  assert.deepEqual(fu(r, 'work_hours'), [ALL_HOURS[2]]);
  assert.deepEqual(fu(r, 'salary'), ['실제 적용될 급여 금액', ...DEFAULT_FOLLOW_UPS.salary]);
});

test('회귀 6: 그린테크놀로지 오퍼 안내문 결과 유지 (인센티브 "별도"는 미확정 표현이 아님)', async () => {
  const r = await run(byKey('X9_real_offer'));
  assert.deepEqual(fu(r, 'salary'), ['세전 금액인지 세후 금액인지', '기본급·고정수당 각각의 금액', '지급일과 지급 방법']);
  assert.deepEqual(fu(r, 'work_hours'), ['연장·야간·휴일 근무가 있는지와 그 처리 방식']);
  assert.deepEqual(fu(r, 'workplace'), ['재택·파견·출장 근무 여부', '근무지가 바뀔 수 있는지']);
  assert.deepEqual(fu(r, 'contract_period'), []);
  assert.deepEqual(fu(r, 'probation_pay'), ['수습 종료 후 적용될 급여 기준']);
});

test('그 밖의 미확정 표현: 세전 여부·지급일·갱신·수습 급여도 구절 안에서만 판단', () => {
  assert.ok(stated('salary', '연봉 4,000만원 (세전·세후 기준은 추후 안내)').includes('세전 금액인지 세후 금액인지'));
  assert.ok(stated('salary', '연봉 4,000만원 (세전)').every((q) => q !== '세전 금액인지 세후 금액인지'));
  // '지급일'이라는 낱말만 있고 날짜가 없으면 확인된 것으로 보지 않음
  assert.equal(stated('salary', '월 250만원, 지급일은 별도 안내')[2], '지급일과 지급 방법');
  assert.equal(stated('salary', '월 250만원, 매월 25일 지급')[2], '지급 방법');
  assert.deepEqual(stated('contract_period', '2026.11.1 ~ 2027.10.31, 갱신 여부는 추후 결정'), ['계약 갱신 여부와 기준']);
  assert.deepEqual(stated('probation_pay', '수습 기간 급여는 추후 협의'), DEFAULT_FOLLOW_UPS.probation_pay);
  // 숫자 사이 쉼표는 구절을 나누지 않는다
  assert.deepEqual(stated('probation_pay', '수습기간 중 급여 월 3,000,000원 (세전)'), ['수습 종료 후 적용될 급여 기준']);
});
