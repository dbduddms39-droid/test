import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { responseSchema } from '../src/ai/prompt.js';
import { CRITERION_IDS } from '../src/criteria.js';
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

test('분석 API가 v2.2 10개 주제(08 조건부) 결과를 돌려준다', async () => {
  const secret = '급여: 월 250만원 비밀문구XYZ';
  const res = await post({ docType: 'job_posting', text: `${secret}\n근무지: 서울 마포구` });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, 'v2.2');
  assert.equal(data.topics.length, 10);
  assert.equal(data.items, undefined, '기존 8개 형식 필드를 함께 보내지 않는다');
  assert.equal(data.counts.shown, 9, '수습 적용이 확인되지 않아 08 미표시');
  assert.equal(data.docTypeLabel, '채용공고');
  assert.equal(data.mode, 'demo', '데모 결과임을 응답에 표시한다');
  const wage = data.topics.find((t) => t.id === '01');
  assert.equal(wage.criteria.find((c) => c.id === '01-a').evidence[0].text, secret);
  assert.ok(data.sourceGuide.includes('법적 기재 의무를 판단하는 것은 아닙니다'));
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
  // 개인정보 안내(v3.1): 개인정보 가림, 서버를 거쳐 외부 AI로 전달된다는 사실, 브라우저에 저장된다는 사실.
  // '저장하지 않음'은 실제 동작(일단확인 서버·원본 파일)에만 쓰고, 외부 AI 제공자의 보관은 보장하지 않는다. 암호화·보안 모드 같은 보장은 넣지 않음.
  assert.ok(html.includes('주민등록번호, 주소 등 확인에 필요 없는 개인정보는 가리고 입력해 주세요.'));
  assert.ok(html.includes('일단확인 서버를 거쳐 외부 AI 모델(Google Gemini API)에 전달돼요'));
  assert.ok(html.includes('외부 AI 제공자의 데이터 처리 방침이 적용돼요'));
  assert.ok(html.includes('원본 사진·PDF 파일은 저장하지 않아요'));
  assert.ok(!/암호화|보안 모드|영구 보관합니다|원본 파일을 보관/.test(html));
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
});

test('분석 API: includeCriteria를 요청하면 세부기준별 결과(검증된 근거만)를 함께, 기본 응답에는 넣지 않음', async () => {
  const plain = await (await post({ docType: 'job_posting', text: '연봉: 3,400만원\n근무지: 서울' })).json();
  assert.equal(plain.criteria, undefined);
  const withC = await (await post({ docType: 'job_posting', text: '연봉: 3,400만원\n근무지: 서울', includeCriteria: true })).json();
  assert.equal(Object.keys(withC.criteria).length, CRITERION_IDS.length);
  assert.equal(withC.criteria['01-a'].evidence[0].text, '연봉: 3,400만원');
  assert.equal((await post({ docType: 'job_posting', text: '연봉', includeCriteria: 'yes' })).status, 400);
});

