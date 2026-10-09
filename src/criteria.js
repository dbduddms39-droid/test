// 점검 기준 v2.2 (동결본: design-handoff/spec/04_점검기준표_v2.2_동결원문.md) 고정 데이터.
// 주제·세부기준 ID, 핵심(C)/추가(D), 조건부 핵심, 출처 코드, 안내 문구는 동결 원문을 그대로 옮긴다.
// 판정 규칙을 바꾸려면 기준표의 새 버전이 먼저 있어야 한다. 이 파일만 고치지 않는다.

export const CRITERIA_VERSION = 'v2.2';

export const DOC_TYPES = {
  job_posting: { label: '채용공고' },
  offer: { label: '오퍼·합격 안내' }, // 합격·오퍼 안내 문자·이메일 포함
  contract: { label: '근로계약서' },
};

// 상위 상태 4개 (3-1)
export const MAIN_STATUS = {
  MAIN_FOUND: '주요 내용 기재됨',
  MAIN_PARTIAL: '일부 내용만 기재됨',
  MAIN_MISSING: '관련 내용 찾지 못함',
  MAIN_UNAVAILABLE: '분석 확인 불가',
};
// 세부기준 상태 6개 (3-2)
export const SUB_STATUS = {
  CONFIRMED: '확인됨',
  PARTIAL: '일부 확인',
  UNCLEAR: '불분명함',
  MISSING: '확인되지 않음',
  NOT_APPLICABLE: '해당 없음',
  UNAVAILABLE: '분석 확인 불가',
};

// 기준 출처 코드 (2)
export const SOURCE_CODES = {
  'L-M': '관련 법령상 근로조건 명시 대상 주제',
  'L-W': '관련 법령상 서면 교부·서면명시 대상 주제',
  F: '고용노동부 등 공식 서식의 항목 참고',
  S: '일단확인이 정의한 구체성 확인 기준',
};

// 출처 링크 (9, 2026-10-09 확인)
export const SOURCE_LINKS = {
  lsa17: { label: '근로기준법 제17조', url: 'https://www.law.go.kr/법령/근로기준법/제17조' },
  lsaDecree8: { label: '근로기준법 시행령 제8조', url: 'https://www.law.go.kr/법령/근로기준법시행령/제8조' },
  fixedTerm17: { label: '기간제 및 단시간근로자 보호 등에 관한 법률 제17조', url: 'https://www.law.go.kr/법령/기간제및단시간근로자보호등에관한법률/제17조' },
  standardContract: { label: '고용노동부 개정 표준근로계약서(2025.03.07 게시)', url: 'https://www.moel.go.kr/info/etc/dataroom/view.do?bbs_seq=20250300356' },
  lsa18: { label: '근로기준법 제18조', url: 'https://www.law.go.kr/법령/근로기준법/제18조' },
  lsa11: { label: '근로기준법 제11조', url: 'https://www.law.go.kr/법령/근로기준법/제11조' },
  lsaDecree7: { label: '근로기준법 시행령 제7조', url: 'https://www.law.go.kr/법령/근로기준법시행령/제7조' },
  lsaDecreeTable1: { label: '근로기준법 시행령 별표 1', url: 'https://law.go.kr/법령별표서식/근로기준법시행령/별표1' },
};
// 적용 범위 안내(applicability_note)와 함께 보여 줄 조문 (기준표 6장)
export const APPLICABILITY_LINKS = ['lsa18', 'lsa11', 'lsaDecree7', 'lsaDecreeTable1'];

// name: 기준표의 세부기준 이름(원문), label: 화면에 보여 줄 짧은 이름. 세부기준 ID·C/D·출처 코드는 화면에 그대로 노출하지 않는다.
// role: 'C' 핵심, 'D' 추가. condition: 조건부 핵심(C)이 요구되는 경우
//   fixed_term: 06-a가 기간을 정한 계약으로 확인됨 / probation_applies: 07-a 수습 적용 확인 / leave_granted: 10-a 연차 부여 확인
// codes: 출처 코드. codesFixedOrPartTime: 기간제·단시간 문서일 때, codesPartTime: 단시간일 때만 달라지는 출처
const C = (id, name, extra = {}) => ({ id, name, role: 'C', ...extra });
const D = (id, name, extra = {}) => ({ id, name, role: 'D', ...extra });

