// 브라우저 스크립트는 Node에서 import하지 않는 파일도 있어, 문법 오류가 단위 테스트에서 드러나도록 모두 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

test('public/의 모든 브라우저 스크립트 문법 검사', () => {
  for (const f of readdirSync('public').filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', `public/${f}`], { stdio: 'pipe' }), f);
  }
});
