// 파일 추출 문제 (OCR 처리 정책 2·3): 일부 누락 의심과 추출 실패를 구분하고, 명시적으로 처리해야 분석할 수 있다.
// 추출 실패는 쪽마다 따로 관리하고, 그 쪽의 입력 칸에 직접 입력한 경우에만 그 쪽의 복구를 인정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIssues, resolveIssue, unresolve, blockingIssues, resetTextDependent, resultNotes, isResolved,
  setSupplement, shiftAnchors, assembleText,
} from '../public/extract-issues.js';
import { pageAnchors, joinPages } from '../public/upload-rules.js';

const issues = () => buildIssues({
  failed: [{ index: 1, code: 'no_text_found', anchor: 3 }],
  suspect: [{ index: 2, reason: 'partial' }],
  unit: 'image',
});
const manual = (list, id, text) => resolveIssue(setSupplement(list, id, text), id, 'manual_input');

// 3쪽 PDF에서 2쪽만 추출 실패: 추출 텍스트는 1쪽 + 3쪽, 2쪽 자리는 1쪽 끝
const P1 = '근로계약서 1쪽 (가상)\n임금: 월 250만원';
const P3 = '3쪽: 연차 유급휴가 15일';
const pdf3 = () => {
  const pages = [P1, '', P3];
  const anchors = pageAnchors(pages);
  return { text: joinPages(pages), issues: buildIssues({ failed: [{ page: 2, code: 'no_text_found', anchor: anchors[1] }], unit: 'pdf' }) };
};

test('추출 실패와 일부 누락 의심을 서로 다른 종류로 만든다 (이미지 번호·PDF 쪽 표시)', () => {
  const list = issues();
  assert.deepEqual(list.map((x) => [x.id, x.kind, x.label]), [['failed-2', 'failed', '2번째 이미지'], ['suspect-3', 'suspect', '3번째 이미지']]);
  const pdf = buildIssues({ failed: [{ page: 2, code: 'no_text_found' }], suspect: [{ page: 4, reason: 'low_confidence' }], unit: 'pdf' });
  assert.deepEqual(pdf.map((x) => x.label), ['PDF 2쪽', 'PDF 4쪽']);
  assert.deepEqual(buildIssues({}), []);
});

test('빈 쪽 위치: 합친 텍스트에서 앞쪽 텍스트가 끝나는 곳 (앞에 글자가 없으면 0)', () => {
  assert.deepEqual(pageAnchors(['가나', '', '다라', '']), [null, 2, null, 6]);
  assert.deepEqual(pageAnchors(['', '가나']), [0, null]);
});

test('문제가 하나라도 처리되지 않으면 분석을 막는다 (분석 버튼은 어떤 문제도 처리하지 않음)', () => {
  const list = issues();
  assert.equal(blockingIssues(list, { textEdited: true }).length, 2);
  assert.ok(list.every((x) => !isResolved(x, { textEdited: true })));
});

test('3쪽 PDF에서 2쪽 추출 실패 후 1쪽만 수정: 2쪽 복구로 인정하지 않음 (텍스트 수정·공백만 입력도 불인정)', () => {
  const { text, issues: list } = pdf3();
  const edited = text.replace('250', '260'); // 1쪽만 고침
  const moved = shiftAnchors(list, text, edited);
  assert.equal(resolveIssue(moved, 'failed-2', 'manual_input', { textEdited: true }).code, 'no_page_input');
  assert.equal(blockingIssues(moved, { textEdited: true }).length, 1);
  assert.equal(manual(moved, 'failed-2', '   \n  ').code, 'no_page_input', '공백만으로는 복구되지 않음');
  assert.equal(resolveIssue(moved, 'failed-2', 'range_checked').code, 'resolution_not_allowed');
  const ok = manual(moved, 'failed-2', '2쪽: 근무시간 09:00~18:00');
  assert.equal(ok.ok, true);
  assert.equal(blockingIssues(ok.issues).length, 0);
  // 입력 칸을 다시 비우면 그 쪽은 다시 처리 필요
  assert.equal(blockingIssues(setSupplement(ok.issues, 'failed-2', ' ')).length, 1);
});

