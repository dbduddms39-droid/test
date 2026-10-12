import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText, editRouteFor, inputRouteFor, resolveRoute, classifyAnalyzeFailure, ROUTES, formatDateTime } from '../public/flow.js';

const base = { hasReview: false, analyzing: false, hasError: false, hasUnsaved: false, lastTarget: { kind: 'new' } };
const REC = 'rec_abc123';

test('입력 확인: 빈 입력·공백만 있는 입력·2만 자 초과만 분석 불가 (최소 글자 수 없음)', () => {
  assert.equal(checkText('').code, 'empty');
  assert.equal(checkText('   \n ').code, 'empty');
  assert.equal(checkText('가'.repeat(20001)).code, 'too_long');
  // 짧은 입력도 분석할 수 있다 (안내만 표시)
  assert.deepEqual(checkText('급여 300만원'), { ok: true, code: 'short' });
  assert.deepEqual(checkText('연'), { ok: true, code: 'short' });
  assert.deepEqual(checkText('가'.repeat(30)), { ok: true, code: null });
});

test('입력 출처별 수정 화면: 직접 입력은 입력 화면(새 기록 S02 / 기존 기록 S07), 파일 추출은 S03', () => {
  assert.equal(editRouteFor('paste', { kind: 'new' }), ROUTES.new);
  assert.equal(editRouteFor('paste', { kind: 'add', recordId: REC }), `#/records/${REC}/add`);
  assert.equal(editRouteFor('ocr', { kind: 'new' }), ROUTES.review);
  assert.equal(editRouteFor('pdf', { kind: 'add', recordId: REC }), ROUTES.review);
  assert.equal(inputRouteFor(undefined), ROUTES.new);
});

test('라우트: S01 시작, S02 자료 등록, S06 내 기록, S04 기록, S07 새 안내 추가, S05 항목 상세', () => {
  assert.deepEqual(resolveRoute('', base), { view: 'landing' });
  assert.deepEqual(resolveRoute('#/', base), { view: 'landing' });
  assert.deepEqual(resolveRoute('#/new', base), { view: 'input', target: { kind: 'new' } });
  assert.deepEqual(resolveRoute('#/records', base), { view: 'records' });
  assert.deepEqual(resolveRoute(`#/records/${REC}`, base), { view: 'record', recordId: REC });
  assert.deepEqual(resolveRoute(`#/records/${REC}/add`, base), { view: 'input', target: { kind: 'add', recordId: REC } });
  assert.deepEqual(resolveRoute(`#/records/${REC}/item/01`, base), { view: 'item', recordId: REC, itemId: '01' });
  assert.deepEqual(resolveRoute(`#/records/${REC}/item/10`, base), { view: 'item', recordId: REC, itemId: '10' });
});

test('라우트: 잘못된 기록 ID·항목 번호는 받지 않는다 (주소에 문서 내용이 들어가지 않음)', () => {
  assert.deepEqual(resolveRoute(`#/records/${REC}/item/99`, base), { redirect: `#/records/${REC}` });
  assert.deepEqual(resolveRoute('#/records/<script>', base), { redirect: ROUTES.landing });
  assert.deepEqual(resolveRoute('#/records/rec_한글', base), { redirect: ROUTES.landing });
});

test('라우트: 예전 주소(근로계약서 확인·비교·결과·상세)는 새 화면으로', () => {
  assert.deepEqual(resolveRoute('#/input', base), { redirect: ROUTES.new });
  assert.deepEqual(resolveRoute('#/compare', base), { redirect: ROUTES.new });
  assert.deepEqual(resolveRoute('#/result', base), { redirect: ROUTES.records });
  assert.deepEqual(resolveRoute('#/compare/result', base), { redirect: ROUTES.records });
  assert.deepEqual(resolveRoute('#/detail/01', base), { redirect: ROUTES.records });
});

test('라우트: 데이터 없이 확인·분석 중·오류·미저장 주소로 들어오면 입력 화면이나 목록으로', () => {
  assert.deepEqual(resolveRoute('#/review', base), { redirect: ROUTES.new, notice: 'no_review' });
  assert.deepEqual(resolveRoute('#/review', { ...base, lastTarget: { kind: 'add', recordId: REC } }), { redirect: `#/records/${REC}/add`, notice: 'no_review' });
  assert.deepEqual(resolveRoute('#/analyzing', base), { redirect: ROUTES.new });
  assert.deepEqual(resolveRoute('#/error', base), { redirect: ROUTES.new });
  assert.deepEqual(resolveRoute('#/unsaved', base), { redirect: ROUTES.records });
  assert.deepEqual(resolveRoute('#/unknown', base), { redirect: ROUTES.landing });
});

test('라우트: 분석 중 화면은 실제로 요청이 진행 중일 때만 (주소만으로 분석을 시작하지 않음)', () => {
  assert.deepEqual(resolveRoute('#/analyzing', { ...base, analyzing: true }), { view: 'analyzing' });
  assert.deepEqual(resolveRoute('#/analyzing', { ...base, hasUnsaved: true }), { redirect: ROUTES.unsaved });
  assert.deepEqual(resolveRoute('#/unsaved', { ...base, hasUnsaved: true }), { view: 'record', unsaved: true });
  assert.deepEqual(resolveRoute('#/review', { ...base, hasReview: true }), { view: 'review' });
  assert.deepEqual(resolveRoute('#/error', { ...base, hasError: true }), { view: 'error' });
});

test('분석 실패 분류: 입력 형식 오류만 입력 화면, 나머지는 오류 화면', () => {
  assert.equal(classifyAnalyzeFailure(400), 'input');
  assert.equal(classifyAnalyzeFailure(413), 'input');
  for (const s of [429, 500, 502, 503, 504]) assert.equal(classifyAnalyzeFailure(s), 'error');
});

test('날짜 표시', () => {
  assert.match(formatDateTime('2026-10-12T05:03:00.000Z'), /^2026\.10\.1[23] \d\d:03$/);
  assert.equal(formatDateTime('x'), '');
});
