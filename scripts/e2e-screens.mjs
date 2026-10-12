// S01~S07 화면 검수: 실제 브라우저에서 주요 경로를 데스크톱(1280)·모바일(390) 폭으로 순회하고 화면을 저장한다.
//   node scripts/e2e-screens.mjs        (데모 모드 로컬 서버만 사용, Gemini 호출 없음. 결과: e2e-artifacts/screens/)
// 경로: S01 → S02 직접 입력 → 분석 중 → S04 기록 → S05 항목 상세 → S07 새 안내 추가 → S04, S06 목록,
//       분석 실패 → 재시도·원문 수정, 사진 업로드 → S03 → 분석, 폭 전환
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
    page.on('dialog', (d) => d.accept());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: true });
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15000 });
    const noOverflow = async (n) => check(`[${tag}] ${n}: 가로 넘침 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const codesHidden = async (n) => {
      const t = await page.evaluate(() => document.querySelector('main').innerText);
      check(`[${tag}] ${n}: 내부 코드(01-a, L-W, C/D 등) 미노출`, !/\b\d{2}-[a-g]\b|L-[MW]\b|MAIN_|UNAVAILABLE|CONFIRMED|different_stated|newly_stated/.test(t));
    };

    // A) S01 → S02 직접 입력 → 분석 중 → S04 → S05
    await page.goto(BASE);
    await view('landing'); await shot('S01'); await noOverflow('S01');
    // S01 시작 화면: 3개 영역(히어로·이어서 확인·마지막 CTA), 첫 화면의 주요 CTA, 자료 하나로 시작, 가상 시연 예시 표시
    const landing = await page.textContent('#view-landing');
    check(`[${tag}] S01: 헤드라인·설명·보조 문구`, landing.includes('입사 전, 놓치지 말고') && landing.includes('안내받은 내용을 한곳에 기록하고 확인해요') && landing.includes('자료 하나만 있어도 시작할 수 있어요'));
    check(`[${tag}] S01: 주요 CTA가 첫 화면에 보임`, await page.$eval('#landing-start', (e) => e.getBoundingClientRect().bottom <= window.innerHeight));
    check(`[${tag}] S01: 영역 3개 (점검 주제 목록·확인 순서·원문 대조 섹션 없음)`, (await page.$$('#view-landing > *')).length === 3 && !(await page.$('.topic-grid, .steps, figure.compare')));
    check(`[${tag}] S01: 이어서 확인 예시는 가상 시연 예시로 표시, 하나만 등록해도 된다는 안내`, landing.includes('가상 시연 예시') && landing.includes('실제 분석 결과가 아니에요') && landing.includes('중 하나만 등록해도 괜찮아요') && !/변경됐|변경되었|위반입니다/.test(landing));
    for (const [sel, hash, v] of [['#landing-records', '#/records', 'records'], ['#landing-start-bottom', '#/new', 'input']]) {
      await page.goto(BASE); await view('landing');
      await page.click(sel); await view(v);
      check(`[${tag}] S01: ${sel} → ${hash}`, page.url().endsWith(hash));
    }
    await page.goto(BASE); await view('landing');
    await page.click('#landing-how');
    await page.waitForTimeout(600);
    check(`[${tag}] S01: '어떻게 이어서 확인하나요?' → 이어서 확인 영역으로 이동`, await page.$eval('#landing-workflow', (e) => e.getBoundingClientRect().top < window.innerHeight));
    await page.click('#landing-start'); await view('input');
    await page.check('input[name="doc-type"][value="job_posting"]');
    await page.click('#example-btn'); await shot('S02');
    await noOverflow('S02');
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/api/analyze', async (route) => { await gate; await route.continue(); });
    await page.click('#submit-btn'); await view('analyzing'); await shot('analyzing'); await noOverflow('분석 중');
    release(); await view('record'); await page.unroute('**/api/analyze');
    await page.waitForTimeout(300); await shot('S04'); await noOverflow('S04'); await codesHidden('S04');
    const rows = await page.$$eval('#condition-list .ccard', (e) => e.length);
    check(`[${tag}] S04: 핵심 조건 요약 카드`, rows >= 4, `${rows}개`);
    check(`[${tag}] S04: 데모 결과 안내·저장 표시`, (await page.textContent('#analysis-source')).includes('데모') && (await page.textContent('#save-status')).includes('저장했어요'));
    await page.click('#condition-list .ccard a.btn-text'); await view('item'); await page.waitForTimeout(300);
    await shot('S05'); await noOverflow('S05'); await codesHidden('S05');
    const chips = await page.$$eval('#item .evidence-chip', (e) => e.map((x) => x.textContent));
    check(`[${tag}] S05: 원문 인용 칩`, chips.length > 0, chips[0]?.slice(0, 40));
    if (chips.length) {
      await page.click('#item .evidence-chip');
      check(`[${tag}] S05: 인용을 누르면 원문 줄 강조`, (await page.$$('#item .doc-line.is-focused')).length === 1);
    }
    check(`[${tag}] S05: 답변 메모는 선택 (추가 버튼)`, await page.isVisible('#memo-add'));

    // S07 새 안내 추가 → 같은 기록
    await page.click('#item-back'); await view('record');
    const recUrl = page.url();
    await page.click('#add-doc'); await view('input');
    await page.check('input[name="doc-type"][value="offer"]');
    await page.click('#example-btn'); await shot('S07'); await noOverflow('S07');
    check(`[${tag}] S07: 추가할 기록 표시`, await page.isVisible('#target-banner'));
    await page.click('#submit-btn'); await view('record');
    check(`[${tag}] S07 → 같은 기록, 자료 2건`, page.url() === recUrl && (await page.$$('#doc-list > li')).length === 2);
    await page.waitForTimeout(300); await shot('S04-two-docs'); await noOverflow('S04 자료 2건'); await codesHidden('S04 자료 2건');

    // S06 목록
    await page.click('#nav-records'); await view('records'); await shot('S06'); await noOverflow('S06');
    check(`[${tag}] S06: 기록 카드`, (await page.$$('#record-list > li')).length >= 1);

    // C) 분석 실패 → 오류 화면 → 재시도 / 원문 수정
    await page.goto(`${BASE}/#/new`); await view('input');
    await page.check('input[name="doc-type"][value="contract"]');
    await page.click('#example-btn');
    await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI 분석 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.' }) }));
    const textBefore = await page.inputValue('#doc-text');
    await page.click('#submit-btn'); await view('error'); await shot('error'); await noOverflow('오류 화면');
    check(`[${tag}] 오류 화면: 오류 안내`, (await page.textContent('#error-message')).includes('응답하지'));
    await page.click('#error-edit'); await view('input');
    check(`[${tag}] 오류 → 원문 수정: S02, 입력 유지`, (await page.inputValue('#doc-text')) === textBefore);
    await page.click('#submit-btn'); await view('error');
    await page.unroute('**/api/analyze');
    await page.click('#retry-btn'); await view('record');
    check(`[${tag}] 오류 → 재시도 성공 시 기록`, await page.isVisible('#view-record'));

    // B) 사진 업로드 → S03 → 분석
    await page.goto(`${BASE}/#/new`); await view('input');
    await page.check('input[name="doc-type"][value="job_posting"]');
    await page.click('#tab-upload');
    await page.setInputFiles('#file-input', 'test/fixtures/upload/posting-ko.png');
    await page.click('#extract-btn');
    await view('review'); await page.waitForTimeout(300); await shot('S03'); await noOverflow('S03');
    check(`[${tag}] S03: 원본 미리보기·추출 텍스트`, (await page.inputValue('#review-text')).includes('급여') && (await page.$eval('#preview-img', (i) => i.complete && i.naturalWidth > 0)));
    await page.click('#review-submit'); await view('record');
    check(`[${tag}] 업로드 경로 기록: 추출 텍스트 기준 안내`, (await page.textContent('#doc-list .input-source-note')).includes('글자를 인식'));

    // D) 화면 전환: 기록 화면에서 폭 바꾸기
    const other = tag === 'desk' ? [390, 844] : [1280, 900];
    await page.setViewportSize({ width: other[0], height: other[1] }); await page.waitForTimeout(300);
    await noOverflow(`S04 폭 전환(${other[0]})`);
    await shot(`S04-switch-${other[0]}`);
    check(`[${tag}] 페이지 오류 없음`, errors.filter((e) => !/502|Failed to load resource/.test(e)).length === 0, errors.join(' | ').slice(0, 200));
    await ctx.close();
  }
} finally {
  await browser.close(); server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n화면 검수: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exitCode = 1;
