// '지금 확인할 내용' 선별 (기능정의서 v3.1 F04, PRD §7). 브라우저와 Node 테스트에서 함께 쓴다. AI를 부르지 않는다.
//
// 우선 확인(primary): 자료 사이의 서로 다른 구체 값, 한 자료 안의 서로 다른 값, 근로계약서의 모호한 주요 내용,
//   (조건부) 근로계약서에서 주요 항목을 찾지 못함 · 오퍼 안내의 핵심 조건이 정해지지 않음. 최대 PRIMARY_LIMIT건.
// 추가로 확인(more, 접힘): 비교하기 어려운 값, 뒤 자료에 처음 적힌 계약기간·수습 조건, 뒤 자료에서 확인되지 않은 조건,
//   채용공고·오퍼에서 일부만 적힌 조건 등. 채용공고에서 찾지 못한 항목은 질문으로 만들지 않는다.
// 다시 분석(reanalyze): 분석 확인 불가(OCR·AI·근거 검증 실패). 회사 질문이 아니라 사용자 재확인·재분석 안내.
// 질문은 템플릿 문장이며, 법률 판단이나 조건 확정 표현을 넣지 않는다.
import { buildQuestion, josa } from './questions.js';
import { relateRecord } from './relate.js';

export const PRIMARY_LIMIT = 3;
const CONTRACT_CORE = new Set(['01', '02', '03', '04', '05', '06', '07']);
const OFFER_CORE = new Set(['01', '02', '03', '04', '05', '07', '08']);
const OFFER_MISSING_ASK = new Set(['01', '02', '03', '04']);
const NEW_CONDITION_ITEMS = new Set(['06', '07', '08']);

// 정렬 순서 (작을수록 먼저)
const RANK = { different_stated: 0, conflict: 1, contract_unclear: 2, offer_unclear: 3, contract_missing: 4, incomparable: 5, newly_stated: 6, not_mentioned_later: 7, partial: 8, missing: 9 };
const REASON = {
  different_stated: '자료마다 다른 값이 적혀 있어요. 어느 쪽이 실제 적용 조건인지는 판단하지 않았어요.',
  conflict: '한 자료 안에 서로 다른 값이 함께 적혀 있어요.',
  contract_unclear: '근로계약서에 관련 내용은 있지만 구체적인 내용을 확인하기 어려워요.',
  offer_unclear: '안내에 관련 내용은 있지만 정해지지 않았거나 구체적이지 않게 적혀 있어요.',
  contract_missing: '분석한 근로계약서 텍스트에서 관련 내용을 찾지 못했어요. 문서에 실제로 없다거나 잘못됐다는 판단은 아니에요.',
  incomparable: '단위나 조건이 달라 같은 내용인지 자동으로 판단하지 않았어요. 각 원문을 직접 비교해 주세요.',
  newly_stated: '앞 자료에는 없던 조건이 뒤 자료에 처음 적혔어요. 바뀐 것으로 보지 않아요.',
  not_mentioned_later: '앞 자료에 적힌 조건이 뒤 자료에서는 확인되지 않아요. 없어지거나 취소됐다는 뜻은 아니에요.',
  partial: '관련 내용은 있지만 일부만 적혀 있거나 구체적이지 않아요.',
  missing: '이 자료에서는 관련 내용을 찾지 못했어요. 짧은 안내에는 빠질 수 있어요.',
};
const TOPIC_NAME = {
  '01': '급여', '02': '근무시간', '03': '근무장소', '04': '담당업무', '05': '고용형태',
  '06': '계약기간', '07': '수습기간', '08': '수습 중 급여', '09': '휴일', '10': '연차 유급휴가',
};

const clip = (t, n = 60) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const shown = (side) => clip(side.value ?? side.evidence?.[0]?.text);
const quotesOf = (topic) => [...new Set(topic.criteria.flatMap((c) => c.evidence.map((e) => e.text)))];

