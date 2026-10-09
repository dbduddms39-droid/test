// 분석 파이프라인 (점검 기준 v2.2):
// 원문 분할 → AI 추출 → 서버 인용 검증 → 필수 근거가 실패한 상위 항목만 보류하고 1회 재분석 → 서버 규칙으로 상태 결정
import {
  CRITERION_IDS, DOC_TYPES, SOURCE_GUIDE, RESULT_NOTICE, TOPIC_IDS, criteriaOfTopics, criterionById,
} from './criteria.js';
import { segmentText } from './segment.js';
import { verifyResponse } from './verify.js';
import { evaluate } from './rules.js';

// throwFatal: 키 없음·무료 한도 초과·타임아웃처럼 재분석해도 해결되지 않는 오류는 그대로 던진다.
async function callAndVerify(ai, { docType, segments, criterionIds, feedback }, { throwFatal = false } = {}) {
  try {
    const raw = await ai.analyze({ docType, segments, criterionIds, feedback });
    return verifyResponse(raw, criterionIds, segments);
  } catch (err) {
    if (throwFatal && err.fatal) throw err;
    const code = `ai_call_failed:${err.code || 'unknown'}${err.httpStatus ? `:${err.httpStatus}` : ''}`;
    return Object.fromEntries(criterionIds.map((id) => [id, { errors: [code], errorQuotes: [] }]));
  }
}

const failed = (e) => Boolean(e?.errors?.length);

// 7-1: 상위 항목을 보류할지 결정한다.
// - 핵심(C)·조건부 핵심 근거가 하나라도 실패하면 보류 (일부 인용이 맞아도 그 항목 응답 전체를 다시 받음)
// - 추가(D)만 실패한 경우, 그 오류가 핵심 판정·상충 근거·조건부 분기에 영향을 줄 수 없다고 입증될 때만 D 단위로 처리한다.
//   줄 번호가 다르다는 것만으로는 독립으로 보지 않는다. 다음을 모두 만족해야 한다:
//   (1) 오류가 '인용 구절이 그 줄에 없음/빈 인용'뿐이다 (응답 누락·형식 오류·없는 줄·허용되지 않은 부정 표현은 독립 아님)
//   (2) 실패 인용이 가리킨 줄이 같은 주제의 핵심(C) 근거 줄이 아니다
//   (3) 그 줄의 실제 내용과 AI가 주장한 구절 모두에 그 주제의 핵심 판단에 쓰이는 표현(금액·시간·장소·수습 등)이 없다
//       → 다른 금액·시간 같은 상충 근거나 조건부 분기 근거가 숨어 있을 가능성을 배제
//   하나라도 입증되지 않으면 그 주제 전체를 보류하고 1회 재분석한다.
const QUOTE_ERRORS = new Set(['quote_not_in_line', 'empty_quote']);
export const CORE_PATTERN = {
  '01': /(\d[\d,.]*\s*(만\s*|천\s*)?원|연봉|월급|시급|시간급|일급|주급|월\s*보수)/,
  '02': /(\d+(\.\d+)?\s*시간|\d{1,2}\s*:\s*\d{2}|주\s*\d+(\.\d+)?\s*일)/,
  '03': /(근무\s*(장소|지)|근무지|취업\s*장소|배치\s*장소|사업장|본사|지점|사무실|오피스|사옥|매장|[가-힣]+(특별시|광역시|시|도|구|군)\s|[가-힣\d]+(로|길)\s*\d)/,
  '04': /(업무|직무|담당)/,
  '05': /(정규직|계약직|기간제|단시간|인턴|파견|고용\s*(형태|방식)|계약\s*(형태|유형))/,
  '06': /(계약\s*기간|기간의\s*정함|기간제|기간을\s*정|\d{4}\s*년|\d+\s*(개월|년)|종료)/,
  '07': /(수습|시용)/,
  '08': /(수습|시용|\d+\s*%)/,
  '09': /(휴일|휴무|주휴|공휴)/,
  '10': /(연차|유급\s*휴가)/,
};
export function isIndependentD(topic, entry, cLines, segments) {
  if (!entry.errors.every((code) => QUOTE_ERRORS.has(code)) || !entry.errorQuotes.length) return false;
  return entry.errorQuotes.every((q) => {
    const seg = Number.isInteger(q.line) ? segments[q.line - 1] : null;
    return seg && !cLines.has(q.line) && !CORE_PATTERN[topic].test(seg.text) && !CORE_PATTERN[topic].test(q.text);
  });
}

