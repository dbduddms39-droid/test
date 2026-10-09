// 테스트 샘플. expected의 각 항목:
//   status: 화면 상태(stated | unclear | not_found | hidden)
//   evidence: 근거로 선택돼야 하는 원문 단위를 찾는 부분 문자열 목록
//   reason / probation / employment / stated / unclear: 이상적인 AI 응답을 만들 때 쓰는 부가 값
//   (stated·unclear는 설명에 인용할 원문 문구: AI의 stated_text·unclear_texts)
// 화면에 숨겨지는 항목(hidden)도 AI 응답 기준(found/not_found)을 함께 적는다.

export const SAMPLES = [
  {
    key: 'S1_clear',
    title: '모든 주요 조건이 명확한 문서',
    docType: 'contract',
    text: `근로계약서

1. 근로계약기간: 2026년 11월 1일부터 2027년 10월 31일까지
2. 근무장소: 서울특별시 마포구 양화로 00, 5층
3. 업무내용: 온라인 고객 문의 응대 및 상담 기록 관리
4. 고용형태: 기간제(계약직)
5. 소정근로시간: 09:00 ~ 18:00 (휴게시간 12:00 ~ 13:00), 주 5일 월~금
6. 임금: 월 2,600,000원 (기본급 2,400,000원, 식대 200,000원), 매월 25일 지급
7. 수습기간: 입사일로부터 3개월
8. 수습기간 중 임금: 월 급여의 90% 지급`,
    expected: {
      salary: { status: 'stated', evidence: ['임금: 월 2,600,000원'] },
      work_hours: { status: 'stated', evidence: ['소정근로시간'] },
      workplace: { status: 'stated', evidence: ['근무장소'] },
      duties: { status: 'stated', evidence: ['업무내용'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'fixed_term' },
      contract_period: { status: 'stated', evidence: ['근로계약기간'] },
      probation_period: { status: 'stated', evidence: ['수습기간: 입사일로부터'], probation: 'applies' },
      probation_pay: { status: 'stated', evidence: ['수습기간 중 임금'] },
    },
  },
  {
    key: 'S2_vague',
    title: "'협의', '회사 내규' 등 모호한 문구가 있는 문서",
    docType: 'job_posting',
    text: `[채용] 마케팅 매니저 모집
담당업무: 브랜드 SNS 채널 운영, 콘텐츠 기획
고용형태: 정규직
급여: 회사 내규에 따름 (면접 후 협의)
근무시간: 탄력적 운영, 세부 시간은 협의
근무지: 서울 성동구
수습: 3개월 (수습 기간 급여는 내규에 따름)`,
    expected: {
      salary: { status: 'unclear', evidence: ['급여: 회사 내규'], reason: 'vague_expression', unclear: ['회사 내규에 따름', '면접 후 협의'] },
      work_hours: { status: 'unclear', evidence: ['근무시간'], reason: 'vague_expression', unclear: ['세부 시간은 협의'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['담당업무'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'stated', evidence: ['수습: 3개월'], probation: 'applies' },
      probation_pay: { status: 'unclear', evidence: ['수습: 3개월'], reason: 'vague_expression' },
    },
  },
  {
    key: 'S3_missing',
    title: '주요 조건 일부가 명시되지 않은 문서',
    docType: 'offer',
    text: `안녕하세요, OO컴퍼니 인사팀입니다.
최종 합격을 축하드립니다.
입사 예정일은 11월 3일(월)이며, 백엔드 개발 업무를 맡게 됩니다.
연봉은 4,200만원으로 확정되었습니다.
궁금한 점은 회신 주세요.`,
    expected: {
      salary: { status: 'stated', evidence: ['연봉은'] },
      work_hours: { status: 'not_found' },
      workplace: { status: 'not_found' },
      duties: { status: 'stated', evidence: ['백엔드 개발'] },
      employment_type: { status: 'not_found' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'S4_conflict',
    title: '같은 항목에 상충하는 값이 있는 문서',
    docType: 'job_posting',
    text: `물류센터 사무보조 채용
근무형태: 정규직
근무시간: 09:00~18:00
급여: 월 230만원
업무: 입출고 서류 정리, 재고 데이터 입력
근무지: 경기도 이천시 마장면
[상세 요강]
급여 조건 - 월 210만원 (세전)
근무 시간 - 08:00~17:00, 주 5일`,
    expected: {
      salary: { status: 'unclear', evidence: ['급여: 월 230만원', '급여 조건'], reason: 'conflicting_values' },
      work_hours: { status: 'unclear', evidence: ['근무시간: 09:00', '근무 시간 - 08:00'], reason: 'conflicting_values' },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['업무: 입출고'] },
      employment_type: { status: 'stated', evidence: ['근무형태'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'S5_pdf',
    title: 'PDF에서 복사해 줄바꿈이 불규칙한 문서',
    docType: 'contract',
    text: `표준 근로계약서
근무 장소
부산광역시 해운대구 센텀
중앙로 00
업무의 내용
매장 판매 및 재고
관리
근로시간
10시 00분부터 19시
00분까지 (휴게 1시간)
임금
시간급
10,500원
고용형태 정규직
수습기간 없음`,
    expected: {
      salary: { status: 'stated', evidence: ['임금', '시간급', '10,500원'] },
      work_hours: { status: 'stated', evidence: ['근로시간', '10시 00분부터', '00분까지'] },
      workplace: { status: 'stated', evidence: ['근무 장소', '부산광역시', '중앙로 00'] },
      duties: { status: 'stated', evidence: ['업무의 내용', '매장 판매', '관리'] },
      employment_type: { status: 'stated', evidence: ['고용형태 정규직'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'stated', evidence: ['수습기간 없음'], probation: 'none' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X1_no_probation',
    title: "추가: '수습 없음' 명시",
    docType: 'offer',
    text: `[OO베이커리] 합격 안내
고용형태: 정규직
근무시간: 07:00~16:00 (주 5일, 휴게 1시간)
근무지: 대전 유성구 매장
업무: 제빵 보조 및 매장 관리
월급: 240만원
수습: 해당 없음`,
    expected: {
      salary: { status: 'stated', evidence: ['월급'] },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['업무:'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'stated', evidence: ['수습: 해당 없음'], probation: 'none' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X2_fixed_term_no_period',
    title: '추가: 계약직인데 계약기간 미기재',
    docType: 'job_posting',
    text: `공공기관 행정 지원 계약직 채용
고용형태: 계약직
담당업무: 민원 접수, 문서 정리
근무시간: 09:00~18:00, 주 5일
근무장소: 세종특별자치시 한누리대로
급여: 월 250만원`,
    expected: {
      salary: { status: 'stated', evidence: ['급여'] },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무장소'] },
      duties: { status: 'stated', evidence: ['담당업무'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'fixed_term' },
      contract_period: { status: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X3_intern_word',
    title: "추가: '인턴' 단어가 자격요건에만 등장",
    docType: 'job_posting',
    text: `데이터 분석가 채용 (정규직)
담당업무: 사내 지표 대시보드 구축
자격요건: 관련 인턴 경험자 우대
근무지: 서울 강남구
근무시간: 10:00~19:00
연봉: 4,000만원 이상 (경력에 따라 협의)`,
    expected: {
      salary: { status: 'unclear', evidence: ['연봉'], reason: 'vague_expression', stated: '4,000만원 이상', unclear: ['경력에 따라 협의'] },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['담당업무'] },
      employment_type: { status: 'stated', evidence: ['데이터 분석가 채용'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  // --- S3 계약기간 오판 회귀 샘플: 시작일만 있으면 계약기간 아님, 종료일·기간 길이가 있으면 계약기간 ---
  {
    key: 'X4_start_date_only',
    title: '추가: 근무 시작일만 있고 계약기간은 없음',
    docType: 'contract',
    text: `근로계약서 (요약본)
근무 시작일: 2026년 12월 1일
고용형태: 정규직
근무장소: 인천광역시 연수구 송도과학로 00
업무내용: 물류 시스템 운영 지원
근로시간: 09:00~18:00 (휴게 1시간), 주 5일
월 기본급: 2,800,000원`,
    expected: {
      salary: { status: 'stated', evidence: ['월 기본급'] },
      work_hours: { status: 'stated', evidence: ['근로시간'] },
      workplace: { status: 'stated', evidence: ['근무장소'] },
      duties: { status: 'stated', evidence: ['업무내용'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X5_contract_end_date',
    title: '추가: 시작일과 종료일이 있는 계약기간',
    docType: 'offer',
    text: `[OO리서치] 연구보조원 합격 안내
고용형태: 계약직(기간제)
계약 기간은 2026년 11월 10일부터 2027년 5월 9일까지입니다.
근무시간: 10:00~17:00, 주 5일
근무지: 광주광역시 북구 첨단과기로
업무: 설문 데이터 정리 및 입력
급여: 월 230만원`,
    expected: {
      salary: { status: 'stated', evidence: ['급여'] },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['업무:'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'fixed_term' },
      contract_period: { status: 'stated', evidence: ['계약 기간은'] },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X6_contract_duration_only',
    title: '추가: 기간 길이(6개월)로 적힌 계약기간',
    docType: 'job_posting',
    text: `행사 운영 스태프 모집
채용형태: 계약직
근무 기간: 6개월 (2027년 1월 4일 입사)
근무시간: 평일 09:00~18:00
근무지: 서울 송파구 올림픽로
담당업무: 행사장 안내 및 운영 보조
시급: 11,000원`,
    expected: {
      salary: { status: 'stated', evidence: ['시급'] },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['담당업무'] },
      employment_type: { status: 'stated', evidence: ['채용형태'], employment: 'fixed_term' },
      contract_period: { status: 'stated', evidence: ['근무 기간: 6개월'] },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },
  {
    key: 'X7_salary_range_negotiable',
    title: '추가: 연봉 범위와 협의가 함께 적힌 급여',
    docType: 'job_posting',
    text: `[채용] 백엔드 개발자 (가상 예시)
담당업무: 결제 서버 API 개발 및 운영
고용형태: 정규직
근무지: 서울 강남구 테헤란로
근무시간: 월~금 10:00~19:00
급여 연봉 3000만원 ~ 5,000만원
(경력에 따라 협의, 인센티브 별도)`,
    expected: {
      salary: {
        status: 'unclear', evidence: ['급여 연봉', '(경력에 따라 협의'], reason: 'vague_expression',
        stated: '연봉 3000만원 ~ 5,000만원', unclear: ['경력에 따라 협의'],
      },
      work_hours: { status: 'stated', evidence: ['근무시간'] },
      workplace: { status: 'stated', evidence: ['근무지'] },
      duties: { status: 'stated', evidence: ['담당업무'] },
      employment_type: { status: 'stated', evidence: ['고용형태'], employment: 'permanent' },
      contract_period: { status: 'hidden', presence: 'not_found' },
      probation_period: { status: 'hidden', presence: 'not_found' },
      probation_pay: { status: 'hidden', presence: 'not_found' },
    },
  },  {
    key: 'X9_real_offer',
    title: '추가: 실제 오퍼 안내문 (사용자 제공 캡처 2장의 글자, 이름은 [이름])',
    docType: 'offer',
    text: `(주)그린테크놀로지 기술로 더 나은 일상을 만듭니다.
채용(오퍼) 안내문
안녕하세요, [이름]님.
그린테크놀로지에 지원해 주셔서 감사합니다.
최종 면접 결과, [이름]님의 합격을 진심으로 축하드리며
아래와 같이 주요 근로조건을 안내드립니다.
자세한 사항은 근로계약서 작성 시 최종 확정되며,
일부 내용은 내부 규정에 따라 변경될 수 있습니다.
1. 채용 직무 및 소속
직무 서비스 기획자
소속 서비스기획팀
고용형태 정규직 (수습기간 3개월)
입사 예정일 2026년 11월 1일 (예정)
* 세부 일정은 추후 개별 안내 예정입니다.
2. 주요 업무
신규 서비스 기획 및 기존 서비스 개선
사용자 조사 및 데이터 분석을 통한 인사이트 도출
유관 부서와의 협업 및 프로젝트 운영
3. 근로조건 (예정)
연봉 4,000만원
(기본급 및 고정수당 포함, 인센티브 별도)
근무시간 주 5일 (월~금) 10:00 ~ 19:00
(점심시간 13:00 ~ 14:00)
근무장소 서울특별시 강남구 테헤란로 123, 그린테크놀로지 본사
(역삼역 도보 5분)
계약기간 기간의 정함이 없는 근로계약
수습기간 중 급여 월 300만원 (세전)
(수습기간 3개월)
4. 복리후생
4대 보험 가입
건강검진 지원
연차 및 반차 자유 사용
명절 선물 및 경조사비 지원
점심 식대 지원
자율 복장 근무
최신 업무 장비 제공
사내 스낵바 및 커피 무제한
5. 기타 안내사항
본 안내문은 근로계약 체결 전 제공되는 것으로, 근로계약서 작성 시 일부 내용이
변경될 수 있습니다.
입사에 필요한 제출 서류 및 세부 일정은 추후 별도로 안내드립니다.
궁금한 사항이 있으시면 채용담당자(채용팀, 02-1234-5678)에게 문의해 주세요.
2026년 10월 8일
(주)그린테크놀로지 채용팀 드림`,
    expected: {
      salary: { status: 'stated', evidence: ['연봉 4,000만원', '(기본급 및 고정수당'] },
      work_hours: { status: 'stated', evidence: ['근무시간 주 5일', '(점심시간'] },
      workplace: { status: 'stated', evidence: ['근무장소 서울특별시', '(역삼역'] },
      duties: { status: 'stated', evidence: ['직무 서비스 기획자', '신규 서비스 기획', '사용자 조사', '유관 부서'] },
      employment_type: { status: 'stated', evidence: ['고용형태 정규직'], employment: 'permanent' },
      contract_period: { status: 'stated', evidence: ['계약기간 기간의 정함이'] },
      probation_period: { status: 'stated', evidence: ['고용형태 정규직 (수습기간', '(수습기간 3개월)'], probation: 'applies' },
      probation_pay: { status: 'stated', evidence: ['수습기간 중 급여'] },
    },
  },
];