// ---------- 자료 하나에서 나오는 후보 ----------
function docCandidates(doc, label, others) {
  const out = [];
  const reanalyze = [];
  for (const t of doc.analysis?.topics ?? []) {
    if (!t.visible) continue;
    if (t.status === 'MAIN_UNAVAILABLE') { reanalyze.push({ docId: doc.id, docLabel: label, topicId: t.id, label: t.label }); continue; }
    const conflict = t.criteria.some((c) => c.required && c.basis === 'conflict');
    // 다른 자료에서 이 항목이 확인되면, 이 자료에서 찾지 못했다는 사실만으로는 묻지 않는다 (자료 사이 관계로 따로 본다)
    const elsewhere = others.some((o) => (o.analysis?.topics ?? []).some((x) => x.id === t.id && x.visible && ['MAIN_FOUND', 'MAIN_PARTIAL'].includes(x.status)));
    const laterFound = others.some((o) => o.registeredIndex > doc.registeredIndex && (o.analysis?.topics ?? []).some((x) => x.id === t.id && x.status === 'MAIN_FOUND'));
    let kind = null;
    if (conflict) kind = 'conflict';
    else if (t.status === 'MAIN_PARTIAL') {
      if (doc.docType === 'contract') kind = 'contract_unclear';
      else if (laterFound) kind = null; // 뒤 자료에 구체적으로 적혀 있으면 앞 자료의 모호함은 묻지 않음
      else if (doc.docType === 'offer' && OFFER_CORE.has(t.id)) kind = 'offer_unclear';
      else kind = 'partial';
    } else if (t.status === 'MAIN_MISSING' && !elsewhere) {
      if (doc.docType === 'contract') kind = CONTRACT_CORE.has(t.id) ? 'contract_missing' : 'missing';
      else if (doc.docType === 'offer' && OFFER_MISSING_ASK.has(t.id)) kind = 'missing';
      // 채용공고에서 찾지 못한 항목은 질문 후보로 만들지 않는다
    }
    if (!kind) continue;
    const quotes = quotesOf(t);
    let sentence;
    if (kind === 'conflict') {
      sentence = `${label}에 ${josa(TOPIC_NAME[t.id], '이/가')} 서로 다르게 적힌 부분이 있어 여쭤봅니다${quotes.length ? `(${quotes.slice(0, 2).map((q) => clip(q, 40)).join(' / ')})` : ''}. 실제로 적용되는 내용을 확인 부탁드립니다.`;
    } else {
      // 기존 주제별 질문 템플릿 (인사말·맺음말을 떼어 다른 문장과 합칠 수 있게)
      sentence = buildQuestion(t, doc.docType)?.replace(/^안녕하세요\.\s*/, '').replace(/\s*감사합니다\.$/, '') ?? null;
    }
    out.push({
      topicId: t.id, kind,
      tier: ['conflict', 'contract_unclear', 'offer_unclear', 'contract_missing'].includes(kind) ? 'primary' : 'more',
      sources: [{ docId: doc.id, docLabel: label, quotes }],
      sentence,
    });
  }
  return { out, reanalyze };
}

// ---------- 자료 사이 관계에서 나오는 후보 ----------
function relationCandidates(rel, labels, documents) {
  const typeOf = Object.fromEntries(documents.map((d) => [d.id, d.docType]));
  const lastDocType = (f) => typeOf[f.sides.at(-1).docId];
  const out = [];
  for (const item of rel.items) {
    for (const f of item.facets) {
      if (!f.relation) continue;
      const present = f.sides.filter((s) => s.kind === 'present' && (s.value || s.evidence.length));
      const sources = present.map((s) => ({ docId: s.docId, docLabel: labels[s.docId], quotes: s.evidence.map((e) => e.text) }));
      const valueList = present.map((s) => `${labels[s.docId]}: ${shown(s) || '해당 없음'}`).join(' / ');
      let kind = null; let sentence = null;
      if (f.relation === 'different_stated') {
        kind = 'different_stated';
        sentence = `${josa(f.label, '이/가')} 자료마다 다르게 적혀 있습니다(${valueList}). 최종적으로 적용되는 ${josa(f.label, '을/를')} 확인 부탁드립니다.`;
      } else if (f.relation === 'incomparable') {
        kind = 'incomparable';
        sentence = `${josa(f.label, '이/가')} 자료마다 다르게 표현되어 있습니다(${valueList}). 같은 조건인지 확인 부탁드립니다.`;
      } else if (f.relation === 'newly_stated' && NEW_CONDITION_ITEMS.has(item.id) && present.length) {
        kind = 'newly_stated';
        const first = present[0];
        sentence = `앞서 받은 자료에서는 ${f.label}에 관한 내용을 찾지 못했고, ${labels[first.docId]}에는 다음과 같이 적혀 있습니다(${shown(first)}). 이 조건으로 확정된 것인지, 따로 정해질 내용이 있는지 확인 부탁드립니다.`;
      } else if (f.relation === 'not_mentioned_later' && present.length && f === item.facets[0] && lastDocType(f) === 'contract') {
        // 뒤 자료가 근로계약서일 때만 묻는다. 짧은 오퍼·공고에서 빠진 조건은 질문 후보로 만들지 않는다
        kind = 'not_mentioned_later';
        const lastId = f.sides.at(-1).docId;
        const prev = present.at(-1);
        sentence = `${labels[lastId]}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${labels[prev.docId]}에 적힌 조건(${shown(prev)})이 그대로 적용되는지 확인 부탁드립니다.`;
      }
      if (!kind) continue;
      out.push({ topicId: item.id, kind, tier: kind === 'different_stated' ? 'primary' : 'more', sources, sentence });
    }
  }
  return out;
}

