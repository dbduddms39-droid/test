// OCR 전처리·결과 평가 (DOM·Tesseract 없이 Node에서 확인). 실제 인식 정확도는 scripts/ocr-bench.mjs로 비교한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForOcr, textLineStats, removeLongLines, ocrScale } from '../public/ocr-prep.js';
import { stripOcrJunk, reviewOcr, combineImageResults } from '../public/upload-rules.js';

// 가상 이미지: 바탕색 영역 위에 '글자' 대신 굵은 가로 막대 줄을 그린다 (밝기만 다룬다)
function canvas(width, height, bg) {
  return { width, height, gray: new Uint8Array(width * height).fill(bg) };
}
function rect(img, x0, y0, x1, y1, v) {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) img.gray[y * img.width + x] = v;
}
// 글자 줄 흉내: 짧은 획이 띄엄띄엄 있는 줄
function textLine(img, x0, y0, x1, h, v) {
  for (let x = x0; x < x1; x += 10) rect(img, x, y0, Math.min(x + 5, x1), y0 + h, v);
}
const at = (img, out, x, y) => out[y * img.width + x];

test('흰 바탕 검은 글자는 그대로, 바탕은 흰색', () => {
  const img = canvas(300, 120, 245);
  textLine(img, 20, 40, 280, 16, 30);
  const { gray } = normalizeForOcr(img.gray, img.width, img.height);
  assert.ok(at(img, gray, 21, 45) < 60, '글자는 어둡게');
  assert.equal(at(img, gray, 5, 5), 255, '바탕은 흰색');
});

test('색 배너의 흰 글자는 반전해 흰 바탕 검은 글자로 (이전 방식은 밝기 100 이상 배너를 놓침)', () => {
  const img = canvas(300, 200, 255);
  rect(img, 0, 0, 300, 70, 150); // 주황 배너 정도의 밝기
  textLine(img, 20, 25, 200, 16, 255); // 흰 글자
  textLine(img, 20, 120, 280, 16, 30); // 아래 흰 바탕 검은 글자
  const { gray } = normalizeForOcr(img.gray, img.width, img.height);
  assert.ok(at(img, gray, 21, 30) < 128, '배너 글자는 어둡게 (대비가 약한 글자는 중간보다 진한 회색까지)');
  assert.equal(at(img, gray, 250, 35), 255, '배너 바탕은 흰색');
  assert.ok(at(img, gray, 21, 125) < 80, '아래 글자는 그대로 어둡게');
});

test('일부만 어두운 배너: 어두운 쪽만 반전하고 밝은 쪽 글자는 그대로 (이전 방식은 줄 전체를 반전)', () => {
  const img = canvas(400, 120, 255);
  rect(img, 0, 0, 220, 80, 35); // 왼쪽 어두운 배너
  textLine(img, 20, 30, 200, 16, 250); // 어두운 배너 위 흰 글자
  textLine(img, 260, 30, 380, 16, 60); // 오른쪽 흰 바탕 위 어두운 글자
  const { gray } = normalizeForOcr(img.gray, img.width, img.height);
  assert.ok(at(img, gray, 21, 35) < 80, '왼쪽 글자 어둡게');
  assert.ok(at(img, gray, 261, 35) < 100, '오른쪽 글자도 어둡게 (반전되지 않음)');
  assert.equal(at(img, gray, 120, 75), 255, '왼쪽 배너 바탕은 흰색');
});

test('다크 모드(전체가 어두운 화면)도 흰 바탕 검은 글자로', () => {
  const img = canvas(300, 120, 23);
  textLine(img, 20, 40, 280, 16, 230);
  const { gray } = normalizeForOcr(img.gray, img.width, img.height);
  assert.ok(at(img, gray, 21, 45) < 60);
  assert.equal(at(img, gray, 5, 5), 255);
});

test('어두운 화면 위 파란 버튼의 흰 글자도 남는다 (버튼 가장자리 때문에 방향을 잘못 정하지 않음)', () => {
  const img = canvas(400, 200, 23);
  rect(img, 40, 60, 360, 160, 119); // 파란 버튼
  textLine(img, 140, 100, 260, 18, 255);
  const { gray } = normalizeForOcr(img.gray, img.width, img.height);
  assert.ok(at(img, gray, 141, 105) < 100, '버튼 글자가 지워지지 않음');
});

