// Google Gemini API 호출 (무료 등급 모델 사용). API 키는 서버 환경변수 GEMINI_API_KEY에서만 읽는다.
// 유료 모델로 자동 전환하는 fallback은 두지 않는다. 실패하면 오류로 돌려준다.
import { GoogleGenAI, ApiError } from '@google/genai';
import { SYSTEM_PROMPT, buildUserMessage, responseSchema } from './prompt.js';
import { AIError } from './errors.js';

const BLOCKED_FINISH = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE', 'OTHER'];

export function createGeminiAnalyzer({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60_000,
  client = apiKey ? new GoogleGenAI({ apiKey }) : null,
} = {}) {
  return {
    name: 'gemini',
    model,
    async analyze({ docType, segments, itemIds, feedback }) {
      if (!client) throw new AIError('missing_key', 'AI 분석 키(GEMINI_API_KEY)가 설정되지 않았어요.');
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: buildUserMessage({ docType, segments, itemIds, feedback }),
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0,
            maxOutputTokens: 16000,
            responseMimeType: 'application/json',
            responseJsonSchema: responseSchema(itemIds),
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
      } catch (err) {
        throw toAIError(err);
      }

      if (response.promptFeedback?.blockReason) throw new AIError('blocked', 'AI가 이 문서를 처리하지 않았어요.');
      const finish = response.candidates?.[0]?.finishReason;
      if (finish === 'MAX_TOKENS') throw new AIError('truncated', 'AI 응답이 잘렸어요.');
      if (BLOCKED_FINISH.includes(finish)) throw new AIError('blocked', 'AI가 이 문서를 처리하지 않았어요.');
      try {
        return JSON.parse(response.text ?? '');
      } catch {
        throw new AIError('invalid_json', 'AI 응답을 해석하지 못했어요.');
      }
    },
  };
}

function toAIError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new AIError('timeout', 'AI 응답 시간이 초과됐어요.');
  }
  if (err instanceof ApiError) {
    const msg = String(err.message || '');
    if (err.status === 429) return new AIError('rate_limited', 'AI 무료 사용량 한도에 도달했어요.');
    if (err.status === 401 || err.status === 403 || /API_KEY_INVALID|API key not valid/i.test(msg)) {
      return new AIError('auth_failed', 'AI 분석 키 인증에 실패했어요.');
    }
    return new AIError('api_error', `AI 서비스 오류 (${err.status ?? 'unknown'})`);
  }
  return new AIError('connection_failed', 'AI 서비스에 연결하지 못했어요.');
}
