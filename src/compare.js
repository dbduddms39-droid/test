// 근로조건 2문서 비교 (채용공고 ↔ 오퍼 안내 ↔ 근로계약서 중 서로 다른 두 종류).
//
// 각 문서는 기존 단일 문서 분석(src/analyze.js, 점검 기준 v2.2)으로 추출·인용 검증·상태 판정을 마친 뒤
// 여기서 규칙으로만 비교한다. 비교 단계에서는 AI를 다시 호출하지 않고, 문서에 없는 값을 만들지 않는다.
//
// 판정 원칙
// - 한쪽 문서에 없는 조건은 '삭제·변경'으로 보지 않는다 → '한쪽 문서에서 확인되지 않음'.
//   간략한 오퍼 안내에 없는 조건은 '비교 불가 · 추가 확인 필요'로 따로 구분한다.
// - '추후 협의', '회사 내규에 따름'처럼 구체적이지 않은 표현, 한 문서 안의 서로 다른 값은 구체적인 조건으로 보지 않는다
//   → '모호하거나 직접 비교하기 어려움'.
// - 금액·시간처럼 수치로 비교할 수 있는 항목은 두 문서의 산정 단위가 같고 값을 하나로 특정할 수 있을 때만 차이를 계산한다.
//   단위가 다르면(연봉 ↔ 월급 등) 환산하지 않는다.
// - 장소·업무처럼 글로 적힌 항목은 표기를 정리해 같을 때만 '동일'로 본다. 다르면 같은지 추측하지 않고 '직접 비교 어려움'.
// - 모든 비교 결과에 두 문서의 원문 근거(검증된 인용 줄)를 붙인다. 근거가 없으면 만들지 않는다.
import { DOC_TYPES } from './criteria.js';

export const COMPARE_VERSION = 'compare-v1';

// 문서 단계: 앞 단계 문서(A)와 뒤 단계 문서(B)로 정렬한다.
const STAGE = { job_posting: 0, offer: 1, contract: 2 };
export const COMPARE_PAIRS = [['job_posting', 'offer'], ['job_posting', 'contract'], ['offer', 'contract']];

export const STATE_LABEL = {
  same: '동일한 조건',
  changed: '달라진 조건',
  added: '새로 추가된 조건',
  missing_one: '한쪽 문서에서 확인되지 않음',
  not_comparable: '비교 불가 · 추가 확인 필요',
  unclear: '모호하거나 직접 비교하기 어려움',
  both_missing: '두 문서 모두 확인되지 않음',
  unavailable: '분석 확인 불가',
  not_applicable: '해당 없음',
};
// 항목 대표 상태를 고를 때의 우선순위 (먼저 나올수록 사용자가 먼저 봐야 함)
const STATE_ORDER = ['changed', 'unavailable', 'not_comparable', 'missing_one', 'unclear', 'added', 'both_missing', 'same', 'not_applicable'];

// 비교 항목과 세부 비교 대상(세부기준). kind: 값을 읽고 비교하는 방법
export const COMPARE_ITEMS = [
  { id: '01', label: '급여 및 지급 조건', facets: [{ id: '01-a', label: '급여 금액', kind: 'money' }, { id: '01-f', label: '지급일', kind: 'payday' }] },
  { id: '02', label: '근무시간 및 휴게시간', facets: [{ id: '02-a', label: '소정근로시간', kind: 'hours' }, { id: '02-b', label: '출퇴근 시각', kind: 'times' }, { id: '02-c', label: '휴게시간', kind: 'break' }] },
  { id: '03', label: '근무장소 및 근무형태', facets: [{ id: '03-a', label: '근무장소', kind: 'place' }, { id: '03-b', label: '재택·파견 등 근무형태', kind: 'text' }] },
  { id: '04', label: '담당업무', facets: [{ id: '04-a', label: '업무 내용', kind: 'text' }] },
  { id: '05', label: '고용형태', facets: [{ id: '05-a', label: '계약 형태', kind: 'employment' }] },
  { id: '06', label: '계약기간', facets: [{ id: '06-a', label: '기간의 정함', kind: 'term' }, { id: '06-b', label: '시작일·종료일', kind: 'period' }] },
  { id: '07', label: '수습기간', facets: [{ id: '07-a', label: '수습 적용', kind: 'probation' }, { id: '07-b', label: '수습 기간', kind: 'duration' }] },
  { id: '08', label: '수습기간 중 급여', facets: [{ id: '08-a', label: '수습 중 지급 기준', kind: 'probationPay' }] },
];

