// 상태 결정 규칙 (점검 기준표 v2.2 3·4·6·7장). AI의 추출값으로 세부 상태와 상위 상태를 서버가 결정한다.
// 입력 entries[id]: verify.js가 검증한 세부기준 추출값, 또는 { unavailable: true, reason } (검증·재분석 실패)
import {
  TOPICS, NOTES, MAIN_STATUS, SUB_STATUS, CRITERIA_VERSION, criterionById, SOURCE_LINKS, APPLICABILITY_LINKS,
} from './criteria.js';
import { verifyCalc } from './verify.js';
import { CORE_PATTERN } from './core-pattern.js';

// 명시적 부정(negated)의 세부 상태. 부정 표현을 공통 규칙으로 일반화하지 않고 세부기준마다 정한다.
// - 07-a(수습 없음)·10-a(연차 없음): 기준표 3-3의 허용 분기 → 확인됨 (06의 '기간 정함 없음'은 term_type으로 처리)
// - 09-a(휴일 없음): 기준표 4-1 → 일부 확인
// - 02-c(휴게 없음): 기준표에 규칙 없음(D04 미결정) → 잠정 '일부 확인' (provisional)
// - 08-a(수습 중 급여 미지급): 기준표에 규칙 없음 → 잠정 '일부 확인'. 08을 주요 내용 기재됨으로 자동 처리하지 않음 (provisional)
// 그 외 세부기준의 negated는 verify.js가 오류로 보고 재분석한다.
const NEGATION_STATUS = {
  '07-a': { status: 'CONFIRMED' },
  '10-a': { status: 'CONFIRMED' },
  '09-a': { status: 'PARTIAL' },
  '02-c': { status: 'PARTIAL', provisional: 'D04' },
  '08-a': { status: 'PARTIAL', provisional: 'probation_pay_negation' },
};
// neutral_note: 근로조건의 부여·지급·적용 자체를 부정한 경우 (6-1). 기준표 예시: 휴일 없음, 연차 미부여, 수습기간 없음, 수습 중 급여 미지급
// 02-c '휴게 없음'은 미결정(D04)이라 안내를 붙이지 않고 진단에만 남긴다.
const NEUTRAL_TARGETS = new Set(['07-a', '08-a', '09-a', '10-a']);
const APPLICABILITY_TARGETS = new Set(['09-a', '10-a']);
// OCR 저신뢰 검사에서 원문 기재값(source_value)만 보는 세부기준: 적용·부여·기간 유형 '표현'만 판정하므로
// 같은 문장의 숫자가 불확실해도 그 표현 자체는 영향받지 않는다 (예: F11 '연간 1O일 부여' → 10-a는 '부여'만 봄)
const PRESENCE_ONLY = new Set(['06-a', '07-a', '10-a']);

const UNIT = /(시급|시간급|시간당|일급|일당|주급|월급|월\s*보수|월\s*\d|연봉|연\s*\d|연간|매월|월\s*환산)/;
const HOURS = /\d+(?:\.\d+)?\s*시간/;
const REST_ONLY = (t) => /휴무/.test(t) && !/(휴일|주휴|공휴)/.test(t);
const HOLIDAY_LABEL = /(휴무|휴일|주휴|공휴)/;
const EXTERNAL_REF = /(법령|법|내규|규정|규칙|정책)\s*(에|을|를)?\s*(따|의|준|참고)/;
const GRANT_WORD = /(부여|지급|\d+\s*일)/;

function subStatus(id, e) {
  switch (e.finding) {
    case 'specific': return 'CONFIRMED';
    case 'coarse': return 'PARTIAL';
    case 'undecided':
    case 'conflict': return 'UNCLEAR';
    case 'negated': return NEGATION_STATUS[id]?.status ?? 'UNAVAILABLE';
    default: return 'MISSING';
  }
}

