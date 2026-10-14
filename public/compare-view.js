// 두 문서 비교 화면(Stitch 26)의 표시용 분류와 원문 근거 묶음.
// 비교 판정(relate.js·compare-core.js)과 질문 생성(followups.js)은 바꾸지 않고, 그 결과를 화면 상태 5가지로만 나눈다.
// 한 항목은 정확히 한 상태에만 들어간다 (요약 숫자 = 카드 수).
// 문서 1개 결과(채용공고·처우 안내 미리보기, 근로계약서 확인)도 같은 카드·요약 구조를 쓰며, 상태는 아래 SINGLE_STATUS로 나눈다.
import { deferral, externallyReferencedLeave } from './followups.js';
import { contractSummaryGroup } from './result-presentation.js';

export const COMPARE_STATUS = {
  different: { label: '서로 다른 조건', badge: '서로 다른 조건' },
  review: { label: '추가 대조가 필요한 조건', badge: '추가 대조 필요' },
  onesided: { label: '한쪽에만 기재된 조건', badge: '한쪽에만 기재' },
  unavailable: { label: '분석 확인 불가', badge: '분석 확인 불가' },
  same: { label: '같은 조건', badge: '같은 조건' },
};
// 화면 순서: 먼저 확인할 차이 → 대조가 필요한 것 → 한쪽에만 적힌 것 → 확인 불가 → 같은 조건(덜 강조)
export const STATUS_ORDER = ['different', 'review', 'onesided', 'unavailable', 'same'];

// relItem: relate.js의 항목 관계, sides: [{ status }] 비교하는 두 문서의 주제 상태(MAIN_*),
// hasQuestion: 이 항목에 회사에 확인할 질문이 있는지, pending: 협의·추후 안내 예정 상태가 남았는지
// 반환: 상태 키 또는 null(두 문서 모두 적혀 있지 않음 → 비교 대상 아님, 전체 목록에서 확인)
export function compareStatus(relItem, sides, { hasQuestion = false, pending = false } = {}) {
  const st = sides.map((s) => s?.status ?? null);
  if (st.some((x) => x === 'MAIN_UNAVAILABLE') || relItem?.relation === 'unavailable') return 'unavailable';
  const written = st.filter((x) => x && x !== 'MAIN_MISSING').length;
  const rel = relItem?.relation ?? null;
  if (!written && !hasQuestion) return null;
  if (rel === 'different_stated') return 'different';
  if (rel === 'incomparable') return 'review';
  // 한쪽에만 적힘: 삭제·변경으로 보지 않는다
  if (rel === 'newly_stated' || rel === 'not_mentioned_later') return 'onesided';
  // 한쪽이 더 구체적(예: 연봉 범위·협의 ↔ 확정 금액): 두 문서 모두 적혀 있으면 '한쪽에만 기재'가 아니라 대조 대상
  if (rel === 'newly_specified') return written === 1 ? 'onesided' : 'review';
  if (rel === 'same') return hasQuestion || pending ? 'review' : 'same';
  // 관계를 정하지 않음(예: 두 문서 모두 구체적이지 않음)
  if (written === 1) return 'onesided';
  return 'review';
}

// 한 문서의 원문 근거 묶음: 같은 인용 줄은 한 번만, 어떤 세부 조건의 근거인지 함께 적는다.
// highlight: 인용 안에서 강조할 정확한 표현(검증된 원문 기재값이 그 줄에 있을 때만). 없으면 강조하지 않는다.
// 반환: [{ line, text, facets: [세부 조건 이름], highlight }]
export function evidenceFor(relItem, docId) {
  const parts = [];
  for (const f of relItem?.facets ?? []) {
    const side = f.sides.find((s) => s.docId === docId);
    if (!side || side.kind !== 'present') continue;
    parts.push({ label: f.label, value: side.value, evidence: side.evidence ?? [] });
  }
  return groupEvidence(parts);
}

