// 화면 공통 컴포넌트. 디자인 명세(design-handoff/design/DESIGN.md)의 요소를 기존 바닐라 JS 구조에 맞춘 렌더 함수다.
// 모든 함수는 DOM 노드를 만들어 돌려주며, 문서 원문은 textContent로만 넣는다(HTML로 해석하지 않음).

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c);
  return node;
};

// 상태 코드 → 표시 유형. 색이 아니라 기호(• ○ — ?)와 글자 굵기로 구분하고, 초록·빨강은 쓰지 않는다.
// 현재 앱의 4개 상태와 v2.2 동결 기준표의 상위 4개·세부 6개 상태 코드를 함께 받는다.
// 라벨은 이 표에 두지 않는다: v2.2 라벨은 기준표 원문 그대로, 현재 상태 라벨은 서버 응답(statusLabel)을 쓴다.
const STATUS_KIND = {
  stated: 'found', unclear: 'review', not_found: 'missing', unavailable: 'unavailable',
  MAIN_FOUND: 'found', MAIN_PARTIAL: 'review', MAIN_MISSING: 'missing', MAIN_UNAVAILABLE: 'unavailable',
  CONFIRMED: 'found', PARTIAL: 'review', UNCLEAR: 'review', MISSING: 'missing', NOT_APPLICABLE: 'missing', UNAVAILABLE: 'unavailable',
};
export const statusKind = (code) => STATUS_KIND[code] ?? 'unavailable';

// v2.2 동결 기준표 3-1·3-2의 UI 라벨 (원문 그대로)
export const V22_STATUS_LABEL = {
  MAIN_FOUND: '주요 내용 기재됨', MAIN_PARTIAL: '일부 내용만 기재됨', MAIN_MISSING: '관련 내용 찾지 못함', MAIN_UNAVAILABLE: '분석 확인 불가',
  CONFIRMED: '확인됨', PARTIAL: '일부 확인', UNCLEAR: '불분명함', MISSING: '확인되지 않음', NOT_APPLICABLE: '해당 없음', UNAVAILABLE: '분석 확인 불가',
};

// 상태 배지. 기호는 CSS ::before로 그려 textContent에는 라벨만 남긴다.
export const statusBadge = (code, label = V22_STATUS_LABEL[code]) =>
  el('span', { class: `badge badge-${statusKind(code)}`, 'data-status': code }, label ?? '');

// 원문 근거 칩: 인용한 원문(따옴표)과 줄 번호. 계산값은 이 칩이 아니라 별도 표시를 쓴다.
export const evidenceChip = (text, lineId) =>
  el('span', { class: 'evidence-chip' },
    lineId != null ? el('span', { class: 'line-ref' }, `${lineId}번 줄`) : null,
    el('q', {}, text));

// 원문 줄 목록. highlight에 든 줄 번호는 형광펜 표시하고, 나머지 줄은 흐리게 둔다.
// lines: [{ id, text }]
export const sourceLines = (lines, highlight = []) => {
  const marked = new Set(highlight.map(String));
  return el('ol', { class: 'source-lines' }, lines.map((s) => {
    const on = marked.has(String(s.id));
    return el('li', { class: on ? 'source-line is-marked' : 'source-line', 'data-line': String(s.id) },
      el('span', { class: 'mono-index source-line-no', 'aria-hidden': 'true' }, String(s.id).padStart(2, '0')),
      el(on ? 'mark' : 'span', { class: 'source-line-text' }, s.text));
  }));
};

// 여백 주석(교정 메모). 데스크톱은 오른쪽 여백, 좁은 화면은 문단 아래 왼쪽 선 들여쓰기로 보인다.
export const marginNote = (meta, ...body) =>
  el('aside', { class: 'margin-note' }, meta ? el('p', { class: 'mono-meta' }, meta) : null, ...body);

// 고정폭 번호가 붙은 구획 제목 (예: 01 임금)
export const indexedHeading = (tag, index, title, attrs = {}) =>
  el(tag, { ...attrs, class: `indexed-heading${attrs.class ? ` ${attrs.class}` : ''}` },
    el('span', { class: 'mono-index' }, String(index).padStart(2, '0')),
    el('span', {}, title));
