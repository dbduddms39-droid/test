import { ITEM_IDS } from '../src/items.js';
import { resolveEvidence } from '../src/eval/score.js';

// 샘플의 기대값으로 '정답 AI 응답'을 만든다.
export function idealItem(sample, id) {
  const exp = sample.expected[id];
  const presence = exp.presence ?? (exp.status === 'not_found' || exp.status === 'hidden' ? 'not_found' : 'found');
  const found = presence === 'found';
  return {
    id,
    presence,
    specificity: found ? (exp.status === 'unclear' ? 'vague' : 'specific') : null,
    reason_code: found && exp.status === 'unclear' ? exp.reason : null,
    evidence_ids: found ? [...new Set(resolveEvidence(sample.text, exp.evidence))] : [],
    probation_status: id === 'probation_period' && found ? exp.probation : null,
    employment_category: id === 'employment_type' && found ? exp.employment : null,
  };
}

export function idealResponse(sample, itemIds = ITEM_IDS) {
  return { items: itemIds.map((id) => idealItem(sample, id)) };
}

// 호출 순서대로 미리 정한 응답을 돌려주는 가짜 AI. 함수면 호출 인자로 응답을 만든다.
export function scriptedAI(...responses) {
  const calls = [];
  return {
    name: 'scripted',
    calls,
    async analyze(args) {
      calls.push(args);
      const next = responses[calls.length - 1];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(args) : structuredClone(next);
    },
  };
}
