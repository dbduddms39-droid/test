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
  assert.deepEqual(good, { quality: 'good', uncertain: [], uncertainAll: [], partial: false });
  const check = reviewOcr({ words: [w('202712.31'), w('2O27'), w('18:300'), w('5일', 40), w('근무', 30)], confidence: 90, lines: 5, inkLines: 5 });
  assert.equal(check.quality, 'check');
  assert.deepEqual(check.uncertain, ['202712.31', '2O27', '18:300', '5일']);
  // 안내 문구에는 최대 6개, 구간 추적(S-03)에는 전체 목록을 쓴다
  const many = reviewOcr({ words: ['1O', '2O', '3O', '4O', '5O', '6O', '7O', '8O'].map((t) => w(t)), confidence: 90, lines: 5, inkLines: 5 });
  assert.equal(many.uncertain.length, 6);
  assert.equal(many.uncertainAll.length, 8);
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
  assert.deepEqual(out.review, [{ index: 1, quality: 'check', partial: false, uncertain: ['202712.31'], anchor: '첫 장\n\n둘째 장'.length }, { index: 2, quality: 'low', partial: false, uncertain: [], anchor: '첫 장\n\n둘째 장\n\n셋째 장'.length }]);
  assert.equal(out.lowConfidence, true);
  assert.deepEqual(out.failed, [{ index: 3, code: 'no_text_found', anchor: '첫 장\n\n둘째 장\n\n셋째 장'.length }]);
  assert.deepEqual(out.uncertainAll, ['202712.31']);
});

// ---------- 배치(행·칸)에 맞춰 줄 엮기 ----------
import { analyzeLayout, placeWords, assembleLines, isIcon } from '../public/ocr-layout.js';

// 잉크 지도에 사각형을 칠한다 (글자·아이콘 흉내)
function inkMap(width, height, boxes) {
  const ink = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) ink[y * width + x] = 1;
  return ink;
}
const word = (text, x0, y0, x1, y1, confidence = 95, lineId = null, space = true) => ({ text, confidence, bbox: { x0, y0, x1, y1 }, lineId, space });

test('아이콘·항목명·두 줄 값이 있는 표 행: 아이콘을 빼고 항목명은 값의 첫 줄에 붙인다', () => {
  // 행: 아이콘(40px 정사각) | 항목명 '수습기간 중 급여'(두 줄 값의 가운데) | 값 1줄 '월 300만원 (세전)' + 값 2줄 '(수습기간 3개월)'
  const W = 900; const H = 140; const th = 40;
  const ink = inkMap(W, H, [[20, 40, 60, 82], [100, 50, 260, 72], [400, 20, 640, 50], [400, 70, 600, 95]]);
  const blocks = analyzeLayout(ink, W, H, th);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].segs.length, 3);
  const words = [
    word('B', 20, 40, 60, 82, 75), // 아이콘을 글자로 읽음
    word('수습기간', 100, 50, 170, 72, 93, 1), word('중', 180, 50, 200, 72, 93, 1), word('급여', 210, 50, 260, 72, 93, 1),
    word('월', 400, 20, 420, 50, 93, 2), word('300만원', 430, 20, 540, 50, 93, 2), word('(세전)', 550, 20, 640, 50, 93, 2),
    word('(수습기간', 400, 70, 520, 95, 93, 3), word('3개월)', 530, 70, 600, 95, 93, 3),
  ];
  const out = assembleLines(blocks, placeWords(words, blocks), th);
  assert.deepEqual(out.lines.map((l) => l.text), ['수습기간 중 급여 월 300만원 (세전)', '(수습기간 3개월)']);
  assert.equal(out.icons, 1);
});

