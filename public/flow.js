// 화면 이동·입력 확인 규칙. DOM에 의존하지 않아 node 테스트에서 그대로 검사한다.
// 라우트(해시)에는 화면 이름과 항목 ID만 들어간다. 문서 내용·파일 이름은 넣지 않는다.

export const MIN_CHARS = 20;      // 분석 시작에 필요한 최소 글자 수 (앞뒤 공백 제외)
export const MAX_CHARS = 20_000;  // 서버 제한과 같음

export const ROUTES = {
  landing: '#/',
  input: '#/input',
  review: '#/review',
  analyzing: '#/analyzing',
  result: '#/result',
  error: '#/error',
  detail: (id) => `#/detail/${id}`,
};

// 입력 텍스트 상태: 분석 버튼 활성 여부와 안내 문구
export function checkText(text) {
  const len = (text ?? '').trim().length;
  if (len === 0) return { ok: false, code: 'empty' };
  if ((text ?? '').length > MAX_CHARS) return { ok: false, code: 'too_long' };
  if (len < MIN_CHARS) return { ok: false, code: 'too_short' };
  return { ok: true, code: null };
}

// 입력 출처 → 내용을 확인·수정하는 화면. 직접 입력은 S-02, 파일 추출(PDF·OCR)은 S-03.
export const editRouteFor = (inputSource) => (inputSource === 'paste' ? ROUTES.input : ROUTES.review);

// 해시 → 보여 줄 화면. 필요한 데이터가 없으면 다른 화면으로 보낸다(redirect).
// state: { hasResult, hasReview, analyzing, hasError, detailExists(id) }
export function resolveRoute(hash, state) {
  const h = hash || '#/';
  if (h === '#/' || h === '#') return { view: 'landing' };
  if (h === ROUTES.input) return { view: 'input' };
  if (h === ROUTES.review) return state.hasReview ? { view: 'review' } : { redirect: ROUTES.input, notice: 'no_review' };
  if (h === ROUTES.analyzing) {
    if (state.analyzing) return { view: 'analyzing' };
    return state.hasResult ? { redirect: ROUTES.result } : { redirect: ROUTES.input, notice: 'no_result' };
  }
  if (h === ROUTES.error) return state.hasError ? { view: 'error' } : { redirect: ROUTES.input };
  if (h === ROUTES.result) return state.hasResult ? { view: 'result' } : { redirect: ROUTES.input, notice: 'no_result' };
  if (h.startsWith('#/detail/')) {
    if (!state.hasResult) return { redirect: ROUTES.input, notice: 'no_result' };
    const id = h.slice('#/detail/'.length);
    return state.detailExists(id) ? { view: 'detail', id } : { redirect: ROUTES.result };
  }
  return { redirect: ROUTES.landing };
}

// 분석 응답 → 다음 화면. 입력 형식 오류(400·413)는 입력 화면으로 돌아가 바로 고치게 하고,
// AI·서버·네트워크·요청 제한 오류는 S-07로 보낸다. 분석 실패를 '찾지 못함' 결과로 바꾸지 않는다.
export function classifyAnalyzeFailure(httpStatus) {
  if (httpStatus === 400 || httpStatus === 413) return 'input';
  return 'error';
}
