# 점검 기준 v2.2 실행 보고서 (데모 분석기 — AI 아님, 키워드 규칙)

- 실행 시각: 2026-10-09T12:37:27.691Z
- 문서: F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11 (모두 가상 문서)
- API 호출: 11회, 성공 11회
- **기획상 기대 판정(오라클)은 사람이 작성한 값이다. 아래 일치율은 이번 실행의 측정값이며 모델 정확도나 법률 타당성의 검증 완료를 뜻하지 않는다.**
- OCR 저신뢰 메타데이터(F05 `1O0`, F08 `2O`, F11 `1O`)는 테스트 전제로 명시해 넣었다.
- 보고서에는 문서 원문과 인용 구절을 넣지 않는다.

## 요약: 상위 85/110칸 일치, 오라클에 명시된 세부 93/132칸 일치

| 문서 | 기대(오라클) | 실제 실행 | 상위 일치 | 보류·재분석한 항목 |
|---|---|---|---|---|
| F01 | F F F F F F F F F F | P F F F F F P - F F | 7/10 | 없음 |
| F02 | P P P P P M P - M P | P P P F P M P - M P | 9/10 | 없음 |
| F03 | F F F F F F F - P F | F P F F F F F - P F | 9/10 | 없음 |
| F04 | F F F P F P F - P F | F F F M F P F - P F | 9/10 | 없음 |
| F05 | P F U F F P F F F P | F P U F F F P - F F | 4/10 | 없음 |
| F06 | F P P F F P F F P P | P P F P F P F F F P | 6/10 | 없음 |
| F07 | P P P F P P P - P F | P P P F P P P - P F | 10/10 | 없음 |
| F08 | F F F F F F F F F F | F F F F F F F F F F | 10/10 | 없음 |
| F09 | F F P F F F F F P P | P P F F F F P - P P | 5/10 | 없음 |
| F10 | F F F F F F F - F F | F F F F F F F - P F | 9/10 | 없음 |
| F11 | F F P F F P P - F U | P F P F F P P - P P | 7/10 | 없음 |

상태 약어: F=주요 내용 기재됨, P=일부 내용만 기재됨, M=관련 내용 찾지 못함, U=분석 확인 불가, -=08 미표시

## 세부기준 (오라클에 명시된 칸만)

### F01 정보가 구체적인 정규직 근로계약서

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | CONFIRMED | UNCLEAR | X |  |
| 01-b | CONFIRMED | CONFIRMED | O |  |
| 02-a | CONFIRMED | CONFIRMED | O |  |
| 03-a | CONFIRMED | CONFIRMED | O |  |
| 04-a | CONFIRMED | CONFIRMED | O |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | CONFIRMED | CONFIRMED | O |  |
| 06-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |
| 07-a | CONFIRMED | UNCLEAR | X |  |
| 07-b | CONFIRMED | UNCLEAR | X |  |
| 08-a | CONFIRMED | (미표시) | X |  |
| 09-a | CONFIRMED | CONFIRMED | O |  |
| 09-b | CONFIRMED | CONFIRMED | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | CONFIRMED | CONFIRMED | O |  |

진단: 없음

### F02 미확정 표현이 많은 채용공고

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | UNCLEAR | UNCLEAR | O |  |
| 01-b | CONFIRMED | UNCLEAR | X |  |
| 02-a | PARTIAL | PARTIAL | O |  |
| 02-b | CONFIRMED | CONFIRMED | O |  |
| 03-a | PARTIAL | UNCLEAR | X |  |
| 04-a | PARTIAL | CONFIRMED | X |  |
| 05-a | UNCLEAR | UNCLEAR | O |  |
| 06-a | MISSING | MISSING | O |  |
| 07-a | UNCLEAR | UNCLEAR | O |  |
| 09-a | MISSING | MISSING | O |  |
| 10-a | PARTIAL | PARTIAL | O |  |
| 10-b | MISSING | MISSING | O |  |

