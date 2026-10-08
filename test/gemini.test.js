import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';
import { createGeminiAnalyzer } from '../src/ai/gemini.js';
import { analyzeDocument } from '../src/analyze.js';
import { ITEM_IDS } from '../src/items.js';
import { segmentText } from '../src/segment.js';
import { SAMPLES } from './samples.js';
import { idealResponse, idealItem, scriptedAI } from './helpers.js';

// 실제 네트워크 대신 응답을 흉내 내는 가짜 Gemini 클라이언트
function fakeClient(respond) {
  const requests = [];
  return {
    requests,
    models: {
      async generateContent(req) {
        requests.push(req);
        return respond(req);
      },
    },
  };
}
const ok = (obj, finishReason = 'STOP') => ({ text: JSON.stringify(obj), candidates: [{ finishReason }] });
const args = (sample) => ({ docType: sample.docType, segments: segmentText(sample.text), itemIds: ITEM_IDS });

test('gemini-3.8-flash에 구조화 JSON 스키마로 요청하고, 유료 fallback 설정이 없다', async () => {
  const sample = SAMPLES[0];
  const client = fakeClient(() => ok(idealResponse(sample)));
  const ai = createGeminiAnalyzer({ client });
  const raw = await ai.analyze(args(sample));
  assert.equal(raw.items.length, 8);
  const req = client.requests[0];
  assert.equal(req.model, 'gemini-3.8-flash');
  assert.equal(req.config.responseMimeType, 'application/json');
  assert.deepEqual(req.config.responseJsonSchema.properties.items.items.properties.id.enum, ITEM_IDS);
  assert.ok(req.config.abortSignal, '타임아웃 신호를 건다');
  assert.ok(!('fallbacks' in req) && !('fallbacks' in req.config));
  assert.ok(req.contents.includes('[1] '), '번호가 붙은 원문을 보낸다');
});

test('API 키가 없으면 missing_key (재분석하지 않는 오류)', async () => {
  const ai = createGeminiAnalyzer({ apiKey: '' });
  await assert.rejects(ai.analyze(args(SAMPLES[0])), (e) => e.code === 'missing_key' && e.fatal);
});

test('429는 무료 사용량 한도 오류, 401·403은 인증 오류', async () => {
  const mk = (status) => createGeminiAnalyzer({ client: fakeClient(() => { throw new ApiError({ message: 'x', status }); }) });
  await assert.rejects(mk(429).analyze(args(SAMPLES[0])), (e) => e.code === 'rate_limited' && e.fatal);
  await assert.rejects(mk(403).analyze(args(SAMPLES[0])), (e) => e.code === 'auth_failed' && e.fatal);
  await assert.rejects(mk(500).analyze(args(SAMPLES[0])), (e) => e.code === 'api_error' && !e.fatal);
});

test('타임아웃은 timeout 오류', async () => {
  const client = fakeClient((req) => new Promise((_, reject) => {
    // AbortSignal.timeout의 타이머는 이벤트 루프를 붙잡지 않으므로 테스트 동안 루프를 유지한다
    const keepAlive = setInterval(() => {}, 1000);
    req.config.abortSignal.addEventListener('abort', () => {
      clearInterval(keepAlive);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  }));
  const ai = createGeminiAnalyzer({ client, timeoutMs: 20 });
  await assert.rejects(ai.analyze(args(SAMPLES[0])), (e) => e.code === 'timeout');
});

test('잘린 응답·차단·깨진 JSON은 재분석 가능한 오류', async () => {
  const mk = (resp) => createGeminiAnalyzer({ client: fakeClient(() => resp) });
  await assert.rejects(mk(ok({}, 'MAX_TOKENS')).analyze(args(SAMPLES[0])), (e) => e.code === 'truncated' && !e.fatal);
  await assert.rejects(mk(ok({}, 'SAFETY')).analyze(args(SAMPLES[0])), (e) => e.code === 'blocked');
  await assert.rejects(mk({ text: '{oops', candidates: [{ finishReason: 'STOP' }] }).analyze(args(SAMPLES[0])), (e) => e.code === 'invalid_json');
});

test('Gemini 응답도 기존 검증·재분석 규칙을 그대로 거친다', async () => {
  const sample = SAMPLES[0];
  let n = 0;
  const client = fakeClient((req) => {
    n += 1;
    if (n === 1) {
      const bad = idealResponse(sample);
      bad.items.find((i) => i.id === 'salary').evidence_ids = [999];
      return ok(bad);
    }
    return ok({ items: [idealItem(sample, 'salary')] });
  });
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: createGeminiAnalyzer({ client }) });
  assert.equal(client.requests.length, 2);
  assert.deepEqual(client.requests[1].config.responseJsonSchema.properties.items.items.properties.id.enum, ['salary']);
  assert.equal(result.items.find((i) => i.id === 'salary').status, 'stated');
});

