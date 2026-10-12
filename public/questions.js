// '담당자에게 이렇게 물어보세요' 질문 템플릿 (브라우저와 Node 테스트에서 함께 사용, 점검 기준 v2.2 주제)
// - 화면에 표시되는 주제 중 '일부 내용만 기재됨' 또는 '관련 내용 찾지 못함'에만 질문을 만든다.
//   '분석 확인 불가'는 문서 내용이 아니라 분석·검증 실패이므로 질문을 만들지 않는다.
// - 문서에 적힌 금액·날짜·조건을 질문에 넣거나 추측하지 않는다. 템플릿 문장만 쓴다.
// - AI를 호출하지 않는다.

// 문서 유형별로 문서를 가리키는 말 (조사 포함)
const DOC_REF = {
  job_posting: '채용공고에서',
  offer: '안내해 주신 내용에서',
  contract: '근로계약서에서',
};

// 주제별: 담당자에게 익숙한 이름(topic), 주격 조사 형태(subj), 무엇을 물을지(ask)
const TOPIC_ASK = {
  '01': { topic: '급여', subj: '급여가', ask: '급여 금액과 산정 단위(시급·월급·연봉), 세전·세후 기준, 지급일과 지급방법을 알려 주실 수 있을까요?' },
  '02': { topic: '근무시간', subj: '근무시간이', ask: '근무일과 출퇴근 시각, 휴게시간, 주당 소정근로시간을 알려 주실 수 있을까요?' },
  '03': { topic: '근무장소', subj: '근무장소가', ask: '실제로 근무하게 될 장소(주소)와 재택·출장 여부를 알려 주실 수 있을까요?' },
  '04': { topic: '담당업무', subj: '담당업무가', ask: '입사 후 맡게 될 업무 내용과 범위를 구체적으로 알려 주실 수 있을까요?' },
  '05': { topic: '고용형태', subj: '고용형태가', ask: '정규직·기간제 등 어떤 형태의 근로계약으로 채용되는지 알려 주실 수 있을까요?' },
  '06': { topic: '계약기간', subj: '계약기간이', ask: '근로계약에 기간이 정해져 있는지, 있다면 시작일과 종료일을 알려 주실 수 있을까요?' },
  '07': { topic: '수습기간', subj: '수습기간이', ask: '수습기간이 있는지, 있다면 기간이 어떻게 되는지 알려 주실 수 있을까요?' },
  '08': { topic: '수습 기간 중 급여', subj: '수습 기간 중 급여가', ask: '수습 기간 중 급여가 어떻게 지급되는지(정규 급여와 같은지, 다르다면 어떻게 정해지는지) 알려 주실 수 있을까요?' },
  '09': { topic: '휴일', subj: '휴일이', ask: '주휴일 등 쉬는 날이 어떻게 정해지는지와 유급 여부를 알려 주실 수 있을까요?' },
  '10': { topic: '연차 유급휴가', subj: '연차 유급휴가가', ask: '연차 유급휴가가 어떻게 부여되는지(대상, 일수, 산정방법)를 알려 주실 수 있을까요?' },
};

export const QUESTION_STATUSES = ['MAIN_PARTIAL', 'MAIN_MISSING'];

// topic: 분석 결과의 주제 ({ id, visible, status }), docType: 문서 유형
// 반환: 질문 문장 또는 null(질문을 만들지 않는 경우)
export function buildQuestion(topic, docType) {
  if (!topic?.visible || !QUESTION_STATUSES.includes(topic.status)) return null;
  const spec = TOPIC_ASK[topic.id];
  const ref = DOC_REF[docType];
  if (!spec || !ref) return null;
  const lead = topic.status === 'MAIN_MISSING'
    ? `${ref} ${spec.topic}에 관한 내용을 찾지 못해 여쭤봅니다.`
    : `${ref} ${spec.topic}에 관한 내용 중 정해지지 않았거나 일부만 적힌 부분이 있어 여쭤봅니다.`;
  return `안녕하세요. ${lead} ${spec.ask} 감사합니다.`;
}

