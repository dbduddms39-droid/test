// 문서 1개 결과의 조건 목록 화면을 1440px·390px로 찍고, 항목별 표시 방식(목록형/넓은 카드)을 출력한다. 모의 AI (실제 Gemini 아님).
//   node scripts/shots-conditions.mjs <출력 폴더 이름>   예) before, after → e2e-artifacts/conditions/<이름>/
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, GQ_POSTING_LONG_EVIDENCE, GQ_POSTING_LONG_EVIDENCE_SPECS, QA2_OFFER, QA2_OFFER_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';
import { DEMO_POSTING, DEMO_POSTING_SPECS } from '../test/demo-docs.js';

const OUT = `e2e-artifacts/conditions/${process.argv[2] ?? 'now'}`;
mkdirSync(OUT, { recursive: true });
const DOCS = [['posting-a', 'job_posting', GQ_POSTING, GQ_POSTING_SPECS], ['posting-b', 'job_posting', DEMO_POSTING, DEMO_POSTING_SPECS], ['posting-long-evidence', 'job_posting', GQ_POSTING_LONG_EVIDENCE, GQ_POSTING_LONG_EVIDENCE_SPECS], ['offer', 'offer', QA2_OFFER, QA2_OFFER_SPECS], ['contract', 'contract', QA2_CONTRACT, QA2_CONTRACT_SPECS]];
const ai = {
  name: 'demo',
  async analyze({ segments, criterionIds }) {
    const text = segments.map((s) => s.text).join('\n');
    const doc = DOCS.find(([, , t]) => segmentText(t).map((s) => s.text).join('\n') === text);
    const all = buildExtraction(segments, doc[3], CRITERION_IDS);
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
    for (const [name, type, body] of DOCS) {
      await page.goto(`${BASE}/#/new`); await page.waitForSelector('#view-input:not([hidden])');
      await page.check(`input[name="doc-type"][value="${type}"]`);
      await page.fill('#doc-text', body); await page.click('#submit-btn');
      await page.waitForSelector('#view-record:not([hidden])'); await page.waitForTimeout(200);
      await page.addStyleTag({ content: 'header, .site-header { position: static !important; }' }); // 요소 스크린샷에 고정 헤더가 겹치지 않게
      const rows = await page.$$eval('#condition-list .cmp-card', (els) => els.map((e) => ({
        group: e.closest('[data-group]').dataset.group, id: e.dataset.item, label: e.querySelector('h3')?.textContent,
        kind: e.classList.contains('is-compact') ? '목록형' : '넓은 카드', badge: e.querySelector('.badge')?.textContent ?? '(없음)',
        no: e.querySelector('.cmp-no')?.textContent ?? '', value: e.querySelector('.cmp-value')?.textContent.slice(0, 40) })));
      if (tag === 'desk') { console.log(`\n[${name}]`); for (const r of rows) console.log(`  ${r.group.padEnd(11)} ${r.no.padEnd(3)}${r.label.padEnd(10)} ${r.kind.padEnd(6)} 배지:${r.badge.padEnd(12)} ${r.value}`); }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/${tag}-${name}-top.png` }); // 저장 안내·요약이 보이는 첫 화면
      await (await page.$('#condition-list')).screenshot({ path: `${OUT}/${tag}-${name}.png` });
      // 근거 하나만 펼쳤을 때 두 링크가 움직이는지
      const one = await page.$('#condition-list .cmp-row details.cmp-evidence');
      if (one) {
        const row = await one.evaluateHandle((d) => d.closest('.cmp-card'));
        const pos = () => row.evaluate((r) => [...r.querySelectorAll('.cmp-evidence > summary, .cmp-detail-link')].map((x) => Math.round(x.getBoundingClientRect().top - r.getBoundingClientRect().top)));
        const before = await pos();
        await one.evaluate((d) => { d.open = true; });
        const after = await pos();
        if (tag === 'desk' || name === 'contract') console.log(`  [${tag}] 근거 펼치기 전후 링크 위치(카드 기준 y): ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        await (await row.asElement()).screenshot({ path: `${OUT}/${tag}-${name}-one-open.png` });
        await one.evaluate((d) => { d.open = false; });
      }
      // 첫 묶음의 원문 근거를 모두 펼친 화면 (목록형 2열이 깨지지 않는지)
      await page.$$eval('[data-group="stated"] details.cmp-evidence, [data-group="written"] details.cmp-evidence', (ds) => ds.forEach((d) => { d.open = true; }));
      await page.waitForTimeout(100);
      await (await page.$('#condition-list')).screenshot({ path: `${OUT}/${tag}-${name}-evidence-open.png` });
    }
  }
} finally { await browser.close(); server.close(); }