// 같은 항목의 후보는 하나로 합친다 (가장 앞선 이유를 대표로, 문장·출처는 모두)
function mergeByTopic(cands) {
  const map = new Map();
  for (const c of cands) {
    const cur = map.get(c.topicId);
    if (!cur) { map.set(c.topicId, { topicIds: [c.topicId], kinds: [c.kind], tier: c.tier, sources: [...c.sources], sentences: c.sentence ? [c.sentence] : [] }); continue; }
    cur.kinds.push(c.kind);
    if (c.tier === 'primary') cur.tier = 'primary';
    for (const s of c.sources) if (!cur.sources.some((x) => x.docId === s.docId && x.quotes.join() === s.quotes.join())) cur.sources.push(s);
    if (c.sentence && !cur.sentences.includes(c.sentence)) cur.sentences.push(c.sentence);
  }
  return [...map.values()];
}

function finalize(g) {
  const kinds = [...new Set(g.kinds)].sort((a, b) => RANK[a] - RANK[b]);
  const label = g.topicIds.map((id) => TOPIC_NAME[id]).join('·');
  return {
    key: g.topicIds.join('+'),
    topicIds: g.topicIds,
    label,
    tier: g.tier,
    kind: kinds[0],
    kinds,
    reasons: kinds.map((k) => REASON[k]),
    sources: g.sources,
    question: g.sentences.length ? `안녕하세요. ${label} 관련해 여쭤봅니다. ${g.sentences.join(' ')} 감사합니다.` : null,
  };
}

// record: { documents: [{ id, docType, analysis }] } (등록 순서)
// 반환: { primary, more, reanalyze, relation }
export function buildFollowUps(record) {
  const documents = (record.documents ?? []).map((d, i) => ({ ...d, registeredIndex: i }));
  const rel = relateRecord(documents);
  const cands = [];
  const reanalyze = [];
  for (const d of documents) {
    const r = docCandidates(d, rel.labels[d.id], documents.filter((o) => o.id !== d.id));
    cands.push(...r.out);
    reanalyze.push(...r.reanalyze);
  }
  if (documents.length > 1) cands.push(...relationCandidates(rel, rel.labels, documents));

  let groups = mergeByTopic(cands);
  // 수습기간과 수습 중 급여는 하나로 묶는다
  const g07 = groups.find((g) => g.topicIds[0] === '07'); const g08 = groups.find((g) => g.topicIds[0] === '08');
  if (g07 && g08) {
    groups = groups.filter((g) => g !== g08);
    g07.topicIds = ['07', '08'];
    g07.kinds.push(...g08.kinds);
    if (g08.tier === 'primary') g07.tier = 'primary';
    g07.sources.push(...g08.sources.filter((s) => !g07.sources.some((x) => x.docId === s.docId && x.quotes.join() === s.quotes.join())));
    g07.sentences.push(...g08.sentences.filter((s) => !g07.sentences.includes(s)));
  }
  const all = groups.map(finalize).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'primary' ? -1 : 1) || RANK[a.kind] - RANK[b.kind] || a.topicIds[0].localeCompare(b.topicIds[0]));
  const primaryAll = all.filter((x) => x.tier === 'primary');
  const primary = primaryAll.slice(0, PRIMARY_LIMIT);
  const more = [...primaryAll.slice(PRIMARY_LIMIT), ...all.filter((x) => x.tier !== 'primary')];
  return { primary, more, reanalyze, relation: rel };
}
