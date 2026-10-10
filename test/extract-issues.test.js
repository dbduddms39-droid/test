// 파일 추출 문제 (OCR 처리 정책 2·3): 일부 누락 의심과 추출 실패를 구분하고, 명시적으로 해결해야 분석할 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIssues, resolveIssue, unresolve, blockingIssues, resetTextDependent, resultNotes, isResolved,
} from '../public/extract-issues.js';

const issues = () => buildIssues({
  failed: [{ index: 1, code: 'no_text_found' }],
  suspect: [{ index: 2, reason: 'partial' }],
  unit: 'image',
});

test('추출 실패와 일부 누락 의심을 서로 다른 종류로 만든다 (이미지 번호·PDF 쪽 표시)', () => {
  const list = issues();
  assert.deepEqual(list.map((x) => [x.id, x.kind, x.label]), [['failed-2', 'failed', '2번째 이미지'], ['suspect-3', 'suspect', '3번째 이미지']]);
  const pdf = buildIssues({ failed: [{ page: 2, code: 'no_text_found' }], suspect: [{ page: 4, reason: 'low_confidence' }], unit: 'pdf' });
  assert.deepEqual(pdf.map((x) => x.label), ['PDF 2쪽', 'PDF 4쪽']);
  assert.deepEqual(buildIssues({}), []);
});

test('문제가 하나라도 해결되지 않으면 분석을 막는다 (분석 버튼은 어떤 문제도 해결하지 않음)', () => {
  const list = issues();
  assert.equal(blockingIssues(list, { textEdited: true }).length, 2);
  assert.ok(list.every((x) => !isResolved(x, { textEdited: true })));
});

test('추출 실패: 다시 추출하거나 직접 입력한 경우만 복구. 범위 확인 표시로는 복구할 수 없고, 텍스트를 고치지 않으면 직접 입력 표시를 받지 않음', () => {
  const list = issues();
  assert.equal(resolveIssue(list, 'failed-2', 'range_checked', { textEdited: true }).code, 'resolution_not_allowed');
  assert.equal(resolveIssue(list, 'failed-2', 'manual_input', { textEdited: false }).code, 'text_not_edited');
  const r = resolveIssue(list, 'failed-2', 'manual_input', { textEdited: true });
  assert.equal(r.ok, true);
  assert.deepEqual(blockingIssues(r.issues, { textEdited: true }).map((x) => x.id), ['suspect-3']);
});

test('일부 누락 의심: 직접 보완(텍스트 수정 필요) 또는 원본과 비교해 범위 확인을 명시적으로 표시해야 해결', () => {
  const list = issues();
  assert.equal(resolveIssue(list, 'suspect-3', 'supplemented', { textEdited: false }).code, 'text_not_edited');
  assert.equal(resolveIssue(list, 'suspect-3', 'manual_input', { textEdited: true }).code, 'resolution_not_allowed');
  const checked = resolveIssue(list, 'suspect-3', 'range_checked', { textEdited: false });
  assert.equal(checked.ok, true, '범위 확인은 텍스트를 고치지 않아도 표시할 수 있음');
  assert.equal(isResolved(checked.issues.find((x) => x.id === 'suspect-3'), { textEdited: false }), true);
  assert.equal(resolveIssue(list, 'nope', 'range_checked').code, 'unknown_issue');
});

test('텍스트를 처음 추출한 내용으로 되돌리면 직접 입력·보완 표시는 다시 확인 필요 (범위 확인 표시는 유지)', () => {
  let list = resolveIssue(issues(), 'failed-2', 'manual_input', { textEdited: true }).issues;
  list = resolveIssue(list, 'suspect-3', 'range_checked').issues;
  // 같은 텍스트로 되돌아간 상태: 직접 입력 표시는 효력이 없음
  assert.deepEqual(blockingIssues(list, { textEdited: false }).map((x) => x.id), ['failed-2']);
  const reset = resetTextDependent(list);
  assert.equal(reset.find((x) => x.id === 'failed-2').resolution, null);
  assert.equal(reset.find((x) => x.id === 'suspect-3').resolution, 'range_checked');
  assert.equal(unresolve(list, 'suspect-3').find((x) => x.id === 'suspect-3').resolution, null);
});

test('결과 안내: 직접 입력·보완한 텍스트를 원본 전체 확보로 표현하지 않고, 누락을 확정된 사실로 쓰지 않음', () => {
  let list = buildIssues({ failed: [{ page: 2 }], suspect: [{ page: 3 }, { page: 4 }], unit: 'pdf' });
  list = resolveIssue(list, 'failed-2', 'manual_input', { textEdited: true }).issues;
  list = resolveIssue(list, 'suspect-3', 'supplemented', { textEdited: true }).issues;
  list = resolveIssue(list, 'suspect-4', 'range_checked').issues;
  const notes = resultNotes(list);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /PDF 2쪽은 .*직접 입력.*빠짐없이 옮겼는지는 확인할 수 없어요/);
  assert.match(notes[1], /PDF 3쪽.*빠졌을 수 있어.*확인할 수 없어요/);
  assert.match(notes[2], /PDF 4쪽.*빠졌을 수 있다는 추정/);
  for (const n of notes) assert.doesNotMatch(n, /(모두|전체를) 확보|누락됐|누락되었|빠졌어요/);
  assert.deepEqual(resultNotes(buildIssues({ suspect: [{ index: 0 }] })), [], '해결 표시가 없으면 안내도 없음');
});

test('결과 안내 조사: 이미지는 / 쪽은', () => {
  const list = resolveIssue(buildIssues({ failed: [{ index: 1 }, { index: 2 }] }), 'failed-2', 'manual_input', { textEdited: true }).issues;
  assert.match(resultNotes(list)[0], /^2번째 이미지는 /);
});
