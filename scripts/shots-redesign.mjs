// 리디자인 화면 확인용 스크린샷 (모의 AI, 실제 Gemini 아님). node scripts/shots-redesign.mjs [출력 폴더]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, QA2_OFFER, QA2_OFFER_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';

const OUT = process.argv[2] ?? 'e2e-artifacts/redesign';
mkdirSync(OUT, { recursive: true });
const DOCS = [[GQ_POSTING, GQ_POSTING_SPECS], [QA2_OFFER, QA2_OFFER_SPECS], [QA2_CONTRACT, QA2_CONTRACT_SPECS]];
const ai = {
  name: 'demo',
  async analyze({ segments, criterionIds }) {
    const text = segments.map((s) => s.text).join('\n');
    const doc = DOCS.find(([t]) => segmentText(t).map((s) => s.text).join('\n') === text);
    if (!doc) throw Object.assign(new Error('unknown'), { code: 'api_error' });
    const all = buildExtraction(segments, doc[1], CRITERION_IDS);
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15000 });
    const register = async (type, body) => {
      await view('input');
      await page.check(`input[name="doc-type"][value="${type}"]`);
      await page.fill('#doc-text', body);
      await page.click('#submit-btn');
      await view('record'); await page.waitForTimeout(200);
    };
    await page.goto(`${BASE}/#/`); await view('landing'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${tag}-landing.png`, fullPage: true });
    await page.goto(`${BASE}/#/new`);
    await page.screenshot({ path: `${OUT}/${tag}-input.png`, fullPage: true });
    await register('contract', QA2_CONTRACT);
    await page.screenshot({ path: `${OUT}/${tag}-contract.png`, fullPage: true });
    await page.click('#add-second:visible, #add-doc-top:visible');
    await register('job_posting', GQ_POSTING);
    await page.screenshot({ path: `${OUT}/${tag}-compare.png`, fullPage: true });
    await page.$$eval('.cmp-evidence', (ds) => ds.forEach((d) => { d.open = true; }));
    await page.screenshot({ path: `${OUT}/${tag}-compare-open.png`, fullPage: true });
    console.log(tag, 'overflow', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
    const href = await page.$eval('.cmp-detail-link', (a) => a.getAttribute('href'));
    await page.goto(`${BASE}/${href}`); await view('item'); await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${tag}-item.png`, fullPage: true });
    await page.goto(`${BASE}/#/records`); await view('records');
    await page.screenshot({ path: `${OUT}/${tag}-records.png`, fullPage: true });
  }
} finally { await browser.close(); server.close(); }
