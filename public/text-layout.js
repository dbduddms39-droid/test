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

// 검증된 블록 → 확인 화면에 둘 텍스트. 글자는 그대로, 줄바꿈만: 블록마다 한 줄, 제목 앞에는 빈 줄 하나.
// (제목을 감싸는 [ ]는 넣지 않는다. 화면에서만 표시)
export function layoutText(blocks) {
  return blocks.map((b, i) => (b.kind === 'heading' && i > 0 ? `\n${b.text}` : b.text)).join('\n');
}

// 공백만 다른 두 문자열의 위치 대응표. before의 위치 i → after의 위치. 공백이 아닌 글자가 하나라도 다르면 null.
// 공백 위치는 다음 글자의 위치로 옮긴다 (끝이면 after.length).
export function positionMap(before, after) {
  const map = new Array(before.length + 1);
  let j = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (isWs(before[i])) continue;
    while (j < after.length && isWs(after[j])) j += 1;
    if (after[j] !== before[i]) return null;
    map[i] = j;
    j += 1;
  }
  while (j < after.length) { if (!isWs(after[j])) return null; j += 1; }
  map[before.length] = after.length;
  for (let i = before.length - 1; i >= 0; i -= 1) if (map[i] === undefined) map[i] = map[i + 1];
  return (i) => map[Math.max(0, Math.min(before.length, i))];
}