export const TOPICS = [
  {
    id: '01', key: 'wage', label: '임금',
    sourceNote: '임금 주제 L-M/L-W; 01-a/b 구체성 S, 01-c/d/e L-W, 01-f F, 01-g S',
    links: ['lsa17', 'standardContract'],
    criteria: [
      C('01-a', '금액·산정값', { label: '금액',  codes: ['S'] }),
      C('01-b', '시급/월급/연봉 등 산정 단위', { label: '급여 단위',  codes: ['S'] }),
      D('01-c', '구성항목', { label: '임금 구성항목',  codes: ['L-W'] }),
      D('01-d', '계산방법', { label: '계산방법',  codes: ['L-W'] }),
      D('01-e', '지급방법', { label: '지급방법',  codes: ['L-W'] }),
      D('01-f', '지급일', { label: '지급일',  codes: ['F'] }),
      D('01-g', '세전·세후', { label: '세전·세후 구분',  codes: ['S'] }),
    ],
  },
  {
    id: '02', key: 'work_hours', label: '근무시간',
    sourceNote: '02-a L-W; 02-b F; 02-c 기간제·단시간 L-W/그 외 F·S; 02-d 단시간만 L-W/그 외 S',
    links: ['lsa17', 'fixedTerm17', 'standardContract'],
    criteria: [
      C('02-a', '소정근로시간', { label: '소정근로시간',  codes: ['L-W'] }),
      D('02-b', '출퇴근 시각', { label: '출퇴근 시각',  codes: ['F'] }),
      D('02-c', '휴게시간', { label: '휴게시간',  codes: ['F', 'S'], codesFixedOrPartTime: ['L-W'] }),
      D('02-d', '근로일 및 근로일별 시간', { label: '근로일·근로일별 시간',  codes: ['S'], codesPartTime: ['L-W'] }),
    ],
  },
  {
    id: '03', key: 'workplace', label: '근무장소',
    sourceNote: '03-a 일반 L-M, 기간제·단시간 L-W; 03-b/c S',
    links: ['lsaDecree8', 'fixedTerm17'],
    criteria: [
      C('03-a', '식별 가능한 취업 장소', { label: '근무 장소',  codes: ['L-M'], codesFixedOrPartTime: ['L-W'] }),
      D('03-b', '재택·원격·파견·출장 여부', { label: '재택·원격·파견·출장 여부',  codes: ['S'] }),
      D('03-c', '변경 조건', { label: '근무 장소 변경 조건',  codes: ['S'] }),
    ],
  },
  {
    id: '04', key: 'duties', label: '담당업무',
    sourceNote: '04-a 일반 L-M, 기간제·단시간 L-W; 04-b S',
    links: ['lsaDecree8', 'fixedTerm17'],
    criteria: [
      C('04-a', '수행 업무 내용', { label: '업무 내용',  codes: ['L-M'], codesFixedOrPartTime: ['L-W'] }),
      D('04-b', '추가 업무 범위', { label: '추가 업무 범위',  codes: ['S'] }),
    ],
  },
  {
    id: '05', key: 'employment_type', label: '고용형태',
    sourceNote: '05-a S (계약기간 등 별도 법정 주제와 혼동 금지); 05-b S',
    links: [],
    criteria: [
      C('05-a', '계약 형태의 구체적 기재', { label: '계약 형태',  codes: ['S'] }),
      D('05-b', '정규직 전환 조건', { label: '정규직 전환 조건',  codes: ['S'] }),
    ],
  },
  {
    id: '06', key: 'contract_period', label: '계약기간',
    sourceNote: '기간제·단시간 계약기간은 L-W; 그 외의 세부 표현 기준 S',
    links: ['fixedTerm17', 'standardContract'],
    criteria: [
      C('06-a', '기간의 정함 유무', { label: '기간의 정함 유무',  codes: ['S'], codesFixedOrPartTime: ['L-W'] }),
      C('06-b', '시작·종료일/확정 가능한 범위', { label: '시작일·종료일',  condition: 'fixed_term', codes: ['S'], codesFixedOrPartTime: ['L-W'] }),
      D('06-c', '갱신 기준', { label: '갱신 기준',  codes: ['S'] }),
    ],
  },
  {
    id: '07', key: 'probation_period', label: '수습기간',
    sourceNote: '서비스 자체 S',
    links: [],
    criteria: [
      C('07-a', '수습 적용 여부', { label: '수습 적용 여부',  codes: ['S'] }),
      C('07-b', '기간', { label: '수습 기간',  condition: 'probation_applies', codes: ['S'] }),
      D('07-c', '평가·전환 기준', { label: '평가·전환 기준',  codes: ['S'] }),
    ],
  },
  {
    id: '08', key: 'probation_pay', label: '수습 중 급여', conditional: true,
    sourceNote: '임금 관련 법령 주제와 연결되나 08 자체 세부기준은 S. 07-a의 \'수습 적용\' 확인 시에만 노출',
    links: [],
    criteria: [
      C('08-a', '금액/비율/원문으로 특정 가능한 지급기준', { label: '수습 중 지급 기준',  codes: ['S'] }),
      D('08-b', '종료 후 임금', { label: '수습 종료 후 임금',  codes: ['S'] }),
    ],
  },
  {
    id: '09', key: 'holidays', label: '휴일',
    sourceNote: '휴일 주제 L-W, 지정 표현 구체성 S, 09-b/c S',
    links: ['lsa17', 'standardContract'],
    criteria: [
      C('09-a', '주휴일 등 지정된 휴일의 요일·주기·일정', { label: '지정된 휴일',  codes: ['L-W', 'S'] }),
      D('09-b', '유급 여부', { label: '유급 여부',  codes: ['S'] }),
      D('09-c', '추가 공휴일 조건', { label: '추가 공휴일 조건',  codes: ['S'] }),
    ],
  },
  {
    id: '10', key: 'annual_leave', label: '연차 유급휴가',
    sourceNote: '연차 주제 L-W, 세부기준의 구체성 S; 미부여 명시 분기는 중립 안내 필수',
    links: ['lsa17', 'standardContract'],
    criteria: [
      C('10-a', '부여/미부여 내용', { label: '부여 여부',  codes: ['L-W', 'S'] }),
      C('10-b', '적용 대상과 부여 일수·산정방법', { label: '적용 대상·부여 일수·산정방법',  condition: 'leave_granted', codes: ['L-W', 'S'] }),
      D('10-c', '사용·신청 방식', { label: '사용·신청 방식',  codes: ['S'] }),
    ],
  },
];