진단: 없음

### F03 기간제·단시간 근로계약서

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | CONFIRMED | CONFIRMED | O |  |
| 01-b | CONFIRMED | CONFIRMED | O |  |
| 02-a | CONFIRMED | PARTIAL | X |  |
| 02-d | CONFIRMED | CONFIRMED | O |  |
| 03-a | CONFIRMED | CONFIRMED | O |  |
| 04-a | CONFIRMED | CONFIRMED | O |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | CONFIRMED | CONFIRMED | O |  |
| 06-b | CONFIRMED | CONFIRMED | O |  |
| 07-a | CONFIRMED | CONFIRMED | O |  |
| 07-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |
| 09-a | PARTIAL | PARTIAL | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |

진단: 02-a:hours_not_quoted

### F04 부정 표현이 포함된 소규모 사업장 오퍼

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | CONFIRMED | CONFIRMED | O |  |
| 01-b | CONFIRMED | CONFIRMED | O |  |
| 01-e | MISSING | MISSING | O |  |
| 02-a | CONFIRMED | CONFIRMED | O |  |
| 03-a | CONFIRMED | CONFIRMED | O |  |
| 04-a | PARTIAL | MISSING | X |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | UNCLEAR | UNCLEAR | O |  |
| 07-a | CONFIRMED | CONFIRMED | O |  |
| 07-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |
| 09-a | PARTIAL | PARTIAL | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |

진단: 없음

### F05 금액 충돌과 OCR 불확실성이 섞인 스캔 추출본

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | UNCLEAR | CONFIRMED | X |  |
| 01-b | CONFIRMED | CONFIRMED | O |  |
| 02-a | CONFIRMED | PARTIAL | X |  |
| 02-b | CONFIRMED | CONFIRMED | O |  |
| 02-c | CONFIRMED | CONFIRMED | O |  |
| 03-a | UNAVAILABLE | UNAVAILABLE | O |  |
| 04-a | CONFIRMED | CONFIRMED | O |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | CONFIRMED | CONFIRMED | O |  |
| 06-b | PARTIAL | CONFIRMED | X |  |
| 07-a | CONFIRMED | UNCLEAR | X |  |
| 07-b | CONFIRMED | UNCLEAR | X |  |
| 08-a | CONFIRMED | (미표시) | X |  |
| 09-a | CONFIRMED | CONFIRMED | O |  |
| 09-b | MISSING | CONFIRMED | X |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | PARTIAL | CONFIRMED | X |  |

진단: 없음

### F06 주 4.5일제·판교 오피스·수습급여 동일 (채용공고)

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | CONFIRMED | UNCLEAR | X |  |
| 01-b | CONFIRMED | UNCLEAR | X |  |
| 01-f | UNCLEAR | UNCLEAR | O |  |
| 02-a | PARTIAL | UNCLEAR | X |  |
| 02-b | UNCLEAR | MISSING | X |  |
| 03-a | PARTIAL | CONFIRMED | X |  |
| 04-a | CONFIRMED | UNCLEAR | X |  |
| 04-b | UNCLEAR | UNCLEAR | O |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | UNCLEAR | UNCLEAR | O |  |
| 07-a | CONFIRMED | CONFIRMED | O |  |
| 07-b | CONFIRMED | CONFIRMED | O |  |
| 08-a | CONFIRMED | CONFIRMED | O |  |
| 09-a | PARTIAL | CONFIRMED | X |  |
| 10-a | CONFIRMED | CONFIRMED | O | PARTIAL |
| 10-b | MISSING | MISSING | O |  |

진단: 없음

