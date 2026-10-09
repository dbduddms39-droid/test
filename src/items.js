// 분석 항목, 문서 유형, 화면 상태 정의. 화면 라벨·문구는 모두 앱이 결정한다.

export const ITEMS = [
  { id: 'salary', label: '임금', base: true },
  { id: 'work_hours', label: '근무시간', base: true },
  { id: 'workplace', label: '근무장소', base: true },
  { id: 'duties', label: '담당업무', base: true },
  { id: 'employment_type', label: '고용형태', base: true },
  { id: 'contract_period', label: '계약기간', base: false },
  { id: 'probation_period', label: '수습기간', base: false },
  { id: 'probation_pay', label: '수습 중 급여', base: false },
];

export const ITEM_IDS = ITEMS.map((i) => i.id);
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const DOC_TYPES = {
  job_posting: { label: '채용공고' },
  offer: { label: '오퍼·문자·메일' },
  contract: { label: '근로계약서' },
};

// AI 응답 값 (내부용). 화면 상태로 직접 쓰지 않는다.
export const PRESENCE = ['found', 'not_found'];
export const SPECIFICITY = ['specific', 'vague'];
export const REASON_CODES = ['vague_expression', 'conflicting_values', 'candidate_unclear'];
// 수습기간 항목 전용: 수습 적용 / 명시적 수습 없음 / 적용 여부 불분명
export const PROBATION_STATUS = ['applies', 'none', 'unclear'];
// 고용형태 항목 전용: 계약기간 표시 여부 판단에 사용
export const EMPLOYMENT_CATEGORY = ['permanent', 'fixed_term', 'intern', 'other', 'unclear'];

// 화면 상태
export const STATUS = {
  stated: { label: '명시됨', explanation: '이 조건이 문서에 구체적으로 적혀 있어요. 적법하거나 유리한 조건이라는 뜻은 아니에요.' },
  unclear: { label: '분명하지 않음', explanation: '이 조건에 관한 내용은 있지만, 구체적으로 정해지지 않았거나 추가 확인이 필요한 부분이 있어요.' },
  not_found: { label: '찾지 못함', explanation: '입력한 문서에서 이 조건에 관한 내용을 확인하지 못했어요. 법률 위반을 뜻하지는 않아요.' },
  unavailable: { label: '분석 확인 불가', explanation: 'AI 분석 결과를 검증하지 못해 이 항목의 상태를 확정할 수 없어요. 원문을 직접 확인해 주세요.' },
};

// '분명하지 않음'의 상세 설명은 사유 코드별 고정 문장이 아니라 src/reason.js가 근거 원문으로 만든다.

export const NOT_FOUND_TEMPLATES = {
  job_posting: (label) => `이 채용공고에는 ${label}에 관한 안내가 확인되지 않아요.`,
  offer: (label) => `입력한 안내 내용에서 ${label}에 관한 내용을 확인하지 못했어요.`,
  contract: (label) => `입력한 계약서에서 ${label}에 관한 내용을 확인하지 못했어요.`,
};

export const COMMON_NOTICE = '이 결과는 입력하신 문서 기준의 정리이며, 법률 판단이 아니에요.';

// 사용자가 추가로 확인할 내용은 src/followups.js가 항목의 원문 근거에 맞춰 정한다 (이미 적힌 사실은 다시 묻지 않음).
