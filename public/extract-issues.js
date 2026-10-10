// 파일 추출 문제 (S-03). 브라우저와 Node 테스트에서 함께 쓴다. DOM·AI 의존 없음.
//
// OCR 처리 정책 (확정) 중 2·3번을 구현한다. 1번(특정 글자만 불확실)은 ocr-spans.js가 맡는다.
//
// 2. 일부 누락 의심 (kind 'suspect'): OCR 품질 추정치(인식 줄 수가 이미지의 글자 줄보다 적음, 평균 신뢰도 낮음)로 판단한 '의심'이다.
//    실제로 빠졌다고 확정하지 않는다. 사용자가 (a) 빠진 내용을 직접 보완했거나 (b) 원본과 비교해 추출 범위를 확인했다고
//    명시적으로 표시해야 분석할 수 있다. '분석하기' 버튼은 어떤 문제도 해결로 처리하지 않는다.
// 3. 추출 실패 (kind 'failed'): 이미지·PDF 쪽에서 글자를 전혀 얻지 못했다. 그대로는 분석할 수 없다.
//    다시 추출하거나(S-02로 돌아가 새 추출 → 문제 목록도 새로 만든다), 원본을 보고 그 내용을 직접 입력한 뒤 표시해야 한다.
//    복구 전에는 분석하지 않으므로, 읽지 못한 쪽의 조건이 '관련 내용 찾지 못함'으로 표시되지 않는다.
//
// 추출 실패는 쪽마다 따로 관리한다. '직접 입력'은 그 쪽의 입력 칸에 공백이 아닌 내용을 넣었을 때만 인정하고
// (추출 텍스트의 다른 쪽을 고치거나 공백만 바꾼 것은 인정하지 않음), 그 내용은 그 쪽 자리에 넣어 분석한다.
// 글자를 찾지 못한 쪽은 사용자가 원본에서 빈 쪽임을 확인하면 분석 대상에서 뺀다(빈 쪽 자체에는 결과를 만들지 않음).
// '직접 보완'(일부 누락 의심)은 추출 텍스트가 실제로 바뀌었을 때만 받는다. 텍스트를 처음 추출한 내용으로 되돌리면
// 직접 입력·보완 표시는 다시 '확인 필요'가 된다. 직접 입력한 텍스트도 원본 전체를 빠짐없이 옮겼다는 보장으로 보지 않는다(resultNotes).

import { diffRegion } from './ocr-spans.js';

export const RESOLUTIONS = {
  failed: ['manual_input', 'blank_confirmed'],
  suspect: ['supplemented', 'range_checked'],
};
const hasContent = (t) => /\S/.test(t ?? '');

// 원본에서 빈 쪽임을 확인하는 선택지는 '글자를 찾지 못한' 쪽이면서 원본 미리보기로 대조할 수 있을 때만 준다.
// 파일 손상·쪽 그리기 실패(원본 확인이 어려운 경우)에는 주지 않는다. 시스템이 빈 쪽이라고 정하지는 않는다.
const BLANK_CHECKABLE = new Set(['no_text_found']);

// failed: [{ index(0부터) 또는 page(1부터), code, anchor }], suspect: [{ index 또는 page, reason: 'partial'|'low_confidence' }]
//   anchor: 그 쪽 내용이 들어갈 추출 텍스트 위치 (앞쪽 텍스트 끝). 사용자가 직접 입력한 내용은 이 위치에 넣어 분석한다.
// unit: 'image' | 'pdf', previewed(position): 그 쪽의 원본 미리보기가 있는가
export function buildIssues({ failed = [], suspect = [], unit = 'image', previewed = () => true } = {}) {
  const label = (x) => (unit === 'pdf' ? `PDF ${x.page}쪽` : `${x.index + 1}번째 이미지`);
  const where = (x) => (unit === 'pdf' ? x.page : x.index + 1);
  return [
    ...failed.map((x) => {
      const code = x.code ?? 'no_text_found';
      const anchor = Number.isInteger(x.anchor) ? x.anchor : null;
      return {
        id: `failed-${where(x)}`, kind: 'failed', unit, label: label(x), position: where(x), code,
        canConfirmBlank: BLANK_CHECKABLE.has(code) && Boolean(previewed(where(x))),
        anchor, originalAnchor: anchor, supplement: '', resolution: null,
      };
    }),
    ...suspect.map((x) => ({ id: `suspect-${where(x)}`, kind: 'suspect', unit, label: label(x), position: where(x), reason: x.reason ?? 'low_confidence', resolution: null })),
  ];
}