// 기준표의 고정 경계 규칙을 AI 판단보다 우선 적용한다. 반환: { status, diag }
function applyBoundaryRules(id, status, e, entries, lines) {
  const texts = e.quotes.map((q) => q.text);
  // 4-1: '급여 300만원' — 단위 언급이 없으면 01-b MISSING
  if (id === '01-b' && status === 'CONFIRMED') {
    const wageTexts = [...texts, ...(entries['01-a']?.quotes ?? []).map((q) => q.text)];
    if (!wageTexts.some((t) => UNIT.test(t))) return { status: 'MISSING', diag: 'unit_not_stated' };
  }
  // 4-1·4-2: 02-a는 소정근로시간 숫자가 원문에 있거나, 검증된 계산값이 있을 때만 확인됨
  if (id === '02-a' && status === 'CONFIRMED' && e.valueKind !== 'calculated' && !texts.some((t) => HOURS.test(t))) {
    return { status: 'PARTIAL', diag: 'hours_not_quoted' };
  }
  // 4-4: '휴무'만으로 지정된 휴일을 추론하지 않음 → 09-a 최대 PARTIAL.
  // 인용이 값만('매주 일요일') 담고 있으면 그 줄의 항목명('휴무일: …')으로 판단한다.
  if (id === '09-a' && status === 'CONFIRMED') {
    const context = e.quotes.map((q) => (HOLIDAY_LABEL.test(q.text) ? q.text : lines[q.line - 1]?.text ?? q.text));
    if (context.every(REST_ONLY)) return { status: 'PARTIAL', diag: 'rest_day_not_designated_holiday' };
  }
  // 4-1·4-4: 연차 외부 참조만 있으면 10-a PARTIAL ('법정 기준 이상 부여'처럼 부여 사실이 적힌 경우는 제외)
  if (id === '10-a' && status === 'CONFIRMED' && e.finding !== 'negated' && texts.every((t) => EXTERNAL_REF.test(t) && !GRANT_WORD.test(t))) {
    return { status: 'PARTIAL', diag: 'external_reference_only' };
  }
  return { status, diag: null };
}

// 문서 유형 관련 출처 표시용: 기간제·단시간 문구 (5장: 출처 적용 표시에만 활용, 상태 판정에는 쓰지 않음)
function employmentFlags(entries) {
  const texts = ['05-a', '06-a', '06-b'].flatMap((id) => (entries[id]?.quotes ?? []).map((q) => q.text)).join(' ');
  const partTime = /단시간/.test(texts);
  const fixedTerm = /(기간제|기간을\s*정한)/.test(texts) || entries['06-a']?.termType === 'fixed';
  return { fixedTerm, partTime };
}

function sourceCodes(c, flags) {
  if (c.codesPartTime && flags.partTime) return c.codesPartTime;
  if (c.codesFixedOrPartTime && (flags.fixedTerm || flags.partTime)) return c.codesFixedOrPartTime;
  return c.codes;
}

// 인용 구절의 원문 위치(문자 범위). 줄 안에서 글자 그대로 찾지 못하면(공백 차이 등) 줄 전체로 본다 (보수적).
function quoteRange(q, lines) {
  const seg = lines[q.line - 1];
  if (!seg) return null;
  const i = seg.text.indexOf(q.text);
  return i >= 0 ? [seg.start + i, seg.start + i + q.text.length] : [seg.start, seg.end];
}
const overlaps = ([a, b], ranges) => ranges.some((r) => r.start < b && a < r.end);

// 7-2: OCR 저신뢰 구간(사용자가 수정하거나 원본과 대조해 확인하지 않은 구간)이 이 세부기준의 판단에 쓰인 원문과 겹치는가.
// 적용·부여·기간 유형 '표현'만 판정하는 세부기준(PRESENCE_ONLY)은 원문 기재값 위치만 본다. 위치를 특정할 수 없으면 근거 전체를 본다.
function touchesLowConfidence(id, e, lines, ranges) {
  if (!ranges.length || e.finding === 'absent') return false;
  const quoteRanges = e.quotes.map((q) => quoteRange(q, lines)).filter(Boolean);
  if (PRESENCE_ONLY.has(id) && e.sourceValue) {
    const svRanges = e.quotes.map((q) => {
      const r = quoteRange(q, lines);
      const i = q.text.indexOf(e.sourceValue);
      return r && i >= 0 && r[1] - r[0] === q.text.length ? [r[0] + i, r[0] + i + e.sourceValue.length] : null;
    }).filter(Boolean);
    if (svRanges.length) return svRanges.some((r) => overlaps(r, ranges));
  }
  return quoteRanges.some((r) => overlaps(r, ranges));
}