// ---------- 문서 한쪽의 세부기준 읽기 ----------
const VAGUE_NOTE = {
  undecided: "'추후 협의'처럼 아직 정해지지 않은 표현이에요",
  conflict: '한 문서 안에 서로 다른 값이 함께 적혀 있어요',
  coarse: '구체적인 값 없이 큰 틀이나 다른 규정 참조로만 적혀 있어요',
  negated: '지급·적용하지 않는다는 표현이 적혀 있어요',
};

function sideOf(doc, id) {
  const c = doc.criteria?.[id] ?? { status: 'UNAVAILABLE', evidence: [] };
  const evidence = (c.evidence ?? []).map((q) => ({ line: q.line, text: q.text }));
  const text = c.sourceValue ?? evidence.map((q) => q.text).join('\n');
  let kind = { CONFIRMED: 'concrete', PARTIAL: 'vague', UNCLEAR: 'vague', MISSING: 'missing', NOT_APPLICABLE: 'na' }[c.status] ?? 'unavailable';
  let naReason = kind === 'na' ? c.reason : null;
  // 수습이 없다고 확인된 문서에서는 수습 중 급여를 '해당 없음'으로 본다
  if (id === '08-a' && isNoProbation(doc)) { kind = 'na'; naReason = 'no_probation'; }
  return {
    docType: doc.docType,
    status: c.status,
    kind,
    finding: c.finding ?? null,
    termType: c.termType ?? null,
    derived: c.derived ?? null,
    naReason,
    evidence,
    text,
    // 화면·질문에 보여 줄 원문 그대로의 값 (검증된 원문 기재값). 없으면 인용 줄(evidence)만 보여 준다
    raw: c.sourceValue ?? null,
  };
}
const isNoProbation = (doc) => doc.criteria?.['07-a']?.status === 'CONFIRMED' && doc.criteria['07-a'].finding === 'negated';
const ctxText = (doc, ids) => ids.flatMap((id) => {
  const c = doc.criteria?.[id];
  if (!c || c.status === 'UNAVAILABLE') return [];
  return [c.sourceValue, ...(c.evidence ?? []).map((q) => q.text)].filter(Boolean);
}).join('\n');

// ---------- 값 읽기 (원문에서 찾은 값만, 하나로 특정할 수 없으면 null) ----------
const uniq = (arr, key = (x) => JSON.stringify(x)) => [...new Map(arr.map((x) => [key(x), x])).values()];
const single = (arr) => { const u = uniq(arr); return u.length === 1 ? u[0] : null; };

// 한국어 금액: '3,600만원', '36,000,000원', '3천만 원', '2억 4천만원', '250만 원'
export function parseAmounts(text) {
  const out = [];
  const re = /((?:\d[\d,]*(?:\.\d+)?\s*|(?:억|천|백|만)\s*)+)원/g;
  for (const m of String(text ?? '').matchAll(re)) {
    const v = wonValue(m[1].replace(/\s+/g, ''));
    if (v != null && v > 0) out.push(v);
  }
  return out;
}
function wonValue(s) {
  let total = 0; let section = 0; let n = null; let seen = false;
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)|(억|만|천|백)/g)) {
    if (m[1]) { if (n != null) return null; n = Number(m[1].replace(/,/g, '')); seen = true; continue; }
    const u = m[2];
    if (u === '천' || u === '백') { section += (n ?? 1) * (u === '천' ? 1000 : 100); n = null; continue; }
    const mult = u === '만' ? 1e4 : 1e8;
    total += (section + (n ?? 0)) * mult; section = 0; n = null;
  }
  if (!seen) return null;
  return Math.round(total + section + (n ?? 0));
}
export function formatWon(v) {
  if (v % 1e4 === 0 && v >= 1e4) {
    const man = v / 1e4;
    if (man >= 1e4 && man % 1e4 === 0) return `${(man / 1e4).toLocaleString('ko-KR')}억원`;
    return `${man.toLocaleString('ko-KR')}만원`;
  }
  return `${v.toLocaleString('ko-KR')}원`;
}

