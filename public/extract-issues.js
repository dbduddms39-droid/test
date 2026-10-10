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
// '직접 보완'·'직접 입력' 표시는 추출 텍스트가 실제로 바뀌었을 때만 받는다. 텍스트를 처음 추출한 내용으로 되돌리면
// 그 표시는 다시 '확인 필요'가 된다. 직접 입력한 텍스트도 원본 전체를 빠짐없이 옮겼다는 보장으로 보지 않는다(resultNotes).

export const RESOLUTIONS = {
  failed: ['manual_input'],
  suspect: ['supplemented', 'range_checked'],
};
const NEEDS_EDIT = new Set(['manual_input', 'supplemented']);

// failed: [{ index(0부터) 또는 page(1부터), code }], suspect: [{ index 또는 page, reason: 'partial'|'low_confidence' }]
// unit: 'image' | 'pdf'
export function buildIssues({ failed = [], suspect = [], unit = 'image' } = {}) {
  const label = (x) => (unit === 'pdf' ? `PDF ${x.page}쪽` : `${x.index + 1}번째 이미지`);
  const where = (x) => (unit === 'pdf' ? x.page : x.index + 1);
  return [
    ...failed.map((x) => ({ id: `failed-${where(x)}`, kind: 'failed', unit, label: label(x), position: where(x), code: x.code ?? 'no_text_found', resolution: null })),
    ...suspect.map((x) => ({ id: `suspect-${where(x)}`, kind: 'suspect', unit, label: label(x), position: where(x), reason: x.reason ?? 'low_confidence', resolution: null })),
  ];
}

// 사용자가 문제 하나를 해결했다고 표시한다. 허용되지 않은 해결 방법이거나, 텍스트를 고치지 않았는데 '직접 입력·보완'을 표시하면 거부한다.
export function resolveIssue(issues, id, resolution, { textEdited = false } = {}) {
  const issue = issues.find((x) => x.id === id);
  if (!issue) return { ok: false, code: 'unknown_issue', issues };
  if (!RESOLUTIONS[issue.kind].includes(resolution)) return { ok: false, code: 'resolution_not_allowed', issues };
  if (NEEDS_EDIT.has(resolution) && !textEdited) return { ok: false, code: 'text_not_edited', issues };
  return { ok: true, issues: issues.map((x) => (x.id === id ? { ...x, resolution } : x)) };
}

export function unresolve(issues, id) {
  return issues.map((x) => (x.id === id ? { ...x, resolution: null } : x));
}

// 지금 텍스트 기준으로 해결된 문제인가. 직접 입력·보완 표시는 텍스트가 처음 추출한 내용과 다를 때만 유효하다.
export function isResolved(issue, { textEdited = false } = {}) {
  if (!issue.resolution) return false;
  return !NEEDS_EDIT.has(issue.resolution) || textEdited;
}

// 분석을 막는 문제 목록 (비어 있어야 분석할 수 있음)
export function blockingIssues(issues, opts = {}) {
  return issues.filter((x) => !isResolved(x, opts));
}

// 처음 추출한 내용으로 되돌리면 텍스트 수정에 기댄 표시를 지운다
export function resetTextDependent(issues) {
  return issues.map((x) => (NEEDS_EDIT.has(x.resolution) ? { ...x, resolution: null } : x));
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
  if (checked.length) {
    notes.push(`${topicOf(checked)} 일부가 빠졌을 수 있다는 추정이 있어, 사용자가 원본과 비교해 추출 범위를 확인했다고 표시한 텍스트 기준이에요.`);
  }
  return notes;
}