test('첫 호출의 치명 오류는 요청 전체 오류, 재분석 중 오류는 해당 항목만 분석 확인 불가', async () => {
  const sample = SAMPLES[0];
  const fatal = Object.assign(new Error('x'), { code: 'rate_limited', fatal: true });
  await assert.rejects(analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(fatal) }), (e) => e.code === 'rate_limited');

  const bad = idealResponse(sample);
  bad.items.find((i) => i.id === 'salary').evidence_ids = [999];
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(bad, fatal) });
  assert.equal(result.items.find((i) => i.id === 'salary').status, 'unavailable');
  assert.equal(result.items.find((i) => i.id === 'duties').status, 'stated');
});

// Google 오류 본문 형태의 ApiError
const googleError = (status, providerStatus, message, reason) => new ApiError({
  status,
  message: JSON.stringify({ error: { code: status, message, status: providerStatus, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] } }),
});

test('HTTP 상태와 제공업체 오류 유형·메시지를 구분해 담는다', async () => {
  const ai = createGeminiAnalyzer({ client: fakeClient(() => { throw googleError(400, 'INVALID_ARGUMENT', 'Invalid JSON payload: unknown schema field'); }) });
  await assert.rejects(ai.analyze(args(SAMPLES[0])), (e) => e.code === 'bad_request' && e.fatal
    && e.httpStatus === 400 && e.providerStatus === 'INVALID_ARGUMENT' && e.providerMessage.includes('unknown schema field'));
});

test('404는 모델 없음, 잘못된 키(400 API_KEY_INVALID)는 인증 오류', async () => {
  const mk = (err) => createGeminiAnalyzer({ client: fakeClient(() => { throw err; }) });
  await assert.rejects(mk(googleError(404, 'NOT_FOUND', 'models/x is not found')).analyze(args(SAMPLES[0])), (e) => e.code === 'model_not_found' && e.fatal && e.httpStatus === 404);
  await assert.rejects(mk(googleError(400, 'INVALID_ARGUMENT', 'API key not valid.', 'API_KEY_INVALID')).analyze(args(SAMPLES[0])),
    (e) => e.code === 'auth_failed' && e.providerStatus === 'INVALID_ARGUMENT/API_KEY_INVALID');
  await assert.rejects(mk(googleError(503, 'UNAVAILABLE', 'overloaded')).analyze(args(SAMPLES[0])), (e) => e.code === 'api_error' && !e.fatal && e.httpStatus === 503);
});

test('제공업체 메시지에서 키처럼 보이는 값을 가린다', async () => {
  const ai = createGeminiAnalyzer({ client: fakeClient(() => { throw googleError(400, 'INVALID_ARGUMENT', 'bad request for key=AIzaSyFAKEFAKEFAKEFAKE1234 ?key=abc'); }) });
  await assert.rejects(ai.analyze(args(SAMPLES[0])), (e) => !e.providerMessage.includes('AIzaSy') && !e.providerMessage.includes('abc'));
});

test('요청 설정 오류(400)는 같은 요청을 재시도하지 않는다', async () => {
  const sample = SAMPLES[0];
  const client = fakeClient(() => { throw googleError(400, 'INVALID_ARGUMENT', 'schema error'); });
  await assert.rejects(
    analyzeDocument({ text: sample.text, docType: sample.docType, ai: createGeminiAnalyzer({ client }) }),
    (e) => e.code === 'bad_request',
  );
  assert.equal(client.requests.length, 1);
});

test('일시 오류(5xx)는 기존 규칙대로 한 번만 재분석하고, 실패 코드에 HTTP 상태를 남긴다', async () => {
  const sample = SAMPLES[0];
  const client = fakeClient(() => { throw googleError(500, 'INTERNAL', 'internal'); });
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: createGeminiAnalyzer({ client }) });
  assert.equal(client.requests.length, 2);
  assert.deepEqual(result.items[0].errorCodes, ['ai_call_failed:api_error:500']);
});

test('모델 사전 점검: 성공 / 404면 flash 모델 이름만 참고로 수집', async () => {
  const okClient = { models: { get: async () => ({ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' }) } };
  assert.equal((await createGeminiAnalyzer({ client: okClient }).checkModel()).ok, true);
  const missing = {
    models: {
      get: async () => { throw googleError(404, 'NOT_FOUND', 'not found'); },
      list: async () => [{ name: 'models/gemini-x-flash', supportedActions: ['generateContent'] }, { name: 'models/gemini-x-pro', supportedActions: ['generateContent'] }],
    },
  };
  const r = await createGeminiAnalyzer({ client: missing }).checkModel();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'model_not_found');
  assert.deepEqual(r.availableFlashModels, ['models/gemini-x-flash']);
});
