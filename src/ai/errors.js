// AI 호출 오류. fatal 오류는 재분석해도 해결되지 않으므로 요청 전체를 오류로 안내한다.
export const FATAL_AI_ERRORS = ['missing_key', 'auth_failed', 'rate_limited', 'timeout'];

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.fatal = FATAL_AI_ERRORS.includes(code);
  }
}
