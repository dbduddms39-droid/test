// AI 추출 응답 검증 (점검 기준표 v2.2 7-1, 4-2, 4-3).
// - 인용 구절이 실제 입력 텍스트의 해당 줄에 글자 그대로 있는지 확인한다. 맞지 않으면 그 세부기준은 오류.
// - 특정 근로조건을 지칭하지 않는 포괄 문구, 휴일 근거로 쓸 수 없는 근무일수 문구는 근거에서 뺀다(오류 아님).
// - 계산값(02-a)은 원문 인용과 별도로 산술·입력 일관성만 검증한다.
import { CRITERION_IDS } from './criteria.js';
import { FINDINGS, TERM_TYPES, VALUE_KINDS } from './ai/prompt.js';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// 특정 근로조건을 지칭하지 않는 포괄 문구 (4-3 포괄 문구 제외)
const CATCH_ALL_HEAD = /^(?:[-•·*]\s*)?(기타|그\s*밖의?|그\s*외|나머지|세부|상세)/;
const CATCH_ALL_TAIL = /(별도|추후|개별|공통\s*정책|입사\s*시|확정\s*시|안내|공지|고지|참고)/;
const CONDITION_WORD = /(급여|임금|연봉|월급|시급|보수|근무\s*시간|근로\s*시간|휴게|출퇴근|장소|근무지|사업장|사무실|오피스|사옥|업무|직무|담당|고용\s*형태|계약\s*기간|계약\s*형태|수습|휴일|휴무|연차|휴가)/;
export const isCatchAll = (text) => CATCH_ALL_HEAD.test(norm(text)) && CATCH_ALL_TAIL.test(text) && !CONDITION_WORD.test(text);

// 근무일수만 말하는 문구는 휴일(09)의 근거가 아니다 (4-1, 4-4)
const WORKDAY = /(주\s*\d+(?:\.\d+)?\s*일|월\s*[~\-∼]\s*금|월요일부터\s*금요일)/;
const HOLIDAY_WORD = /(휴일|휴무|쉬|주휴|공휴|휴가)/;
export const isWorkdayOnly = (text) => WORKDAY.test(text) && !HOLIDAY_WORD.test(text);

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) <= 24 && Number(m[2]) < 60 ? v : null;
};
const fmtHours = (h) => `${Number.isInteger(h) ? h : Number(h.toFixed(2))}시간`;

// 02-a 계산값 검증: 시간표 숫자가 인용 원문에 있고, 휴게가 원문으로 뒷받침되며, 산술이 맞는지.
// 반환: { ok, derived: [{ label, value, derivation }] } (값은 서버가 다시 계산한 것)
export function verifyCalc(calc, quoteTexts) {
  if (!calc || !Array.isArray(calc.entries) || !calc.entries.length) return { ok: false, reason: 'calc_missing' };
  const joined = quoteTexts.join('\n');
  const derived = [];
  for (const e of calc.entries) {
    if (!e || !Array.isArray(e.segments) || !e.segments.length || typeof e.hours !== 'number') return { ok: false, reason: 'calc_malformed' };
    let total = 0;
    const parts = [];
    for (const s of e.segments) {
      const a = toMinutes(s.start);
      const b = toMinutes(s.end);
      if (a == null || b == null || b <= a || !Number.isInteger(s.days) || s.days < 1 || s.days > 7) return { ok: false, reason: 'calc_malformed' };
      if (!Number.isInteger(s.break_minutes) || s.break_minutes < 0 || s.break_minutes >= b - a) return { ok: false, reason: 'calc_malformed' };
      // 시각은 원문 인용에 있어야 한다 (9:30 / 09:30 표기 차이는 허용)
      const timeIn = (t) => joined.includes(t) || joined.includes(t.replace(/^0/, ''));
      if (!timeIn(s.start) || !timeIn(s.end)) return { ok: false, reason: 'calc_time_not_quoted' };
      // 휴게: 원문에 휴게 언급이 있어야 한다. 0분이면 '휴게 없음'류 원문이 있어야 한다 (휴게 누락 보정 금지)
      if (s.break_minutes > 0 && !/휴게/.test(joined)) return { ok: false, reason: 'calc_break_not_quoted' };
      if (s.break_minutes === 0 && !/휴게[^\n]{0,15}(없|두지\s*않|미부여)/.test(joined)) return { ok: false, reason: 'calc_break_not_quoted' };
      const daily = (b - a - s.break_minutes) / 60;
      total += daily * s.days;
      parts.push(`(${s.end}−${s.start}${s.break_minutes ? ` − 휴게 ${s.break_minutes}분` : ''}) × ${s.days}일`);
    }
    if (Math.abs(total - e.hours) > 0.01) return { ok: false, reason: 'calc_mismatch' };
    derived.push({ label: String(e.label ?? ''), value: `주 ${fmtHours(total)}`, derivation: `${parts.join(' + ')} = 주 ${fmtHours(total)}` });
  }
  return { ok: true, derived };
}

