// 기록 결과 화면에 표시할 분류와 대표 원문 근거.
// 분석 결과·질문 생성 규칙은 변경하지 않는다.
import { weeklyCalc, externallyReferencedLeave } from './followups.js';

// 직접 쓰인 주 소정근로시간이 없어도 검증된 근무일·시각·휴게시간으로
// 주간 시간을 계산할 수 있으면 질문 유무보다 '계산값' 분류를 우선한다.
// 확인할 질문은 기존 카드 안에 계속 표시한다.
export function contractSummaryGroup(t, hasQuestion = false) {
  if (!t || t.status === 'MAIN_UNAVAILABLE') return null;
  if (weeklyCalc(t)) return 'calculated';
  if (hasQuestion) return 'needs';
  return t.status === 'MAIN_FOUND' ? 'written' : 'needs';
}

// 수습 적용 여부의 제목('수습기간 및 수습 중 임금')보다
// 실제 수습기간이 적힌 검증된 원문('입사 후 3개월')을 우선 보여 준다.
// 원문에 없는 시작·종료일을 인용처럼 만들지 않는다.
export function summaryEvidence(t) {
  if (!t?.criteria) return null;
  const duration = t.id === '07'
    ? t.criteria.find((c) => c.id === '07-b' && c.status === 'CONFIRMED' && c.evidence?.length)
    : null;
  const selected = duration
    ?? t.criteria.find((c) => c.required && c.evidence?.length)
    ?? t.criteria.find((c) => c.evidence?.length);
  return selected?.evidence?.[0] ?? null;
}

export { externallyReferencedLeave } from './followups.js';
