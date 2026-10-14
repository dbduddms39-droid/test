import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignLayout, headingHasMarker } from '../public/text-layout.js';
import { createServer } from '../server.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { layoutResponseSchema } from '../src/ai/layout-prompt.js';
import { createGeminiAnalyzer } from '../src/ai/gemini.js';

// 가상 문서 (실제 회사·개인 정보 아님)
const SRC = '[가상] 근로계약서\n근로조건 1. 임금: 월 3,000,000원(세전) 2. 지급일: 매월 25일\n근무시간은 09:00부터\n18:00까지로 한다.';
const B = (kind, text) => ({ kind, text });

test('줄 나누기·합치기만 한 결과는 통과하고, 화면용 문자열은 원문과 공백만 다르다', () => {
  const r = alignLayout(SRC, [
    B('heading', '[가상] 근로계약서'), B('heading', '근로조건'),
    B('item', '1. 임금: 월 3,000,000원(세전)'), B('item', '2. 지급일: 매월 25일'),
    B('text', '근무시간은 09:00부터 18:00까지로 한다.'),
  ]);
  assert.ok(r);
  assert.equal(r.length, 5);
  assert.equal(r[4].text, '근무시간은 09:00부터 18:00까지로 한다.');
  assert.equal(r.map((x) => x.text).join('').replace(/\s/g, ''), SRC.replace(/\s/g, ''));
});

test('숫자·금액·날짜·단위를 바꾸면 실패', () => {
  for (const changed of ['1. 임금: 월 300만원(세전)', '1. 임금: 월 3,000,000원', '1. 임금: 월 3,000,000원(세전).', '1. 임금 : 월 3,000,000원(세전)']) {
    assert.equal(alignLayout(SRC, [B('heading', '[가상] 근로계약서'), B('heading', '근로조건'), B('item', changed), B('item', '2. 지급일: 매월 25일'), B('text', '근무시간은 09:00부터 18:00까지로 한다.')]), null, changed);
  }
});

test('내용을 빼거나(요약), 더하거나, 순서를 바꾸면 실패', () => {
  const ok = [B('text', '[가상] 근로계약서'), B('text', '근로조건 1. 임금: 월 3,000,000원(세전) 2. 지급일: 매월 25일'), B('text', '근무시간은 09:00부터 18:00까지로 한다.')];
  assert.ok(alignLayout(SRC, ok));
  assert.equal(alignLayout(SRC, ok.slice(0, 2)), null, '뒷부분 누락');
  assert.equal(alignLayout(SRC, [...ok, B('text', '(참고) 연봉 3,600만원')]), null, '원문에 없는 내용');
  assert.equal(alignLayout(SRC, [ok[1], ok[0], ok[2]]), null, '순서 변경');
  assert.equal(alignLayout(SRC, [B('heading', '[근로조건]'), ...ok]), null, '제목에 괄호를 만들어 넣음');
});

test('같은 줄의 띄어쓰기를 지우거나 없던 띄어쓰기를 넣으면 실패, 잘린 줄은 붙여 쓸 수 있음', () => {
  assert.equal(alignLayout('월 3,000,000원', [B('text', '월3,000,000원')]), null);
  assert.equal(alignLayout('월 3,000,000원', [B('text', '월 3,000,000 원')]), null);
  const wrapped = alignLayout('근로계\n약서', [B('heading', '근로계약서')]);
  assert.deepEqual(wrapped, [{ kind: 'heading', text: '근로계약서' }]);
});

test('형식이 잘못된 응답은 실패', () => {
  assert.equal(alignLayout(SRC, null), null);
  assert.equal(alignLayout(SRC, []), null);
  assert.equal(alignLayout(SRC, [{ kind: 'title', text: SRC }]), null);
  assert.equal(alignLayout(SRC, [{ kind: 'text', text: 3 }]), null);
  assert.equal(alignLayout('', [B('text', 'a')]), null);
});

test('제목 표시: 원문에 이미 괄호·기호가 있으면 화면에서 괄호를 더하지 않음', () => {
  assert.equal(headingHasMarker('[가상] 근로계약서'), true);
  assert.equal(headingHasMarker('■ 임금'), true);
  assert.equal(headingHasMarker('근로조건'), false);
});

test('응답 스키마: 블록 종류는 heading·item·text', () => {
  assert.deepEqual(layoutResponseSchema().properties.blocks.items.properties.kind.enum, ['heading', 'item', 'text']);
});

test('Gemini 정리 요청: 지시문·스키마·온도 0으로 한 번 호출', async () => {
  const calls = [];
  const client = { models: { generateContent: async (req) => { calls.push(req); return { text: JSON.stringify({ blocks: [B('text', '가')] }), candidates: [{ finishReason: 'STOP' }] }; } } };
  const ai = createGeminiAnalyzer({ apiKey: 'x', client });
  const out = await ai.layout({ text: '가' });
  assert.deepEqual(out.blocks, [B('text', '가')]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.temperature, 0);
  assert.ok(calls[0].config.systemInstruction.includes('글자 그대로'));
  assert.ok(calls[0].contents.includes('<text>\n가\n</text>'));
});