export const TOPIC_IDS = TOPICS.map((t) => t.id);
export const CRITERIA = TOPICS.flatMap((t) => t.criteria.map((c) => ({ ...c, topic: t.id })));
export const CRITERION_IDS = CRITERIA.map((c) => c.id);
export const criterionById = Object.fromEntries(CRITERIA.map((c) => [c.id, c]));
export const topicById = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const topicOf = (criterionId) => criterionId.slice(0, 2);
export const criteriaOfTopics = (topicIds) => CRITERION_IDS.filter((id) => topicIds.includes(topicOf(id)));

// 고정 안내 문구 (3-3, 6-1). 원문 그대로.
export const NOTES = {
  neutral: '문서에 적힌 내용만 확인했습니다. 법적 효력이나 실제 적용 여부를 판단한 결과가 아닙니다.',
  applicability: '법령상 적용 범위는 사업장 규모와 근로시간 등 실제 사정에 따라 달라질 수 있습니다. 이 서비스는 해당 조건의 법적 적용 여부나 적법성을 판단하지 않습니다.',
  probationHold: '수습 적용 여부가 확인되지 않아 수습 중 급여 항목은 별도 판정하지 않았습니다. 수습이 적용된다면 급여 조건도 확인해야 합니다.',
};

// 기준 출처 안내 (5-1). 문서 유형별로 문구만 다르고 판정은 같다.
export const SOURCE_GUIDE = {
  job_posting: '확인 기준의 출처: 근로기준법 제17조·고용노동부 표준근로계약서 등을 참고해 만든 정보 확인 목록입니다. 이 문서의 법적 기재 의무를 판단하는 것은 아닙니다.',
  offer: '확인 기준의 출처: 근로기준법 제17조·고용노동부 표준근로계약서 등을 참고해 만든 정보 확인 목록입니다. 이 문서의 법적 기재 의무를 판단하는 것은 아닙니다.',
  contract: '참고 근거: 근로기준법 제17조 등 관련 조문. 법적 의무의 적용 여부 및 충족 여부는 판정하지 않습니다.',
};

export const RESULT_NOTICE = '이 결과는 문서에 적힌 내용의 기재 상태를 정리한 것이며, 법 위반 여부나 계약의 효력을 판단하지 않습니다.';