// raw: AI 응답 ({ criteria: [...] }), expectedIds: 이번 호출에서 요청한 세부기준 ID, segments: 입력 줄
// 반환: entries[id] = { finding, quotes, sourceValue, termType, valueKind, calc, excluded, errors: [] }
//   errors가 비어 있지 않으면 그 세부기준의 응답은 쓰지 않는다(검증되지 않은 인용을 표시하지 않음).
//   errorLines: 오류 인용이 가리킨 줄 번호 (추가(D) 오류가 핵심(C) 근거와 독립적인지 판단할 때 사용)
export function verifyResponse(raw, expectedIds, segments) {
  const entries = {};
  const fail = (id, code, line) => {
    const e = (entries[id] ||= { errors: [], errorLines: [] });
    e.errors.push(code);
    if (line !== undefined) e.errorLines.push(line);
  };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.criteria)) {
    for (const id of expectedIds) fail(id, 'malformed_response');
    return entries;
  }
  const byId = new Map();
  for (const c of raw.criteria) {
    const id = c?.id;
    if (!CRITERION_IDS.includes(id) || !expectedIds.includes(id)) continue;
    byId.set(id, [...(byId.get(id) ?? []), c]);
  }
  for (const id of expectedIds) {
    const list = byId.get(id);
    if (!list) { fail(id, 'missing_criterion'); continue; }
    if (list.length > 1) { fail(id, 'duplicate_criterion'); continue; }
    entries[id] = verifyEntry(id, list[0], segments);
  }
  return entries;
}

function verifyEntry(id, c, segments) {
  const out = { finding: null, quotes: [], sourceValue: null, termType: null, valueKind: null, calc: null, excluded: [], errors: [], errorLines: [] };
  const err = (code, line) => { out.errors.push(code); if (line !== undefined) out.errorLines.push(line); };
  if (!FINDINGS.includes(c.finding)) err('invalid_finding');
  if (!Array.isArray(c.quotes)) { err('invalid_quotes'); return out; }

  const verified = [];
  for (const q of c.quotes) {
    if (!q || !Number.isInteger(q.line) || typeof q.text !== 'string') { err('invalid_quotes'); continue; }
    const seg = segments[q.line - 1];
    if (!seg) { err('unknown_line', null); continue; }
    if (!norm(q.text)) { err('empty_quote', q.line); continue; }
    if (!norm(seg.text).includes(norm(q.text))) { err('quote_not_in_line', q.line); continue; }
    verified.push({ line: q.line, text: q.text.trim() });
  }
  if (c.finding === 'absent' && c.quotes.length) err('absent_with_quotes');
  if (c.finding !== 'absent' && FINDINGS.includes(c.finding) && !c.quotes.length) err('no_quotes');
  if (c.finding === 'conflict' && new Set(verified.map((q) => norm(q.text))).size < 2) err('conflict_needs_two');

  const sv = typeof c.source_value === 'string' && norm(c.source_value) ? c.source_value.trim() : null;
  if (sv && !verified.some((q) => norm(q.text).includes(norm(sv)))) err('source_value_not_in_quote');
  if (id === '06-a' && c.finding === 'specific' && !TERM_TYPES.includes(c.term_type)) err('missing_term_type');
  if (out.errors.length) return out;

  // 근거로 쓸 수 없는 문구는 빼고 기록만 남긴다
  let quotes = verified;
  const drop = (pred, reason) => {
    const keep = [];
    for (const q of quotes) (pred(q.text) ? out.excluded.push({ ...q, reason }) : keep.push(q));
    quotes = keep;
  };
  drop(isCatchAll, 'catch_all');
  if (id.startsWith('09-')) drop(isWorkdayOnly, 'workday_not_holiday');

  out.finding = c.finding;
  out.quotes = quotes;
  out.sourceValue = sv && quotes.some((q) => norm(q.text).includes(norm(sv))) ? sv : null;
  out.termType = id === '06-a' && TERM_TYPES.includes(c.term_type) ? c.term_type : null;
  if (id === '02-a') {
    out.valueKind = VALUE_KINDS.includes(c.value_kind) ? c.value_kind : null;
    out.calc = c.calc ?? null;
  }
  // 근거를 모두 뺐으면 '언급 없음'과 같다
  if (out.finding !== 'absent' && !quotes.length) out.finding = 'absent';
  // 상충 근거 중 하나가 빠졌다면 확정값으로 올리지 않고 '일부'로 둔다 (보수적)
  if (out.finding === 'conflict' && new Set(quotes.map((q) => norm(q.text))).size < 2) out.finding = quotes.length ? 'coarse' : 'absent';
  return out;
}
