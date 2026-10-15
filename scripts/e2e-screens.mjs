// S01~S07 화면 검수: 실제 브라우저에서 주요 경로를 데스크톱(1280)·모바일(390) 폭으로 순회하고 화면을 저장한다.
//   node scripts/e2e-screens.mjs        (데모 모드 로컬 서버만 사용, Gemini 호출 없음. 결과: e2e-artifacts/screens/)
// 경로: S01 → S02 직접 입력 → 분석 중 → S04 기록 → S05 항목 상세 → S07 새 안내 추가 → S04, S06 목록,
//       분석 실패(자료는 저장) → 같은 텍스트로 다시 분석, 사진 업로드 → S03 → 분석, 폭 전환
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
    // S01 시작 화면(Stitch 30): 히어로(단일 CTA) · 이용 방법 4단계 · 주요 기능 2개 · 가상 문서 · 안내
    const landing = await page.textContent('#view-landing');
    check(`[${tag}] S01: 헤드라인·서브 카피(문서 하나로 시작, 나중에 추가해 비교)·보조 문구`, landing.includes('입사 전, 놓치지 말고') && landing.includes('받은 문서 하나부터 등록하세요') && landing.includes('나중에 받은 문서를 더하면') && landing.includes('문서 하나만 있어도 시작할 수 있어요'));
    check(`[${tag}] S01: 주요 CTA '첫 문서 등록하기'가 첫 화면에 보임`, (await page.textContent('#landing-start')).includes('첫 문서 등록하기') && await page.$eval('#landing-start', (e) => e.getBoundingClientRect().bottom <= window.innerHeight));
    check(`[${tag}] S01: 등록 CTA는 히어로와 샘플 문서 영역 아래 하나씩 (내 기록 보기·기능 카드 버튼 없음), 내 기록은 헤더에만`, (await page.$$('#view-landing a[href="#/new"]')).length === 2 && (await page.$$('#sample-download a[href="#/new"]')).length === 1 && (await page.$$('#view-landing a[href="#/records"]')).length === 0 && !(await page.$('#landing-records, #landing-start-bottom, .landing-cta')) && (await page.$$('#landing-workflow a, #landing-workflow button')).length === 0 && await page.isVisible('#nav-records'));
    const hero = await page.textContent('.hero-visual');
    check(`[${tag}] S01: 대표 비주얼 = 문서 카드 3장 + 조건 차이 확인 (가상 예시 표시, 헤드라인 반복 없음)`, ['채용공고', '처우 안내', '근로계약서', '조건 차이 확인', '가상 예시'].every((x) => hero.includes(x)) && !hero.includes('놓치지 말고'));
    check(`[${tag}] S01: 비주얼 안에는 누를 수 있는 요소 없음 (실제 CTA만)`, (await page.$$('.hero-visual a, .hero-visual button')).length === 0);
    const steps = await page.$$eval('.step-list > li h3', (els) => els.map((e) => e.textContent));
    check(`[${tag}] S01: 이용 방법 4단계`, steps.join('|') === '문서 한 개 등록하기|주요 근로조건 확인하기|다른 문서 추가해 비교하기 선택|원문 근거 보고 질문 준비하기', steps.join('|'));
    const flow = await page.textContent('#landing-workflow');
    check(`[${tag}] S01: 주요 기능 두 가지 구분 (문서 2개 비교 / 근로계약서 단독 확인, 10개 조건)`, flow.includes('문서 2개 비교') && flow.includes('근로계약서 단독 확인') && (await page.$$('#landing-workflow .use-cards > li')).length === 2 && (await page.$$('#landing-criteria li')).length === 10);
    check(`[${tag}] S01: 처우 안내는 세 문서 중 하나(필수 단계 아님), 순서·필수 표현 없음`, landing.includes('처우·근로조건 안내') && landing.includes('등록 순서는 정해져 있지 않아요') && !/최종합격 안내|필수|반드시|순서대로/.test(landing));
    check(`[${tag}] S01: 정확한 안내 (Gemini 사용·브라우저 저장·법률 판단 안 함, '100% 로컬' 없음)`, landing.includes('Google Gemini') && landing.includes('브라우저에만 저장') && landing.includes('법률 위반 여부') && !/100% ?로컬|변경됐|변경되었|위반입니다/.test(landing));
    await page.goto(BASE); await view('landing');
    await page.click('#nav-records'); await view('records');
    check(`[${tag}] S01: 헤더 '내 기록' → #/records`, page.url().endsWith('#/records'));
    await page.goto(BASE); await view('landing');
    await page.waitForSelector('#landing-how:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.click('#landing-how');
    await page.waitForTimeout(600);
    check(`[${tag}] S01: '샘플 문서로 체험해 보세요' → 샘플 문서 영역으로 이동`, await page.$eval('#sample-download', (e) => e.getBoundingClientRect().top < window.innerHeight));
    await page.click('#landing-start'); await view('input');
    await page.check('input[name="doc-type"][value="job_posting"]');
    // S02 안내 문구가 실제 문서 유형 선택지와 일치 (오퍼 등 예전 명칭 없음)
    const lead = await page.textContent('#input-lead');
    const typeNames = await page.$$eval('.doc-type-name', (els) => els.map((e) => e.textContent.trim()));
    check(`[${tag}] S02: 안내 문구 = 최신 문서 유형 (선택지와 일치)`, lead.startsWith('채용공고, 근로계약서, 처우·근로조건 안내(문자·메일 등) 중 받은 자료 하나부터 등록할 수 있어요.')
      && typeNames.every((t) => lead.includes(t)) && typeNames.length === 3 && !/오퍼|합격 안내/.test(lead), typeNames.join(', '));
    await page.click('#example-btn'); await shot('S02');
    await noOverflow('S02');
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/api/analyze', async (route) => { await gate; await route.continue(); });
    await page.click('#submit-btn'); await view('analyzing'); await shot('analyzing'); await noOverflow('분석 중');
    release(); await view('record'); await page.unroute('**/api/analyze');
    await page.waitForTimeout(300); await shot('S04'); await noOverflow('S04'); await codesHidden('S04');
    const rows = await page.$$eval('#condition-list .cmp-card', (e) => e.length);
    check(`[${tag}] S04: 핵심 조건 요약 카드`, rows >= 4, `${rows}개`);
    check(`[${tag}] S04: 데모 결과 안내·저장 표시`, (await page.textContent('#analysis-source')).includes('데모') && /저장됐어요|추가됐어요/.test(await page.textContent('#save-indicator')));
    await page.click('#condition-list .cmp-card a[href*="/item/"]'); await view('item'); await page.waitForTimeout(300);
    await shot('S05'); await noOverflow('S05'); await codesHidden('S05');
    // 상세: 카드에는 근거 건수만, 인용 전문은 아래 '원문 근거'에서 한 번만 (강조는 글자에만)
    const counts = await page.$$eval('#item .criterion .card-detail p', (e) => e.map((x) => x.textContent).filter((t) => t.includes('관련 원문 근거')));
    const marked = await page.$$eval('#item .paper-sheet > .doc-lines .doc-line.is-marked mark', (e) => e.length);
    check(`[${tag}] S05: 카드에는 근거 건수, 원문 근거는 아래에 한 번만 (강조 표시)`, counts.length > 0 && marked > 0 && (await page.$$('#item .evidence-chip')).length === 0, `${counts[0] ?? ''} · 강조 ${marked}곳`);
    check(`[${tag}] S05: 답변 메모는 선택 (추가 버튼)`, await page.isVisible('#memo-add'));

    // S07 새 안내 추가 → 같은 기록
    check(`[${tag}] S05: 위쪽 '돌아가기' 중복 없음, 아래 돌아가기만`, !(await page.isVisible('#item-back')) && (await page.$$('#item .detail-actions a')).length === 1);
    await page.click('#item .detail-actions a'); await view('record');
    const recUrl = page.url();
    await page.click('#add-doc-top:visible, #add-second:visible'); await view('input');
    await page.check('input[name="doc-type"][value="offer"]');
    await page.click('#example-btn'); await shot('S07'); await noOverflow('S07');
    check(`[${tag}] S07: 추가할 기록 표시`, await page.isVisible('#target-banner'));
    await page.click('#submit-btn'); await view('record');
    check(`[${tag}] S07 → 같은 기록, 자료 2건`, page.url() === recUrl && (await page.$$('#doc-list > li')).length === 2);
    await page.waitForTimeout(300); await shot('S04-two-docs'); await noOverflow('S04 자료 2건'); await codesHidden('S04 자료 2건');

    // S06 목록
    await page.click('#nav-records'); await view('records'); await shot('S06'); await noOverflow('S06');
    check(`[${tag}] S06: 기록 카드`, (await page.$$('#record-list > li')).length >= 1);

    // C) 분석 실패 → 자료는 저장, '분석 실패' 상태 → 같은 텍스트로 다시 분석 (v3.2: 저장과 분석 분리)
    await page.goto(`${BASE}/#/new`); await view('input');
    await page.check('input[name="doc-type"][value="contract"]');
    await page.click('#example-btn');
    await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI 분석 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.' }) }));
    await page.click('#submit-btn'); await view('record'); await page.waitForTimeout(300); await shot('analysis-failed'); await noOverflow('분석 실패 기록');
    check(`[${tag}] 분석 실패: 자료는 저장, 분석 실패 안내`, (await page.textContent('#save-status')).includes('자료는 이 브라우저에 저장했어요') && (await page.textContent('#save-status')).includes('분석은 완료하지 못했어요') && (await page.textContent('#doc-list')).includes('분석 실패'));
    await page.unroute('**/api/analyze');
    await page.click('#doc-list button[data-reanalyze]');
    await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('다시 분석한 결과'));
    check(`[${tag}] 분석 실패 → 같은 텍스트로 다시 분석 → 기록`, (await page.$$('#condition-list .cmp-card')).length > 0 && (await page.$$('#doc-list > li')).length === 1);

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
