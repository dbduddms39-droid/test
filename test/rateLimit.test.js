import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/rateLimit.js';

test('IP별 제한과 시간 경과 후 해제', () => {
  let t = Date.parse('2026-10-08T00:00:00Z');
  const rl = createRateLimiter({ perIp: 2, windowMs: 60_000, globalPerMinute: 100, globalPerDay: 100, now: () => t });
  assert.ok(rl.check('a').ok);
  assert.ok(rl.check('a').ok);
  const r = rl.check('a');
  assert.equal(r.ok, false);
  assert.equal(r.scope, 'ip');
  assert.ok(rl.check('b').ok, '다른 IP는 영향 없음');
  t += 60_001;
  assert.ok(rl.check('a').ok);
});

test('서버 전체 분당·일일 제한', () => {
  let t = Date.parse('2026-10-08T10:00:00Z');
  const rl = createRateLimiter({ perIp: 100, globalPerMinute: 2, globalPerDay: 3, now: () => t });
  assert.ok(rl.check('a').ok);
  assert.ok(rl.check('b').ok);
  assert.equal(rl.check('c').scope, 'global');
  t += 61_000;
  assert.ok(rl.check('c').ok);
  t += 61_000;
  const d = rl.check('d');
  assert.equal(d.scope, 'daily');
  assert.ok(d.retryAfterSec > 0);
  t = Date.parse('2026-10-09T00:00:01Z');
  assert.ok(rl.check('d').ok, '다음 날 초기화');
});
