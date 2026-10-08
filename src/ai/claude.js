// Claude API 호출. API 키는 서버 환경변수(ANTHROPIC_API_KEY)에서만 읽는다.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserMessage, responseSchema } from './prompt.js';

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createClaudeAnalyzer({
  model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  effort = process.env.ANTHROPIC_EFFORT || 'medium',
  client = new Anthropic(),
} = {}) {
  return {
    name: 'claude',
    async analyze({ docType, segments, itemIds, feedback }) {
      let response;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          // 안전 분류기가 요청을 거절하면 서버 측에서 권장 대체 모델로 다시 실행
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort, format: { type: 'json_schema', schema: responseSchema(itemIds) } },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage({ docType, segments, itemIds, feedback }) }],
        });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) throw new AIError('rate_limited', 'AI 서비스 요청 한도를 초과했어요.');
        if (err instanceof Anthropic.AuthenticationError) throw new AIError('auth_failed', 'AI 서비스 인증에 실패했어요.');
        if (err instanceof Anthropic.APIConnectionError) throw new AIError('connection_failed', 'AI 서비스에 연결하지 못했어요.');
        if (err instanceof Anthropic.APIError) throw new AIError('api_error', `AI 서비스 오류 (${err.status ?? 'unknown'})`);
        throw err;
      }
      if (response.stop_reason === 'refusal') throw new AIError('refusal', 'AI가 이 요청을 처리하지 않았어요.');
      if (response.stop_reason === 'max_tokens') throw new AIError('truncated', 'AI 응답이 잘렸어요.');
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        return JSON.parse(text);
      } catch {
        throw new AIError('invalid_json', 'AI 응답을 해석하지 못했어요.');
      }
    },
  };
}
