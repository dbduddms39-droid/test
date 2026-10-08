// 분석 파이프라인: 원문 분할 → AI 분석 → 서버 검증 → 실패 항목 1회 재분석 → 화면용 결과
import { ITEM_IDS } from './items.js';
import { segmentText } from './segment.js';
import { validateResponse } from './validate.js';
import { present } from './present.js';

// throwFatal: 키 없음·무료 한도 초과·타임아웃처럼 재분석해도 해결되지 않는 오류는 그대로 던진다.
async function callAndValidate(ai, { docType, segments, itemIds, feedback }, { throwFatal = false } = {}) {
  try {
    const raw = await ai.analyze({ docType, segments, itemIds, feedback });
    return validateResponse(raw, itemIds, segments.length);
  } catch (err) {
    if (throwFatal && err.fatal) throw err;
    const code = `ai_call_failed:${err.code || 'unknown'}`;
    return { valid: {}, errors: Object.fromEntries(itemIds.map((id) => [id, [code]])) };
  }
}

export async function analyzeDocument({ text, docType, ai, log = () => {} }) {
  const segments = segmentText(text);
  let first;
  try {
    first = await callAndValidate(ai, { docType, segments, itemIds: ITEM_IDS }, { throwFatal: true });
  } catch (err) {
    log({ event: 'analysis_failed', analyzer: ai.name, docType, segments: segments.length, error: err.code });
    throw err;
  }
  const valid = { ...first.valid };
  let errors = first.errors;
  const retried = Object.keys(errors);

  // 재분석 단계의 오류는 이미 받은 결과를 버리지 않도록 해당 항목만 '분석 확인 불가'로 둔다.
  if (retried.length) {
    const second = await callAndValidate(ai, { docType, segments, itemIds: retried, feedback: errors });
    Object.assign(valid, second.valid);
    errors = second.errors;
  }

  // 원문은 기록하지 않는다. 항목 ID, 오류 코드, 개수만 남긴다.
  log({
    event: 'analysis_done',
    analyzer: ai.name,
    docType,
    segments: segments.length,
    firstPassErrors: first.errors,
    retried,
    finalErrors: errors,
  });

  return present({ docType, segments, valid, errors });
}