test('직접 입력한 쪽 내용은 그 쪽 자리에 넣고, 저신뢰 구간 위치는 넣은 길이만큼 옮긴다 (앞쪽 수정 후에도 자리 유지)', () => {
  const { text, issues: list } = pdf3();
  const edited = text.replace('250', '2600'); // 1쪽 길이가 1 늘어남
  const moved = shiftAnchors(list, text, edited);
  const r = manual(moved, 'failed-2', '2쪽: 근무시간 09:00~18:00').issues;
  const at = edited.indexOf('15일');
  const out = assembleText(edited, r, [{ start: at, end: at + 2 }]);
  assert.equal(out.text, `${P1.replace('250', '2600')}\n\n2쪽: 근무시간 09:00~18:00\n\n${P3}`);
  assert.equal(out.text.slice(out.ranges[0].start, out.ranges[0].end), '15');
  assert.equal(out.text.slice(out.inserted[0].start, out.inserted[0].end), '2쪽: 근무시간 09:00~18:00');
  // 처리 표시가 없는 입력은 넣지 않음
  assert.equal(assembleText(edited, setSupplement(moved, 'failed-2', '미확인')).text, edited);
});

test('여러 쪽 추출 실패 중 한 쪽만 복구하면 아직 분석 불가, 각각 따로 복구해야 함', () => {
  const pages = ['1쪽 내용', '', '', '4쪽 내용'];
  const a = pageAnchors(pages);
  const text = joinPages(pages);
  let list = buildIssues({ failed: [{ page: 2, code: 'no_text_found', anchor: a[1] }, { page: 3, code: 'no_text_found', anchor: a[2] }], unit: 'pdf' });
  list = manual(list, 'failed-2', '2쪽 직접 입력').issues;
  assert.deepEqual(blockingIssues(list).map((x) => x.id), ['failed-3']);
  assert.equal(resolveIssue(list, 'failed-3', 'manual_input').code, 'no_page_input', '다른 쪽에 입력한 내용으로는 복구되지 않음');
  list = manual(list, 'failed-3', '3쪽 직접 입력').issues;
  assert.equal(blockingIssues(list).length, 0);
  assert.equal(assembleText(text, list).text, '1쪽 내용\n\n2쪽 직접 입력\n\n3쪽 직접 입력\n\n4쪽 내용', '쪽 순서대로');
});

test('빈 쪽 확인: 글자를 찾지 못했고 원본 미리보기가 있는 쪽만. 확인한 쪽은 분석 텍스트에서 빠지고 나머지는 분석 허용', () => {
  const { text } = pdf3();
  const list = buildIssues({ failed: [{ page: 2, code: 'no_text_found', anchor: P1.length }], unit: 'pdf', previewed: (p) => p <= 3 });
  assert.equal(list[0].canConfirmBlank, true);
  const r = resolveIssue(list, 'failed-2', 'blank_confirmed');
  assert.equal(r.ok, true);
  assert.equal(blockingIssues(r.issues).length, 0);
  assert.equal(assembleText(text, r.issues).text, text, '빈 쪽에는 아무것도 넣지 않음 (빈 쪽 자체를 분석하지 않음)');
  assert.match(resultNotes(r.issues)[0], /PDF 2쪽은 .*빈 쪽임을 확인했다고 표시해 분석에서 제외/);
});

test('파일 손상·쪽 그리기 실패·미리보기 실패에는 빈 쪽 확인을 주지 않음 (OCR 실패를 빈 쪽으로 확정하지 않음)', () => {
  const corrupt = buildIssues({ failed: [{ index: 0, code: 'image_decode_failed', anchor: 0 }] });
  assert.equal(corrupt[0].canConfirmBlank, false);
  assert.equal(resolveIssue(corrupt, 'failed-1', 'blank_confirmed').code, 'blank_not_checkable');
  const renderFail = buildIssues({ failed: [{ page: 2, code: 'extract_failed' }], unit: 'pdf' });
  assert.equal(renderFail[0].canConfirmBlank, false);
  const noPreview = buildIssues({ failed: [{ page: 2, code: 'no_text_found' }], unit: 'pdf', previewed: () => false });
  assert.equal(noPreview[0].canConfirmBlank, false);
  assert.equal(resolveIssue(noPreview, 'failed-2', 'blank_confirmed').code, 'blank_not_checkable');
  // 시스템이 스스로 빈 쪽으로 처리하지 않음: 표시 전에는 항상 처리 필요
  assert.equal(buildIssues({ failed: [{ page: 2, code: 'no_text_found' }], unit: 'pdf' })[0].resolution, null);
});

test('문서 전체가 비면(나머지 텍스트를 모두 지우고 실패한 쪽을 빈 쪽으로 확인) 분석할 텍스트가 없음', () => {
  const list = resolveIssue(buildIssues({ failed: [{ page: 2, code: 'no_text_found', anchor: 0 }], unit: 'pdf' }), 'failed-2', 'blank_confirmed').issues;
  assert.equal(assembleText('   ', list).text.trim(), '');
});

