// 정확도 채점: 기대 상태와 실제 상태, 근거 번호의 정확성을 비교한다.
// AI가 구조적으로 유효한 번호를 골랐더라도 그 근거가 실제로 맞는지는 여기서 측정한다.
import { segmentText } from '../segment.js';

// 기대 근거(부분 문자열)를 단위 번호로 바꾼다. 각 문자열은 처음 일치하는 단위 하나를 가리킨다.
export function resolveEvidence(text, needles = []) {
  const segments = segmentText(text);
  return needles.map((needle) => {
    const seg = segments.find((s) => s.text.includes(needle));
    if (!seg) throw new Error(`샘플 근거 문자열을 원문에서 찾지 못함: ${needle}`);
    return seg.id;
  });
}

export function scoreSample(sample, result) {
  const rows = [];
  for (const item of result.items) {
    const exp = sample.expected[item.id];
    const expectedStatus = exp.status;
    const actualStatus = item.visible ? item.status : 'hidden';
    const expectedIds = [...new Set(resolveEvidence(sample.text, exp.evidence))].sort((a, b) => a - b);
    const actualIds = item.evidence.map((s) => s.id);
    const hit = expectedIds.filter((n) => actualIds.includes(n)).length;
    const extra = actualIds.filter((n) => !expectedIds.includes(n));
    const missing = expectedIds.filter((n) => !actualIds.includes(n));

    let evidence;
    if (!expectedIds.length && !actualIds.length) evidence = 'n/a';
    else if (!missing.length && !extra.length) evidence = 'exact';
    else if (hit > 0) evidence = 'partial';
    else evidence = 'wrong';

    rows.push({
      sample: sample.key,
      item: item.id,
      expectedStatus,
      actualStatus,
      statusMatch: expectedStatus === actualStatus,
      // 문서에 근거가 있는데 찾지 못함으로 판정한 경우 (잘못된 not_found)
      falseNotFound: expectedIds.length > 0 && item.status === 'not_found',
      expectedIds,
      actualIds,
      evidence,
    });
  }
  return rows;
}

export function summarize(rows) {
  const total = rows.length;
  const statusOk = rows.filter((r) => r.statusMatch).length;
  const withEvidence = rows.filter((r) => r.expectedIds.length);
  return {
    total,
    statusOk,
    statusAccuracy: total ? statusOk / total : 0,
    evidenceExact: withEvidence.filter((r) => r.evidence === 'exact').length,
    evidencePartial: withEvidence.filter((r) => r.evidence === 'partial').length,
    evidenceWrongOrMissing: withEvidence.filter((r) => r.evidence === 'wrong' || !r.actualIds.length).length,
    evidenceTotal: withEvidence.length,
    falseNotFound: rows.filter((r) => r.falseNotFound).length,
    unavailable: rows.filter((r) => r.actualStatus === 'unavailable').length,
  };
}
