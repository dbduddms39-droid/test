// S-01~S-07 화면 검수: 실제 브라우저에서 주요 경로를 데스크톱(1280)·모바일(390) 폭으로 순회하고 화면을 저장한다.
//   node scripts/e2e-screens.mjs        (데모 모드 로컬 서버만 사용, Gemini 호출 없음. 결과: e2e-artifacts/screens/)
// 경로: 직접 입력 → 분석 → 결과 → 상세, 사진 업로드 → 추출 텍스트 확인 → 분석, 분석 실패 → 재시도·원문 수정, 폭 전환
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = 'e2e-artifacts/screens';
mkdirSync(OUT, { recursive: true });
const PORT = 3981;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DEMO_MODE: 'true', GEMINI_API_KEY: '', RATE_LIMIT_PER_IP: '50', RATE_LIMIT_GLOBAL_PER_MINUTE: '50' }, stdio: 'ignore' });
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`); };
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch();
try {
  for (const [vw, vh, tag] of [[1280, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: true });
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15000 });
    const noOverflow = async (n) => check(`[${tag}] ${n}: 가로 넘침 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const codesHidden = async (n) => {
      const t = await page.evaluate(() => document.querySelector('main').innerText);
      check(`[${tag}] ${n}: 내부 코드(01-a, L-W, C/D 등) 미노출`, !/\b\d{2}-[a-g]\b|L-[MW]\b|MAIN_|UNAVAILABLE|CONFIRMED/.test(t));
    };

    // A) S-01 → S-02 직접 입력 → S-04 → S-05 → S-06
    await page.goto(BASE);
    await view('landing'); await shot('S01'); await noOverflow('S-01');
    await page.click('#landing-start'); await view('input');
    await page.check('input[name=docType][value=offer]');
    await page.click('#example-btn'); await shot('S02');
    await noOverflow('S-02');
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/api/analyze', async (route) => { await gate; await route.continue(); });
    await page.click('#submit-btn'); await view('analyzing'); await shot('S04'); await noOverflow('S-04');
    release(); await view('result'); await page.unroute('**/api/analyze');
    await page.waitForTimeout(300); await shot('S05'); await noOverflow('S-05'); await codesHidden('S-05');
    const cards = await page.$$eval('.topic-card', (e) => e.length);
    const badges = await page.$$eval('.topic-card .status-badge, .topic-card [class*=badge]', (e) => e.map((x) => x.textContent.trim()));
    check(`[${tag}] S-05: 주제 카드·상태 표시`, cards >= 9 && badges.length >= 9, `${cards}개, 예: ${badges.slice(0, 3).join(' / ')}`);
    check(`[${tag}] S-05: 데모 결과 안내·결과 안내 문구`, (await page.textContent('#analysis-source')).includes('데모') && (await page.textContent('#result-notice')).trim().length > 20);
    if (tag === 'desk') {
      const panel = await page.isVisible('#source-panel');
      const marks = await page.$$eval('#source-panel-body mark, #source-panel-body .is-marked', (e) => e.length);
      check(`[desk] S-05: 오른쪽 원문 패널과 인용 표시`, panel && marks > 0, `표시 ${marks}곳`);
    } else {
      await page.click('.topic-card [aria-expanded]');
      check(`[mob] S-05: 카드 안에서 원문 근거 펼침`, await page.isVisible('.topic-card .card-source:not([hidden])'));
    }
    await page.click('.topic-card .item-row'); await view('detail'); await page.waitForTimeout(300);
    await shot('S06'); await noOverflow('S-06'); await codesHidden('S-06');
    const chips = await page.$$eval('#detail .evidence-chip', (e) => e.map((x) => x.textContent));
    check(`[${tag}] S-06: 원문 인용 칩`, chips.length > 0, chips[0]?.slice(0, 40));
    if (chips.length) {
      await page.click('#detail .evidence-chip');
      check(`[${tag}] S-06: 인용을 누르면 원문 줄 강조`, (await page.$$('#detail .doc-line.is-focused')).length === 1);
    }
    check(`[${tag}] S-06: '원문 수정하고 다시 분석하기'는 S-02로 (직접 입력)`, (await page.getAttribute('#detail-edit', 'href')) === '#/input');

    // C) 분석 실패 → S-07 → 재시도 / 원문 수정
    await page.goto(`${BASE}/#/input`); await view('input');
    await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI 분석 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.' }) }));
    const textBefore = await page.inputValue('#doc-text');
    await page.click('#submit-btn'); await view('error'); await shot('S07'); await noOverflow('S-07');
    check(`[${tag}] S-07: 오류 안내`, (await page.textContent('#error-message')).includes('응답하지'));
    await page.unroute('**/api/analyze');
    await page.click('#retry-btn'); await view('result');
    check(`[${tag}] S-07 → 재시도 성공 시 결과`, await page.isVisible('#view-result'));
    await page.goto(`${BASE}/#/input`); await view('input');
    await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"실패"}' }));
    await page.click('#submit-btn'); await view('error');
    await page.click('#error-edit'); await view('input');
    check(`[${tag}] S-07 → 원문 수정: S-02, 입력 유지`, (await page.inputValue('#doc-text')) === textBefore);
    await page.unroute('**/api/analyze');

    // B) 사진 업로드 → S-03 → 분석
    await page.goto(`${BASE}/#/input`); await view('input');
    await page.check('input[name=docType][value=job_posting]');
    await page.click('#tab-upload');
    await page.setInputFiles('#file-input', 'test/fixtures/upload/posting-ko.png');
    await page.click('#extract-btn');
    await view('review'); await page.waitForTimeout(300); await shot('S03'); await noOverflow('S-03');
    check(`[${tag}] S-03: 원본 미리보기·추출 텍스트`, (await page.inputValue('#review-text')).includes('급여') && (await page.$eval('#preview-img', (i) => i.complete && i.naturalWidth > 0)));
    await page.click('#review-submit'); await view('result');
    check(`[${tag}] 업로드 경로 결과: 추출 텍스트 기준 안내`, (await page.isVisible('#input-source-note')) && (await page.textContent('#input-source-note')).includes('글자를 인식'));
    check(`[${tag}] 업로드 경로 결과 → 다시 입력은 S-03`, (await page.getAttribute('#result-back', 'href')) === '#/review');

    // D) 화면 전환: 결과 화면에서 폭 바꾸기
    const other = tag === 'desk' ? [390, 844] : [1280, 900];
    await page.setViewportSize({ width: other[0], height: other[1] }); await page.waitForTimeout(300);
    await noOverflow(`S-05 폭 전환(${other[0]})`);
    check(`[${tag}] 폭 전환 후 원문 패널 표시 규칙`, (await page.isVisible('#source-panel')) === (other[0] >= 1024));
    await shot(`S05-switch-${other[0]}`);
    check(`[${tag}] 페이지 오류 없음`, errors.filter((e) => !/502|Failed to load resource/.test(e)).length === 0, errors.join(' | ').slice(0, 200));
    await ctx.close();
  }
} finally {
  await browser.close(); server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n화면 검수: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exitCode = 1;