// 사용자가 문제 하나를 처리했다고 표시한다. 조건이 맞지 않으면 거부한다.
// - manual_input(추출 실패): 그 쪽의 '직접 입력' 칸에 공백이 아닌 내용이 있어야 한다. 추출 텍스트의 다른 곳을 고친 것은 인정하지 않는다.
// - blank_confirmed(추출 실패): 글자를 찾지 못한 쪽이고 원본 미리보기가 있을 때만.
// - supplemented(일부 누락 의심): 추출 텍스트가 처음 추출한 내용과 달라야 한다.
export function resolveIssue(issues, id, resolution, { textEdited = false } = {}) {
  const issue = issues.find((x) => x.id === id);
  if (!issue) return { ok: false, code: 'unknown_issue', issues };
  if (!RESOLUTIONS[issue.kind].includes(resolution)) return { ok: false, code: 'resolution_not_allowed', issues };
  if (resolution === 'manual_input' && !hasContent(issue.supplement)) return { ok: false, code: 'no_page_input', issues };
  if (resolution === 'blank_confirmed' && !issue.canConfirmBlank) return { ok: false, code: 'blank_not_checkable', issues };
  if (resolution === 'supplemented' && !textEdited) return { ok: false, code: 'text_not_edited', issues };
  return { ok: true, issues: issues.map((x) => (x.id === id ? { ...x, resolution } : x)) };
}

// 추출 실패한 쪽의 '직접 입력' 칸 내용을 바꾼다 (표시는 그대로 두고, 처리 여부는 isResolved가 내용으로 다시 판단)
export function setSupplement(issues, id, text) {
  return issues.map((x) => (x.id === id && x.kind === 'failed' ? { ...x, supplement: String(text ?? '') } : x));
}

export function unresolve(issues, id) {
  return issues.map((x) => (x.id === id ? { ...x, resolution: null } : x));
}

// 지금 상태로 처리된 문제인가. 직접 입력 표시는 그 쪽 입력 칸에 내용이 남아 있을 때만,
// 직접 보완 표시는 추출 텍스트가 처음 추출한 내용과 다를 때만 유효하다.
export function isResolved(issue, { textEdited = false } = {}) {
  if (!issue.resolution) return false;
  if (issue.resolution === 'manual_input') return hasContent(issue.supplement);
  if (issue.resolution === 'supplemented') return textEdited;
  return true;
}

// 분석을 막는 문제 목록 (비어 있어야 분석할 수 있음)
export function blockingIssues(issues, opts = {}) {
  return issues.filter((x) => !isResolved(x, opts));
}

// 처음 추출한 내용으로 되돌리면 직접 입력·보완한 내용과 표시를 지운다
// (원본과 비교해 범위를 확인한 표시, 빈 쪽 확인 표시는 텍스트와 무관해 유지)
export function resetTextDependent(issues) {
  return issues.map((x) => {
    const reset = x.resolution === 'manual_input' || x.resolution === 'supplemented' ? { ...x, resolution: null } : x;
    return x.kind === 'failed' ? { ...reset, supplement: '', anchor: x.originalAnchor } : reset;
  });
}

// 추출 텍스트가 before → after로 바뀌면 실패한 쪽이 들어갈 위치를 옮긴다.
// 바뀐 범위 앞이면 그대로, 뒤(또는 그 위치에 글자를 넣음)면 길이 차이만큼, 지운 범위 안이면 지운 자리 시작으로.
export function shiftAnchors(issues, before, after) {
  if (before === after) return issues;
  const { start: cs, oldEnd: ce, newEnd: ne } = diffRegion(before, after);
  const delta = ne - ce;
  return issues.map((x) => {
    if (x.kind !== 'failed' || x.anchor == null) return x;
    const a = x.anchor < cs ? x.anchor : x.anchor >= ce ? x.anchor + delta : cs;
    return a === x.anchor ? x : { ...x, anchor: a };
  });
}