// ---- /api/layout ----
async function withServer(ai, fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  const server = createServer({ ai, limiter: createRateLimiter({ perIp: 100, globalPerMinute: 100 }) });
  await new Promise((r) => server.listen(0, r));
  const post = (body) => fetch(`http://localhost:${server.address().port}/api/layout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { await fn(post, logs); } finally { console.log = orig; server.close(); }
}

test('/api/layout: 검증된 블록만 돌려주고 원문은 로그에 남기지 않음', async () => {
  const ai = { name: 'mock', layout: async ({ text }) => ({ blocks: text.split('\n').map((t) => B('text', t)) }) };
  await withServer(ai, async (post, logs) => {
    const res = await post({ text: '비밀문구XYZ 임금\n월 300만원' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.blocks.map((b) => b.text), ['비밀문구XYZ 임금', '월 300만원']);
    assert.ok(logs.some((l) => l.includes('layout_done')));
    assert.ok(!logs.some((l) => l.includes('비밀문구XYZ')));
  });
});

test('/api/layout: 원문과 다르면 422로 표시하지 않음, 입력 오류·미지원 처리', async () => {
  const ai = { name: 'mock', layout: async () => ({ blocks: [B('text', '월 3,000,000원')] }) };
  await withServer(ai, async (post) => {
    const res = await post({ text: '월 300만원' });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'layout_mismatch');
    assert.equal((await post({ text: '  ' })).status, 400);
    assert.equal((await post({ text: 'x'.repeat(20001) })).status, 400);
  });
  await withServer({ name: 'mock' }, async (post) => {
    const res = await post({ text: '가' });
    assert.equal(res.status, 503);
  });
  await withServer({ name: 'mock', layout: async () => { throw Object.assign(new Error('x'), { code: 'rate_limited' }); } }, async (post) => {
    assert.equal((await post({ text: '가' })).status, 429);
  });
});

// ---- 확인 화면 기본 적용: 줄바꿈 정리 텍스트와 위치 옮기기 ----
import { layoutText, positionMap } from '../public/text-layout.js';
import { createTracker, remapTracker, pendingRanges } from '../public/ocr-spans.js';
import { remapAnchors } from '../public/extract-issues.js';

const OCR = '[가상] 근로계약서 근로조건 1. 임금: 월 3,000,000원(세전) 2. 지급일: 매월 25일\n근무시간은 09:00부터\n18:00까지로 한다.';
const BLOCKS = [B('heading', '[가상] 근로계약서'), B('heading', '근로조건'), B('item', '1. 임금: 월 3,000,000원(세전)'), B('item', '2. 지급일: 매월 25일'), B('text', '근무시간은 09:00부터 18:00까지로 한다.')];

test('정리 텍스트: 블록마다 한 줄, 제목 앞 빈 줄, 괄호를 새로 넣지 않음, 글자는 원문과 같음', () => {
  const v = alignLayout(OCR, BLOCKS);
  const t = layoutText(v);
  assert.equal(t, '[가상] 근로계약서\n\n근로조건\n1. 임금: 월 3,000,000원(세전)\n2. 지급일: 매월 25일\n근무시간은 09:00부터 18:00까지로 한다.');
  assert.equal(t.replace(/\s/g, ''), OCR.replace(/\s/g, ''));
  assert.ok(positionMap(OCR, t));
});

test('위치 대응: 공백만 다르면 글자 위치를 그대로 옮기고, 글자가 다르면 null', () => {
  const t = layoutText(alignLayout(OCR, BLOCKS));
  const map = positionMap(OCR, t);
  for (const word of ['3,000,000', '25일', '18:00']) assert.equal(t.slice(map(OCR.indexOf(word)), map(OCR.indexOf(word) + word.length - 1) + 1), word);
  assert.equal(positionMap('월 300만원', '월 3,000,000원'), null);
  assert.ok(positionMap('월 300만원', '월 300만원\n'));
});

test('불확실한 글자 구간은 정리 후에도 같은 글자를 가리키고 확인 필요 상태 그대로, 직접 입력 위치도 함께 옮김', () => {
  const tr = createTracker(OCR, ['3,000,000원', '25일']);
  const t = layoutText(alignLayout(OCR, BLOCKS));
  const map = positionMap(OCR, t);
  const moved = remapTracker(tr, map, t);
  assert.equal(moved.spans.length, 2);
  assert.ok(moved.spans.every((s) => s.state === 'pending' && t.slice(s.start, s.end) === s.text));
  assert.deepEqual(moved.spans.map((s) => s.text), ['3,000,000원', '25일']);
  assert.equal(pendingRanges(moved, t).length, 2);
  const at = OCR.indexOf('근무시간');
  assert.equal(t.slice(remapAnchors([{ id: 'p2', anchor: at }], map)[0].anchor).startsWith('근무시간'), true);
});
