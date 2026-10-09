import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, applyEdit, confirmSpan, pendingRanges, summary, diffRegion } from '../public/ocr-spans.js';

const TEXT = '임금: 월 280만원. 매월 2O일 지급\n주소: 상도로 77';
const slice = (text, ranges) => ranges.map((r) => text.slice(r.start, r.end));

test('불확실한 단어의 모든 출현 위치를 확인 필요로 표시, 텍스트에 없는 단어는 위치 미확인으로 따로 둠', () => {
  const t = createTracker(`${TEXT}\n2O일 재확인`, ['2O', '없는글자']);
  assert.equal(t.spans.length, 2);
  assert.deepEqual(t.lost.map((l) => [l.kind, l.text]), [['unlocated', '없는글자']]);
  assert.deepEqual(slice(`${TEXT}\n2O일 재확인`, pendingRanges(t, `${TEXT}\n2O일 재확인`)), ['2O', '2O']);
});

test('저신뢰 구간 앞을 고치면 위치만 이동하고 계속 확인 필요 (분석 버튼이나 다른 곳 수정으로 해제되지 않음)', () => {
  const t0 = createTracker(TEXT, ['2O', '77']);
  const after = TEXT.replace('월 280만원', '월 2,800,000원');
  const t1 = applyEdit(t0, TEXT, after);
  assert.equal(summary(t1).pending, 2);
  assert.deepEqual(slice(after, pendingRanges(t1, after)), ['2O', '77']);
});

test('사용자가 그 구간을 직접 고치면 해제', () => {
  const t0 = createTracker(TEXT, ['2O']);
  const after = TEXT.replace('2O일', '20일');
  const t1 = applyEdit(t0, TEXT, after);
  assert.deepEqual(summary(t1), { total: 1, pending: 0, edited: 1, confirmed: 0 });
  assert.deepEqual(pendingRanges(t1, after), []);
});

test("원본과 대조해 '확인했어요'를 누른 구간 하나만 해제", () => {
  const t0 = createTracker(TEXT, ['2O', '77']);
  const t1 = confirmSpan(t0, t0.spans.find((s) => s.text === '2O').id);
  assert.deepEqual(slice(TEXT, pendingRanges(t1, TEXT)), ['77']);
  assert.equal(summary(t1).confirmed, 1);
});

test('대량 수정(전체 붙여넣기)으로 위치를 잃으면 새 글자 전체를 대응 불가 구간으로, 사라진 저신뢰 글자는 같은 글자가 나오면 확정하지 않음', () => {
  const t0 = createTracker(TEXT, ['2O']);
  const pasted = `새로 붙여넣은 문서입니다. ${'내용 '.repeat(30)}매월 2O일`;
  const t1 = applyEdit(t0, TEXT, pasted);
  assert.equal(t1.lost[0].kind, 'lost');
  const ranges = pendingRanges(t1, pasted);
  assert.deepEqual(ranges, [{ start: 0, end: pasted.length }], '대응 불가 구간이 전체를 덮음');
  // 대응 불가 구간 안의 작은 수정은 구간 전체를 해제하지 않음
  const fixed = pasted.replace('2O일', '20일');
  const t2 = applyEdit(t1, pasted, fixed);
  assert.ok(summary(t2).pending >= 1);
  assert.deepEqual(pendingRanges(t2, fixed), [{ start: 0, end: fixed.length }]);
  // 사용자가 그 구간을 원본과 대조해 확인하면 해제
  const untracked = t2.spans.find((s) => s.kind === 'untracked');
  const t3 = confirmSpan(confirmSpan(t2, untracked.id), t2.lost[0].id);
  assert.deepEqual(pendingRanges(t3, fixed), []);
});

test('비우기(대량 삭제) 뒤 같은 글자를 다시 붙여넣어도 저신뢰 표시가 사라지지 않음', () => {
  const t0 = createTracker(TEXT, ['2O']);
  const t1 = applyEdit(t0, TEXT, '');
  const t2 = applyEdit(t1, '', TEXT);
  assert.deepEqual(slice(TEXT, pendingRanges(t2, TEXT)), ['2O']);
});

test('구간 경계 바로 옆에 글자를 넣는 것은 그 구간을 고친 것이 아님', () => {
  const t0 = createTracker('A2OB', ['2O']);
  const t1 = applyEdit(t0, 'A2OB', 'A2O일B');
  assert.equal(summary(t1).pending, 1);
  assert.deepEqual(diffRegion('A2OB', 'A2O일B'), { start: 3, oldEnd: 3, newEnd: 4 });
});

// 브라우저는 입력 전후 텍스트만 알 수 있으므로 '바뀐 최소 범위'로 판단한다. 그 범위가 저신뢰 글자 + 10자를 넘으면
// 그 자리를 고친 것으로 보지 않는다 (줄을 통째로 다른 내용으로 바꾼 경우 등).
test('저신뢰 글자가 든 줄을 통째로 다른 내용으로 바꾸면 그 자리를 고친 것으로 보지 않음 (새 글자 전체를 확인 필요로)', () => {
  const t0 = createTracker(TEXT, ['2O']);
  const after = TEXT.replace('임금: 월 280만원. 매월 2O일 지급', '급여는 매달 이십일에 이백팔십만원을 줌');
  const t1 = applyEdit(t0, TEXT, after);
  assert.equal(summary(t1).edited, 0);
  assert.ok(pendingRanges(t1, after).length > 0);
});
