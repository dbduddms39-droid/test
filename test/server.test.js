import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { responseSchema } from '../src/ai/prompt.js';
import { ITEM_IDS } from '../src/items.js';
import { createGeminiAnalyzer } from '../src/ai/gemini.js';
import { createRateLimiter } from '../src/rateLimit.js';

let server;
let base;
const logged = [];
const origLog = console.log;

before(async () => {
  console.log = (...args) => logged.push(args.join(' '));
  server = createServer({ ai: createDemoAnalyzer(), limiter: createRateLimiter({ perIp: 100, globalPerMinute: 100 }) });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { console.log = origLog; server.close(); });

const post = (body) => fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('분석 API가 8개 항목 결과와 요약을 돌려준다', async () => {
  const secret = '급여: 월 250만원 비밀문구XYZ';
  const res = await post({ docType: 'job_posting', text: `${secret}\n근무지: 서울 마포구` });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.items.length, 8);
  assert.equal(data.docTypeLabel, '채용공고');
  assert.equal(data.mode, 'demo', '데모 결과임을 응답에 표시한다');
  assert.equal(data.items.find((i) => i.id === 'salary').evidence[0].text, secret);
  assert.ok(logged.length > 0);
  assert.ok(!logged.some((l) => l.includes('비밀문구XYZ')), '원문을 로그에 남기지 않는다');
});

test('입력 검증', async () => {
  assert.equal((await post({ docType: 'x', text: 'a' })).status, 400);
  assert.equal((await post({ docType: 'offer', text: '   ' })).status, 400);
  assert.equal((await post({ docType: 'offer', text: 'a'.repeat(20001) })).status, 400);
});

test('정적 파일 제공 및 경로 이탈 차단', async () => {
  const html = await (await fetch(`${base}/`)).text();
  // 개인정보 안내: 서버·AI 모델로 전달된다는 사실과 개인정보를 가리라는 안내 (암호화·비저장 같은 보장은 넣지 않음)
  assert.ok(html.includes('입력한 문서 텍스트는 분석을 위해 서버와 AI 모델에 전달됩니다.'));
  assert.ok(html.includes('이름, 연락처, 주민등록번호 등 개인정보는 가리고 입력해 주세요.'));
  assert.ok(!/암호화|저장하지 않|보안 모드/.test(html));
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
});

test('응답 스키마가 8개 항목 ID와 수습 없음 구분 값을 포함한다', () => {
  const s = responseSchema();
  const props = s.properties.items.items.properties;
  assert.deepEqual(props.id.enum, ITEM_IDS);
  assert.ok(props.probation_status.anyOf[0].enum.includes('none'));
});

// 별도 서버를 띄워 한 번 요청하고 닫는다
async function once(opts, body) {
  const srv = createServer(opts);
  await new Promise((r) => srv.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, retryAfter: res.headers.get('retry-after'), data: await res.json() };
  } finally {
    srv.close();
  }
}
const doc = { docType: 'job_posting', text: '급여: 월 250만원' };

test('GEMINI_API_KEY가 없으면 데모로 바꾸지 않고 오류를 안내한다', async () => {
  const r = await once({ ai: createGeminiAnalyzer({ apiKey: '' }) }, doc);
  assert.equal(r.status, 503);
  assert.equal(r.data.code, 'missing_key');
  assert.ok(r.data.error.includes('GEMINI_API_KEY'));
  assert.equal(r.data.items, undefined);
});

test('AI 무료 사용량 한도 도달을 안내한다', async () => {
  const ai = { name: 'gemini', analyze: async () => { throw Object.assign(new Error('x'), { code: 'rate_limited', fatal: true }); } };
  const r = await once({ ai }, doc);
  assert.equal(r.status, 429);
  assert.ok(r.data.error.includes('무료 사용량 한도'));
});

test('요청 제한을 넘으면 AI를 호출하지 않고 429', async () => {
  let calls = 0;
  const ai = { name: 'gemini', analyze: async () => { calls += 1; throw new Error('should not be called'); } };
  const r = await once({ ai, limiter: { check: () => ({ ok: false, scope: 'ip', retryAfterSec: 30 }) } }, doc);
  assert.equal(r.status, 429);
  assert.equal(r.retryAfter, '30');
  assert.equal(calls, 0);
});
