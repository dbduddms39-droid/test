// 두 문서 비교 결과 화면을 1440px·390px로 찍는다 (질문 모아보기·조건 카드·같은/다른 조건). 모의 AI (실제 Gemini 아님).
//   node scripts/shots-compare.mjs <출력 폴더 이름>   → e2e-artifacts/compare/<이름>/
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, QA2_OFFER, QA2_OFFER_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';

const OUT = `e2e-artifacts/compare/${process.argv[2] ?? 'now'}`;
mkdirSync(OUT, { recursive: true });
const DOCS = [[GQ_POSTING, GQ_POSTING_SPECS], [QA2_OFFER, QA2_OFFER_SPECS], [QA2_CONTRACT, QA2_CONTRACT_SPECS]];
const ai = {
  name: 'demo',
  async analyze({ segments, criterionIds }) {
    const text = segments.map((s) => s.text).join('\n');
    const doc = DOCS.find(([t]) => segmentText(t).map((s) => s.text).join('\n') === text);
    return { criteria: buildExtraction(segments, doc[1], CRITERION_IDS).criteria.filter((c) => criterionIds.includes(c.id)) };
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    const register = async (type, body) => {
      await page.waitForSelector('#view-input:not([hidden])');
      await page.check(`input[name="doc-type"][value="${type}"]`);
      await page.fill('#doc-text', body); await page.click('#submit-btn');
      await page.waitForSelector('#view-record:not([hidden])'); await page.waitForTimeout(200);
    };
    for (const [name, [ta, ba], [tb, bb]] of [['posting-contract', ['job_posting', GQ_POSTING], ['contract', QA2_CONTRACT]], ['posting-offer', ['job_posting', GQ_POSTING], ['offer', QA2_OFFER]]]) {
      await page.goto(`${BASE}/#/new`);
      await register(ta, ba);
      await page.click('#add-second:visible, #add-doc-top:visible');
      await register(tb, bb);
      await page.addStyleTag({ content: '.topbar { position: static !important; }' });
      await (await page.$('#cmp-summary')).evaluate((e) => e.scrollIntoView());
      await page.screenshot({ path: `${OUT}/${tag}-${name}-top.png` });
      await (await page.$('#condition-list')).screenshot({ path: `${OUT}/${tag}-${name}-list.png` });
      for (const st of ['different', 'same']) {
        const c = await page.$(`#condition-list .cmp-card[data-status="${st}"]`);
        if (!c) continue;
        await c.evaluate((e) => { e.closest('details')?.setAttribute('open', ''); e.querySelector('details.cmp-evidence')?.setAttribute('open', ''); });
        await c.screenshot({ path: `${OUT}/${tag}-${name}-${st}-card.png` });
      }
      const rows = await page.$$eval('#condition-list .cmp-card', (els) => els.map((e) => `${e.dataset.status}:${e.querySelector('h3').textContent}${e.querySelector('.cmp-question') ? '(질문)' : ''}`));
      if (tag === 'desk') console.log(name, rows.join(' | '));
    }
  }
} finally { await browser.close(); server.close(); }