test('좌우 2열 목록: 가운데 아이콘에서 항목을 나눠 한 줄에 하나씩', () => {
  const W = 1000; const H = 60; const th = 40;
  const ink = inkMap(W, H, [[20, 10, 60, 50], [100, 15, 300, 45], [520, 10, 560, 50], [600, 15, 760, 45]]);
  const blocks = analyzeLayout(ink, W, H, th);
  const words = [word('©', 20, 10, 60, 50, 69), word('4대', 100, 15, 150, 45, 93, 1), word('보험', 160, 15, 220, 45, 93, 1), word('가입', 230, 15, 300, 45, 93, 1),
    word('@', 520, 10, 560, 50, 65), word('건강검진', 600, 15, 700, 45, 93, 1), word('지원', 710, 15, 760, 45, 93, 1)];
  const out = assembleLines(blocks, placeWords(words, blocks), th);
  assert.deepEqual(out.lines.map((l) => l.text), ['4대 보험 가입', '건강검진 지원']);
});

test('아이콘 판단: 두 글자 항목명·글자 높이의 숫자 칸은 남기고, 한글 없는 기호·큰 그림·확신 낮은 한 칸은 뺀다', () => {
  const seg = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
  const th = 40; const glyph = 30;
  assert.equal(isIcon(seg(160, 220, 129, 160), [word('연봉', 160, 129, 220, 160, 55)], th, 3, glyph), false, '두 글자 항목명');
  assert.equal(isIcon(seg(20, 40, 130, 152), [word('1', 20, 130, 40, 152, 92)], th, 3, glyph), false, '번호 칸 숫자');
  assert.equal(isIcon(seg(80, 124, 122, 165), [word('8', 80, 122, 124, 165, 87)], th, 3, glyph), true, '아이콘을 숫자로 읽음(글자보다 큼)');
  assert.equal(isIcon(seg(80, 124, 122, 160), [word('<?', 80, 122, 124, 160, 65)], th, 3, glyph), true, '기호');
  assert.equal(isIcon(seg(100, 140, 980, 1022), [word('범', 100, 980, 130, 1022, 55), word('0', 130, 976, 150, 1035, 37)], th, 4, glyph), true, '확신 낮은 한 칸');
  assert.equal(isIcon(seg(80, 124, 122, 160), [word('g', 80, 122, 124, 160, 72)], th, 1, glyph), false, '칸이 하나뿐인 행은 아이콘으로 보지 않음');
});

test('칸 맨 앞 로고: 한글이 없고 글자보다 크고 떨어져 있을 때만 뺀다 (번호 "1."은 남김)', () => {
  const W = 900; const H = 60; const th = 30;
  const ink = inkMap(W, H, [[10, 5, 380, 55]]);
  const blocks = analyzeLayout(ink, W, H, th);
  const logo = [word('67', 10, 5, 50, 55, 83), word('(주)그린테크놀로지', 70, 15, 250, 45, 93, 1), word('기술로', 260, 15, 320, 45, 93, 1), word('더', 330, 15, 380, 45, 93, 1)];
  assert.deepEqual(assembleLines(blocks, placeWords(logo, blocks), th).lines.map((l) => l.text), ['(주)그린테크놀로지 기술로 더']);
  const numbered = [word('1.', 10, 20, 30, 45, 95, 2), word('채용', 40, 15, 100, 45, 95, 2), word('직무', 110, 15, 170, 45, 95, 2)];
  assert.deepEqual(assembleLines(blocks, placeWords(numbered, blocks), th).lines.map((l) => l.text), ['1. 채용 직무']);
});

test('결과 평가: 한글 문서에서 신뢰도 낮게 영문으로 읽힌 단어도 확인할 부분으로 (고치지 않음)', () => {
  const w = (text, confidence = 95) => ({ text, confidence });
  const r = reviewOcr({ words: [w('사내'), w('Addl', 20), w('및'), w('커피'), w('API', 90), w('HLF', 47), w('무제한')], confidence: 90, lines: 3, inkLines: 3 });
  assert.deepEqual(r.uncertain, ['Addl', 'HLF']);
  assert.equal(r.quality, 'check');
});
