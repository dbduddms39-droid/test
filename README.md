# 일단확인 (MVP)

구직자가 채용공고, 오퍼 안내, 근로계약서에 적힌 주요 근로조건을 항목별로 확인하는 웹앱입니다.
문서의 **기재 상태**와 **원문 근거**만 보여 주며, 법률 위반 여부·기업 신뢰도·향후 조건 변경 가능성은 판단하지 않습니다.

## 실행 방법

Node.js 20 이상이 필요합니다. AI 분석은 **Google Gemini API 무료 등급**(`gemini-3.5-flash-lite`)을 사용하며, 유료 모델로 자동 전환하지 않습니다.

```bash
npm install
# GEMINI_API_KEY 는 서버 환경변수로만 등록합니다 (코드·채팅·브라우저에 넣지 않음).
npm start                 # 실제 AI 분석, http://localhost:3000
npm run demo              # DEMO_MODE=true — 키워드 규칙 데모 (AI 아님)
```

- 키 발급: Google AI Studio(https://aistudio.google.com/apikey)에서 **결제 수단을 연결하지 않은 프로젝트**로 발급하면 무료 등급으로만 동작합니다. 결제(billing)를 켜면 유료 요금이 적용될 수 있으니 켜지 마세요.
- `GEMINI_API_KEY`가 없으면 데모로 바뀌지 않고, 분석 요청에 "AI 분석이 아직 설정되지 않았어요" 오류를 안내합니다.
- 데모 모드는 `DEMO_MODE=true`를 명시했을 때만 켜집니다. 데모 결과는 헤더 배지와 결과 화면 안내로 AI 결과와 구분됩니다.
- 무료 사용량 한도(HTTP 429)에 도달하면 "AI 무료 사용량 한도에 도달했어요"를 안내합니다.

### 이미지·PDF 업로드

- 입력 화면에서 **캡처 이미지 최대 5장**(JPG·PNG·WebP) 또는 **PDF 1개**를 올릴 수 있습니다 (파일당 10MB, PDF 10쪽, 스캔된 쪽 5쪽까지). 여러 문서를 동시에 비교하는 기능은 없습니다.
- 여러 장의 이미지는 **같은 문서의 연속 캡처**로 봅니다. 미리보기·개별 삭제·순서 변경(위로/아래로) 후 '텍스트 추출'을 누르면 정한 순서대로 한국어·영어 글자를 인식해 하나의 편집 가능한 문서로 합칩니다. 일부 이미지가 실패하면 나머지는 합치고 실패한 장을 표시합니다.
- **파일은 브라우저 안에서만 처리하고 서버로 보내지 않습니다.** 일반 PDF는 pdf.js로 텍스트를 추출하고, 이미지와 스캔 PDF 쪽은 Tesseract.js로 OCR 합니다. 어두운 배경 위 밝은 글자(앱 캡처의 색 머리글 등)는 해당 줄만 반전해 인식합니다.
- 추출 결과는 입력란에 채워지고 **자동으로 분석하지 않습니다.** 추출 텍스트로 분석하려면 '원본과 비교해 확인·수정했어요'를 체크해야 하며, 확인한 텍스트만 기존 분석 API로 전송됩니다. 결과·상세 화면에는 '추출·확인한 텍스트 기준'임을 표시합니다.
- 형식 오류·인식 실패·일부 실패·바꾸기 취소 때 이미 입력한 내용과 이미지 목록은 그대로 둡니다.
- 라이브러리와 언어 데이터는 외부 CDN이 아니라 같은 사이트의 `public/vendor/`에서 제공합니다 (처음 업로드할 때만 내려받음: PDF 약 2MB, OCR 약 8.5MB). `public/vendor/`는 `npm run vendor`로 `node_modules`에서 복사해 커밋한 파일입니다. Vercel은 빌드 스크립트보다 먼저 `public/`을 정적 파일로 수집하므로 빌드 때 생성하지 않고 커밋해 둡니다.
- 한계: OCR은 사진 품질·글꼴·기울기에 따라 오타가 생깁니다 (예: 테스트에서 '센텀중앙로'를 'MESURE'로, 'OO'를 '00'으로 인식). 표 테두리가 '_' 같은 기호로 섞일 수 있고, 여러 단 배치는 줄 순서가 섞일 수 있습니다. 연속 캡처가 겹치면 겹친 줄이 두 번 들어가므로 직접 지워야 합니다. 처음 OCR 때 내려받는 데이터 때문에 느린 네트워크·저사양 휴대폰에서는 시간이 걸립니다. 암호가 걸린 PDF는 열지 않습니다.

### 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | (없음) | Gemini API 키. 서버에서만 읽음 |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | 사용할 모델 |
| `DEMO_MODE` | (꺼짐) | `true`일 때만 데모 분석기 사용 |
| `AI_TIMEOUT_MS` | `60000` | AI 호출 1회 제한 시간 |
| `RATE_LIMIT_PER_IP` / `RATE_LIMIT_WINDOW_MS` | `5` / `60000` | IP별 요청 제한 |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | `4` | 서버 전체 분당 분석 수 |
| `RATE_LIMIT_GLOBAL_PER_DAY` | `100` | 서버 전체 하루(UTC) 분석 수 |
| `TRUST_PROXY` | (꺼짐) | `true`면 `X-Forwarded-For`로 IP 판단 (프록시 뒤에서만) |
| `PORT` | `3000` | 포트 |

분석 1건은 검증 실패 시 AI를 최대 2번 호출합니다. 요청 제한 기본값은 무료 등급 한도의 절반 이하가 되도록 잡았지만, 무료 한도는 Google이 바꿀 수 있으므로 AI Studio에서 현재 한도를 확인한 뒤 조정하세요. 요청 제한은 메모리 기반이라 서버를 재시작하면 초기화됩니다.

## 테스트

```bash
npm test             # 단위·통합 테스트 (실제 AI 호출 없음)
npm run report       # 샘플 8종을 데모 분석기로 실행 → docs/test-report-demo.md
npm run eval:live    # 샘플 8종을 실제 Gemini API로 실행 → docs/test-report-live.md (GEMINI_API_KEY 필요)
npm run eval:live -- --samples=S2_vague   # 일부 샘플만 실행 (무료 사용량 절약)
```

샘플은 모두 가상 문서입니다. 무료 등급 API에는 실제 개인정보가 담긴 문서를 넣지 마세요.

### GitHub Actions에서 실제 Gemini 연결 테스트

`.github/workflows/gemini-live-test.yml` — 수동 실행 전용. 저장소 Secrets의 `GEMINI_API_KEY`로 가상 문서 샘플 8건 전체를 앱 기본 모델과 같은 `gemini-3.5-flash-lite`로 분석하고, 보고서(`gemini-live-report`)를 아티팩트로 올립니다.
실행: 저장소 **Actions** 탭 → 왼쪽 **Gemini live test** → **Run workflow** → (선택) `samples`에 `S3_missing`처럼 샘플 키 입력 → **Run workflow**.

### 브라우저 사용자 흐름 확인 (E2E)

`.github/workflows/web-e2e.yml` — 수동 실행 전용. 러너에서 웹 서버를 띄우고 실제 브라우저로 문서 유형 선택 → 가상 채용공고 붙여넣기 → 분석 시작 → 8개 항목 결과 → 원문 근거 확인을 진행합니다. 브라우저로 전달된 응답·페이지·서버 로그에 API 키가 없는지도 검사하고, 화면 캡처를 `web-e2e-screenshots` 아티팩트로 올립니다.
로컬: `DEMO_MODE=true node scripts/e2e-browser.mjs` (키 없이 흐름만, 데모 결과)

업로드 흐름은 `scripts/e2e-upload.mjs`가 가상 문서 파일(`test/fixtures/upload/`, 생성: `scripts/make-upload-fixtures.mjs`)로 일반 PDF·한국어 이미지(PNG·WebP·사진형 JPG)·스캔 PDF·연속 캡처 3장 추출 정확도, 여러 장 미리보기·삭제·순서 변경, 일부 실패, 입력 내용 유지, 확인 체크, 수정한 텍스트의 분석 전달, 오류 안내(암호화·쪽수 초과·형식 오류·손상·10MB 초과), 외부 전송 없음을 검사합니다. 워크플로 입력 `base_url`에 배포 주소를 넣으면 배포된 사이트를 대상으로 검사합니다.
로컬: `DEMO_MODE=true node scripts/e2e-upload.mjs`

### Vercel 배포 (Hobby 무료 플랜)

- Vercel이 루트의 `server.js`를 감지해 Node 서버리스 함수(Node 22)로 실행하고, `public/` 파일은 정적 파일로도 제공합니다. `server.js`는 Vercel용으로 `(req, res)` 핸들러를 default export 합니다 (로컬 `node server.js` 실행 방식은 그대로).
- **`/`(메인 화면)는 함수가 처리합니다.** 빌드 결과에서 함수가 `functions/index.func`(경로 `/`)라서 정적 `index.html`보다 함수가 먼저 받습니다. 그래서 함수 번들에 `public/index.html`이 있어야 합니다. `vercel.json`은 함수 번들에서 **`public/vendor/**`(약 20MB)만** 제외합니다. `public/**` 전체를 제외하면 배포 사이트의 `/`가 `{"error":"not found"}`가 됩니다 (실제로 겪은 장애, `test/vendor.test.js`가 막음).
- `/app.js`, `/styles.css`, `/vendor/...` 같은 나머지 파일은 정적 파일로 제공됩니다.
- Vercel 프로젝트의 **Settings → Environment Variables**에 `GEMINI_API_KEY`를 등록합니다. `NEXT_PUBLIC_` 같은 접두사를 붙이지 않습니다. `DEMO_MODE`는 등록하지 않습니다.
- 요청 제한은 함수 인스턴스 메모리에 저장되므로 인스턴스마다 따로 세고, 인스턴스가 바뀌면 초기화됩니다. 무제한 호출을 완전히 막지 못하며, 최종 상한은 Gemini 무료 등급 한도(HTTP 429)입니다. 결제가 연결되지 않은 키라면 한도 초과 시 요금이 아니라 분석 불가로 끝납니다.
- Vercel에서는 `X-Forwarded-For`의 첫 IP로 사용자를 구분합니다 (`VERCEL=1`일 때 자동).

배포 점검:
- **Vercel build check** 워크플로: 배포 관련 파일이 바뀌어 푸시되면 공식 CLI로 `vercel build`(계정 불필요)를 실행하고 `scripts/check-vercel-output.mjs`로 `/`·정적 파일·API를 확인합니다.
- **Deploy smoke test** 워크플로: 수동 실행, `base_url`에 배포 주소를 넣으면 새로고침(`/`), 정적·vendor 파일, `/api/config`, `/api/analyze`(가상 문서 1건)를 확인합니다. 로컬: `node scripts/smoke-deployed.mjs https://배포주소`

### 웹앱 서버에 키 등록

GitHub Actions Secrets는 Actions 실행에만 쓰이고, 웹앱을 배포한 서버에는 자동으로 들어가지 않습니다. 웹앱을 실행하는 서버(호스팅 서비스)의 **환경변수 설정**에 `GEMINI_API_KEY`를 따로 등록하세요. 키는 서버 프로세스만 읽고(`src/ai/gemini.js`), 브라우저로 보내는 응답(`/api/config`, `/api/analyze`, 정적 파일)에는 포함되지 않습니다. 코드·`.env` 커밋·프런트엔드 파일에 키를 넣지 마세요.

## 구조

```
server.js              HTTP 서버 (정적 파일 + POST /api/analyze)
src/items.js           8개 항목, 문서 유형, 화면 상태·문구 정의
src/segment.js         원문 → 번호가 붙은 줄 단위(위치 정보 보존)
src/ai/prompt.js       AI 지시문, 구조화 응답 JSON 스키마
src/ai/gemini.js       Gemini API 호출 (구조화 JSON 응답, 타임아웃, fallback 없음)
src/ai/errors.js       AI 오류 코드 (키 없음·한도 초과·타임아웃은 재분석하지 않음)
src/rateLimit.js       IP별·서버 전체 요청 제한
src/ai/demo.js         데모용 키워드 규칙 분석기
src/validate.js        AI 응답 서버 검증
src/analyze.js         분할 → AI → 검증 → 실패 항목 1회 재분석 → 화면용 결과
src/present.js         화면 상태·표시 여부·안내 문구 결정
src/eval/score.js      기대/실제 상태, 근거 번호 정확성, 잘못된 not_found 채점
public/                화면 01(입력) · 02(결과) · 03(원문 상세)
public/extract.js      파일 → 텍스트 추출 (pdf.js, Tesseract.js OCR, 브라우저 안에서만)
public/upload-rules.js 업로드 제한·형식 판별·안내 문구 (Node 테스트와 공용)
public/vendor/         pdf.js·Tesseract.js·언어 데이터 (npm run vendor로 생성해 커밋)
vercel.json            Vercel 함수 번들에서 public/vendor/만 제외 (메인 화면은 함수가 제공)
scripts/check-vercel-output.mjs  vercel build 결과 점검 (정적 파일·함수 번들·/ ·API)
scripts/smoke-deployed.mjs       실제 배포 주소 점검 (새로고침·정적 파일·API)
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
- 업로드한 파일은 서버로 전송하지 않고 브라우저 메모리에서만 처리합니다. Tesseract.js는 언어 데이터(문서 내용 아님)만 브라우저 저장소(IndexedDB)에 캐시합니다.
- 보관·삭제 기간에 대한 문구는 API 제공업체의 데이터 처리 정책을 확인한 뒤 확정해야 하므로, 현재 화면에는 넣지 않았습니다.
- Gemini API **무료 등급**은 유료 등급과 데이터 처리 조건이 다를 수 있습니다(제출 내용이 Google 서비스 개선에 쓰일 수 있음). Gemini API 추가 약관을 확인하기 전까지는 가상 문서로만 테스트하세요.
