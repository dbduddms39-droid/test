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

// 사용자가 추가로 확인할 내용 (판정과 무관하게 항목별로 제공)
export const FOLLOW_UPS = {
  salary: ['세전 금액인지 세후 금액인지', '기본급과 각종 수당(식대·연장근로수당 등)의 구성', '지급일과 지급 방법'],
  work_hours: ['출퇴근 시각과 휴게시간', '주당 근무일수', '연장·야간·휴일 근무가 있는지와 그 처리 방식'],
  workplace: ['실제 출근할 사업장 주소', '재택·파견·출장 근무 여부', '근무지가 바뀔 수 있는지'],
  duties: ['실제로 맡게 될 업무 범위', '직무 외 업무가 추가될 수 있는지'],
  employment_type: ['정규직·계약직 등 고용형태', '정규직 전환 조건이 있다면 그 기준'],
  contract_period: ['계약 시작일과 종료일', '계약 갱신 여부와 기준'],
  probation_period: ['수습 기간의 길이', '수습 종료 후 평가 기준과 결과'],
  probation_pay: ['수습 기간 중 급여 금액 또는 비율', '수습 종료 후 급여가 어떻게 바뀌는지'],
};