// 저신뢰 구간 주변 문맥: 그 줄 안에서 구간을 낱말 경계까지 넓히고 앞뒤 낱말을 하나씩 더한다.
function rangeContexts(r, lines) {
  const out = [];
  const isSpace = (ch) => /\s/.test(ch);
  for (const seg of lines) {
    if (seg.end <= r.start || seg.start >= r.end) continue;
    const t = seg.text;
    const back = (i) => { while (i > 0 && !isSpace(t[i - 1])) i -= 1; return i; };
    const fwd = (i) => { while (i < t.length && !isSpace(t[i])) i += 1; return i; };
    let a = back(Math.max(r.start, seg.start) - seg.start);
    let b = fwd(Math.min(r.end, seg.end) - seg.start);
    while (a > 0 && isSpace(t[a - 1])) a -= 1;
    while (b < t.length && isSpace(t[b])) b += 1;
    out.push(t.slice(back(a), fwd(b)));
  }
  return out;
}

// OCR 처리 정책 1 (확정): 확인하지 않은 저신뢰 구간이 핵심(C) 판단에 영향을 줄 수 있으면 그 주제를 '분석 확인 불가'로 둔다.
// 핵심 근거 인용과 겹치는 구간은 세부기준 단위(7-2, touchesLowConfidence)로 처리한다. 여기서는 그 밖의 구간
// (추가(D) 근거에만 걸리거나 어떤 근거에도 인용되지 않은 구간)을 본다.
// 구간 주변 문맥에 그 주제의 핵심 판단 표현(금액·시간·장소·수습 등)이 보이면 독립성이 입증되지 않은 것으로 보고,
// 그 주제의 핵심 세부기준을 확정하지 않는다. 같은 줄에 있다는 것만으로는 영향이 있다고 보지 않는다(문자 구간 기준).
// OCR이 숫자를 비슷한 모양의 글자로 읽은 경우(4,0O0만원, 1l:00)도 핵심 표현으로 볼 수 있게 숫자 옆의 글자를 숫자로 바꿔 본다
const asDigits = (t) => t.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0').replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, '1').replace(/(?<=\d)S|S(?=\d)/g, '5');

function coreAffectedTopics(entries, lines, ranges) {
  const affected = new Map();
  if (!ranges.length) return affected;
  for (const t of TOPICS) {
    const cRanges = t.criteria.filter((c) => c.role === 'C')
      .flatMap((c) => (entries[c.id] && !entries[c.id].unavailable && entries[c.id].finding !== 'absent' ? entries[c.id].quotes : []))
      .map((q) => quoteRange(q, lines)).filter(Boolean);
    for (const r of ranges) {
      if (cRanges.some(([a, b]) => r.start < b && a < r.end)) continue;
      if (rangeContexts(r, lines).some((ctx) => CORE_PATTERN[t.id].test(ctx) || CORE_PATTERN[t.id].test(asDigits(ctx)))) { affected.set(t.id, r); break; }
    }
  }
  return affected;
}

const linksOf = (keys) => keys.map((k) => SOURCE_LINKS[k]);