test('AI 응답 스키마: 32개 세부기준 ID, 표현 유형, 06-a 기간 유형, 02-a 계산값 구조 (상태 코드는 AI가 정하지 않음)', () => {
  const s = responseSchema();
  const props = s.properties.criteria.items.properties;
  assert.deepEqual(props.id.enum, CRITERION_IDS);
  assert.equal(CRITERION_IDS.length, 32);
  assert.deepEqual(props.finding.enum, ['specific', 'coarse', 'undecided', 'conflict', 'negated', 'absent']);
  assert.deepEqual(props.term_type.anyOf[0].enum, ['fixed', 'indefinite']);
  assert.ok(!JSON.stringify(s).includes('CONFIRMED') && !JSON.stringify(s).includes('MAIN_'));
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
  assert.equal(r.data.topics, undefined);
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

test('OCR 저신뢰 구간: 올바른 범위만 받고, 잘못된 형식은 400 (내용이 아니라 위치만 받음)', async () => {
  const text = '급여: 월 25O만원\n근무지: 서울 마포구';
  const ok = await post({ docType: 'offer', text, lowConfidence: [{ start: 7, end: 10 }] });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  const wage = data.topics.find((t) => t.id === '01');
  assert.equal(wage.criteria.find((c) => c.id === '01-a').status, 'UNAVAILABLE', '확인되지 않은 저신뢰 구간이 겹친 핵심값은 확정하지 않음');
  assert.equal(wage.status, 'MAIN_UNAVAILABLE');
  for (const bad of [[{ start: 5, end: 3 }], [{ start: 0, end: 999 }], [{ start: 0, end: 2, text: 'x' }], 'x', [{ start: 1.5, end: 3 }]]) {
    assert.equal((await post({ docType: 'offer', text, lowConfidence: bad })).status, 400, JSON.stringify(bad));
  }
});

// ---------- 2문서 비교 API ----------
const postCompare = (body, url = base) => fetch(`${url}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('비교 API: 서로 다른 두 문서를 각각 분석해 항목별 비교와 양쪽 원문을 돌려주고, 원문을 로그에 남기지 않음', async () => {
  const res = await postCompare({ documents: [
    { docType: 'contract', text: '[가상] 근로계약서\n임금: 연봉 3,200만원 비교비밀ABC\n근무장소: 서울 마포구' },
    { docType: 'job_posting', text: '[가상] 채용공고\n연봉 3,600만원\n근무지: 서울 마포구' },
  ] });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, 'compare-v1');
  assert.equal(data.mode, 'demo');
  assert.deepEqual(data.docs.map((d) => d.docType), ['job_posting', 'contract'], '앞 단계 문서가 A');
  assert.equal(data.items.length, 8);
  assert.ok(data.docs.every((d) => d.lines.length >= 2));
  assert.ok(!logged.some((l) => l.includes('비교비밀ABC')), '원문을 로그에 남기지 않는다');
});

test('비교 API 입력 오류: 문서 수, 같은 유형, 빈 문서, 지원하지 않는 유형, 너무 긴 문서는 400', async () => {
  const ok = { docType: 'offer', text: '연봉 3,600만원' };
  assert.equal((await postCompare({ documents: [ok] })).status, 400);
  assert.equal((await postCompare({ documents: [ok, { ...ok }] })).status, 400, '같은 유형끼리는 비교하지 않음');
  const empty = await postCompare({ documents: [ok, { docType: 'contract', text: '  ' }] });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /^문서 B: /);
  assert.equal((await postCompare({ documents: [ok, { docType: 'resume', text: 'x' }] })).status, 400);
  assert.equal((await postCompare({ documents: [ok, { docType: 'contract', text: 'a'.repeat(20001) }] })).status, 400);
  assert.equal((await postCompare({ documents: [ok, { docType: 'contract', text: 'abc', lowConfidence: [{ start: 0, end: 9 }] }] })).status, 400);
});

test('비교 API: 한 문서라도 AI 분석에 실패하면 결과를 지어내지 않고 오류로 안내, 요청 제한은 분석 2회로 셈', async () => {
  const failing = {
    name: 'failing',
    calls: 0,
    async analyze() { this.calls += 1; if (this.calls >= 2) throw Object.assign(new Error('x'), { code: 'rate_limited', fatal: true }); return { criteria: [] }; },
  };
  const s = createServer({ ai: failing, limiter: createRateLimiter({ perIp: 100, globalPerMinute: 100 }) });
  await new Promise((r) => s.listen(0, r));
  const url = `http://localhost:${s.address().port}`;
  try {
    const res = await postCompare({ documents: [{ docType: 'offer', text: '연봉 3,600만원' }, { docType: 'contract', text: '연봉 3,200만원' }] }, url);
    assert.equal(res.status, 429);
    const data = await res.json();
    assert.equal(data.code, 'rate_limited');
    assert.equal(data.items, undefined, '부분 결과를 보내지 않음');
  } finally { s.close(); }

  const limited = createServer({ ai: createDemoAnalyzer(), limiter: createRateLimiter({ perIp: 3, globalPerMinute: 100 }) });
  await new Promise((r) => limited.listen(0, r));
  const lurl = `http://localhost:${limited.address().port}`;
  try {
    const body = { documents: [{ docType: 'offer', text: '연봉 3,600만원' }, { docType: 'contract', text: '연봉 3,200만원' }] };
    assert.equal((await postCompare(body, lurl)).status, 200);
    assert.equal((await postCompare(body, lurl)).status, 429, '두 번째 비교는 분석 4회째라 제한');
  } finally { limited.close(); }
});