// 분석에 보낼 텍스트: 추출 텍스트에 '직접 입력'으로 처리한 쪽의 내용을 그 쪽 위치에 넣는다.
// 빈 쪽으로 확인한 쪽은 아무것도 넣지 않는다(분석 대상에서 제외). ranges(OCR 저신뢰 구간)는 넣은 길이만큼 옮긴다.
// 반환: { text, ranges, inserted: [{ id, start, end }] }
export function assembleText(mainText, issues, ranges = []) {
  const inserts = issues
    .filter((x) => x.kind === 'failed' && x.resolution === 'manual_input' && hasContent(x.supplement))
    .map((x) => ({ id: x.id, position: x.position, at: Math.min(Math.max(x.anchor ?? mainText.length, 0), mainText.length), body: x.supplement.trim() }))
    .sort((a, b) => a.at - b.at || a.position - b.position);
  let text = '';
  let cursor = 0;
  let lastWasInsert = false;
  const inserted = [];
  const slices = []; // 추출 텍스트 조각의 [원래 시작, 원래 끝, 새 시작]
  const appendMain = (from, to) => {
    if (to <= from) return;
    if (lastWasInsert && !/^\s/.test(mainText[from])) text += '\n\n';
    slices.push([from, to, text.length]);
    text += mainText.slice(from, to);
    lastWasInsert = false;
  };
  for (const ins of inserts) {
    appendMain(cursor, ins.at);
    cursor = Math.max(cursor, ins.at);
    if (text.length && !/\n\n$/.test(text)) text += /\n$/.test(text) ? '\n' : '\n\n';
    inserted.push({ id: ins.id, start: text.length, end: text.length + ins.body.length });
    text += ins.body;
    lastWasInsert = true;
  }
  appendMain(cursor, mainText.length);
  const mapPos = (p) => {
    const sl = slices.find(([a, b]) => p >= a && p < b) ?? slices.find(([, b]) => p === b);
    return sl ? sl[2] + (p - sl[0]) : p;
  };
  return {
    text,
    ranges: ranges.map((r) => { const start = mapPos(r.start); return { start, end: start + (r.end - r.start) }; }),
    inserted,
  };
}

// 결과 화면에 덧붙일 안내. 직접 입력·보완한 텍스트를 원본 전체를 확보했다는 보장으로 표현하지 않는다.
// 목록 마지막 글자의 받침에 맞춘 조사 ('2번째 이미지는', 'PDF 3쪽은')
const topicOf = (labels) => {
  const text = labels.join(', ');
  const code = text.charCodeAt(text.length - 1) - 0xac00;
  return `${text}${code >= 0 && code <= 11171 && code % 28 ? '은' : '는'}`;
};

export function resultNotes(issues) {
  const notes = [];
  const by = (r) => issues.filter((x) => x.resolution === r).map((x) => x.label);
  const manual = by('manual_input');
  const supplemented = by('supplemented');
  const checked = by('range_checked');
  if (manual.length) {
    notes.push(`${topicOf(manual)} 글자를 읽지 못해 사용자가 원본을 보고 직접 입력한 내용을 기준으로 확인했어요. 직접 입력한 내용이 원본을 빠짐없이 옮겼는지는 확인할 수 없어요.`);
  }
  if (supplemented.length) {
    notes.push(`${topicOf(supplemented)} 일부가 빠졌을 수 있어 사용자가 직접 보완한 텍스트를 기준으로 확인했어요. 보완한 내용이 원본 전체를 빠짐없이 담았는지는 확인할 수 없어요.`);
  }
  const blank = by('blank_confirmed');
  if (blank.length) {
    notes.push(`${topicOf(blank)} 글자를 찾지 못했고, 사용자가 원본에서 빈 쪽임을 확인했다고 표시해 분석에서 제외했어요.`);
  }
  if (checked.length) {
    notes.push(`${topicOf(checked)} 일부가 빠졌을 수 있다는 추정이 있어, 사용자가 원본과 비교해 추출 범위를 확인했다고 표시한 텍스트 기준이에요.`);
  }
  return notes;
}
