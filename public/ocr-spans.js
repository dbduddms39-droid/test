// OCR 저신뢰 구간 추적 (S-03). 브라우저와 Node 테스트에서 함께 쓴다. AI를 호출하지 않는다.
//
// 정책 (확정):
// - 불확실성은 사용자가 S-03에서 그 구간을 직접 고쳤거나, 원본과 대조해 '확인했어요'를 눌렀을 때만 해제한다.
//   '내용 확인하고 분석하기' 버튼은 어떤 구간도 해제하지 않는다.
// - 해제되지 않은 구간은 분석 요청에 위치(문자 구간)로 보내고, 서버는 그 구간과 겹치는 세부기준을 확정하지 않는다
//   (핵심이면 상위 '분석 확인 불가', 추가면 그 기준만).
// - 고친 범위가 커서(붙여넣기·대량 삭제 등) 원래 위치와 대응할 수 없게 되면 안전하게 처리한다:
//   새로 들어온 글자 전체를 '대응 불가 구간'으로 표시하고, 사라진 저신뢰 글자는 텍스트에 같은 글자가 다시 나타나면 그 위치도 확정하지 않는다.
//
// 구간 종류(kind): ocr(인식이 불확실한 글자), untracked(대량 수정으로 대응할 수 없게 된 구간),
//                  lost(대량 수정으로 위치를 잃은 저신뢰 글자), unlocated(추출 텍스트에서 위치를 찾지 못한 저신뢰 글자)
// 상태(state): pending(확인 필요), edited(사용자가 고침), confirmed(원본과 대조해 확인함)

// 한 번의 입력 변경이 '그 자리를 고친 것'인지: 지운 글자가 그 구간 길이 + LOCAL_MARGIN 이하이고, 새로 넣은 글자가 LOCAL_EDIT_MAX 이하.
// 넘으면(문서 비우기, 줄 통째 붙여넣기 등) 위치 대응을 믿지 않는다.
export const LOCAL_EDIT_MAX = 60;
export const LOCAL_MARGIN = 10;

const occurrences = (text, word) => {
  const out = [];
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) out.push(i);
  return out;
};

// 추출 텍스트와 OCR이 알려 준 불확실한 단어로 추적을 시작한다. 같은 단어가 여러 번 나오면 모두 표시한다(보수적).
export function createTracker(text, words = []) {
  let nextId = 1;
  const spans = [];
  const lost = [];
  for (const w of [...new Set(words.map((x) => String(x).trim()).filter(Boolean))]) {
    const at = occurrences(text, w);
    for (const i of at) spans.push({ id: nextId++, kind: 'ocr', state: 'pending', start: i, end: i + w.length, text: w });
    if (!at.length) lost.push({ id: nextId++, kind: 'unlocated', state: 'pending', text: w });
  }
  spans.sort((a, b) => a.start - b.start);
  return { spans, lost, nextId };
}

// 두 텍스트의 바뀐 범위 (공통 앞부분·뒷부분을 뺀 나머지)
export function diffRegion(before, after) {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p += 1;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s += 1;
  return { start: p, oldEnd: before.length - s, newEnd: after.length - s };
}

// 텍스트가 before → after로 바뀌었을 때 구간 위치와 상태를 갱신한다 (원래 tracker는 바꾸지 않음)
export function applyEdit(tracker, before, after) {
  if (before === after) return tracker;
  const { start: cs, oldEnd: ce, newEnd: ne } = diffRegion(before, after);
  const delta = (ne - cs) - (ce - cs);
  const local = ce - cs <= LOCAL_EDIT_MAX && ne - cs <= LOCAL_EDIT_MAX;
  const overlapsSpan = (s) => (ce === cs ? s.start < cs && cs < s.end : cs < s.end && ce > s.start);
  let nextId = tracker.nextId;
  const lost = [...tracker.lost];
  const spans = [];
  let lostPosition = false;
  for (const s of tracker.spans) {
    if (s.state !== 'pending') { spans.push(s); continue; } // 해제된 구간은 위치를 더 추적하지 않는다
    if (!overlapsSpan(s)) {
      spans.push(ce <= s.start ? { ...s, start: s.start + delta, end: s.end + delta } : s);
      continue;
    }
    if (s.kind === 'untracked') {
      // 대응 불가 구간 안을 고쳐도 구간 전체가 확인된 것은 아니다 → 범위만 넓혀 그대로 확인 필요
      if (local) spans.push({ ...s, start: Math.min(s.start, cs), end: Math.max(s.end + delta, ne), text: after.slice(Math.min(s.start, cs), Math.max(s.end + delta, ne)) });
      else lostPosition = true;
      continue;
    }
    if (local && ce - cs <= s.end - s.start + LOCAL_MARGIN) {
      // 사용자가 그 자리를 직접 고침 → 해제
      spans.push({ ...s, state: 'edited', start: null, end: null, editedTo: after.slice(cs, ne) });
    } else {
      // 대량 수정으로 위치를 잃음 → 글자 기준으로 계속 확정하지 않음
      lost.push({ id: s.id, kind: 'lost', state: 'pending', text: s.text });
      lostPosition = true;
    }
  }
  // 위치를 잃은 구간이 있으면 새로 들어온 글자 전체를 대응 불가 구간으로 둔다
  if (lostPosition && ne > cs) {
    spans.push({ id: nextId++, kind: 'untracked', state: 'pending', start: cs, end: ne, text: after.slice(cs, ne) });
  }
  spans.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  return { spans, lost, nextId };
}

// 사용자가 원본과 대조해 확인한 구간을 해제한다 (그 구간 하나만)
export function confirmSpan(tracker, id) {
  const mark = (x) => (x.id === id && x.state === 'pending' ? { ...x, state: 'confirmed', start: null, end: null } : x);
  return { ...tracker, spans: tracker.spans.map(mark), lost: tracker.lost.map(mark) };
}

// 분석 요청에 보낼 '확인되지 않은 저신뢰 구간' [{ start, end }] (겹치면 합침)
export function pendingRanges(tracker, text) {
  const ranges = [];
  for (const s of tracker.spans) {
    if (s.state === 'pending' && s.start != null && s.end > s.start && s.end <= text.length) ranges.push([s.start, s.end]);
  }
  for (const l of tracker.lost) {
    if (l.state === 'pending') for (const i of occurrences(text, l.text)) ranges.push([i, i + l.text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.map(([start, end]) => ({ start, end }));
}

export function summary(tracker) {
  const all = [...tracker.spans, ...tracker.lost];
  return {
    total: all.length,
    pending: all.filter((x) => x.state === 'pending').length,
    edited: all.filter((x) => x.state === 'edited').length,
    confirmed: all.filter((x) => x.state === 'confirmed').length,
  };
}