test('옅은 잡티·테두리는 지우고 글자 줄 수·높이를 센다', () => {
  const img = canvas(300, 200, 250);
  rect(img, 0, 100, 300, 101, 232); // 옅은 구분선
  textLine(img, 20, 30, 280, 20, 40);
  textLine(img, 20, 130, 280, 20, 40);
  const { gray, rowInk } = normalizeForOcr(img.gray, img.width, img.height);
  assert.equal(at(img, gray, 150, 100), 255, '옅은 구분선은 지움');
  const stats = textLineStats(gray, img.width, img.height, rowInk);
  assert.equal(stats.count, 2);
  assert.ok(stats.height >= 18 && stats.height <= 22);
});

test('글자보다 긴 직선(표 테두리·버튼 외곽선)만 지운다', () => {
  const img = canvas(400, 200, 255);
  rect(img, 10, 150, 390, 153, 0); // 긴 가로선
  rect(img, 5, 10, 8, 190, 0); // 긴 세로선
  textLine(img, 40, 40, 300, 20, 0);
  removeLongLines(img.gray, img.width, img.height, 20);
  assert.equal(img.gray[151 * 400 + 200], 255);
  assert.equal(img.gray[100 * 400 + 6], 255);
  assert.equal(img.gray[45 * 400 + 41], 0, '글자 획은 남김');
});

test('글자 크기에 맞춘 배율: 작은 글자만 키우고(최대 3배), 이미지 크기 한도를 넘지 않음', () => {
  assert.equal(ocrScale(40, 1000, 1000), 1);
  assert.ok(Math.abs(ocrScale(15, 360, 500) - 40 / 15) < 0.01);
  assert.equal(ocrScale(8, 360, 500), 3);
  assert.equal(ocrScale(10, 1500, 2000), 1.5); // 긴 변 3000px 한도
  assert.equal(ocrScale(0, 360, 500), 1);
});

test('칸 사이 빈 곳·테두리에서 생긴 기호 조각만 지우고 내용 기호는 둔다', () => {
  assert.equal(stripOcrJunk('근무지 _ _ 서울 송파구'), '근무지 서울 송파구');
  assert.equal(stripOcrJunk('| 지원하기 |'), ' 지원하기 ');
  assert.equal(stripOcrJunk('근무시간 09:30 ~ 18:30'), '근무시간 09:30 ~ 18:30');
  assert.equal(stripOcrJunk('기간 3개월 - 6개월'), '기간 3개월 - 6개월');
  assert.equal(stripOcrJunk('file_name'), 'file_name');
});

test('결과 평가: 확인할 숫자는 고치지 않고 그대로 알리고, 일부만 읽힌 이미지는 낮은 품질로', () => {
  const w = (text, confidence = 95) => ({ text, confidence });
  const good = reviewOcr({ words: [w('1,000,000원'), w('2026.11.30'), w('12:00~13:00'), w('02-000-0000')], confidence: 92, lines: 5, inkLines: 5 });
  assert.deepEqual(good, { quality: 'good', uncertain: [], partial: false });
  const check = reviewOcr({ words: [w('202712.31'), w('2O27'), w('18:300'), w('5일', 40), w('근무', 30)], confidence: 90, lines: 5, inkLines: 5 });
  assert.equal(check.quality, 'check');
  assert.deepEqual(check.uncertain, ['202712.31', '2O27', '18:300', '5일']);
  assert.equal(reviewOcr({ words: [w('담당업무')], confidence: 90, lines: 4, inkLines: 10 }).quality, 'low');
  assert.equal(reviewOcr({ words: [w('담당업무')], confidence: 50, lines: 4, inkLines: 4 }).quality, 'low');
});

test('여러 장 합치기: 순서 유지, 확인이 필요한 이미지를 따로 알린다', () => {
  const out = combineImageResults([
    { ok: true, text: '첫 장', confidence: 92, quality: 'good', uncertain: [] },
    { ok: true, text: '둘째 장', confidence: 90, quality: 'check', uncertain: ['202712.31'] },
    { ok: true, text: '셋째 장', confidence: 86, quality: 'low', uncertain: [] },
    { ok: false, code: 'no_text_found' },
  ]);
  assert.equal(out.text, '첫 장\n\n둘째 장\n\n셋째 장');
  assert.deepEqual(out.review, [{ index: 1, quality: 'check', uncertain: ['202712.31'] }, { index: 2, quality: 'low', uncertain: [] }]);
  assert.equal(out.lowConfidence, true);
  assert.deepEqual(out.failed, [{ index: 3, code: 'no_text_found' }]);
});
