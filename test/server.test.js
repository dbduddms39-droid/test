import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { responseSchema } from '../src/ai/prompt.js';
import { ITEM_IDS } from '../src/items.js';

let server;
let base;
const logged = [];
const origLog = console.log;

before(async () => {
  console.log = (...args) => logged.push(args.join(' '));
  server = createServer({ ai: createDemoAnalyzer() });
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
  assert.ok(html.includes('입력한 내용은 분석을 위해 AI 서비스로 전송돼요. 이름·주민등록번호·주소 등 개인정보는 가린 뒤 입력해 주세요.'));
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
});

test('응답 스키마가 8개 항목 ID와 수습 없음 구분 값을 포함한다', () => {
  const s = responseSchema();
  const props = s.properties.items.items.properties;
  assert.deepEqual(props.id.enum, ITEM_IDS);
  assert.ok(props.probation_status.anyOf[0].enum.includes('none'));
});
