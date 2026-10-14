// S-03 기본 화면 = Gemini 줄바꿈 정리 결과 (실제 브라우저, 1440px·390px). 모의 AI (실제 Gemini 아님).
//   node scripts/e2e-layout.mjs
// 확인: 추출 전 전송 안내·끄기 경로, 추출 직후 자동 정리(검증 통과분만), 오른쪽은 읽기 화면(제목 강조·[ ]는 화면 표시만),
// '텍스트 수정하기' 후에도 줄 구조 유지, 원래 추출 텍스트 보존·복원, 검증 실패·호출 실패 시 원래 텍스트,
// 불확실한 글자(OCR) 위치가 정리 후에도 같은 글자를 가리킴, 분석 요청에는 사용자가 확인한 텍스트.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { createRateLimiter } from '../src/rateLimit.js';

const OUT = 'e2e-artifacts/layout';
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

let mode = 'ok'; // ok: 번호 항목·짧은 줄을 제목으로, 그 밖은 줄마다 · tamper: 숫자를 바꿈 · error: 호출 실패
let layoutCalls = 0;
const demo = createDemoAnalyzer();
const ai = {
  name: 'demo',
  analyze: demo.analyze,
  async layout({ text }) {
    layoutCalls += 1;
    if (mode === 'error') throw Object.assign(new Error('x'), { code: 'timeout' });
    // 모의 정리: '1. 임금 연봉 …'처럼 번호 제목과 내용이 붙은 줄을 제목·내용으로 나누고, 나머지는 줄마다 (글자는 그대로)
    const blocks = [];
    for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const m = l.match(/^(\d+\.\s*\S+)\s+(\S.*)$/);
      if (m) blocks.push({ kind: 'heading', text: m[1] }, { kind: /[:：]/.test(m[2]) ? 'item' : 'text', text: m[2] });
      else blocks.push({ kind: /[:：]/.test(l) ? 'item' : 'text', text: l });
    }
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
const strip = (t) => t.replace(/\s/g, '');

try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const analyzeBodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/analyze')) analyzeBodies.push(JSON.parse(r.postData())); });
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 30000 });
    const status = () => page.textContent('#layout-status');
    const settled = () => page.waitForFunction(() => { const t = document.querySelector('#layout-status').textContent; return t && !t.includes('정리하는 중'); }, null, { timeout: 15000 });
    const textPane = async () => { if (w < 900) await page.click('#rtab-text'); };
    const upload = async (opts = {}) => {
      await page.goto(`${BASE}/#/new`); await view('input');
      await page.check('input[name="doc-type"][value="contract"]');
      await page.click('#tab-upload');
      if (opts.off) await page.uncheck('#ai-layout'); else await page.check('#ai-layout');
      await page.setInputFiles('#file-input', { name: '가상_근로계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
      await view('review');
      await page.waitForFunction(() => document.querySelector('#review-text').value.length > 50, null, { timeout: 30000 });
      await settled();
      await textPane();
    };

    // 0) 추출 전 안내·끄기 경로
    await page.goto(`${BASE}/#/new`); await view('input');
    await page.click('#tab-upload');
    const optText = await page.textContent('.ai-layout-opt');
    const privacy = await page.textContent('#privacy-note .privacy-core');
    check(`[${tag}] 추출 전 안내: Gemini로 텍스트 전송·파일은 보내지 않음·끄기 가능, 개인정보 안내도 실제 동작대로`, optText.includes('Google Gemini로 보내') && optText.includes('파일 자체는 아님') && optText.includes('끄면 AI로 보내지 않고') && await page.isChecked('#ai-layout') && privacy.includes("'Gemini 줄바꿈 정리'를 켜 두면 추출 직후"));

    // 1) 기본: 추출 직후 자동 정리 → 오른쪽 읽기 화면
    mode = 'ok'; layoutCalls = 0;
    await upload();
    const original = await page.textContent('#original-text-body');
    const value = await page.inputValue('#review-text');
    const rv = await page.$eval('#read-view', (v) => ({ visible: v.offsetParent !== null, text: v.textContent, heads: v.querySelectorAll('.rv-heading').length,
      marker: getComputedStyle(v.querySelector('.rv-heading.with-marker') ?? v, '::before').content, headWeight: getComputedStyle(v.querySelector('.rv-heading') ?? v).fontWeight }));
    check(`[${tag}] 추출 직후 자동 정리 1회, 별도 버튼·영역 없음`, layoutCalls === 1 && !(await page.$('#layout-run, #layout-box, #layout-view')) && (await status()).includes('줄만 나눴어요'), `${layoutCalls}회`);
    check(`[${tag}] 기본 화면 = 읽기 화면 (입력칸 숨김), 제목 강조·[ ]는 화면 표시만`, rv.visible && !(await page.isVisible('#review-text')) && rv.heads >= 3 && rv.marker.includes('[') && Number(rv.headWeight) >= 700 && !value.includes('[1.'), `제목 ${rv.heads}개`);
    check(`[${tag}] 정리 텍스트 글자 = 원래 추출 텍스트 (공백·줄바꿈만 다름), 원래 텍스트 따로 보존`, strip(value) === strip(original) && value !== original && strip(rv.text) === strip(value));
    await page.screenshot({ path: `${OUT}/${tag}-read.png`, fullPage: true });

    // 2) 수정하기 → 입력칸, 고친 뒤에도 줄 구조 유지
    await page.click('#review-edit');
    check(`[${tag}] '텍스트 수정하기' → 편집 입력칸`, await page.isVisible('#review-text') && !(await page.isVisible('#read-view')) && (await page.textContent('#review-edit')).includes('수정 완료'));
    const edited = value.replace('작성일', '작성일(확인)');
    await page.fill('#review-text', edited);
    await page.click('#review-edit');
    const rv2 = await page.$eval('#read-view', (v) => ({ text: v.textContent, heads: v.querySelectorAll('.rv-heading').length }));
    check(`[${tag}] 수정 후 읽기 화면: 고친 내용 반영, 제목 구조 유지`, rv2.text.includes('작성일(확인)') && rv2.heads === rv.heads, `제목 ${rv2.heads}개`);

    // 3) 분석 요청 = 사용자가 확인한 텍스트
    await page.click('#review-submit'); await view('record');
    check(`[${tag}] 분석 요청 본문 = 확인·수정한 텍스트 (줄바꿈 구조 포함)`, analyzeBodies.at(-1)?.text === edited);

    // 4) 원래 추출 텍스트로 되돌리기
    await upload();
    page.once('dialog', (d) => d.accept());
    await page.click('#review-restore');
    check(`[${tag}] '원래 추출 텍스트로' → 정리 전 텍스트 그대로`, (await page.inputValue('#review-text')) === (await page.textContent('#original-text-body')) && (await status()).includes('되돌렸어요'));

    // 5) 끄기 경로: AI로 보내지 않음
    layoutCalls = 0;
    await upload({ off: true });
    check(`[${tag}] 줄바꿈 정리를 끄면 Gemini 요청 없이 추출 텍스트 그대로`, layoutCalls === 0 && (await page.inputValue('#review-text')) === (await page.textContent('#original-text-body')) && (await status()).includes('AI 줄바꿈 정리 없이'));

    // 6) 검증 실패·호출 실패 → 원래 텍스트, 직접 수정해 진행 가능
    for (const m of ['tamper', 'error']) {
      mode = m;
      await upload();
      const v = await page.inputValue('#review-text');
      check(`[${tag}] ${m === 'tamper' ? '숫자를 바꾼 결과(검증 실패)' : 'Gemini 호출 실패'} → 원래 추출 텍스트, 진행 가능`, v === (await page.textContent('#original-text-body')) && (await status()).includes('적용하지 못해') && !(await page.isDisabled('#review-submit')));
    }
    mode = 'ok';
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors.join(' | ').slice(0, 200));
    await ctx.close();
  }

  // 7) 사진(OCR): 불확실한 글자 위치가 정리 후에도 같은 글자를 가리키고, '크게 바뀐 구간'으로 바뀌지 않음
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    mode = 'ok';
    await page.goto(`${BASE}/#/new`);
    await page.waitForSelector('#view-input:not([hidden])');
    await page.check('input[name="doc-type"][value="job_posting"]');
    await page.click('#tab-upload'); await page.check('#ai-layout');
    await page.setInputFiles('#file-input', ['test/fixtures/ocr-bench/check-blur-1.png', 'test/fixtures/ocr-bench/check-blur-2.png']); // 흐린 이미지: 확인이 필요한 글자가 생김
    await page.click('#extract-btn');
    await page.waitForSelector('#view-review:not([hidden])', { timeout: 120000 });
    await page.waitForFunction(() => { const t = document.querySelector('#layout-status').textContent; return t && !t.includes('정리하는 중'); }, null, { timeout: 20000 });
    const st = await page.textContent('#layout-status');
    const changed = (await page.inputValue('#review-text')) !== (await page.textContent('#original-text-body'));
    const ocr = await page.evaluate(() => [...document.querySelectorAll('#ocr-check-list > li')].map((li) => li.textContent));
    check('[ocr] 사진 추출 후 자동 정리 적용, 불확실한 글자가 그대로 남고 \'크게 바뀐 구간\'으로 바뀌지 않음', st.includes('줄만 나눴어요') && changed && ocr.length > 0 && !ocr.some((t) => t.includes('크게 바뀌어')), `${ocr.length}곳`);
    const pos = await page.evaluate(() => { const b = document.querySelector('#ocr-check-list [data-ocr-action="locate"]'); return b ? b.closest('[data-ocr-id]').textContent : null; });
    check('[ocr] 위치 보기 대상 있음', Boolean(pos));
    if (pos) {
      await page.click('#ocr-check-list [data-ocr-action="locate"] >> nth=0');
      const sel = await page.evaluate(() => { const t = document.querySelector('#review-text'); return { visible: !t.hidden, s: t.value.slice(t.selectionStart, t.selectionEnd) }; });
      check('[ocr] \'위치 보기\' → 입력칸에서 정리 후 텍스트의 같은 글자를 선택', sel.visible && sel.s.length > 0 && pos.includes(sel.s), sel.s);
    }
    await ctx.close();
  }
} catch (e) {
  check('예외 없이 완료', false, e.stack?.split('\n').slice(0, 3).join(' '));
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n줄바꿈 정리 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
