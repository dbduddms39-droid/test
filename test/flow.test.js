import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText, editRouteFor, resolveRoute, classifyAnalyzeFailure, ROUTES } from '../public/flow.js';

const base = { hasResult: false, hasReview: false, analyzing: false, hasError: false, detailExists: () => false };

test('입력 확인: 빈 입력·공백만 있는 입력·2만 자 초과만 분석 불가 (최소 글자 수 없음)', () => {
  assert.equal(checkText('').code, 'empty');
  assert.equal(checkText('   \n ').code, 'empty');
  assert.equal(checkText('가'.repeat(20001)).code, 'too_long');
  // 짧은 입력도 분석할 수 있다 (안내만 표시)
  assert.deepEqual(checkText('급여 300만원'), { ok: true, code: 'short' });
  assert.deepEqual(checkText('연'), { ok: true, code: 'short' });
  assert.deepEqual(checkText('가'.repeat(30)), { ok: true, code: null });
});

test('입력 출처별 수정 화면: 직접 입력은 S-02, 파일 추출은 S-03', () => {
  assert.equal(editRouteFor('paste'), ROUTES.input);
  assert.equal(editRouteFor('ocr'), ROUTES.review);
  assert.equal(editRouteFor('pdf'), ROUTES.review);
});

test('라우트: S-01과 S-02는 별도 화면', () => {
  assert.deepEqual(resolveRoute('', base), { view: 'landing' });
  assert.deepEqual(resolveRoute('#/', base), { view: 'landing' });
  assert.deepEqual(resolveRoute('#/input', base), { view: 'input' });
});

test('라우트: 데이터 없이 결과·상세·확인·분석 중·오류 주소로 들어오면 입력 화면으로', () => {
  assert.deepEqual(resolveRoute('#/result', base), { redirect: ROUTES.input, notice: 'no_result' });
  assert.deepEqual(resolveRoute('#/detail/wage', base), { redirect: ROUTES.input, notice: 'no_result' });
  assert.deepEqual(resolveRoute('#/review', base), { redirect: ROUTES.input, notice: 'no_review' });
  assert.deepEqual(resolveRoute('#/analyzing', base), { redirect: ROUTES.input, notice: 'no_result' });
  assert.deepEqual(resolveRoute('#/error', base), { redirect: ROUTES.input });
  assert.deepEqual(resolveRoute('#/unknown', base), { redirect: ROUTES.landing });
});

test('라우트: 분석 중 화면은 실제로 요청이 진행 중일 때만 (주소만으로 분석을 시작하지 않음)', () => {
  assert.deepEqual(resolveRoute('#/analyzing', { ...base, analyzing: true }), { view: 'analyzing' });
  assert.deepEqual(resolveRoute('#/analyzing', { ...base, hasResult: true }), { redirect: ROUTES.result });
});

test('라우트: 결과가 있으면 결과·상세 표시, 없는 항목 ID는 결과 목록으로', () => {
  const s = { ...base, hasResult: true, detailExists: (id) => id === 'wage' };
  assert.deepEqual(resolveRoute('#/result', s), { view: 'result' });
  assert.deepEqual(resolveRoute('#/detail/wage', s), { view: 'detail', id: 'wage' });
  assert.deepEqual(resolveRoute('#/detail/nope', s), { redirect: ROUTES.result });
});

test('분석 실패 분류: 입력 형식 오류만 입력 화면, 나머지는 S-07', () => {
  assert.equal(classifyAnalyzeFailure(400), 'input');
  assert.equal(classifyAnalyzeFailure(413), 'input');
  for (const s of [429, 500, 502, 503, 504]) assert.equal(classifyAnalyzeFailure(s), 'error');
});
