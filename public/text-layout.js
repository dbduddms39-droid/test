// S-03 '읽기 쉽게 정리해서 보기': AI(Gemini)가 나눈 제목·항목·문장 블록을 원문과 대조해 검증한다.
// 브라우저와 서버가 같은 규칙을 쓴다. 정리 결과는 화면 표시용이며 원문(추출 텍스트·사용자가 확인한 텍스트)을 바꾸지 않는다.
//
// 허용하는 차이는 공백뿐이다.
// - 블록 사이: 원문의 공백·줄바꿈은 블록 경계로 사라질 수 있다 (줄을 나누거나 합치는 위치).
// - 블록 안: 공백 묶음은 원문의 공백 묶음과 짝이 맞아야 한다(줄바꿈 ↔ 띄어쓰기는 같은 것으로 본다).
//   원문에 공백이 없는 곳에 공백을 넣을 수 없다. 원문의 줄바꿈(줄이 잘린 곳)만 블록 안에서 붙여 쓸 수 있다.
// 글자·숫자·날짜·금액·단위·기호가 하나라도 다르거나, 빠지거나, 더해지거나, 순서가 바뀌면 검증 실패(null)다.

export const LAYOUT_KINDS = ['heading', 'item', 'text'];
export const LAYOUT_MAX_BLOCKS = 2000;
const isWs = (c) => /\s/.test(c);

// original: 원문 문자열, blocks: [{ kind, text }]
// 반환: [{ kind, text }] (text = 화면에 보일 문자열, 원문과 공백만 다름) 또는 null (검증 실패)
export function alignLayout(original, blocks) {
  if (typeof original !== 'string' || !original.trim() || !Array.isArray(blocks) || !blocks.length || blocks.length > LAYOUT_MAX_BLOCKS) return null;
  const out = [];
  let pos = 0;
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || !LAYOUT_KINDS.includes(b.kind) || typeof b.text !== 'string') return null;
    const t = b.text.trim();
    if (!t) continue;
    while (pos < original.length && isWs(original[pos])) pos += 1;
    let i = 0;
    while (i < t.length) {
      if (isWs(t[i])) {
        // 블록 안의 공백은 원문에도 공백이 있어야 한다
        if (pos >= original.length || !isWs(original[pos])) return null;
        while (i < t.length && isWs(t[i])) i += 1;
        while (pos < original.length && isWs(original[pos])) pos += 1;
        continue;
      }
      if (pos < original.length && isWs(original[pos])) {
        // 원문의 줄바꿈(줄이 잘린 곳)만 붙여 쓸 수 있다. 같은 줄의 띄어쓰기는 지울 수 없다.
        let end = pos;
        while (end < original.length && isWs(original[end])) end += 1;
        if (!original.slice(pos, end).includes('\n')) return null;
        pos = end;
      }
      if (original[pos] !== t[i]) return null;
      i += 1;
      pos += 1;
    }
    out.push({ kind: b.kind, text: t.replace(/\s*\n\s*/g, ' ') });
  }
  if (original.slice(pos).trim()) return null; // 원문 뒷부분이 빠짐
  return out.length ? out : null;
}

// 제목 표시: 원문에 이미 괄호·기호가 있으면 그대로, 없으면 화면에서만 [ ]로 감싼다 (문자열은 바꾸지 않음)
export function headingHasMarker(text) {
  return /^\s*[[【〔<《〈(（■□◆◇●○▶▷※]/.test(text);
}