### F07 선택지·조건부 수습·미확정 항목 (합격 오퍼)

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | UNCLEAR | UNCLEAR | O |  |
| 01-b | CONFIRMED | UNCLEAR | X |  |
| 02-a | PARTIAL | PARTIAL | O |  |
| 02-b | CONFIRMED | CONFIRMED | O |  |
| 02-c | UNCLEAR | CONFIRMED | X |  |
| 03-a | UNCLEAR | UNCLEAR | O |  |
| 04-a | CONFIRMED | CONFIRMED | O |  |
| 05-a | PARTIAL | UNCLEAR | X |  |
| 06-a | UNCLEAR | CONFIRMED | X |  |
| 07-a | UNCLEAR | UNCLEAR | O |  |
| 09-a | PARTIAL | PARTIAL | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | CONFIRMED | CONFIRMED | O |  |

진단: 없음

### F08 핵심은 확실하지만 추가 지급일만 OCR 저신뢰 (스캔 추출본)

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-a | CONFIRMED | CONFIRMED | O |  |
| 01-b | CONFIRMED | CONFIRMED | O |  |
| 01-f | UNAVAILABLE | MISSING | X |  |
| 02-a | CONFIRMED | CONFIRMED | O |  |
| 03-a | CONFIRMED | CONFIRMED | O |  |
| 04-a | CONFIRMED | CONFIRMED | O |  |
| 05-a | CONFIRMED | CONFIRMED | O |  |
| 06-a | CONFIRMED | CONFIRMED | O |  |
| 06-b | CONFIRMED | CONFIRMED | O |  |
| 07-a | CONFIRMED | CONFIRMED | O |  |
| 07-b | CONFIRMED | CONFIRMED | O |  |
| 08-a | CONFIRMED | CONFIRMED | O |  |
| 09-a | CONFIRMED | CONFIRMED | O |  |
| 09-b | CONFIRMED | CONFIRMED | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | CONFIRMED | CONFIRMED | O |  |

진단: 없음

### F09 채용공고 — 격주 근무·사옥 층수·연차 차등 부여

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 01-e | PARTIAL | UNCLEAR | X | UNCLEAR |
| 02-a | CONFIRMED | PARTIAL | X |  |
| 08-a | CONFIRMED | (미표시) | X |  |
| 08-b | CONFIRMED | (미표시) | X |  |
| 09-a | PARTIAL | PARTIAL | O |  |
| 10-a | CONFIRMED | UNCLEAR | X |  |
| 10-b | PARTIAL | MISSING | X | UNCLEAR |

진단: 02-c:D04_break_negation_note_undecided, 09-a:rest_day_not_designated_holiday

### F10 근로계약서 — 단시간·근무 일정의 부정문·휴가 미부여

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 07-a | CONFIRMED | CONFIRMED | O |  |
| 07-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |
| 10-a | CONFIRMED | CONFIRMED | O |  |
| 10-b | NOT_APPLICABLE | NOT_APPLICABLE | O |  |

진단: 02-c:D04_break_negation_note_undecided

### F11 오퍼 안내 — 불확정 조건·핵심 연차 숫자 OCR 불명

| 세부기준 | 기대 | 실제 | 일치 | 원래 오라클(다른 경우) |
|---|---|---|---|---|
| 06-a | CONFIRMED | UNCLEAR | X |  |
| 06-b | UNCLEAR | MISSING | X |  |
| 07-a | UNCLEAR | UNCLEAR | O |  |
| 10-a | CONFIRMED | UNCLEAR | X |  |
| 10-b | UNAVAILABLE | MISSING | X |  |

진단: 없음

## API 호출 기록

- 호출 1 (F01, 세부기준 32개): 성공
- 호출 2 (F02, 세부기준 32개): 성공
- 호출 3 (F03, 세부기준 32개): 성공
- 호출 4 (F04, 세부기준 32개): 성공
- 호출 5 (F05, 세부기준 32개): 성공
- 호출 6 (F06, 세부기준 32개): 성공
- 호출 7 (F07, 세부기준 32개): 성공
- 호출 8 (F08, 세부기준 32개): 성공
- 호출 9 (F09, 세부기준 32개): 성공
- 호출 10 (F10, 세부기준 32개): 성공
- 호출 11 (F11, 세부기준 32개): 성공
