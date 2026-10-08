// 검증된 AI 결과를 화면 상태로 바꾼다. 상태 라벨·표시 여부·문구는 모두 여기서 결정한다.
import {
  ITEMS, STATUS, REASON_TEXT, NOT_FOUND_TEMPLATES, COMMON_NOTICE, FOLLOW_UPS, DOC_TYPES,
} from './items.js';

export function statusOf(result) {
  if (!result) return 'unavailable';
  if (result.presence === 'not_found') return 'not_found';
  return result.specificity === 'specific' ? 'stated' : 'unclear';
}

// 문서 유형별 표시 규칙
export function visibility(valid) {
  const vis = {};
  for (const item of ITEMS) if (item.base) vis[item.id] = true;

  const emp = valid.employment_type;
  const fixedTermLike = emp?.presence === 'found' && ['fixed_term', 'intern'].includes(emp.employment_category);
  const contract = valid.contract_period;
  // 계약기간: 근거가 발견됐거나, 고용형태가 계약직·기간제·인턴으로 확인된 경우. 검증 실패는 숨기지 않는다.
  vis.contract_period = !contract || contract.presence === 'found' || fixedTermLike;

  // 수습기간: 수습 관련 언급이 발견된 경우. 검증 실패는 숨기지 않는다.
  const prob = valid.probation_period;
  vis.probation_period = !prob || prob.presence === 'found';

  // 수습 중 급여: 수습이 언급되고 적용되는 경우. 수습 없음이 명시되면 숨긴다.
  const pay = valid.probation_pay;
  if (prob?.probation_status === 'none') vis.probation_pay = false;
  else if (prob?.presence === 'found') vis.probation_pay = true;
  else if (prob?.presence === 'not_found') vis.probation_pay = pay?.presence === 'found';
  else vis.probation_pay = !pay || pay.presence === 'found'; // 수습기간 검증 실패
  return vis;
}

export function present({ docType, segments, valid, errors }) {
  const vis = visibility(valid);
  const segById = new Map(segments.map((s) => [s.id, s]));

  const items = ITEMS.map((item) => {
    const result = valid[item.id];
    const status = statusOf(result);
    return {
      id: item.id,
      label: item.label,
      visible: vis[item.id],
      status,
      statusLabel: STATUS[status].label,
      explanation: STATUS[status].explanation,
      reasonCode: result?.reason_code ?? null,
      reasonText: result?.reason_code ? REASON_TEXT[result.reason_code] : null,
      notFoundMessage: status === 'not_found' ? NOT_FOUND_TEMPLATES[docType](item.label) : null,
      probationNone: item.id === 'probation_period' && result?.probation_status === 'none',
      // 화면에는 AI가 쓴 문장이 아니라 앱이 보존한 원문을 번호로 찾아 보여준다.
      evidence: (result?.evidence_ids ?? []).map((n) => segById.get(n)),
      followUps: FOLLOW_UPS[item.id],
      errorCodes: errors[item.id] ?? [],
    };
  });

  const summary = Object.fromEntries(Object.keys(STATUS).map((s) => [s, 0]));
  for (const it of items) if (it.visible) summary[it.status] += 1;

  return {
    docType,
    docTypeLabel: DOC_TYPES[docType].label,
    notice: COMMON_NOTICE,
    summary,
    items,
    segments,
  };
}
