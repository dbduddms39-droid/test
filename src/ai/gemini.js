// Google Gemini API 호출 (무료 등급 모델 사용). API 키는 서버 환경변수 GEMINI_API_KEY에서만 읽는다.
// 유료 모델로 자동 전환하는 fallback은 두지 않는다. 실패하면 오류로 돌려준다.
import { GoogleGenAI, ApiError } from '@google/genai';
import { SYSTEM_PROMPT, buildUserMessage, responseSchema } from './prompt.js';
import { AIError } from './errors.js';

const BLOCKED_FINISH = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE', 'OTHER'];

export function createGeminiAnalyzer({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60_000,
  client = apiKey ? new GoogleGenAI({ apiKey }) : null,
} = {}) {
  return {
    name: 'gemini',
    model,
    // 모델 메타데이터 조회 (생성 요청이 아니며 토큰을 쓰지 않는다). 실제 연결 테스트의 사전 점검용.
    async checkModel() {
      if (!client) return { ok: false, code: 'missing_key' };
      try {
        const m = await client.models.get({ model, config: { abortSignal: AbortSignal.timeout(timeoutMs) } });
        return { ok: true, name: m.name, displayName: m.displayName, inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit };
      } catch (err) {
        const e = toAIError(err);
        const out = { ok: false, code: e.code, httpStatus: e.httpStatus, providerStatus: e.providerStatus, providerMessage: e.providerMessage };
        // 모델을 찾지 못하면 사용 가능한 flash 계열 모델 이름만 참고로 모은다 (자동 전환하지 않음)
        if (e.code === 'model_not_found') out.availableFlashModels = await listFlashModels(client);
        return out;
      }
    },
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

async function listFlashModels(client) {
  try {
    const names = [];
    for await (const m of await client.models.list({ config: { pageSize: 100 } })) {
      if (/flash/i.test(m.name ?? '') && (m.supportedActions ?? []).includes('generateContent')) names.push(m.name);
      if (names.length >= 30) break;
    }
    return names;
  } catch {
    return null;
  }
}

// 제공업체 오류 메시지에서 키처럼 보이는 값을 가리고 길이를 줄인다.
export function sanitizeProviderMessage(msg) {
  if (msg == null) return null;
  return String(msg)
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/([?&]key=)[^&\s"]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// SDK ApiError 메시지는 Google 오류 본문 JSON이다: {"error":{"code":400,"message":"...","status":"INVALID_ARGUMENT"}}
export function parseApiError(err) {
  let body = null;
  try { body = JSON.parse(err.message); } catch { /* JSON이 아닌 오류 본문 */ }
  const e = body?.error ?? {};
  const reason = (e.details ?? []).map((d) => d?.reason).find(Boolean) ?? null;
  return {
    httpStatus: err.status ?? e.code ?? null,
    providerStatus: e.status ?? null,
    providerReason: reason,
    providerMessage: sanitizeProviderMessage(e.message ?? (body ? null : err.message)),
  };
}

export function toAIError(err) {
  if (err instanceof AIError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new AIError('timeout', 'AI 응답 시간이 초과됐어요.');
  }
  if (err instanceof ApiError) {
    const d = parseApiError(err);
    const detail = { httpStatus: d.httpStatus, providerStatus: d.providerReason ? `${d.providerStatus}/${d.providerReason}` : d.providerStatus, providerMessage: d.providerMessage };
    const s = d.httpStatus;
    if (s === 429 || d.providerStatus === 'RESOURCE_EXHAUSTED') return new AIError('rate_limited', 'AI 무료 사용량 한도에 도달했어요.', detail);
    if (s === 401 || s === 403 || d.providerReason === 'API_KEY_INVALID' || /API key not valid/i.test(d.providerMessage ?? '')) {
      return new AIError('auth_failed', 'AI 분석 키 인증에 실패했어요.', detail);
    }
    if (s === 404) return new AIError('model_not_found', 'AI 모델을 찾지 못했어요.', detail);
    // 400대: 요청 설정(스키마·파라미터) 문제. 같은 요청을 다시 보내도 같은 결과이므로 재시도하지 않는다.
    if (s >= 400 && s < 500) return new AIError('bad_request', `AI 요청이 거부됐어요 (HTTP ${s}).`, detail);
    // 500대: 일시 오류일 수 있어 기존 규칙대로 한 번 재분석한다.
    return new AIError('api_error', `AI 서비스 오류 (HTTP ${s ?? 'unknown'})`, detail);
  }
  return new AIError('connection_failed', 'AI 서비스에 연결하지 못했어요.');
}
