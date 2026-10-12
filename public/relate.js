// 한 입사 기록 안의 자료(문서) 사이 관계 (기능정의서 v3.1 §5). 브라우저와 Node 테스트에서 함께 쓴다.
//
// - 자료는 등록한 순서대로 비교한다. 등록 순서는 회사가 실제로 안내한 시간 순서를 보증하지 않는다.
// - 값 비교는 기존 2문서 비교 규칙(compare-core.js의 compareFacet)을 그대로 쓴다. AI를 다시 부르지 않고,
//   단위가 다르면 환산하지 않으며, 글로 적힌 조건은 표기가 같을 때만 같다고 본다.
// - 앞 자료에 없던 조건이 뒤 자료에 처음 적힌 것은 '바뀜'이 아니라 '새롭게 적힘'이다.
// - 앞 자료에 있던 조건이 뒤 자료에 없는 것은 삭제·취소로 보지 않는다.
// - 같은 문서 유형끼리도(예: 오퍼 안내 두 건) 비교한다.
import { COMPARE_ITEMS, compareFacet, parseTimeRanges } from './compare-core.js';

export const DOC_TYPE_LABEL = { job_posting: '채용공고', offer: '오퍼·합격 안내', contract: '근로계약서' };

export const RELATION_LABEL = {
  same: '같은 내용으로 안내됐어요',
  different_stated: '서로 다른 안내가 있어요',
  newly_stated: '이번 안내에 새롭게 적혔어요',
  newly_specified: '이번 안내에서 구체적으로 적혔어요',
  not_mentioned_later: '이번 안내에서는 확인되지 않아요',
  incomparable: '서로 비교하기 어려워요',
  unavailable: '분석 확인 불가',
};
// 먼저 나올수록 항목의 대표 관계가 된다
// newly_specified: 앞 자료에는 '별도 안내'처럼 구체적이지 않게만 적혔고, 뒤 자료에 처음 구체적으로 적힘 (바뀜·비교 불가로 보지 않음)
const RELATION_ORDER = ['different_stated', 'incomparable', 'unavailable', 'newly_specified', 'newly_stated', 'not_mentioned_later', 'same'];

// 비교 항목: 기존 비교 항목(01~08)에 휴일·연차의 핵심 세부기준을 글 비교로 더한다
export const RELATE_ITEMS = [
  ...COMPARE_ITEMS,
  { id: '09', label: '휴일', facets: [{ id: '09-a', label: '지정된 휴일', kind: 'text' }] },
  { id: '10', label: '연차 유급휴가', facets: [{ id: '10-a', label: '연차 부여', kind: 'text' }] },
];

// 자료 이름: 같은 유형이 둘 이상이면 몇 번째 자료인지 붙인다 (예: '오퍼·합격 안내 2')
export function docLabels(documents) {
  const total = {};
  for (const d of documents) total[d.docType] = (total[d.docType] ?? 0) + 1;
  const seen = {};
  return Object.fromEntries(documents.map((d) => {
    seen[d.docType] = (seen[d.docType] ?? 0) + 1;
    const base = DOC_TYPE_LABEL[d.docType] ?? '자료';
    return [d.id, total[d.docType] > 1 ? `${base} ${seen[d.docType]}` : base];
  }));
}

const isNoProbation = (criteria) => criteria?.['07-a']?.status === 'CONFIRMED' && criteria['07-a'].finding === 'negated';
// 자료 한쪽의 상태 종류: 적혀 있음(present) / 찾지 못함(missing) / 분석 확인 불가(unavailable)
function kindOf(doc, facetId) {
  const c = doc.analysis?.criteria?.[facetId];
  if (!c || c.status === 'UNAVAILABLE') return 'unavailable';
  if (facetId === '08-a' && isNoProbation(doc.analysis.criteria)) return 'present'; // 수습 없음 → 해당 없음으로 비교
  if (c.status === 'MISSING') return 'missing';
  return 'present';
}
const PAIR_RELATION = { changed: 'different_stated', unclear: 'incomparable' };
const CONCRETE = new Set(['CONFIRMED', 'NOT_APPLICABLE']);