// ---------- 확인 질문 목록 (결과 화면 '회사에 확인할 질문') ----------
// 질문은 템플릿으로만 만든다 (AI가 쓰지 않음). 사용자는 고치거나 골라서 직접 회사에 보낸다.
// 동일한 조건에는 질문하지 않는다. 앞 문서에 없고 뒤 문서에 처음 등장한 조건은 변경으로 단정하지 않고 적용 여부를 확인한다.

// 한글 받침에 맞춘 조사 ('급여 금액이', '지급일이', '근무장소가')
export function josa(word, pair) {
  const [withBatchim, without] = pair.split('/');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  return `${word}${has ? withBatchim : without}`;
}
const clip = (t, n = 60) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const normalizeQ = (t) => t.replace(/\s+/g, ' ').trim();

// 같은 내용의 질문을 하나로 (공백 차이 무시, 처음 나온 순서 유지)
export function dedupeQuestions(list) {
  const seen = new Set();
  return list.filter((q) => {
    const key = normalizeQ(q.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 비교 결과의 세부 항목 하나 → 질문 문장 (질문이 필요 없으면 null)
// 새로 기재된 조건은 '핵심 조건'에만 기본 질문을 만든다.
// 새로 기재된 지급일·휴게시간 등 세부 정보는 결과에서 보여 주되, 이미 구체적으로 적혔다면 재질문하지 않는다.
// 이는 법적 중요도 순위가 아니라 사용자에게 반복 질문을 줄이려는 제품 정책이다.
const NEW_CORE_FACETS = new Set(['01-a', '02-a', '03-a', '04-a', '05-a', '06-a', '06-b', '07-a', '07-b', '08-a']);
const INCOMPLETE_STATUSES = new Set(['PARTIAL', 'UNCLEAR']);

// '협의 후 결정'은 금액이 없다는 뜻과 같지 않다. 원문 표현이 검증된 경우만 단계별 안내한다.
const NEGOTIATION = /(?:협의\s*(?:후|하여|해서)?\s*(?:결정|확정)|추후\s*협의|별도\s*협의|면접\s*후\s*(?:결정|협의)|급여\s*협의)/;
const negotiatingWage = (f, side) => f.id === '01-a' && INCOMPLETE_STATUSES.has(side.status)
  && NEGOTIATION.test([side.value, ...(side.evidence ?? []).map((e) => e.text)].filter(Boolean).join(' '));
const docIs = (comparison, i, kind) => comparison.docs[i]?.docType === kind
  || (kind === 'job_posting' && comparison.docs[i]?.docTypeLabel === '채용공고')
  || (kind === 'offer' && /오퍼|합격 안내/.test(comparison.docs[i]?.docTypeLabel ?? ''))
  || (kind === 'contract' && comparison.docs[i]?.docTypeLabel === '근로계약서');
function negotiationQuestion(f, comparison) {
  if (f.id !== '01-a') return undefined;
  const aPlanned = docIs(comparison, 0, 'job_posting') && negotiatingWage(f, f.a);
  const bPlanned = negotiatingWage(f, f.b);
  const bOffer = docIs(comparison, 1, 'offer');
  const bContract = docIs(comparison, 1, 'contract');
  const bClear = f.b.status === 'CONFIRMED';
  if (aPlanned && bClear) return null; // 예정된 협의가 금액으로 구체화됨: 변경으로 취급하지 않음
  if (aPlanned && bOffer && f.b.status === 'MISSING') return null; // 공고의 협의 예정만으로 오퍼에 질문을 강제하지 않음
  if ((aPlanned || bPlanned) && bOffer && bPlanned)
    return '최종 오퍼에도 급여가 협의 후 결정으로 안내되어 있습니다. 급여는 언제, 어떤 기준으로 확정되며 최종 금액은 어떻게 안내받을 수 있을까요?';
  if (bContract && bPlanned)
    return '근로계약서에 급여가 협의 후 결정으로 기재되어 있습니다. 최종 적용되는 급여 금액과 산정 단위를 확인 부탁드립니다.';
  return undefined; // 나머지는 기존 조건별 질문 규칙 유지
}

// 처음 등장한 핵심 조건: 이미 구체적으로 기재됐다면 적용 여부, '별도 협의'라면 구체적인 내용을 질문한다.
function newlyStatedCoreQuestion(f, L, b) {
  if (!NEW_CORE_FACETS.has(f.id) || f.a.status !== 'MISSING' || !b) return null;
  if (INCOMPLETE_STATUSES.has(f.b.status))
    return `${L.A}에는 ${f.label}에 관한 내용이 없고 ${L.B}에는 ‘${b}’라고 적혀 있습니다. 구체적인 ${josa(f.label, '을/를')} 알려 주실 수 있을까요?`;
  if (f.b.status === 'CONFIRMED')
    return `${L.A}에서는 ${f.label}에 관한 내용을 찾지 못했지만 ${L.B}에는 ‘${b}’라고 적혀 있습니다. 이 조건이 실제로 적용되는지 확인 부탁드립니다.`;
  return null; // 분석 확인 불가 등은 회사에 확인할 문제로 단정하지 않음
}

// A: 앞 단계 문서, B: 뒤 단계 문서. 같은 조건은 질문하지 않되, 새롭게 기재된 핵심 조건의 구체성을 확인한다.
function compareSentence(f, L, isCoreFacet, item, comparison) {
  const negotiation = negotiationQuestion(f, comparison);
  if (negotiation !== undefined) return negotiation;
  // 원문 기재값이 없으면 첫 인용 줄을 짧게 보여 준다 (문서에 없는 값을 만들지 않음)
  const a = clip(f.a.value ?? f.a.evidence?.[0]?.text); const b = clip(f.b.value ?? f.b.evidence?.[0]?.text);
  const subj = josa(f.label, '이/가');
  switch (f.state) {
    case 'changed':
      return `${subj} 문서마다 다르게 적혀 있습니다(${L.A}: ${a || '해당 없음'} / ${L.B}: ${b || '해당 없음'}). 최종적으로 적용되는 ${josa(f.label, '을/를')} 확인 부탁드립니다.`;
    case 'missing_one':
      if (INCOMPLETE_STATUSES.has(f.a.status) && a)
        return `${L.A}에는 ${f.label}이 ‘${a}’라고 적혀 있지만 구체적으로 정해졌는지 확인하기 어렵고, ${L.B}에서는 관련 내용을 찾지 못했습니다. 현재 적용되는 ${josa(f.label, '을/를')} 구체적으로 알려 주실 수 있을까요?`;
      return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
    case 'added':
      // 새로 기재된 내용은 변경이나 위반이라고 단정하지 않는다. 세부 정보가 확정되지 않았으면 구체적으로 묻는다.
      return newlyStatedCoreQuestion(f, L, b);
    case 'not_comparable':
      // 간략한 오퍼에 없다는 이유만으로 조건이 삭제·변경됐다고 단정하지 않는다.
      if (f.b.status === 'MISSING' && a) {
        if (INCOMPLETE_STATUSES.has(f.a.status))
          return `${L.A}에는 ${f.label}이 ‘${a}’라고 적혀 있지만 구체적으로 정해졌는지 확인하기 어렵고, ${L.B}에서는 관련 내용을 찾지 못했습니다. 현재 적용되는 ${josa(f.label, '을/를')} 구체적으로 알려 주실 수 있을까요?`;
        return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
      }
      return newlyStatedCoreQuestion(f, L, b);
    case 'unclear':
      if (f.b.status === 'PARTIAL' || f.b.status === 'UNCLEAR') return `${L.B}의 ${subj} 구체적으로 정해지지 않은 것으로 보여 여쭤봅니다(${L.B}: ${b}). 구체적인 ${josa(f.label, '을/를')} 알려 주실 수 있을까요?`;
      if (f.a.status === 'CONFIRMED' && f.b.status === 'CONFIRMED') return `${subj} 문서마다 다르게 표현되어 있습니다(${L.A}: ${a} / ${L.B}: ${b}). 같은 조건인지 확인 부탁드립니다.`;
      return null; // 앞 문서만 모호하고 뒤 문서에 구체적으로 적힌 경우
    case 'both_missing':
      return isCoreFacet ? `두 문서 모두에서 ${item.label}에 관한 내용을 찾지 못했습니다. ${TOPIC_ASK[item.id]?.ask ?? ''}`.trim() : null;
    default:
      return null; // 동일·해당 없음·분석 확인 불가(분석 문제이지 문서 내용이 아님)
  }
}

// 수습을 적용한다는 내용이 확인되지 않으면 두 문서 모두 미기재된 수습 급여에 질문하지 않는다.
// 비교 상태와 원문 근거는 변경하지 않고 질문 생성만 제한한다.
function hasProbationApplication(comparison) {
  const f = comparison.items.find((i) => i.id === '07')?.facets.find((v) => v.id === '07-a');
  return Boolean(f && [f.a, f.b].some((side) => side?.status === 'CONFIRMED' && side.finding !== 'negated'));
}

// 수습기간과 수습 중 급여가 모두 질문 대상일 때 한 개의 편집 가능한 질문으로 결합한다.
// 항목별 결과는 각각 유지한다. 한쪽에 질문이 없다면 결합하지 않는다.
function mergeProbationQuestions(questions, mode) {
  const period = questions.find((q) => q.itemId === '07');
  const pay = questions.find((q) => q.itemId === '08');
  if (!period || !pay) return questions;
  const text = mode === 'compare'
    ? `안녕하세요. 수습기간과 수습 중 급여를 함께 확인하고 싶습니다. ${[...new Set([...(period.sentences ?? []), ...(pay.sentences ?? [])])].join(' ')} 감사합니다.`
    : '안녕하세요. 근로계약서의 수습기간과 수습 중 급여에 대해 확인하고 싶습니다. 수습 적용 여부와 기간, 수습 중 급여 지급 기준(금액 또는 정규 급여 대비 비율)을 함께 알려 주실 수 있을까요? 감사합니다.';
  const first = questions.find((q) => q === period || q === pay);
  const merged = { id: 'q-07-08', itemId: first.itemId, itemIds: ['07', '08'], label: '수습기간·수습 중 급여', text };
  return questions.flatMap((q) => q === first ? [merged] : q === period || q === pay ? [] : [q]);
}

// 비교 결과는 건드리지 않고, 질문만 '주요'와 '선택적'으로 분리한다.
// 두 문서 모두 미기재: 결과에서는 계속 표시하지만 자동으로 회사에 물을 질문은 아님.
// 간략한 오퍼에 미기재: 앞 문서의 확정 조건이 사라졌다는 뜻이 아니므로 선택적 확인.
// 계약서에서 앞 문서의 조건을 찾지 못한 경우, 확정값 충돌, 뒤 문서의 중요한 신규 조건은 주요 질문으로 유지.
function isOptionalCompareFacet(f, comparison) {
  return f.state === 'both_missing'
    || (docIs(comparison, 1, 'offer') && f.state === 'not_comparable' && f.b.status === 'MISSING');
}
const finalized = (questions, mode) => dedupeQuestions(mergeProbationQuestions(questions, mode))
  .map(({ sentences, ...q }) => q);

export function buildCompareQuestionGroups(comparison) {
  const L = { A: comparison.docs[0].docTypeLabel, B: comparison.docs[1].docTypeLabel };
  const probationApplies = hasProbationApplication(comparison);
  const lists = { primary: [], optional: [] };
  for (const item of comparison.items) {
    const sentences = { primary: [], optional: [] };
    for (const [i, f] of item.facets.entries()) {
      if (item.id === '08' && f.state === 'both_missing' && !probationApplies) continue;
      const sentence = compareSentence(f, L, i === 0, item, comparison);
      if (!sentence) continue;
      const bucket = isOptionalCompareFacet(f, comparison) ? 'optional' : 'primary';
      sentences[bucket].push(sentence);
    }
    for (const bucket of ['primary', 'optional']) {
      const unique = [...new Set(sentences[bucket])];
      if (!unique.length) continue;
      const reason = bucket === 'optional'
        ? (item.facets.some((f) => f.state === 'both_missing')
          ? '두 문서에서 모두 확인되지 않은 내용이에요.'
          : '간략한 오퍼에서 확인되지 않은 내용이에요.')
        : null;
      lists[bucket].push({
        id: `q-${item.id}`, itemId: item.id, label: item.label, sentences: unique, reason,
        text: `안녕하세요. ${item.label} 관련해 여쭤봅니다. ${unique.join(' ')} 감사합니다.`,
      });
    }
  }
  return {
    primary: finalized(lists.primary, 'compare'),
    optional: finalized(lists.optional, 'compare'),
  };
}

// 기존 호출은 주요 질문만 반환한다. '선택적' 질문은 사용자가 직접 추가할 때만 편집 목록에 들어간다.
export function buildCompareQuestions(comparison) {
  return buildCompareQuestionGroups(comparison).primary;
}
export function buildOptionalCompareQuestions(comparison) {
  return buildCompareQuestionGroups(comparison).optional;
}

// 근로계약서 핵심 기준이 확인돼도, 일부 세부 조건에 대한 확인 질문은 유용할 수 있다.
// 먼저 지급방법(법령 관련 기재항목)·지급일(공식 서식)·휴게시간(계약 유형에 따라 법령/공식서식 참고)만 적용한다.
// 모든 누락된 추가 기준을 자동 질문하면 사용자에게 불필요한 질문이 쌓일 수 있어 제한한다.
const DETAIL_FOLLOWUPS = {
  '01': { '01-e': '급여 지급방법', '01-f': '급여 지급일' },
  '02': { '02-c': '휴게시간' },
};
const DETAIL_NEEDS_CHECK = new Set(['MISSING', 'PARTIAL', 'UNCLEAR']);

function buildContractDetailQuestion(topic, docType) {
  if (docType !== 'contract' || !topic?.visible || topic.status !== 'MAIN_FOUND') return null;
  const candidates = DETAIL_FOLLOWUPS[topic.id];
  if (!candidates || !Array.isArray(topic.criteria)) return null;
  const names = topic.criteria
    .filter((c) => c.role === 'D' && DETAIL_NEEDS_CHECK.has(c.status) && candidates[c.id])
    .map((c) => candidates[c.id]);
  if (!names.length) return null;
  return `안녕하세요. 근로계약서의 ${names.join('·')}에 대해 추가로 확인하고 싶습니다. 해당 조건을 구체적으로 알려 주실 수 있을까요? 감사합니다.`;
}

// 근로계약서 단독 점검: 핵심 기재 부족·미기재는 주요 질문으로,
// 주요 조건이 기재된 주제에서 지급일·지급방법·휴게시간만 추가 확인으로 제안한다.
export function buildContractQuestionGroups(result) {
  const lists = { primary: [], optional: [] };
  for (const t of result?.topics ?? []) {
    if (!t.visible) continue;
    const primaryText = buildQuestion(t, result.docType);
    const optionalText = primaryText ? null : buildContractDetailQuestion(t, result.docType);
    if (primaryText) lists.primary.push({ id: `q-${t.id}`, itemId: t.id, label: t.label, text: primaryText });
    if (optionalText) lists.optional.push({
      id: `q-${t.id}`, itemId: t.id, label: t.label,
      reason: '주요 조건은 기재되어 있지만 일부 세부 정보는 추가 확인할 수 있어요.',
      text: optionalText,
    });
  }
  return {
    primary: dedupeQuestions(mergeProbationQuestions(lists.primary, 'contract')),
    optional: dedupeQuestions(lists.optional),
  };
}
export function buildContractQuestions(result) {
  return buildContractQuestionGroups(result).primary;
}
export function buildOptionalContractQuestions(result) {
  return buildContractQuestionGroups(result).optional;
}

// 클립보드 복사: Clipboard API를 먼저 쓰고, 안 되면 임시 입력란 선택 후 복사 명령을 쓴다.
// 성공하면 true, 둘 다 실패하면 false (브라우저 전용)
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 권한·보안 컨텍스트 문제면 아래 방법으로 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