test('일부 누락 의심: 직접 보완(텍스트 수정 필요) 또는 원본과 비교해 범위 확인을 명시적으로 표시해야 처리', () => {
  const list = issues();
  assert.equal(resolveIssue(list, 'suspect-3', 'supplemented', { textEdited: false }).code, 'text_not_edited');
  assert.equal(resolveIssue(list, 'suspect-3', 'manual_input', { textEdited: true }).code, 'resolution_not_allowed');
  assert.equal(resolveIssue(list, 'suspect-3', 'blank_confirmed').code, 'resolution_not_allowed');
  const checked = resolveIssue(list, 'suspect-3', 'range_checked', { textEdited: false });
  assert.equal(checked.ok, true);
  assert.equal(isResolved(checked.issues.find((x) => x.id === 'suspect-3'), { textEdited: false }), true);
  assert.equal(resolveIssue(list, 'nope', 'range_checked').code, 'unknown_issue');
});

test('처음 추출한 내용으로 되돌리면 직접 입력한 내용·표시와 위치를 되돌림 (범위 확인·빈 쪽 확인 표시는 유지)', () => {
  let list = manual(issues(), 'failed-2', '직접 입력').issues;
  list = resolveIssue(list, 'suspect-3', 'range_checked').issues;
  list = shiftAnchors(list, 'abc', 'xyzabc');
  assert.equal(list.find((x) => x.id === 'failed-2').anchor, 6);
  const reset = resetTextDependent(list);
  const f = reset.find((x) => x.id === 'failed-2');
  assert.deepEqual([f.resolution, f.supplement, f.anchor], [null, '', 3]);
  assert.equal(reset.find((x) => x.id === 'suspect-3').resolution, 'range_checked');
  assert.equal(unresolve(list, 'suspect-3').find((x) => x.id === 'suspect-3').resolution, null);
  const blank = resolveIssue(buildIssues({ failed: [{ index: 0, code: 'no_text_found', anchor: 0 }] }), 'failed-1', 'blank_confirmed').issues;
  assert.equal(resetTextDependent(blank)[0].resolution, 'blank_confirmed');
});

test('위치 옮기기: 바뀐 범위 앞은 그대로, 그 자리에 글자를 넣거나 뒤를 고치면 길이만큼, 지운 범위 안이면 지운 자리로', () => {
  const at = (anchor, before, after) => shiftAnchors(buildIssues({ failed: [{ index: 0, anchor }] }), before, after)[0].anchor;
  assert.equal(at(3, 'abc\n\ndef', 'abc\n\ndeXf'), 3);
  assert.equal(at(3, 'abc\n\ndef', 'aXbc\n\ndef'), 4);
  assert.equal(at(3, 'abc\n\ndef', 'abcZ\n\ndef'), 4, '앞쪽 끝에 이어 쓴 글자는 그 쪽 내용으로 봄');
  assert.equal(at(3, 'abc\n\ndef', 'a'), 1);
});

test('결과 안내: 직접 입력·보완한 텍스트를 원본 전체 확보로 표현하지 않고, 누락을 확정된 사실로 쓰지 않음', () => {
  let list = buildIssues({ failed: [{ page: 2 }], suspect: [{ page: 3 }, { page: 4 }], unit: 'pdf' });
  list = manual(list, 'failed-2', '직접 입력').issues;
  list = resolveIssue(list, 'suspect-3', 'supplemented', { textEdited: true }).issues;
  list = resolveIssue(list, 'suspect-4', 'range_checked').issues;
  const notes = resultNotes(list);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /PDF 2쪽은 .*직접 입력.*빠짐없이 옮겼는지는 확인할 수 없어요/);
  assert.match(notes[1], /PDF 3쪽은 .*빠졌을 수 있어.*확인할 수 없어요/);
  assert.match(notes[2], /PDF 4쪽은 .*빠졌을 수 있다는 추정/);
  for (const n of notes) assert.doesNotMatch(n, /(모두|전체를) 확보|누락됐|누락되었|빠졌어요/);
  assert.deepEqual(resultNotes(buildIssues({ suspect: [{ index: 0 }] })), [], '처리 표시가 없으면 안내도 없음');
  assert.match(resultNotes(manual(buildIssues({ failed: [{ index: 1 }] }), 'failed-2', 'x').issues)[0], /^2번째 이미지는 /);
});
