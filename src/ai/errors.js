// AI 호출 오류. fatal 오류는 같은 요청을 다시 보내도 해결되지 않으므로 재분석하지 않고 요청 전체를 오류로 안내한다.
// - bad_request: 요청 설정(스키마·파라미터)이 거부됨 (HTTP 400 INVALID_ARGUMENT 등)
// - model_not_found: 모델 이름을 찾을 수 없음 (HTTP 404)
export const FATAL_AI_ERRORS = ['missing_key', 'auth_failed', 'rate_limited', 'timeout', 'bad_request', 'model_not_found'];

export class AIError extends Error {
  // detail: { httpStatus, providerStatus, providerMessage } — 제공업체 오류 진단용. 키·원문은 넣지 않는다.
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.fatal = FATAL_AI_ERRORS.includes(code);
    this.httpStatus = detail.httpStatus ?? null;
    this.providerStatus = detail.providerStatus ?? null;
    this.providerMessage = detail.providerMessage ?? null;
  }
}
