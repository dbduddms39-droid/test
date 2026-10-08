// 분석 파이프라인: 원문 분할 → AI 분석 → 서버 검증 → 실패 항목 1회 재분석 → 화면용 결과
import { ITEM_IDS } from './items.js';
import { segmentText } from './segment.js';
import { validateResponse } from './validate.js';
import { present } from './present.js';

async function callAndValidate(ai, { docType, segments, itemIds, feedback }) {
  try {
    const raw = await ai.analyze({ docType, segments, itemIds, feedback });
    return validateResponse(raw, itemIds, segments.length);
  } catch (err) {
    const code = `ai_call_failed:${err.code || 'unknown'}`;
    return { valid: {}, errors: Object.fromEntries(itemIds.map((id) => [id, [code]])) };
  }
}

export async function analyzeDocument({ text, docType, ai, log = () => {} }) {
  const segments = segmentText(text);
  const first = await callAndValidate(ai, { docType, segments, itemIds: ITEM_IDS });
  const valid = { ...first.valid };
  let errors = first.errors;
  const retried = Object.keys(errors);

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