export function planHolds(entries, segments) {
  const held = [];
  const independentD = [];
  for (const topic of TOPIC_IDS) {
    const ids = criteriaOfTopics([topic]);
    const cFailed = ids.some((id) => criterionById[id].role === 'C' && failed(entries[id]));
    if (cFailed) { held.push(topic); continue; }
    const dFailed = ids.filter((id) => criterionById[id].role === 'D' && failed(entries[id]));
    if (!dFailed.length) continue;
    const cLines = new Set(ids.filter((id) => criterionById[id].role === 'C').flatMap((id) => (entries[id].quotes ?? []).map((q) => q.line)));
    const independent = dFailed.every((id) => isIndependentD(topic, entries[id], cLines, segments));
    if (independent) independentD.push(...dFailed);
    else held.push(topic);
  }
  return { held, independentD };
}

const errorsOf = (entries, ids) => Object.fromEntries(ids.filter((id) => failed(entries[id])).map((id) => [id, entries[id].errors]));

// lowConfidence: 입력 텍스트 기준 OCR 저신뢰 문자 구간 [{ start, end }] (S-03에서 사용자가 수정하거나 원본과 대조해 확인하지 않은 구간)
export async function analyzeDocument({ text, docType, ai, log = () => {}, lowConfidence = [] }) {
  const segments = segmentText(text);
  let first;
  try {
    first = await callAndVerify(ai, { docType, segments, criterionIds: CRITERION_IDS }, { throwFatal: true });
  } catch (err) {
    // 오류 코드·HTTP 상태·제공업체 오류 유형만 기록한다 (제공업체 메시지·원문·키는 기록하지 않음)
    log({ event: 'analysis_failed', analyzer: ai.name, docType, segments: segments.length, error: err.code, httpStatus: err.httpStatus ?? null, providerStatus: err.providerStatus ?? null });
    throw err;
  }

  const final = { ...first };
  const { held, independentD } = planHolds(first, segments);
  for (const id of independentD) final[id] = { unavailable: true, reason: 'evidence_verification_failed' };

  // 보류한 상위 항목만 1회 재분석. 다른 항목의 검증된 결과는 그대로 둔다.
  let retryErrors = {};
  if (held.length) {
    const ids = criteriaOfTopics(held);
    const second = await callAndVerify(ai, { docType, segments, criterionIds: ids, feedback: errorsOf(first, ids) });
    for (const id of ids) {
      // 재분석까지 실패한 세부기준은 '분석 확인 불가'. 허위 구절은 버린다.
      final[id] = failed(second[id]) ? { unavailable: true, reason: 'evidence_verification_failed' } : second[id];
    }
    retryErrors = errorsOf(second, ids);
  }

  const result = evaluate(final, { lowConfidence, lines: segments });

  // 원문은 기록하지 않는다. 세부기준 ID, 오류 코드, 개수만 남긴다.
  log({
    event: 'analysis_done',
    analyzer: ai.name,
    criteria: result.version,
    docType,
    segments: segments.length,
    firstPassErrors: errorsOf(first, CRITERION_IDS),
    heldTopics: held,
    lowConfidenceRanges: lowConfidence.length,
    independentD,
    finalErrors: retryErrors,
    shown: result.counts.shown,
    diagnostics: result.diagnostics.map((d) => `${d.id}:${d.diag}`),
  });

  return {
    version: result.version,
    docType,
    docTypeLabel: DOC_TYPES[docType].label,
    sourceGuide: SOURCE_GUIDE[docType],
    counts: result.counts,
    topics: result.topics,
    lines: segments.map((s) => ({ id: s.id, text: s.text })),
    notice: RESULT_NOTICE,
  };
}

