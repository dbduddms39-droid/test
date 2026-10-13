// '입사 전 확인할 내용' 선별 (기능정의서 v3.1 F04, PRD §7). 브라우저와 Node 테스트에서 함께 쓴다. AI를 부르지 않는다.
//
// 우선 확인(primary): 자료 사이의 서로 다른 구체 값, 한 자료 안의 서로 다른 값, 근로계약서의 모호한 주요 내용,
//   (조건부) 근로계약서에서 주요 항목을 찾지 못함 · 오퍼 안내의 핵심 조건이 정해지지 않음. 최대 PRIMARY_LIMIT건.
// 추가로 확인(more, 접힘): 비교하기 어려운 값, 뒤 자료에 처음(구체적으로) 적힌 계약기간·수습 조건, 뒤 자료에서 확인되지 않은 조건,
//   채용공고·오퍼에서 일부만 적힌 조건, 계약서에서 세부 정보(주 소정근로시간 숫자 등)만 빠진 조건.
// 다시 분석(reanalyze): 분석 확인 불가(OCR·AI·근거 검증 실패). 회사 질문이 아니라 사용자 재확인·재분석 안내.
//
// 질문: 확인 주제(항목)마다 대표 질문 1개(실제 적용 조건을 묻는 것 우선) + 의미가 다른 추가 질문(선택, 최대 2개).
// 질문에는 검증된 원문 값만 넣고, 법률 판단이나 조건 확정 표현을 넣지 않는다.
import { buildQuestion, josa } from './questions.js';
import { relateRecord } from './relate.js';
import { parsePayRange, formatWonRange, payUnit, parseAmounts } from './compare-core.js';

export const PRIMARY_LIMIT = 3;
const EXTRA_LIMIT = 2;
const CONTRACT_CORE = new Set(['01', '02', '03', '04', '05', '06', '07']);
const OFFER_CORE = new Set(['01', '02', '03', '04', '05', '07', '08']);
const OFFER_MISSING_ASK = new Set(['01', '02', '03', '04']);
const NEW_CONDITION_ITEMS = new Set(['06', '07', '08']);

// 정렬·대표 질문 순서 (작을수록 먼저). 실제 적용 조건을 묻는 차이·상충이 먼저다.
const RANK = {
  different_stated: 0, conflict: 1, contract_unclear: 2, offer_unclear: 3, contract_missing: 4, incomparable: 5,
  newly_specified: 6, newly_stated: 7, not_mentioned_later: 8, partial_detail: 9, partial: 10, missing: 11,
};
const PRIMARY_KINDS = new Set(['different_stated', 'conflict', 'contract_unclear', 'offer_unclear', 'contract_missing']);
const REASON = {
  different_stated: '자료마다 다른 값이 적혀 있어요. 어느 쪽이 실제 적용 조건인지는 판단하지 않았어요.',
  conflict: '한 자료 안에 서로 다른 값이 함께 적혀 있어요.',
  contract_unclear: '근로계약서에 관련 내용은 있지만 구체적인 내용을 확인하기 어려워요.',
  offer_unclear: '안내에 관련 내용은 있지만 정해지지 않았거나 구체적이지 않게 적혀 있어요.',
  contract_missing: '분석한 근로계약서 텍스트에서 관련 내용을 찾지 못했어요. 문서에 실제로 없다거나 잘못됐다는 판단은 아니에요.',
  incomparable: '표기 방식이나 단위가 달라 같은 내용인지 자동으로 판단하지 않았어요. 각 원문을 직접 비교해 주세요.',
  newly_specified: '앞 자료에는 구체적인 내용이 없었고, 뒤 자료에 구체적으로 적혔어요. 바뀐 것으로 보지 않아요.',
  newly_stated: '앞 자료에는 없던 조건이 뒤 자료에 처음 적혔어요. 바뀐 것으로 보지 않아요.',
  not_mentioned_later: '앞 자료에 적힌 조건이 뒤 자료에서는 확인되지 않아요. 없어지거나 취소됐다는 뜻은 아니에요.',
  partial_detail: '주요 내용은 적혀 있지만 일부 세부 정보가 직접 적혀 있지 않아요.',
  partial: '관련 내용은 있지만 일부만 적혀 있거나 구체적이지 않아요.',
  missing: '이 자료에서는 관련 내용을 찾지 못했어요. 짧은 안내에는 빠질 수 있어요.',
};
export const TOPIC_NAME = {
  '01': '급여', '02': '근무시간', '03': '근무장소', '04': '담당업무', '05': '고용형태',
  '06': '계약기간', '07': '수습기간', '08': '수습 중 급여', '09': '휴일', '10': '연차 유급휴가',
};
// 질문에서 세부 항목을 부르는 말 (예: 출퇴근 시각 → '근무시간이 09:00~18:00')
const FACET_NOUN = {
  '01-a': '급여', '01-f': '급여 지급일', '02-a': '주 소정근로시간', '02-b': '근무시간', '02-c': '휴게시간',
  '03-a': '근무장소', '03-b': '근무형태', '04-a': '담당업무', '05-a': '고용형태', '06-a': '계약기간', '06-b': '계약기간',
  '07-a': '수습 적용 여부', '07-b': '수습기간', '08-a': '수습 중 급여', '09-a': '휴일', '10-a': '연차 유급휴가',
};
// 경계 규칙으로 낮아진 상태의 설명 (rules.js의 boundary)
export const BOUNDARY_TEXT = {
  hours_not_quoted: '주 소정근로시간 숫자(예: 주 40시간)가 직접 적혀 있지 않아요',
  unit_not_stated: '급여의 산정 단위(연봉·월급·시급 등)가 적혀 있지 않아요',
  rest_day_not_designated_holiday: '휴무일만 적혀 있고 지정된 휴일로 적혀 있지는 않아요',
  external_reference_only: '법령·내규를 따른다고만 적혀 있어요',
  calc_time_not_quoted: '근무시간을 계산할 출퇴근 시각을 원문에서 확인하지 못했어요',
  calc_break_not_quoted: '근무시간 계산에 필요한 휴게시간이 적혀 있지 않아요',
  calc_mismatch: '근무시간 계산이 원문 숫자와 맞지 않아 쓰지 않았어요',
  calc_missing: '주 소정근로시간 숫자(예: 주 40시간)가 직접 적혀 있지 않아요',
  calc_malformed: '주 소정근로시간 숫자(예: 주 40시간)가 직접 적혀 있지 않아요',
};
const DETAIL_ONLY = new Set(['hours_not_quoted', 'calc_missing', 'calc_malformed', 'calc_time_not_quoted', 'calc_break_not_quoted', 'calc_mismatch']);