// entries: 32개 세부기준 → 추출값 또는 { unavailable }
// opts.lowConfidence: 입력 텍스트 기준 OCR 저신뢰 문자 구간 [{ start, end }] (S-03에서 수정·확인되지 않은 구간).
//   근거 없는 자동 OCR 판정은 하지 않는다. opts.lines: 분할된 줄 (원문 위치 포함)
export function evaluate(entries, { lowConfidence = [], lines = [] } = {}) {
  const lowRanges = lowConfidence.filter((r) => Number.isInteger(r?.start) && Number.isInteger(r?.end) && r.end > r.start);
  const flags = employmentFlags(entries);
  const diagnostics = [];
  const crit = {};
  const ocrCore = coreAffectedTopics(entries, lines, lowRanges);

  for (const t of TOPICS) {
    for (const c of t.criteria) {
      const e = entries[c.id];
      if (!e || e.unavailable) {
        crit[c.id] = { status: 'UNAVAILABLE', evidence: [], reason: e?.reason ?? 'missing', finding: null };
        continue;
      }
      // 7-2: 확인되지 않은 OCR 저신뢰 구간이 이 세부기준의 판단 근거와 겹치면 확정하지 않는다
      if (touchesLowConfidence(c.id, e, lines, lowRanges)) {
        crit[c.id] = { status: 'UNAVAILABLE', evidence: [], reason: 'ocr_low_confidence', finding: e.finding };
        continue;
      }
      let status = subStatus(c.id, e);
      let derived = null;
      let valueKind = e.sourceValue ? 'quoted' : null;
      if (c.id === '02-a' && e.valueKind === 'calculated') {
        const calc = verifyCalc(e.calc, [...e.quotes, ...(entries['02-b']?.quotes ?? []), ...(entries['02-c']?.quotes ?? []), ...(entries['02-d']?.quotes ?? [])].map((q) => q.text));
        if (calc.ok) { derived = calc.derived; valueKind = 'calculated'; } else {
          diagnostics.push({ id: c.id, diag: calc.reason });
          if (status === 'CONFIRMED') status = 'PARTIAL'; // 검증되지 않은 계산으로 확정하지 않음
        }
      } else if (c.id === '02-a' && status === 'CONFIRMED') valueKind = 'quoted';
      const ruled = applyBoundaryRules(c.id, status, { ...e, valueKind: derived ? 'calculated' : e.valueKind }, entries, lines);
      if (ruled.diag) diagnostics.push({ id: c.id, diag: ruled.diag });
      if (e.excluded?.length) diagnostics.push({ id: c.id, diag: 'excluded_quotes', reasons: e.excluded.map((x) => x.reason) });
      const provisional = e.finding === 'negated' ? NEGATION_STATUS[c.id]?.provisional ?? null : null;
      if (provisional) diagnostics.push({ id: c.id, diag: `provisional_negation:${provisional}` });
      crit[c.id] = { status: ruled.status, evidence: e.quotes, sourceValue: e.sourceValue, valueKind, derived, finding: e.finding, termType: e.termType, provisional };
    }
    if (ocrCore.has(t.id)) {
      diagnostics.push({ id: t.id, diag: 'ocr_low_confidence_core_context' });
      for (const c of t.criteria) {
        if (c.role === 'C' && crit[c.id].status !== 'UNAVAILABLE') {
          crit[c.id] = { status: 'UNAVAILABLE', evidence: [], reason: 'ocr_low_confidence_related', finding: crit[c.id].finding };
        }
      }
    }
  }

  // 조건부 핵심과 명시적 분기 (3-3, 4-1)
  const confirmed = (id) => crit[id].status === 'CONFIRMED';
  const term = confirmed('06-a') ? crit['06-a'].termType : null;
  if (term === 'indefinite') crit['06-b'] = { ...crit['06-b'], status: 'NOT_APPLICABLE', evidence: [], derived: null, naReason: 'indefinite_term' };
  const probationApplies = confirmed('07-a') && crit['07-a'].finding !== 'negated';
  const probationNone = confirmed('07-a') && crit['07-a'].finding === 'negated';
  if (probationNone) crit['07-b'] = { ...crit['07-b'], status: 'NOT_APPLICABLE', evidence: [], derived: null, naReason: 'no_probation' };
  const leaveGranted = confirmed('10-a') && crit['10-a'].finding !== 'negated';
  const leaveNone = confirmed('10-a') && crit['10-a'].finding === 'negated';
  if (leaveNone) crit['10-b'] = { ...crit['10-b'], status: 'NOT_APPLICABLE', evidence: [], derived: null, naReason: 'no_leave' };
  const conditionMet = { fixed_term: term === 'fixed', probation_applies: probationApplies, leave_granted: leaveGranted };

  const topics = TOPICS.map((t) => {
    // 08은 07-a가 수습 '적용'으로 확인됐을 때만 표시. 숨긴 항목에는 상태를 만들지 않는다.
    const visible = !t.conditional || probationApplies;
    if (!visible) return { id: t.id, key: t.key, label: t.label, visible: false, status: null, statusLabel: null, criteria: [], notes: {}, unconfirmed: [], links: [], applicabilityLinks: [] };

    const criteria = t.criteria.map((c) => {
      const r = crit[c.id];
      const required = c.role === 'C' && (!c.condition || conditionMet[c.condition]);
      // basis: 상태의 근거 종류 (화면 설명용). 불분명함: undecided|conflict, 해당 없음: 분기 이유, 확인 불가: 실패 이유, 부정 표현: negated
      const basis = r.status === 'UNAVAILABLE' ? r.reason ?? null
        : r.status === 'NOT_APPLICABLE' ? r.naReason ?? null
          : r.finding === 'negated' ? 'negated'
            : r.status === 'UNCLEAR' ? r.finding : null;
      return {
        id: c.id,
        name: c.name,
        label: c.label,
        role: c.role,
        conditional: Boolean(c.condition),
        condition: c.condition ?? null,
        required,
        status: r.status,
        statusLabel: SUB_STATUS[r.status],
        evidence: r.status === 'UNAVAILABLE' ? [] : r.evidence, // 검증되지 않은 인용은 보이지 않는다
        sourceValue: r.status === 'UNAVAILABLE' || r.status === 'NOT_APPLICABLE' ? null : r.sourceValue ?? null,
        valueKind: r.status === 'UNAVAILABLE' ? null : r.valueKind ?? null,
        derived: r.status === 'UNAVAILABLE' ? null : r.derived ?? null,
        unavailableReason: r.status === 'UNAVAILABLE' ? r.reason ?? null : null,
        basis,
        provisional: r.status === 'UNAVAILABLE' ? null : r.provisional ?? null,
        sources: sourceCodes(c, flags),
      };
    });
    const required = criteria.filter((c) => c.required);
    const hasEvidence = criteria.some((c) => c.evidence.length > 0);
    let status;
    if (required.some((c) => c.status === 'UNAVAILABLE')) status = 'MAIN_UNAVAILABLE';
    else if (required.every((c) => c.status === 'CONFIRMED' || c.status === 'NOT_APPLICABLE')) status = 'MAIN_FOUND';
    else if (hasEvidence) status = 'MAIN_PARTIAL';
    else status = 'MAIN_MISSING';

    const notes = {};
    const negatedTarget = t.criteria.find((c) => NEUTRAL_TARGETS.has(c.id) && crit[c.id].finding === 'negated' && crit[c.id].status !== 'UNAVAILABLE');
    if (negatedTarget) notes.neutral = NOTES.neutral;
    if (t.criteria.some((c) => APPLICABILITY_TARGETS.has(c.id) && crit[c.id].finding === 'negated' && crit[c.id].status !== 'UNAVAILABLE')) {
      notes.applicability = NOTES.applicability;
    }
    if (t.id === '07' && !probationApplies && !probationNone) notes.probationHold = NOTES.probationHold;

    return {
      id: t.id,
      key: t.key,
      label: t.label,
      visible: true,
      status,
      statusLabel: MAIN_STATUS[status],
      criteria,
      notes,
      links: linksOf(t.links),
      applicabilityLinks: notes.applicability ? linksOf(APPLICABILITY_LINKS) : [],
      // '이 문서에서 확인되지 않은 내용': 확인되지 않음·불분명함인 세부기준
      unconfirmed: criteria.filter((c) => c.status === 'MISSING' || c.status === 'UNCLEAR').map((c) => c.id),
    };
  });

  const shown = topics.filter((t) => t.visible);
  const byStatus = Object.fromEntries(Object.keys(MAIN_STATUS).map((s) => [s, shown.filter((t) => t.status === s).length]));
  return { version: CRITERIA_VERSION, topics, counts: { shown: shown.length, byStatus }, diagnostics };
}

// 상위 항목 보류 판단에 쓰는 '필수 근거' 세부기준: 핵심(C)과 조건부 핵심(적용 여부를 아직 알 수 없으므로 모두 포함)
export const isRequiredEvidence = (id) => criterionById[id].role === 'C';
