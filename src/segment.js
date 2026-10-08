// 입력 원문을 줄 단위 근거 단위(segment)로 나누고 번호를 부여한다.
// - 원문은 수정하지 않으며, 각 단위의 시작·끝 위치(원문 기준 문자 인덱스)를 보존한다.
// - 마침표가 없다는 이유로 줄을 합치지 않는다. 값이 여러 줄로 갈라진 경우는
//   AI가 여러 번호를 함께 근거로 고르도록 한다.
// - 한 줄이 매우 길면(웹 페이지를 한 줄로 붙여넣은 경우 등) 문장 경계에서만 나눈다.

const LONG_LINE = 100;
// 문장 끝(마침표·물음표·느낌표 뒤 공백) 또는 글머리 기호 앞에서 나눈다.
const SPLIT_POINT = /(?<=[^\d\s][.!?。])\s+|\s+(?=[•■▶※□◆●○]\s?)/g;

export function segmentText(text) {
  const segments = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    let contentEnd = lineEnd;
    if (contentEnd > lineStart && text[contentEnd - 1] === '\r') contentEnd -= 1;
    for (const [s, e] of splitLine(text, lineStart, contentEnd)) {
      pushTrimmed(segments, text, s, e);
    }
    if (lineEnd === text.length) break;
    lineStart = lineEnd + 1;
  }
  return segments;
}

function splitLine(text, start, end) {
  const line = text.slice(start, end);
  if (line.length <= LONG_LINE) return [[start, end]];
  const ranges = [];
  let cursor = 0;
  for (const m of line.matchAll(SPLIT_POINT)) {
    if (m.index > cursor) ranges.push([start + cursor, start + m.index]);
    cursor = m.index + m[0].length;
  }
  if (cursor < line.length) ranges.push([start + cursor, end]);
  return ranges;
}

function pushTrimmed(segments, text, s, e) {
  while (s < e && /\s/.test(text[s])) s += 1;
  while (e > s && /\s/.test(text[e - 1])) e -= 1;
  if (e <= s) return;
  segments.push({ id: segments.length + 1, text: text.slice(s, e), start: s, end: e });
}

// AI에 전달할 번호 부여 텍스트
export function toNumberedText(segments) {
  return segments.map((s) => `[${s.id}] ${s.text}`).join('\n');
}