// 문서 1개 결과: 주제의 세부 기준별 근거를 같은 방식으로 묶는다 (분석 확인 불가 기준의 인용은 보이지 않음).
// criteria: 문서 분석의 세부 기준 맵 (원문 기재값 sourceValue를 강조에 씀)
export function topicEvidence(t, criteria = {}) {
  const parts = (t?.criteria ?? []).filter((c) => c.status !== 'UNAVAILABLE' && c.evidence?.length)
    .map((c) => ({ label: c.label, value: criteria[c.id]?.sourceValue ?? null, evidence: c.evidence }));
  return groupEvidence(parts);
}

// parts: [{ label, value, evidence: [{ line, text }] }] → 같은 인용은 한 번만, 대상 조건 이름을 함께
function groupEvidence(parts) {
  const out = [];
  for (const p of parts) {
    for (const e of p.evidence) {
      const key = `${e.line}\u0000${e.text}`;
      let row = out.find((r) => r.key === key);
      if (!row) { row = { key, line: e.line, text: e.text, facets: [], highlight: [] }; out.push(row); }
      if (!row.facets.includes(p.label)) row.facets.push(p.label);
      if (p.value && e.text.includes(p.value) && !row.highlight.includes(p.value)) row.highlight.push(p.value);
    }
  }
  // 같은 줄에서 한 인용이 다른 인용 안에 들어 있으면 긴 인용 하나로 (인용 글자는 바꾸지 않음)
  const merged = [];
  for (const r of out.sort((a, b) => b.text.length - a.text.length)) {
    const host = merged.find((m) => m.line === r.line && m.text.includes(r.text));
    if (!host) { merged.push(r); continue; }
    for (const f of r.facets) if (!host.facets.includes(f)) host.facets.push(f);
    for (const h of r.highlight) if (!host.highlight.includes(h)) host.highlight.push(h);
  }
  return merged.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map(({ key, ...r }) => r);
}

// 문서 카드에 보이는 이름: PDF 파일 이름, 없으면 확인한 텍스트의 첫 줄(원문 그대로, 길면 줄임)
export function documentTitle(doc, max = 40) {
  if (doc?.original?.name) return doc.original.name;
  const first = String(doc?.confirmedText ?? '').split('\n').map((x) => x.trim()).find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

// ---------- 문서 1개 결과 ----------
// tone: 비교 화면과 같은 배지·요약 칸 색 (status-*)
export const SINGLE_STATUS = {
  contract: {
    order: ['needs', 'written', 'calculated', 'unavailable'],
    needs: { label: '추가 확인이 필요한 조건', tone: 'review' },
    written: { label: '문서에 기재된 조건', tone: 'same' },
    calculated: { label: '계산으로 확인한 조건', tone: 'onesided' },
    unavailable: { label: '분석 확인 불가', tone: 'unavailable' },
  },
  brief: {
    order: ['stated', 'deferred', 'unavailable'],
    stated: { label: '문서에 적힌 조건', tone: 'same' },
    deferred: { label: '협의·추후 안내 예정 조건', tone: 'different' },
    unavailable: { label: '분석 확인 불가', tone: 'unavailable' },
  },
};

// 문서 1개의 한 주제를 카드 상태로. null = 카드 없음 (채용공고·처우 안내에 적히지 않은 조건은 미기재로 늘어놓지 않음)
// 판정은 바꾸지 않고 이미 계산된 상태(t.status·계산값·협의 예정)만 나눈다.
export function singleStatus(docType, t, { hasQuestion = false } = {}) {
  if (!t?.visible) return null;
  if (t.status === 'MAIN_UNAVAILABLE') return 'unavailable';
  if (docType === 'contract') return externallyReferencedLeave(t) ? 'written' : contractSummaryGroup(t, hasQuestion);
  if (t.status === 'MAIN_MISSING') return null;
  return deferral(t) ? 'deferred' : 'stated';
}
