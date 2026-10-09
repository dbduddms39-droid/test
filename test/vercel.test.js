// Vercel Node 런타임 방식 점검: 런타임은 server.js를 import한 뒤
// default export (req, res) 함수를 호출하거나, import 중 listen()을 가로챈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DEMO_MODE = 'true'; // 이 파일의 요청은 데모 분석기로만 (외부 API 호출 없음)

let listenCalled = false;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) { listenCalled = true; return originalListen.apply(this, args); };
const mod = await import('../server.js');
http.Server.prototype.listen = originalListen;

async function withServer(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('import만으로는 서버를 띄우지 않고, default export가 (req, res) 핸들러다', () => {
  assert.equal(listenCalled, false);
  assert.equal(typeof mod.default, 'function');
  assert.equal(mod.default.length, 2);
});

test('default 핸들러로 메인 화면, /api/config, /api/analyze가 동작한다', async () => {
  await withServer(mod.default, async (base) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<title>일단확인<\/title>/);
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { mode: 'demo' });
    const res = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docType: 'job_posting', text: '급여: 월 250만원\n근무지: 서울' }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.version, 'v2.2');
    assert.equal(data.topics.length, 10);
  });
});

test('환경변수 구성: 데모는 명시할 때만, Vercel에서는 X-Forwarded-For로 IP 판단', () => {
  assert.equal(mod.configFromEnv({}).ai.name, 'gemini');
  assert.equal(mod.configFromEnv({}).ai.model, 'gemini-3.5-flash-lite');
  assert.equal(mod.configFromEnv({ DEMO_MODE: '1' }).demo, false);
  assert.equal(mod.configFromEnv({ DEMO_MODE: 'true' }).ai.name, 'demo');
  assert.equal(mod.configFromEnv({}).trustProxy, false);
  assert.equal(mod.configFromEnv({ VERCEL: '1' }).trustProxy, true);
});

test('예상치 못한 서버 오류의 메시지(입력 일부가 섞일 수 있음)는 로그에 남기지 않는다', async () => {
  const logged = [];
  const origLog = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    const ai = { name: 'gemini', analyze: async () => { throw new SyntaxError('Unexpected token in "급여 비밀문구QWE"'); } };
    const handler = mod.createHandler({ ai });
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docType: 'offer', text: '급여 비밀문구QWE' }) });
      // 비치명 오류는 재분석 후 '분석 확인 불가'로 처리되어 200
      assert.equal(res.status, 200);
    });
    const throwing = mod.createHandler({ ai: { name: 'x', analyze: async () => ({ items: [] }) }, limiter: { check: () => { throw new TypeError('boom 비밀문구QWE'); } } });
    await withServer(throwing, async (base) => {
      const res = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docType: 'offer', text: '비밀문구QWE' }) });
      assert.equal(res.status, 500);
    });
  } finally {
    console.log = origLog;
  }
  assert.ok(logged.some((l) => l.includes('server_error')));
  assert.ok(!logged.some((l) => l.includes('비밀문구QWE')));
});
