// AI 응답 검증. 항목별로 유효한 결과(valid)와 실패 사유(errors)를 돌려준다.
import {
  ITEM_IDS, PRESENCE, SPECIFICITY, REASON_CODES, PROBATION_STATUS, EMPLOYMENT_CATEGORY,
} from './items.js';

// raw: AI가 반환한 객체 ({ items: [...] })
// expectedIds: 이번 호출에서 요청한 항목 ID 목록
// segmentCount: 유효한 근거 번호의 최댓값 (1..segmentCount)
export function validateResponse(raw, expectedIds, segmentCount) {
  const valid = {};
  const errors = {};
  const fail = (id, code) => { (errors[id] ||= []).push(code); };

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    for (const id of expectedIds) fail(id, 'malformed_response');
    return { valid, errors };
  }

  const byId = new Map();
  for (const entry of raw.items) {
    const id = entry && entry.id;
    if (!ITEM_IDS.includes(id) || !expectedIds.includes(id)) continue; // 요청하지 않은 항목은 무시
    if (byId.has(id)) byId.get(id).push(entry);
    else byId.set(id, [entry]);
  }

  for (const id of expectedIds) {
    const entries = byId.get(id);
    if (!entries) { fail(id, 'missing_item'); continue; }
    if (entries.length > 1) { fail(id, 'duplicate_item'); continue; }
    const itemErrors = validateItem(entries[0], segmentCount);
    if (itemErrors.length) errors[id] = itemErrors;
    else valid[id] = normalize(entries[0]);
  }
  return { valid, errors };
}

function validateItem(item, segmentCount) {
  const errs = [];
  const { id, presence, specificity, reason_code: reason, evidence_ids: ev } = item;

  if (!PRESENCE.includes(presence)) errs.push('invalid_presence');
  if (!Array.isArray(ev)) { errs.push('invalid_evidence_ids'); return errs; }
  if (!ev.every((n) => Number.isInteger(n))) errs.push('invalid_evidence_ids');
  if (ev.some((n) => Number.isInteger(n) && (n < 1 || n > segmentCount))) errs.push('unknown_evidence_id');
  if (new Set(ev).size !== ev.length) errs.push('duplicate_evidence_id');

  if (presence === 'found') {
    if (ev.length === 0) errs.push('found_without_evidence');
    if (!SPECIFICITY.includes(specificity)) errs.push('invalid_specificity');
    if (specificity === 'specific' && reason != null) errs.push('reason_on_specific');
    if (specificity === 'vague' && !REASON_CODES.includes(reason)) errs.push('missing_reason_code');
  } else if (presence === 'not_found') {
    if (ev.length > 0) errs.push('not_found_with_evidence');
    if (specificity != null) errs.push('specificity_on_not_found');
    if (reason != null) errs.push('reason_on_not_found');
  }

  if (id === 'probation_period') {
    const ps = item.probation_status;
    if (presence === 'found' && !PROBATION_STATUS.includes(ps)) errs.push('missing_probation_status');
    if (presence === 'not_found' && ps != null) errs.push('probation_status_on_not_found');
  }
  if (id === 'employment_type') {
    const ec = item.employment_category;
    if (presence === 'found' && !EMPLOYMENT_CATEGORY.includes(ec)) errs.push('missing_employment_category');
    if (presence === 'not_found' && ec != null) errs.push('employment_category_on_not_found');
  }
  return errs;
}

function normalize(item) {
  const out = {
    id: item.id,
    presence: item.presence,
    specificity: item.presence === 'found' ? item.specificity : null,
    reason_code: item.presence === 'found' && item.specificity === 'vague' ? item.reason_code : null,
    evidence_ids: [...item.evidence_ids].sort((a, b) => a - b),
  };
  // 설명용 인용 문구 (분명하지 않음일 때만). 판정에는 쓰지 않고, 근거 원문에 실제로 있는지는 화면 설명을 만들 때 확인한다.
  const vague = out.specificity === 'vague';
  out.stated_text = vague && typeof item.stated_text === 'string' ? item.stated_text : null;
  out.unclear_texts = vague && Array.isArray(item.unclear_texts) ? item.unclear_texts.filter((t) => typeof t === 'string').slice(0, 3) : [];
  // 항목 전용 필드는 해당 항목에서만 의미가 있다. 다른 항목에 들어온 값은 버린다.
  if (item.id === 'probation_period') out.probation_status = item.probation_status ?? null;
  if (item.id === 'employment_type') out.employment_category = item.employment_category ?? null;
  return out;
}
