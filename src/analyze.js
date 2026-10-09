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
    return Object.fromEntries(criterionIds.map((id) => [id, { errors: [code], errorLines: [null] }]));
  }
}

const failed = (e) => Boolean(e?.errors?.length);

// 7-1: 상위 항목을 보류할지 결정한다.
// - 핵심(C)·조건부 핵심 근거가 하나라도 실패하면 보류 (일부 인용이 맞아도 그 항목 응답 전체를 다시 받음)
// - 추가(D)만 실패한 경우, 실패 인용이 실제 줄을 가리키고 그 줄이 핵심(C) 근거와 겹치지 않을 때만 독립 오류로 본다.
//   독립성이 입증되지 않으면(응답 누락, 없는 줄, 핵심과 같은 줄) 보류해 항목 전체를 다시 분석한다.
export function planHolds(entries) {
  const held = [];
  const independentD = [];
  for (const topic of TOPIC_IDS) {
    const ids = criteriaOfTopics([topic]);
    const cFailed = ids.some((id) => criterionById[id].role === 'C' && failed(entries[id]));
    if (cFailed) { held.push(topic); continue; }
    const dFailed = ids.filter((id) => criterionById[id].role === 'D' && failed(entries[id]));
    if (!dFailed.length) continue;
    const cLines = new Set(ids.filter((id) => criterionById[id].role === 'C').flatMap((id) => (entries[id].quotes ?? []).map((q) => q.line)));
    const independent = dFailed.every((id) => entries[id].errorLines.length > 0
      && entries[id].errorLines.every((line) => Number.isInteger(line) && !cLines.has(line)));
    if (independent) independentD.push(...dFailed);
    else held.push(topic);
  }
  return { held, independentD };
}

const errorsOf = (entries, ids) => Object.fromEntries(ids.filter((id) => failed(entries[id])).map((id) => [id, entries[id].errors]));

// lowConfidence: OCR 저신뢰 구절 (선택). 화면에서는 아직 보내지 않으며, 보낼 때의 정책은 미결정(보고서 참고).
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
  const { held, independentD } = planHolds(first);
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

