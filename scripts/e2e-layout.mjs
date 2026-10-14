// S-03 '읽기 쉽게 정리해서 보기' 실제 브라우저 검사 (1440px·390px). 모의 AI (실제 Gemini 아님).
//   node scripts/e2e-layout.mjs
// 확인: 전송 안내가 먼저 보이고 버튼을 누르기 전에는 /api/layout 요청 없음, 검증된 결과만 보기 전용으로 표시,
// 원문과 다르면 표시하지 않음, 텍스트를 고치면 정리된 보기를 닫음, 분석 요청에는 확인한 텍스트가 그대로 들어감.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { createRateLimiter } from '../src/rateLimit.js';

const OUT = 'e2e-artifacts/layout';
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

let mode = 'ok'; // ok: 줄을 나누고 잘린 문장을 합침 · tamper: 숫자를 바꿈
let layoutCalls = 0;
const demo = createDemoAnalyzer();
const ai = {
  name: 'demo',
  analyze: demo.analyze,
  async layout({ text }) {
    layoutCalls += 1;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const blocks = lines.map((l, i) => ({ kind: i === 0 ? 'heading' : /^\d+\./.test(l) ? 'heading' : /[:：]/.test(l) ? 'item' : 'text', text: l }));
    if (mode === 'tamper') {
      const k = blocks.findIndex((b) => /\d/.test(b.text));
      blocks[k] = { ...blocks[k], text: blocks[k].text.replace(/\d/, (d) => String((Number(d) + 1) % 10)) };
    }
    return { blocks };
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const PDF = readFileSync('public/samples/ildan-sample-3-contract.pdf');

try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const analyzeBodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/analyze')) analyzeBodies.push(JSON.parse(r.postData())); });
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 30000 });
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await page.goto(`${BASE}/#/new`); await view('input');
    await page.check('input[name="doc-type"][value="contract"]');
    await page.click('#tab-upload');
    await page.setInputFiles('#file-input', { name: '가상_근로계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
    await view('review');
    await page.waitForFunction(() => document.querySelector('#review-text').value.length > 50, null, { timeout: 30000 });
    const extracted = await page.inputValue('#review-text');
    if (tag === 'mob') await page.click('#rtab-text').catch(() => {});

    const notice = await page.textContent('#layout-notice');
    layoutCalls = 0;
    await page.waitForTimeout(300);
    check(`[${tag}] 전송 안내가 버튼 옆에 먼저 보이고, 누르기 전에는 Gemini 요청 없음`, notice.includes('Google Gemini로 전송') && notice.includes('바꾸지 않아요') && await page.isVisible('#layout-run') && layoutCalls === 0 && !(await page.isVisible('#layout-view')));

    mode = 'ok';
    await page.click('#layout-run');
    await page.waitForSelector('#layout-view:not([hidden])', { timeout: 10000 });
    const shown = await page.$eval('#layout-view', (v) => ({ text: v.textContent, headings: v.querySelectorAll('.layout-heading').length, marker: getComputedStyle(v.querySelector('.layout-heading.with-marker') ?? v, '::before').content }));
    const strip = (t) => t.replace(/\s/g, '');
    check(`[${tag}] 버튼을 누르면 1회 요청, 정리된 보기 표시 (제목 구분)`, layoutCalls === 1 && shown.headings >= 1, `제목 ${shown.headings}개`);
    check(`[${tag}] 정리된 보기의 글자 = 확인 중인 텍스트 (공백·줄바꿈만 다름), 제목 괄호는 화면 표시로만`, strip(shown.text) === strip(extracted) && !shown.text.includes('[[') && (shown.marker === 'none' || shown.marker.includes('[')), shown.marker);
    check(`[${tag}] 추출 텍스트(입력칸)는 바뀌지 않음`, (await page.inputValue('#review-text')) === extracted);
    check(`[${tag}] 가로 넘침 없음`, await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-layout.png`, fullPage: true });

    // 텍스트를 고치면 정리된 보기를 닫는다 (예전 결과를 보여 주지 않음)
    await page.click('#review-text'); await page.keyboard.press('End'); await page.keyboard.type(' ');
    check(`[${tag}] 텍스트를 고치면 정리된 보기를 닫고 안내`, !(await page.isVisible('#layout-view')) && (await page.textContent('#layout-status')).includes('텍스트가 바뀌어'));
    await page.keyboard.press('Backspace');

    // 원문과 다른 결과(숫자 변경)는 표시하지 않는다
    mode = 'tamper';
    await page.click('#layout-run');
    await page.waitForFunction(() => document.querySelector('#layout-status').textContent.includes('일치하지 않아'), null, { timeout: 10000 });
    check(`[${tag}] 숫자를 바꾼 결과는 표시하지 않고 원래 텍스트 유지`, !(await page.isVisible('#layout-view')) && (await page.inputValue('#review-text')) === extracted);

    // 분석 요청에는 확인한 텍스트가 그대로 (정리 결과가 섞이지 않음)
    mode = 'ok';
    await page.click('#layout-run');
    await page.waitForSelector('#layout-view:not([hidden])', { timeout: 10000 });
    await page.click('#review-submit');
    await view('record');
    check(`[${tag}] 분석 요청 본문 = 확인한 텍스트 (정리 결과 미사용)`, analyzeBodies.length === 1 && analyzeBodies[0].text === extracted, `${analyzeBodies[0]?.text?.length}자 / ${extracted.length}자`);
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors.join(' | ').slice(0, 200));
    await ctx.close();
  }
} catch (e) {
  check('예외 없이 완료', false, e.stack?.split('\n').slice(0, 3).join(' '));
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n읽기 쉽게 정리 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
