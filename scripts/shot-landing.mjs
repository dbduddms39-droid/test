// 시작 화면(S01) 스크린샷: node scripts/shot-landing.mjs <이름>  → e2e-artifacts/landing/<이름>-{desk,mob}-{full,first}.png (데모 분석기, AI 호출 없음)
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
const tag = process.argv[2];
const server = createServer({ ai: createDemoAnalyzer() });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const b = await chromium.launch();
for (const [w, h, n] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${BASE}/#/`); await p.waitForSelector('#view-landing:not([hidden])'); await p.waitForTimeout(400);
  await p.screenshot({ path: `e2e-artifacts/landing/${tag}-${n}-full.png`, fullPage: true });
  await p.screenshot({ path: `e2e-artifacts/landing/${tag}-${n}-first.png` });
  console.log(tag, n, await p.evaluate(() => document.documentElement.scrollHeight));
}
await b.close(); server.close();
