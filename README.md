# 일단확인 (MVP)

구직자가 채용공고, 오퍼 안내, 근로계약서에 적힌 주요 근로조건을 항목별로 확인하는 웹앱입니다.
문서의 **기재 상태**와 **원문 근거**만 보여 주며, 법률 위반 여부·기업 신뢰도·향후 조건 변경 가능성은 판단하지 않습니다.

## 실행 방법

Node.js 20 이상이 필요합니다.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # 서버에서만 사용, 브라우저로 전달되지 않음
npm start                             # http://localhost:3000
```

- `ANTHROPIC_API_KEY`가 없거나 `DEMO_MODE=1`이면 **데모 모드**로 실행됩니다. 데모 모드는 AI 대신 키워드 규칙을 쓰며, 화면 상단에 '데모 모드'가 표시됩니다. 흐름 확인용이며 정확도는 낮습니다.
- 선택 환경변수: `PORT`(기본 3000), `ANTHROPIC_MODEL`(기본 `claude-opus-5-5`), `ANTHROPIC_EFFORT`(기본 `medium`).

## 테스트

```bash
npm test             # 단위·통합 테스트 (AI 호출 없음)
npm run report       # 샘플 8종을 데모 분석기로 실행 → docs/test-report-demo.md
npm run eval:live    # 샘플 8종을 Claude API로 실행 → docs/test-report-live.md (API 키 필요, 비용 발생)
```

## 구조

```
server.js              HTTP 서버 (정적 파일 + POST /api/analyze)
src/items.js           8개 항목, 문서 유형, 화면 상태·문구 정의
src/segment.js         원문 → 번호가 붙은 줄 단위(위치 정보 보존)
src/ai/prompt.js       AI 지시문, 구조화 응답 JSON 스키마
src/ai/claude.js       Claude API 호출 (structured outputs, 거절 시 서버 측 fallback)
src/ai/demo.js         데모용 키워드 규칙 분석기
src/validate.js        AI 응답 서버 검증
src/analyze.js         분할 → AI → 검증 → 실패 항목 1회 재분석 → 화면용 결과
src/present.js         화면 상태·표시 여부·안내 문구 결정
src/eval/score.js      기대/실제 상태, 근거 번호 정확성, 잘못된 not_found 채점
public/                화면 01(입력) · 02(결과) · 03(원문 상세)
test/                  테스트와 샘플 문서
scripts/run-samples.js 샘플 결과 기록
```

## 동작 요약

1. 원문을 줄 단위로 나누고 번호를 붙입니다. 원문과 위치는 그대로 보존하며, 마침표가 없다는 이유로 줄을 합치지 않습니다. 100자를 넘는 한 줄만 문장 경계에서 나눕니다.
2. AI에는 번호가 붙은 텍스트를 보내고, 항목마다 `presence` / `specificity` / `reason_code` / `evidence_ids`(와 `probation_status`, `employment_category`)만 받습니다.
3. 서버가 응답을 검증합니다(항목 누락·중복, found인데 근거 없음, not_found인데 근거 있음, 존재하지 않는 번호, vague인데 사유 없음 등). 실패한 항목만 오류 내용을 알려 주고 한 번 재분석하며, 그래도 실패하면 그 항목만 `분석 확인 불가`로 표시합니다. 검증 실패를 `찾지 못함`으로 바꾸지 않습니다.
4. 화면 상태와 표시 여부는 앱이 결정하고, 근거는 앱이 보존한 원문을 번호로 찾아 그대로 보여 줍니다.

## 개인정보

- 입력 화면에 "입력한 내용은 분석을 위해 AI 서비스로 전송돼요. 이름·주민등록번호·주소 등 개인정보는 가린 뒤 입력해 주세요."를 표시합니다.
- 서버는 원문을 저장하지 않고, 로그에는 항목 ID·오류 코드·단위 개수만 남깁니다. 브라우저도 원문·결과를 저장소에 남기지 않습니다(새로고침하면 사라짐).
- 보관·삭제 기간에 대한 문구는 API 제공업체의 데이터 처리 정책을 확인한 뒤 확정해야 하므로, 현재 화면에는 넣지 않았습니다.
