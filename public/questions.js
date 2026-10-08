// '담당자에게 이렇게 물어보세요' 질문 템플릿 (브라우저와 Node 테스트에서 함께 사용)
// - '분명하지 않음' 또는 '찾지 못함'이고 화면에 표시되는 항목에만 질문을 만든다.
// - 문서에 적힌 금액·날짜·조건을 질문에 넣거나 추측하지 않는다. 템플릿 문장만 쓴다.
// - AI를 호출하지 않는다.

// 문서 유형별로 문서를 가리키는 말 (조사 포함)
const DOC_REF = {
  job_posting: '채용공고에서',
  offer: '안내해 주신 내용에서',
  contract: '근로계약서에서',
};

// 항목별: 짧은 이름(topic), 주격 조사를 붙인 형태(subj), 무엇을 물을지(ask)
const ITEM_ASK = {
  salary: { topic: '급여', subj: '급여가', ask: '급여 금액(월급 또는 연봉)과 세전·세후 기준, 지급일을 알려 주실 수 있을까요?' },
  work_hours: { topic: '근무시간', subj: '근무시간이', ask: '출퇴근 시각과 휴게시간, 주당 근무일수, 연장근무가 있는지 알려 주실 수 있을까요?' },
  workplace: { topic: '근무장소', subj: '근무장소가', ask: '실제로 근무하게 될 장소(주소)와 재택·출장 여부를 알려 주실 수 있을까요?' },
  duties: { topic: '담당업무', subj: '담당업무가', ask: '입사 후 맡게 될 업무 범위를 구체적으로 알려 주실 수 있을까요?' },
  employment_type: { topic: '고용형태', subj: '고용형태가', ask: '정규직·계약직 등 어떤 고용형태로 채용되는지 알려 주실 수 있을까요?' },
  contract_period: { topic: '계약기간', subj: '계약기간이', ask: '근로계약의 시작일과 종료일, 계약 갱신 여부를 알려 주실 수 있을까요?' },
  probation_period: { topic: '수습기간', subj: '수습기간이', ask: '수습기간이 있는지, 있다면 기간이 어떻게 되는지 알려 주실 수 있을까요?' },
  probation_pay: { topic: '수습 기간 중 급여', subj: '수습 기간 중 급여가', ask: '수습 기간 중 급여가 어떻게 지급되는지(정규 급여와 같은지, 다르다면 어떻게 정해지는지) 알려 주실 수 있을까요?' },
};

// '분명하지 않음'의 사유별 앞 문장
const VAGUE_LEAD = {
  vague_expression: (ref, spec) => `${ref} ${spec.subj} 구체적으로 정해지지 않은 표현으로 적혀 있어 여쭤봅니다.`,
  conflicting_values: (ref, spec) => `${ref} ${spec.subj} 서로 다르게 적힌 부분이 있어, 어느 내용이 적용되는지 확인하고 싶습니다.`,
  candidate_unclear: (ref, spec) => `${ref} ${spec.topic}에 관한 내용인지 분명하지 않은 부분이 있어 여쭤봅니다.`,
};

export const QUESTION_STATUSES = ['unclear', 'not_found'];

// item: 분석 결과 항목 ({ id, visible, status, reasonCode }), docType: 문서 유형
// 반환: 질문 문장 또는 null(질문을 만들지 않는 경우)
export function buildQuestion(item, docType) {
  if (!item?.visible || !QUESTION_STATUSES.includes(item.status)) return null;
  const spec = ITEM_ASK[item.id];
  const ref = DOC_REF[docType];
  if (!spec || !ref) return null;
  const lead = item.status === 'not_found'
    ? `${ref} ${spec.topic}에 관한 내용을 찾지 못해 여쭤봅니다.`
    : (VAGUE_LEAD[item.reasonCode] ?? VAGUE_LEAD.candidate_unclear)(ref, spec);
  return `안녕하세요. ${lead} ${spec.ask} 감사합니다.`;
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