// 화면·질문에 쓰는 짧은 값: 검증된 원문 기재값 → (시각은) 원문에서 읽은 시각 → 인용 구절(항목명 제외). 원문에 없는 값을 만들지 않는다.
const stripLabel = (t) => String(t ?? '').replace(/^\s*(?:\d+\.\s*)?[^:：\n]{1,15}[:：]\s*/, '').trim();
const clip = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}…` : t);
export function displayValue(facet, side) {
  if (side.kind === 'unavailable' || side.kind === 'missing') return null;
  const text = side.evidence.map((e) => e.text).join('\n');
  if (facet.kind === 'times') {
    const r = parseTimeRanges(side.value ?? text, { skipBreaks: true });
    if (r.length) return r.join(', ');
  }
  if (facet.kind === 'break') {
    const r = parseTimeRanges(side.value ?? text.replace(/^.*?휴게/s, '휴게'));
    if (r.length === 1) return r[0];
  }
  // 인용 구절(항목명 제외)을 그대로: '정규 급여의 90%, 월 2,700,000원(세전)'. 길면 첫 구절만
  const quotes = [...new Set(side.evidence.map((e) => (stripLabel(e.text) || e.text).replace(/[.。]+$/, '')))];
  // 문장으로 된 인용('제안 연봉은 3,600만원입니다')은 검증된 원문 기재값을 쓴다
  const sentence = quotes.some((q) => /(니다|어요|에요|해요|드려요|겠습니다)$/.test(q));
  if (side.value && (sentence || !quotes.length)) return clip(side.value);
  if (quotes.length) {
    const joined = quotes.join(' · ');
    return clip(joined.length <= 60 ? joined : quotes[0], 60);
  }
  return side.value ? clip(side.value) : null;
}

function relateFacet(facet, documents, labels) {
  const docs = documents.map((d) => ({ doc: d, kind: kindOf(d, facet.id), view: { docType: d.docType, criteria: d.analysis?.criteria ?? {} } }));
  const sides = docs.map(({ doc, kind }) => {
    const c = doc.analysis?.criteria?.[facet.id] ?? { status: 'UNAVAILABLE', evidence: [] };
    return {
      docId: doc.id,
      kind,
      status: c.status,
      // 검증된 원문 기재값만. 없으면 화면은 인용 줄(evidence)을 보여 준다
      value: kind === 'present' && c.status !== 'NOT_APPLICABLE' ? c.sourceValue ?? null : null,
      evidence: kind === 'unavailable' ? [] : (c.evidence ?? []).map((q) => ({ line: q.line, text: q.text })),
      finding: c.finding ?? null,
    };
  }).map((side) => ({ ...side, display: displayValue(facet, side), concrete: CONCRETE.has(side.status) }));
  if (documents.length < 2) return { id: facet.id, label: facet.label, kind: facet.kind, relation: null, relationLabel: null, notes: [], sides, specifiedIn: null };

  const present = docs.filter((d) => d.kind === 'present');
  const concrete = (d) => CONCRETE.has(d.doc.analysis?.criteria?.[facet.id]?.status) || (facet.id === '08-a' && isNoProbation(d.doc.analysis?.criteria));
  const notes = [];
  const found = new Set();
  // 적혀 있는 자료끼리 등록 순서대로 비교. 구체적인 값끼리는 같음·다름·비교 어려움을 보고,
  // 앞 자료는 구체적이지 않고 뒤 자료가 구체적이면 '구체적으로 적힘'(아래), 둘 다 구체적이지 않으면 관계를 만들지 않는다.
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const A = present[i]; const B = present[j];
      const ca = concrete(A); const cb = concrete(B);
      if (!cb || (!ca && cb)) {
        if (ca && !cb) {
          found.add('incomparable');
          notes.push(`${labels[B.doc.id]}에는 구체적인 값 없이 적혀 있어 ${labels[A.doc.id]}의 값과 비교하지 않았어요.`);
        }
        continue;
      }
      const r = compareFacet(facet, A.view, B.view, { A: labels[A.doc.id], B: labels[B.doc.id] });
      const rel = PAIR_RELATION[r.state] ?? (r.state === 'same' ? 'same' : null);
      if (rel) found.add(rel);
      if (rel) notes.push(present.length > 2 || rel !== 'same' ? `${labels[A.doc.id]} ↔ ${labels[B.doc.id]}: ${r.note}` : r.note);
    }
  }
  if (docs.some((d) => d.kind === 'unavailable')) {
    found.add('unavailable');
    notes.push(`${docs.filter((d) => d.kind === 'unavailable').map((d) => labels[d.doc.id]).join(', ')}: 원문 근거를 확인하지 못해 비교하지 않았어요. 적혀 있지 않다는 뜻이 아니에요.`);
  }
  let specifiedIn = null;
  if (present.length) {
    const firstPresent = docs.indexOf(present[0]);
    const firstConcrete = present.find(concrete);
    const before = firstConcrete ? docs.slice(0, docs.indexOf(firstConcrete)) : [];
    if (firstConcrete && before.some((d) => d.kind === 'present') && before.every((d) => d.kind !== 'present' || !concrete(d))) {
      found.add('newly_specified');
      specifiedIn = firstConcrete.doc.id;
      const vague = before.filter((d) => d.kind === 'present');
      notes.push(`${vague.map((d) => labels[d.doc.id]).join('·')}에는 구체적인 ${facet.label} 없이 적혀 있었고, ${labels[firstConcrete.doc.id]}에 구체적으로 적혔어요. 조건이 바뀐 것으로 보지 않아요.`);
    } else if (docs.slice(0, firstPresent).some((d) => d.kind === 'missing')) {
      found.add('newly_stated');
      notes.push(`${labels[present[0].doc.id]}에 처음 적혔어요. 앞 자료에는 관련 내용이 없어 바뀐 것으로 보지 않아요.`);
    }
    const last = docs.at(-1);
    if (last.kind === 'missing') {
      found.add('not_mentioned_later');
      notes.push(`${labels[last.doc.id]}에서는 관련 내용을 찾지 못했어요. 조건이 없어지거나 취소됐다는 뜻은 아니에요.`);
    }
  }
  const relation = RELATION_ORDER.find((r) => found.has(r)) ?? null;
  return { id: facet.id, label: facet.label, kind: facet.kind, relation, relationLabel: relation ? RELATION_LABEL[relation] : null, notes, sides, specifiedIn };
}

// documents: 등록 순서대로의 자료 [{ id, docType, analysis: { criteria, ... } }]
// 반환: { labels, items: [{ id, label, relation, relationLabel, facets }] } — 자료가 하나면 relation은 모두 null
export function relateRecord(documents) {
  const labels = docLabels(documents);
  const items = RELATE_ITEMS.map((item) => {
    const facets = item.facets.map((f) => relateFacet(f, documents, labels));
    // 대표 관계: 첫 세부 항목은 항상, 나머지는 관계가 있을 때만
    const relation = RELATION_ORDER.find((r) => facets.some((f) => f.relation === r)) ?? null;
    return { id: item.id, label: item.label, relation, relationLabel: relation ? RELATION_LABEL[relation] : null, facets };
  });
  return { labels, items };
}