const clip = (t, n = 50) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const quotesOf = (topic) => [...new Set(topic.criteria.flatMap((c) => c.evidence.map((e) => e.text)))];

// '으로/로': 받침 있는 글자·숫자 뒤 '으로', 받침 없거나 ㄹ 받침 뒤 '로'
const DIGIT_BATCHIM = { 0: 'y', 1: 'l', 2: 'n', 3: 'y', 4: 'n', 5: 'n', 6: 'y', 7: 'l', 8: 'l', 9: 'n' };
export function euro(word) {
  const w = String(word).trim();
  const last = w.replace(/\s*\([^)]*\)$/, '').at(-1) ?? ''; // '월 2,700,000원(세전)'은 '원' 기준
  if (/\d/.test(last)) return `${w}${DIGIT_BATCHIM[last] === 'y' ? '으로' : '로'}`;
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${w}로`; // 영문·기호(%, ) 등)
  const jong = code % 28;
  return `${w}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}
const joinDocs = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).map((n, i) => (i === names.length - 2 ? josa(n, '과/와') : `${n},`)).join(' ')} ${names.at(-1)}`);

// 같은 값을 적은 자료끼리 묶는다 (등록 순서 유지): [{ value, docs: [이름] }]
function groupByValue(sides, labels) {
  const groups = [];
  for (const s of sides) {
    if (!s.display) continue;
    const key = s.display.replace(/\s+/g, '');
    const g = groups.find((x) => x.key === key);
    if (g) g.docs.push(labels[s.docId]);
    else groups.push({ key, value: s.display, docs: [labels[s.docId]] });
  }
  return groups;
}
// '채용공고에는 09:00~18:00, 처우·근로조건 안내와 근로계약서에는 10:00~19:00'
function valuePhrase(groups, noun) {
  return groups.map((g, i) => {
    const subject = i === 0 ? `${josa(noun, '이/가')} ` : '';
    const value = i === groups.length - 1 ? euro(g.value) : g.value;
    return `${joinDocs(g.docs)}에는 ${subject}${value}`;
  }).join(', ');
}

// ---------- 협의 예정·추후 안내 예정 ----------
// 핵심 세부기준이 모두 '정해지지 않음'(finding undecided: 협의·추후 안내·입사 시 안내 등)으로 적힌 항목.
// 기준표 판정(일부 확인)은 그대로 두고, 화면 표시와 질문 선정에서만 '미기재'와 구분한다.
export function deferral(t) {
  if (!t?.visible || t.status !== 'MAIN_PARTIAL') return null;
  const lacking = t.criteria.filter((c) => c.required && c.status !== 'CONFIRMED' && c.status !== 'NOT_APPLICABLE');
  if (!lacking.length || !lacking.every((c) => c.basis === 'undecided')) return null;
  const quotes = lacking.flatMap((c) => c.evidence.map((e) => e.text));
  const text = quotes.join('\n');
  const range = t.id === '01' ? parsePayRange(text) : null;
  const negotiate = /(협의|조율|논의|면접\s*후|결정)/.test(text);
  return {
    kind: negotiate ? 'negotiate' : 'later',
    label: negotiate ? '협의 예정' : '추후 안내 예정',
    quote: quotes[0] ?? null,
    rangeText: range ? formatWonRange(range) : null,
    unitLabel: range ? payUnit(text)?.label ?? null : null,
  };
}

// ---------- 자료 하나에서 나오는 후보 ----------
function partialSentence(t, label, docType) {
  const req = t.criteria.filter((c) => c.required && c.status !== 'CONFIRMED' && c.status !== 'NOT_APPLICABLE');
  const written = t.criteria.filter((c) => c.status === 'CONFIRMED' && c.evidence.length);
  if (!req.length || !written.length) return buildQuestion(t, docType)?.replace(/^안녕하세요\.\s*/, '').replace(/\s*감사합니다\.$/, '') ?? null;
  const missNames = req.map((c) => (c.id === '02-a' ? '주 소정근로시간' : c.label)).join('·');
  const how = req.every((c) => c.basis === 'undecided') ? '정해지지 않은 것으로 적혀 있습니다'
    : req.every((c) => c.status === 'MISSING') ? '찾지 못했습니다' : '직접·구체적으로 적혀 있지 않습니다';
  return `${label}에 ${josa(written.slice(0, 3).map((c) => c.label).join('·'), '은/는')} 적혀 있지만 ${josa(missNames, '은/는')} ${how}. ${josa(missNames, '을/를')} 확인 부탁드립니다.`;
}

function docCandidates(doc, label, others) {
  const out = [];
  const reanalyze = [];
  const pending = [];
  for (const t of doc.analysis?.topics ?? []) {
    if (!t.visible) continue;
    if (t.status === 'MAIN_UNAVAILABLE') {
      const codes = [...new Set(t.criteria.filter((c) => c.required && c.status === 'UNAVAILABLE').flatMap((c) => [c.unavailableReason, ...(c.unavailableCodes ?? [])]).filter(Boolean))];
      reanalyze.push({ docId: doc.id, docLabel: label, topicId: t.id, label: t.label, codes });
      continue;
    }
    const conflict = t.criteria.some((c) => c.required && c.basis === 'conflict');
    // 다른 자료에서 이 항목이 확인되면, 이 자료에서 찾지 못했다는 사실만으로는 묻지 않는다 (자료 사이 관계로 따로 본다)
    const elsewhere = others.some((o) => (o.analysis?.topics ?? []).some((x) => x.id === t.id && x.visible && ['MAIN_FOUND', 'MAIN_PARTIAL'].includes(x.status)));
    const laterFound = others.some((o) => o.registeredIndex > doc.registeredIndex && (o.analysis?.topics ?? []).some((x) => x.id === t.id && x.status === 'MAIN_FOUND'));
    // 핵심 내용은 적혀 있고 세부 숫자(주 소정근로시간 등)만 직접 적혀 있지 않은 경우
    const lacking = t.criteria.filter((c) => c.required && c.status !== 'CONFIRMED' && c.status !== 'NOT_APPLICABLE');
    const detailOnly = t.status === 'MAIN_PARTIAL' && lacking.length > 0 && lacking.every((c) => DETAIL_ONLY.has(c.boundary));
    const def = deferral(t);
    let kind = null;
    if (conflict) kind = 'conflict';
    else if (def && doc.docType !== 'contract') {
      // 협의·추후 안내 예정: 질문 대신 상태를 안내하고, 뒤 자료에서 구체적으로 적혔는지 본다 (근로계약서는 아래에서 질문 후보)
      if (!laterFound) pending.push({ topicId: t.id, docId: doc.id, docLabel: label, label: t.label, def });
    } else if (doc.docType !== 'contract') {
      // v3.2: 채용공고·처우 안내는 단독 점검(미기재·불명확 질문)을 하지 않는다. 적힌 조건의 기록과 자료 사이 비교에만 쓴다.
      kind = null;
    } else if (t.status === 'MAIN_PARTIAL') {
      if (laterFound && doc.docType !== 'contract') kind = null; // 뒤 자료에 구체적으로 적혀 있으면 앞 자료의 모호함은 묻지 않음
      else if (detailOnly) kind = 'partial_detail';
      else if (doc.docType === 'contract') kind = 'contract_unclear';
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
      sentence = `${label}에 ${josa(TOPIC_NAME[t.id], '이/가')} 서로 다르게 적힌 부분이 있습니다${quotes.length ? `(${quotes.slice(0, 2).map((q) => clip(q, 30)).join(' / ')})` : ''}. 실제로 적용되는 내용을 확인 부탁드립니다.`;
    } else if (t.status === 'MAIN_PARTIAL') {
      sentence = partialSentence(t, label, doc.docType);
    } else {
      sentence = buildQuestion(t, doc.docType)?.replace(/^안녕하세요\.\s*/, '').replace(/\s*감사합니다\.$/, '') ?? null;
    }
    out.push({ topicId: t.id, kind, sources: [{ docId: doc.id, docLabel: label, quotes }], sentence, detail: kind === 'partial_detail' ? lacking.map((c) => BOUNDARY_TEXT[c.boundary]).filter(Boolean)[0] : null });
  }
  return { out, reanalyze, pending };
}

// ---------- 자료 사이 관계에서 나오는 후보 ----------
function relationCandidates(rel, labels, documents) {
  const typeOf = Object.fromEntries(documents.map((d) => [d.id, d.docType]));
  const out = [];
  for (const item of rel.items) {
    for (const f of item.facets) {
      if (!f.relation) continue;
      const present = f.sides.filter((s) => s.kind === 'present' && (s.display || s.evidence.length));
      const sources = present.map((s) => ({ docId: s.docId, docLabel: labels[s.docId], quotes: s.evidence.map((e) => e.text) }));
      const noun = FACET_NOUN[f.id] ?? f.label;
      let kind = null; let sentence = null; let line = null;
      if (f.relation === 'different_stated') {
        kind = 'different_stated';
        const groups = groupByValue(present.filter((s) => s.concrete), labels);
        // 범위 밖 금액: 범위가 적힌 자료를 앞에 함께 보여 준다 ('채용공고에는 연봉 3,400만~3,800만원 범위')
        if (f.range?.outDocs?.length) groups.unshift({ key: 'range', value: `${f.range.unitLabel} ${f.range.rangeText} 범위`, docs: [labels[f.range.docId]] });
        line = groups.map((g) => `${g.docs.join('·')} ${g.value}`).join(' / ');
        sentence = `${valuePhrase(groups, noun)} 기재되어 있습니다. 실제 적용되는 ${josa(noun, '을/를')} 확인 부탁드립니다.`;
      } else if (f.relation === 'incomparable') {
        kind = 'incomparable';
        const groups = groupByValue(present, labels);
        line = groups.map((g) => `${g.docs.join('·')} ${g.value}`).join(' / ');
        sentence = `${valuePhrase(groups, noun)} 적혀 있습니다. 같은 조건인지 확인 부탁드립니다.`;
      } else if (f.relation === 'newly_specified' && f.specifiedIn) {
        kind = 'newly_specified';
        const s = f.sides.find((x) => x.docId === f.specifiedIn);
        if (f.range?.inDocs?.includes(s.docId)) {
          // 협의 가능한 범위 안에서 구체적인 금액이 적힘. 같은 금액을 적은 뒤 자료를 함께 묶는다 (협의 완료 여부는 단정하지 않음)
          const amount = (x) => { const a = [...new Set(parseAmounts(x.value ?? x.display))]; return a.length === 1 ? a[0] : null; };
          const same = f.sides.filter((x) => x.concrete && amount(x) != null && amount(x) === amount(s)).map((x) => labels[x.docId]);
          const shown = s.display.startsWith(f.range.unitLabel) ? s.display : `${f.range.unitLabel} ${s.display}`;
          line = `${labels[f.range.docId]}에는 협의 가능한 ${f.range.unitLabel} 범위(${f.range.rangeText})가 적혀 있고, ${joinDocs(same)}에는 ${euro(shown)} 기재되어 있어요.`;
        } else {
          line = `이전 자료에는 구체적인 ${josa(noun, '이/가')} 없었지만, ${labels[s.docId]}에는 ${euro(s.display)} 적혀 있어요.`;
        }
        sentence = null; // 뒤 자료에 구체적으로 적힌 내용은 다시 묻지 않는다
      } else if (f.relation === 'newly_stated' && present.length) {
        kind = 'newly_stated';
        const first = present[0];
        line = `${labels[first.docId]}에 처음 적혔어요: ${first.display}`;
        sentence = null; // 처음 적힌 조건은 상태로 안내하고, 같은 내용을 다시 묻지 않는다
      } else if (f.relation === 'not_mentioned_later' && present.length && f === item.facets[0] && typeOf[f.sides.at(-1).docId] === 'contract') {
        // 뒤 자료가 근로계약서일 때만 묻는다. 짧은 오퍼·공고에서 빠진 조건은 질문 후보로 만들지 않는다
        kind = 'not_mentioned_later';
        const prev = present.at(-1);
        sentence = `${labels[f.sides.at(-1).docId]}에서 ${noun}에 관한 내용을 찾지 못했습니다. ${labels[prev.docId]}에 적힌 조건(${prev.display})이 그대로 적용되는지 확인 부탁드립니다.`;
      }
      if (!kind) continue;
      out.push({ topicId: item.id, facetId: f.id, kind, sources, sentence, line });
    }
  }
  return out;
}

// 항목(주제)별로 묶어 대표 질문 1개 + 의미가 다른 추가 질문을 고른다
function groupCandidates(cands) {
  const map = new Map();
  for (const c of cands) {
    const g = map.get(c.topicId) ?? { topicIds: [c.topicId], cands: [] };
    g.cands.push(c);
    map.set(c.topicId, g);
  }
  return [...map.values()];
}
const normQ = (t) => String(t ?? '').replace(/[\s.,()·]/g, '');

function finalize(g) {
  const cands = [...g.cands].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  const kinds = [...new Set(cands.map((c) => c.kind))];
  const label = g.topicIds.map((id) => TOPIC_NAME[id]).join('·');
  const withQ = cands.filter((c) => c.sentence);
  const rep = withQ[0] ?? null;
  // 추가 질문: 대표와 (종류·세부 항목)이 다르고 문장이 다른 것만, (종류·세부 항목)마다 하나씩
  const keyOf = (c) => `${c.kind}:${c.facetId ?? ''}`;
  const extras = [];
  const seenKinds = new Set(rep ? [keyOf(rep)] : []);
  const seenText = new Set(rep ? [normQ(rep.sentence)] : []);
  for (const c of withQ.slice(1)) {
    if (seenKinds.has(keyOf(c)) || seenText.has(normQ(c.sentence))) continue;
    // 자료 사이에 다른 값이 있으면, 같은 항목의 '다르게 표현됨' 질문은 대표 질문과 의미가 겹친다
    if (rep?.kind === 'different_stated' && c.kind === 'incomparable') continue;
    seenKinds.add(keyOf(c)); seenText.add(normQ(c.sentence));
    extras.push(c.sentence);
    if (extras.length >= EXTRA_LIMIT) break;
  }
  const sources = [];
  for (const c of cands) for (const s of c.sources) if (!sources.some((x) => x.docId === s.docId && x.quotes.join() === s.quotes.join())) sources.push(s);
  return {
    key: g.topicIds.join('+'),
    topicIds: g.topicIds,
    label,
    tier: cands.some((c) => PRIMARY_KINDS.has(c.kind)) ? 'primary' : 'more',
    kind: kinds[0],
    kinds,
    reasons: kinds.map((k) => (k === 'partial_detail' && cands.find((c) => c.kind === k)?.detail) ? `${REASON[k]} (${cands.find((c) => c.kind === k).detail})` : REASON[k]),
    line: cands.find((c) => c.line)?.line ?? null,
    sources,
    question: rep?.sentence ?? null,
    extraQuestions: extras,
  };
}

// record: { documents: [{ id, docType, analysis }] } (등록 순서)
// 반환: { primary, more, reanalyze, relation, summary }
//   summary: 결과 화면 맨 위 요약 — different(서로 다르게 안내됨) / specified(새롭게 구체화·처음 적힘) / needsCheck(여전히 확인 필요) / unavailable
export function buildFollowUps(record) {
  // 분석 결과가 있는 자료만 (분석 전·분석 실패 자료는 기록에만 있고 비교·질문에 쓰지 않는다)
  const documents = (record.documents ?? []).filter((d) => d.analysis).map((d, i) => ({ ...d, registeredIndex: i }));
  const rel = relateRecord(documents);
  const cands = [];
  const reanalyze = [];
  const pendingAll = [];
  for (const d of documents) {
    const r = docCandidates(d, rel.labels[d.id], documents.filter((o) => o.id !== d.id));
    cands.push(...r.out);
    reanalyze.push(...r.reanalyze);
    pendingAll.push(...r.pending);
  }
  const relCands = documents.length > 1 ? relationCandidates(rel, rel.labels, documents) : [];
  cands.push(...relCands);

  let groups = groupCandidates(cands);
  // 수습기간과 수습 중 급여는 하나로 묶는다 (대표 질문은 둘 중 더 중요한 것)
  const g07 = groups.find((g) => g.topicIds[0] === '07'); const g08 = groups.find((g) => g.topicIds[0] === '08');
  if (g07 && g08) {
    groups = groups.filter((g) => g !== g08);
    g07.topicIds = ['07', '08'];
    g07.cands.push(...g08.cands);
  }
  const all = groups.map(finalize).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'primary' ? -1 : 1) || RANK[a.kind] - RANK[b.kind] || a.topicIds[0].localeCompare(b.topicIds[0]));
  const primaryAll = all.filter((x) => x.tier === 'primary');
  const primary = primaryAll.slice(0, PRIMARY_LIMIT);
  const more = [...primaryAll.slice(PRIMARY_LIMIT), ...all.filter((x) => x.tier !== 'primary')];

  // 맨 위 요약: 항목마다 한 줄. 자료 사이 관계(다름·구체화)는 확인 질문 여부와 무관하게 보여 준다.
  const firstRel = (topicId, kindsWanted) => relCands.find((c) => c.topicId === topicId && kindsWanted.includes(c.kind));
  const itemLabel = (id) => rel.items.find((i) => i.id === id)?.label ?? TOPIC_NAME[id];
  const topicsWith = (kindsWanted) => [...new Set(relCands.filter((c) => kindsWanted.includes(c.kind)).map((c) => c.topicId))];
  const different = topicsWith(['different_stated']).map((id) => ({ topicId: id, label: TOPIC_NAME[id] ?? itemLabel(id), line: firstRel(id, ['different_stated']).line }));
  const specified = topicsWith(['newly_specified', 'newly_stated']).filter((id) => !different.some((d) => d.topicId === id))
    .filter((id) => NEW_CONDITION_ITEMS.has(id) || relCands.some((c) => c.topicId === id && c.kind === 'newly_specified'))
    .map((id) => ({ topicId: id, label: TOPIC_NAME[id], line: firstRel(id, ['newly_specified', 'newly_stated']).line }));
  const needsCheck = all.filter((x) => x.tier === 'primary' && x.kind !== 'different_stated')
    .map((x) => ({ topicId: x.topicIds[0], label: x.label, line: x.reasons[0] }));
  const unavailable = reanalyze.map((x) => ({ topicId: x.topicId, label: `${x.docLabel} · ${x.label}`, codes: x.codes }));
  // 협의·추후 안내 예정 (질문 없이 상태만): 항목마다 가장 뒤 자료 기준, 다른 요약에 이미 있는 항목은 빼고
  const shown = new Set([...different, ...specified, ...needsCheck].map((x) => x.topicId));
  const pendingByTopic = new Map();
  for (const p of pendingAll) pendingByTopic.set(p.topicId, p);
  const pending = [...pendingByTopic.values()].filter((p) => !shown.has(p.topicId)).map((p) => ({
    topicId: p.topicId, label: TOPIC_NAME[p.topicId] ?? p.label, kind: p.def.kind, line: pendingLine(p),
  }));
  return { primary, more, reanalyze, relation: rel, summary: { different, specified, needsCheck, pending, unavailable } };
}

export function pendingLine({ docLabel, def }) {
  const head = def.rangeText
    ? `${docLabel}에는 협의 가능한 ${def.unitLabel ?? '급여'} 범위(${def.rangeText})가 적혀 있어요.`
    : `${docLabel}에는 '${clip(def.quote, 40)}'라고 적혀 있어요(${def.label}).`;
  return `${head} 다음 안내에서 구체적인 조건이 적히는지 이어서 확인해요.`;
}