// 급여 산정 단위. 서로 다른 단위가 함께 보이면 특정하지 않는다.
const PAY_UNITS = [
  ['annual', '연봉', /(연봉|연\s*급여|연간\s*(급여|보수|임금)|연\s*\d|년\s*\d[\d,]*\s*(만|원))/],
  ['monthly', '월급', /(월급|월\s*(급여|보수|임금)|월\s*\d[\d,.]*\s*(만|천|원))/],
  ['hourly', '시급', /(시급|시간급|시간당)/],
  ['daily', '일급', /(일급|일당)/],
  ['weekly', '주급', /주급/],
];
export function payUnit(text) {
  const hits = PAY_UNITS.filter(([, , re]) => re.test(text));
  return hits.length === 1 ? { key: hits[0][0], label: hits[0][1] } : null;
}
const taxBasis = (text) => {
  const pre = /세전/.test(text); const post = /세후|실수령/.test(text);
  return pre && !post ? 'pre' : post && !pre ? 'post' : null;
};

// 근무시간: '주 40시간', '주당 소정근로시간 35시간', '1일 8시간'
export function parseHours(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/(주|1\s*일|하루|일)\s*(?:당\s*)?(?:소정\s*)?(?:근로|근무)?\s*(?:시간)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*시간/g)) {
    out.push({ per: m[1] === '주' ? 'week' : 'day', h: Number(m[2]) });
  }
  return out;
}
// 출퇴근 시각: '09:00~18:00', '9시~18시', '10시부터 19시까지'
const hm = (h, m = '0') => `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}`;
export function parseTimeRanges(text, { skipBreaks = false } = {}) {
  const out = [];
  // 출퇴근 시각을 읽을 때는 '휴게 12:00~13:00' 같은 휴게 시각을 빼고 읽는다
  const t = skipBreaks ? String(text ?? '').replace(/휴게\s*(?:시간)?\s*[:：]?\s*[^,)\n]*/g, '') : String(text ?? '');
  for (const m of t.matchAll(/(\d{1,2}):(\d{2})\s*(?:~|-|–|∼|부터)\s*(\d{1,2}):(\d{2})/g)) out.push(`${hm(m[1], m[2])}~${hm(m[3], m[4])}`);
  for (const m of t.matchAll(/(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(?:~|-|부터)\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/g)) out.push(`${hm(m[1], m[2] ?? 0)}~${hm(m[3], m[4] ?? 0)}`);
  return [...new Set(out)].sort();
}
// 휴게: '휴게 1시간', '휴게시간 60분', '휴게 12:00~13:00'
export function parseBreakMinutes(text) {
  const t = String(text ?? '');
  const out = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(시간|분)/g)) out.push(Math.round(Number(m[1]) * (m[2] === '시간' ? 60 : 1)));
  for (const r of parseTimeRanges(t)) {
    const [s, e] = r.split('~').map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)));
    if (e > s) out.push(e - s);
  }
  return [...new Set(out)];
}
// 지급일: '매월 25일', '25일 지급', '말일'
export function parsePayday(text) {
  const t = String(text ?? '');
  const out = [];
  if (/말일/.test(t)) out.push('말일');
  for (const m of t.matchAll(/(?:매월|익월|당월)?\s*(\d{1,2})\s*일\s*(?:에\s*)?(?:지급|입금)?/g)) {
    if (/(지급|입금|매월|익월|당월)/.test(m[0])) out.push(`${Number(m[1])}일`);
  }
  return [...new Set(out)];
}
// 글로 적힌 조건의 표기 정리: 항목명·공백·문장부호·행정구역 접미어를 뺀다
export function normalizeText(text, { place = false } = {}) {
  let t = String(text ?? '').replace(/^[^:：\n]{1,15}[:：]\s*/, '');
  if (place) t = t.replace(/(특별자치시|특별자치도|특별시|광역시)/g, '').replace(/(경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)도/g, '$1');
  return t.replace(/[\s.,·()[\]{}'"“”‘’\-–~/]/g, '').toLowerCase();
}
// 고용형태 분류
const EMPLOYMENT = [
  ['정규직', /(정규직|정규\s*채용|무기\s*계약)/],
  ['기간제(계약직)', /(계약직|기간제|기간을\s*정한|프로젝트\s*계약)/],
  ['인턴', /인턴/],
  ['단시간', /(단시간|파트\s*타임|시간제|아르바이트)/],
  ['파견', /파견/],
];
export function employmentKinds(text) {
  return EMPLOYMENT.filter(([, re]) => re.test(text)).map(([k]) => k);
}
// 계약기간: 날짜 2개(시작·종료) 또는 기간 길이
export function parsePeriod(text) {
  const t = String(text ?? '');
  const dates = [...t.matchAll(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g)]
    .map((m) => `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
  if (dates.length === 2) return { kind: 'dates', value: `${dates[0]}~${dates[1]}` };
  if (dates.length) return null;
  const durs = [...t.matchAll(/(\d+)\s*(년|개월)/g)].map((m) => Number(m[1]) * (m[2] === '년' ? 12 : 1));
  return [...new Set(durs)].length === 1 ? { kind: 'months', value: durs[0] } : null;
}
// 수습 기간: '3개월', '90일', '12주'
export function parseDuration(text) {
  const out = [...String(text ?? '').matchAll(/(\d+)\s*(개월|주|일)/g)].map((m) => ({ n: Number(m[1]), unit: m[2] }));
  return single(out);
}
const percents = (text) => [...String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));

// ---------- 세부 비교 ----------
const SAME = (note) => ({ state: 'same', note });
const CHANGED = (note) => ({ state: 'changed', note });
const UNCLEAR = (note) => ({ state: 'unclear', note });

function compareConcrete(kind, a, b, docA, docB, L) {
  switch (kind) {
    case 'money': {
      const va = single(parseAmounts(a.text)); const vb = single(parseAmounts(b.text));
      if (va == null || vb == null) return UNCLEAR('금액을 하나로 특정할 수 없어 직접 비교하지 않았어요.');
      const ua = payUnit(ctxText(docA, ['01-a', '01-b'])); const ub = payUnit(ctxText(docB, ['01-a', '01-b']));
      if (!ua || !ub) return UNCLEAR('산정 단위(연봉·월급·시급 등)를 하나로 확인할 수 없어 직접 비교하지 않았어요.');
      if (ua.key !== ub.key) return UNCLEAR(`산정 단위가 달라요(${L.A}: ${ua.label}, ${L.B}: ${ub.label}). 단위를 바꿔 계산하지 않았어요.`);
      const ta = taxBasis(ctxText(docA, ['01-a', '01-g'])); const tb = taxBasis(ctxText(docB, ['01-a', '01-g']));
      if (ta && tb && ta !== tb) return UNCLEAR('세전·세후 기준이 달라 직접 비교하지 않았어요.');
      if (va === vb) return SAME(`${ua.label} ${formatWon(va)}로 같아요.`);
      const d = vb - va;
      return CHANGED(`${ua.label} ${formatWon(va)} → ${formatWon(vb)} (${formatWon(Math.abs(d))} ${d > 0 ? '많아요' : '적어요'})`);
    }
    case 'hours': {
      const ha = single([...(a.derived ?? []).map((x) => parseHours(x.value)).flat(), ...parseHours(a.text)]);
      const hb = single([...(b.derived ?? []).map((x) => parseHours(x.value)).flat(), ...parseHours(b.text)]);
      if (!ha || !hb) return UNCLEAR('근무시간을 하나로 특정할 수 없어 직접 비교하지 않았어요.');
      if (ha.per !== hb.per) return UNCLEAR('한 문서는 주 단위, 다른 문서는 하루 단위로 적혀 있어 직접 비교하지 않았어요.');
      const unit = ha.per === 'week' ? '주' : '1일';
      if (ha.h === hb.h) return SAME(`${unit} ${ha.h}시간으로 같아요.`);
      return CHANGED(`${unit} ${ha.h}시간 → ${unit} ${hb.h}시간 (${Math.abs(hb.h - ha.h)}시간 ${hb.h > ha.h ? '늘었어요' : '줄었어요'})`);
    }
    case 'times': {
      const ta = parseTimeRanges(a.text, { skipBreaks: true }); const tb = parseTimeRanges(b.text, { skipBreaks: true });
      if (!ta.length || !tb.length) return UNCLEAR('출퇴근 시각을 읽을 수 없어 직접 비교하지 않았어요.');
      if (ta.join() === tb.join()) return SAME(`${ta.join(', ')}로 같아요.`);
      return CHANGED(`${ta.join(', ')} → ${tb.join(', ')}`);
    }
    case 'break': {
      const ma = single(parseBreakMinutes(a.text)); const mb = single(parseBreakMinutes(b.text));
      if (ma == null || mb == null) return UNCLEAR('휴게시간을 하나로 특정할 수 없어 직접 비교하지 않았어요.');
      return ma === mb ? SAME(`${ma}분으로 같아요.`) : CHANGED(`${ma}분 → ${mb}분`);
    }
    case 'payday': {
      const pa = single(parsePayday(a.text)); const pb = single(parsePayday(b.text));
      if (!pa || !pb) return UNCLEAR('지급일을 하나로 특정할 수 없어 직접 비교하지 않았어요.');
      return pa === pb ? SAME(`${pa}로 같아요.`) : CHANGED(`${pa} → ${pb}`);
    }
    case 'place':
    case 'text': {
      const na = normalizeText(a.text, { place: kind === 'place' }); const nb = normalizeText(b.text, { place: kind === 'place' });
      if (na && na === nb) return SAME('같은 내용으로 적혀 있어요.');
      return UNCLEAR('표현이 달라 같은 조건인지 자동으로 판단하지 않았어요. 두 원문을 비교해 확인해 주세요.');
    }
    case 'employment': {
      const ka = employmentKinds(a.text); const kb = employmentKinds(b.text);
      if (!ka.length || !kb.length) return UNCLEAR('계약 형태를 분류할 수 없어 직접 비교하지 않았어요.');
      if (ka.join() === kb.join()) return SAME(`${ka.join('·')}(으)로 같아요.`);
      return CHANGED(`${ka.join('·')} → ${kb.join('·')}`);
    }
    case 'term': {
      const lab = { fixed: '기간을 정한 계약', indefinite: '기간의 정함이 없는 계약' };
      if (!a.termType || !b.termType) return UNCLEAR('기간의 정함 여부를 특정할 수 없어 직접 비교하지 않았어요.');
      return a.termType === b.termType ? SAME(`${lab[a.termType]}으로 같아요.`) : CHANGED(`${lab[a.termType]} → ${lab[b.termType]}`);
    }
    case 'period': {
      const pa = parsePeriod(a.text); const pb = parsePeriod(b.text);
      if (!pa || !pb || pa.kind !== pb.kind) return UNCLEAR('계약기간을 같은 방식으로 읽을 수 없어 직접 비교하지 않았어요.');
      const show = (p) => (p.kind === 'months' ? `${p.value}개월` : p.value.replace('~', ' ~ '));
      return pa.value === pb.value ? SAME(`${show(pa)}로 같아요.`) : CHANGED(`${show(pa)} → ${show(pb)}`);
    }
    case 'probation': {
      const va = a.finding === 'negated' ? 'none' : 'applies'; const vb = b.finding === 'negated' ? 'none' : 'applies';
      const lab = { none: '수습 없음', applies: '수습 적용' };
      return va === vb ? SAME(`${lab[va]}으로 같아요.`) : CHANGED(`${lab[va]} → ${lab[vb]}`);
    }
    case 'duration': {
      const da = parseDuration(a.text); const db = parseDuration(b.text);
      if (!da || !db || da.unit !== db.unit) return UNCLEAR('수습 기간을 같은 단위로 읽을 수 없어 직접 비교하지 않았어요.');
      return da.n === db.n ? SAME(`${da.n}${da.unit}로 같아요.`) : CHANGED(`${da.n}${da.unit} → ${db.n}${db.unit}`);
    }
    case 'probationPay': {
      const pa = single(percents(a.text)); const pb = single(percents(b.text));
      if (pa != null && pb != null) return pa === pb ? SAME(`정규 급여의 ${pa}%로 같아요.`) : CHANGED(`${pa}% → ${pb}%`);
      const wa = single(parseAmounts(a.text)); const wb = single(parseAmounts(b.text));
      if (wa != null && wb != null && pa == null && pb == null) return wa === wb ? SAME(`${formatWon(wa)}로 같아요.`) : CHANGED(`${formatWon(wa)} → ${formatWon(wb)}`);
      return UNCLEAR('지급 기준을 같은 방식(비율·금액)으로 읽을 수 없어 직접 비교하지 않았어요.');
    }
    default:
      return UNCLEAR('직접 비교하지 않았어요.');
  }
}

const NA_TEXT = { indefinite_term: '기간의 정함이 없는 계약', no_probation: '수습 없음', no_leave: '연차 미부여' };

function compareFacet(facet, docA, docB, L) {
  const a = sideOf(docA, facet.id);
  const b = sideOf(docB, facet.id);
  const vagueNote = (s, who) => `${who}: ${VAGUE_NOTE[s.finding] ?? '일부만 적혀 있거나 구체적이지 않아요'}.`;
  let r;
  if (a.kind === 'unavailable' || b.kind === 'unavailable') {
    r = { state: 'unavailable', note: '원문 근거를 확인하지 못해 비교하지 않았어요. 문서에 적혀 있지 않다는 뜻이 아니에요.' };
  } else if (a.kind === 'missing' && b.kind === 'missing') {
    r = { state: 'both_missing', note: '두 문서 모두에서 관련 내용을 찾지 못했어요.' };
  } else if ((a.kind === 'missing' && b.kind === 'na') || (a.kind === 'na' && b.kind === 'missing')) {
    const na = a.kind === 'na' ? a : b;
    r = { state: 'not_applicable', note: `${a.kind === 'na' ? L.A : L.B}는 ${NA_TEXT[na.naReason] ?? '해당 없음'}이라 이 조건은 해당 없어요.` };
  } else if (a.kind === 'missing' || b.kind === 'missing') {
    const missing = a.kind === 'missing' ? 'A' : 'B';
    const missingDoc = missing === 'A' ? docA : docB;
    if (missingDoc.docType === 'offer') {
      r = { state: 'not_comparable', note: `${L[missing]}에 적혀 있지 않아 비교할 수 없어요. 간략한 안내에는 빠질 수 있으니 회사에 확인이 필요해요.` };
    } else if (missing === 'A') {
      r = { state: 'added', note: `${L.A}에는 없고 ${L.B}에 적혀 있어요.` };
    } else {
      r = { state: 'missing_one', note: `${L.B}에서 확인되지 않아요. 조건이 없어지거나 바뀌었다는 뜻은 아니에요.` };
    }
  } else if (a.kind === 'na' && b.kind === 'na') {
    r = { state: 'not_applicable', note: `두 문서 모두 ${NA_TEXT[a.naReason] ?? '해당 없음'}이에요.` };
  } else if (a.kind === 'vague' || b.kind === 'vague') {
    const notes = [];
    if (a.kind === 'vague') notes.push(vagueNote(a, L.A));
    if (b.kind === 'vague') notes.push(vagueNote(b, L.B));
    if (a.kind !== 'vague') notes.push(`${L.A}에는 구체적으로 적혀 있어요.`);
    if (b.kind !== 'vague') notes.push(`${L.B}에는 구체적으로 적혀 있어요.`);
    r = { state: 'unclear', note: notes.join(' ') };
  } else if (a.kind === 'na' || b.kind === 'na') {
    const na = a.kind === 'na' ? a : b;
    r = { state: 'changed', note: `${a.kind === 'na' ? L.A : L.B}는 ${NA_TEXT[na.naReason] ?? '해당 없음'}으로 적혀 있어 다른 문서와 달라요.` };
  } else {
    r = compareConcrete(facet.kind, a, b, docA, docB, L);
  }
  const side = (s) => ({ status: s.status, value: s.kind === 'missing' || s.kind === 'unavailable' ? null : s.raw, evidence: s.evidence, finding: s.finding });
  // 질문·요약에 쓰는 짧은 원문: 원문 기재값, 없으면 첫 인용 줄
  return { id: facet.id, label: facet.label, state: r.state, stateLabel: STATE_LABEL[r.state], note: r.note, a: side(a), b: side(b) };
}

// docs: [{ docType, result }] 두 개 (result는 analyzeDocument(..., withCriteria: true) 결과). 순서는 상관없다.
export function compareDocuments(docs) {
  const [x, y] = docs;
  if (!x || !y || x.docType === y.docType || STAGE[x.docType] == null || STAGE[y.docType] == null) {
    throw Object.assign(new Error('invalid pair'), { code: 'invalid_pair' });
  }
  const [A, B] = STAGE[x.docType] < STAGE[y.docType] ? [x, y] : [y, x];
  const docA = { docType: A.docType, criteria: A.result.criteria };
  const docB = { docType: B.docType, criteria: B.result.criteria };
  const L = { A: DOC_TYPES[A.docType].label, B: DOC_TYPES[B.docType].label };

  const items = COMPARE_ITEMS.map((item) => {
    const facets = item.facets.map((f) => compareFacet(f, docA, docB, L));
    // 대표 상태: 보조 세부 항목(두 번째부터)이 두 문서 모두 없거나 해당 없음이면 대표 상태를 정하는 데 쓰지 않는다
    const deciding = facets.filter((f, i) => i === 0 || !['both_missing', 'not_applicable'].includes(f.state));
    const state = STATE_ORDER.find((s) => deciding.some((f) => f.state === s)) ?? facets[0].state;
    return { id: item.id, label: item.label, state, stateLabel: STATE_LABEL[state], facets };
  });
  const allFacets = items.flatMap((i) => i.facets.map((f) => ({ ...f, itemId: i.id, itemLabel: i.label })));
  const counts = Object.fromEntries(Object.keys(STATE_LABEL).map((s) => [s, items.filter((i) => i.state === s).length]));
  // 핵심 차이: 달라진 조건 → 확인 불가 → 비교 불가 → 한쪽 미기재 → 모호 순
  const highlights = STATE_ORDER.slice(0, 5).flatMap((s) => allFacets.filter((f) => f.state === s))
    .map((f) => ({ itemId: f.itemId, itemLabel: f.itemLabel, facetId: f.id, facetLabel: f.label, state: f.state, stateLabel: f.stateLabel, note: f.note }));

  return {
    version: COMPARE_VERSION,
    criteriaVersion: A.result.version,
    docs: [A, B].map((d, i) => ({ role: i ? 'B' : 'A', docType: d.docType, docTypeLabel: DOC_TYPES[d.docType].label, lines: d.result.lines })),
    items,
    summary: { counts, highlights },
  };
}
