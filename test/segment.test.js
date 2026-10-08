import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentText, toNumberedText } from '../src/segment.js';

test('줄 단위로 번호를 부여하고 빈 줄은 건너뛴다', () => {
  const segs = segmentText('급여\n\n월 250만원\n근무지: 서울');
  assert.deepEqual(segs.map((s) => [s.id, s.text]), [[1, '급여'], [2, '월 250만원'], [3, '근무지: 서울']]);
});

test('위치 정보로 원문을 그대로 복원할 수 있다', () => {
  const text = '  근로시간\r\n10시 00분부터 19시\r\n\t00분까지  \n';
  for (const s of segmentText(text)) assert.equal(text.slice(s.start, s.end), s.text);
});

test('마침표가 없다는 이유로 줄을 합치지 않는다', () => {
  const segs = segmentText('업무의 내용\n매장 판매 및 재고\n관리');
  assert.equal(segs.length, 3);
});

test('아주 긴 한 줄은 문장 경계에서만 나눈다', () => {
  const line = '저희 회사는 성장하는 스타트업입니다. 담당업무는 고객 응대이며 상담 기록을 관리합니다. 급여는 월 250만원이고 매월 25일에 지급합니다. 근무지는 서울 마포구이고 근무시간은 09시부터 18시까지입니다. 많은 지원 바랍니다.';
  const segs = segmentText(line);
  assert.ok(segs.length >= 4);
  assert.equal(segs.map((s) => s.text).join(' '), line);
  for (const s of segs) assert.equal(line.slice(s.start, s.end), s.text);
});

test('AI 전달용 번호 텍스트', () => {
  assert.equal(toNumberedText(segmentText('a\nb')), '[1] a\n[2] b');
});
