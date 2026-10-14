// 사용자 흐름 검사 (실제 브라우저, 1440px·390px). 모의 AI: 사람이 작성한 응답 + 데모 규칙 (실제 Gemini 아님).
//   node scripts/e2e-journey.mjs
// 1) 처음 방문 → 가상문서 받기 → 받은 근로계약서 PDF 등록 → 10개 조건 확인
// 2) 채용공고 하나 → 결과 활용 안내·다음 문서 추가
// 3) 두 문서 비교 → 원문 근거 → '원문 전체에서 위치 보기'(펼침·강조·돌아가기)
// 4) 조건 상세 → 메모 작성 → 결과 화면 복귀(보던 카드 위치), 브라우저 뒤로 가기
// 5) 비교 결과 정리본: 전체 복사·질문만 복사·A4 인쇄(PDF), 세 문서에서 A·B 바꾸면 반영, 질문 없는 비교, 분석 확인 불가 포함
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, QA2_OFFER, QA2_OFFER_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';
import { SAMPLE_FILES } from '../public/samples.js';

const OUT = 'e2e-artifacts/journey';
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const DOCS = [[GQ_POSTING, GQ_POSTING_SPECS], [QA2_OFFER, QA2_OFFER_SPECS], [QA2_CONTRACT, QA2_CONTRACT_SPECS]];
const demo = createDemoAnalyzer();
let forgeWage = false; // 임금 인용을 원문에 없는 문장으로 → 서버 검증에서 '분석 확인 불가'
const ai = {
  name: 'demo',
  async analyze(args) {
    const text = args.segments.map((s) => s.text).join('\n');
    const doc = DOCS.find(([t]) => segmentText(t).map((s) => s.text).join('\n') === text);
    const out = doc ? { criteria: buildExtraction(args.segments, doc[1], CRITERION_IDS).criteria.filter((c) => args.criterionIds.includes(c.id)) } : await demo.analyze(args);
    if (forgeWage) for (const c of out.criteria) if (c.id.startsWith('01-') && c.quotes?.length) c.quotes = [{ line: c.quotes[0].line, text: '연봉 9,999만원 (가상)' }];
    return out;
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 30000 });
    const text = (sel) => page.textContent(sel);
    const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }).catch(() => false);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const clip = () => page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const register = async (type, body) => {
      await view('input');
      await page.check(`input[name="doc-type"][value="${type}"]`);
      if (!(await page.isVisible('#doc-text'))) await page.click('#tab-paste');
      await page.fill('#doc-text', body);
      await page.click('#submit-btn');
      await view('record'); await page.waitForTimeout(200);
    };
    const addDoc = () => page.click('#add-second:visible, #add-doc-top:visible');

    // ---- 1) 처음 방문 → 가상문서 → 근로계약서 PDF 등록 ----
    await page.goto(`${BASE}/#/`); await view('landing');
    await page.waitForSelector('#landing-how:not([hidden])', { timeout: 5000 });
    const steps = await page.$$eval('.step-list > li h3', (els) => els.map((e) => e.textContent));
    const hier = await page.evaluate(() => {
      const a = document.querySelector('#landing-start'); const b = document.querySelector('#landing-how');
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      return { aBg: getComputedStyle(a).backgroundColor, bBg: getComputedStyle(b).backgroundColor, aH: ra.height, bH: rb.height, bVisible: rb.top < window.innerHeight };
    });
    check(`[${tag}] 랜딩: 이용 방법 = 문서 한 개 → 주요 조건 → (선택) 비교 → 근거·질문, 계약서 단독 안내`, steps[0].startsWith('문서 한 개 등록하기') && steps[2].includes('선택') && (await text('#view-landing')).includes('근로계약서는 한 개만으로도') && !/반드시|필수/.test(await text('.step-list')), steps.join(' | '));
    check(`[${tag}] 랜딩: 첫 화면에서 가상문서로 가는 보조 버튼 (메인 CTA보다 덜 강조)`, hier.bVisible && hier.aBg !== hier.bBg && hier.aH >= hier.bH && (await text('#landing-start')).includes('첫 문서 등록하기'), JSON.stringify(hier));
    await page.click('#landing-how'); await page.waitForTimeout(700);
    check(`[${tag}] 랜딩: 가상문서 영역으로 이동·강조, 개별 3종 + ZIP`, await inView('#sample-dl-list') && (await page.$$('#sample-dl-list a')).length === 3 && await page.isVisible('#sample-zip'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sample-dl-list li:nth-child(3) a')]);
    const pdf = readFileSync(await dl.path());
    await page.click('#landing-start'); await view('input');
    check(`[${tag}] 등록 화면에는 가상문서 다운로드 영역 없음`, !(await page.$('#view-input .sample-download, #view-input #sample-dl-list')));
    await page.check('input[name="doc-type"][value="contract"]');
    await page.click('#tab-upload');
    await page.setInputFiles('#file-input', { name: SAMPLE_FILES[2].name, mimeType: 'application/pdf', buffer: pdf });
    await view('review');
    await page.waitForFunction(() => document.querySelector('#review-text').value.length > 50, null, { timeout: 30000 });
    await page.click('#review-submit'); await view('record'); await page.waitForTimeout(300);
    const cCards = await page.$$eval('#condition-list .cmp-card', (els) => els.length);
    const guideC = await text('#result-guide');
    check(`[${tag}] 근로계약서 하나: 10개 기준 카드 + 활용 안내(추가 확인 → 원문 → 메모)`, cCards >= 9 && cCards <= 10 && guideC.includes('이렇게 활용해 보세요') && guideC.includes('답변 메모') && !(await page.isVisible('#open-report')), `카드 ${cCards}`);
    await page.screenshot({ path: `${OUT}/${tag}-1-contract-sample.png`, fullPage: true });

    // ---- 2) 채용공고 하나 ----
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING);
    const guideB = await page.$$eval('#result-guide-steps li', (els) => els.map((e) => e.textContent));
    check(`[${tag}] 채용공고 하나: 활용 안내 = 주요 조건 확인 → 다른 문서 추가, 질문 단계 없음, 다음 문서 CTA 하나`, guideB.length === 2 && guideB[1].includes('다른 문서를 추가') && !guideB.join('').includes('복사') && (await page.$$('#view-record a[href$="/add"]:visible')).length === 1, guideB.join(' | '));

    // ---- 3) 두 문서 비교 → 원문 위치 이동 ----
    await addDoc(); await register('contract', QA2_CONTRACT);
    const guideX = await text('#result-guide');
    check(`[${tag}] 비교: 활용 안내(차이 → 원문 → 질문 고쳐 복사 → 메모) + 정리본 버튼 하나`, guideX.includes('서로 다른 조건') && guideX.includes('질문을 상황에 맞게 고쳐서 복사한 뒤 회사에 직접 확인해 보세요') && guideX.includes('나중에 다시 확인할 수 있어요') && (await page.$$('#open-report')).length === 1);
    const card = '#condition-list [data-group="different"] .cmp-card >> nth=0';
    const cardId = await page.getAttribute(card, 'id');
    await page.click(`#${cardId} details.cmp-evidence > summary`);
    const evFor = await page.$$eval(`#${cardId} .cmp-evidence-for`, (els) => els.map((e) => e.textContent));
    check(`[${tag}] 원문 근거: 조건·문서·줄 번호가 함께 보임`, evFor.length > 0 && evFor.every((t) => t.includes('의 근거') && /(채용공고|근로계약서)/.test(t) && t.includes('번째 줄')), evFor[0]);
    const goto = `#${cardId} .cmp-goto >> nth=0`;
    const quote = await page.getAttribute(goto, 'data-goto-text');
    const line = await page.getAttribute(goto, 'data-goto-line');
    await page.click(goto); await page.waitForTimeout(400);
    const target = await page.$eval('#doc-list .doc-line.is-goto', (li) => ({ line: li.dataset.line, mark: li.querySelector('mark')?.textContent ?? '', open: document.querySelector('#docs-box').open && li.closest('details').open, top: li.getBoundingClientRect().top, h: window.innerHeight })).catch(() => null);
    check(`[${tag}] '원문 전체에서 위치 보기': 접힌 원문 자동 펼침, 그 줄로 이동·강조, 인용 구절만 표시`, target && target.open && target.line === line && target.mark === quote && target.top > 0 && target.top < target.h, JSON.stringify(target));
    await page.screenshot({ path: `${OUT}/${tag}-3-goto.png` });
    await page.click('#doc-list .goto-return button');
    await page.waitForTimeout(300);
    check(`[${tag}] '카드로 돌아가기' → 보던 카드로, 원문 강조 정리`, await inView(`#${cardId}`) && !(await page.$('#doc-list .doc-line.is-goto')));

    // ---- 4) 조건 상세 → 메모 → 복귀 ----
    const item = await page.getAttribute(`#${cardId}`, 'data-item');
    await page.click(`#${cardId} .cmp-detail-link`); await view('item');
    const order = await page.evaluate(() => { const m = document.querySelector('#item .memo'); const d = document.querySelector('#item .doc-block'); return m && d ? Boolean(m.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) : false; });
    check(`[${tag}] 조건 상세: 질문 다음에 답변 메모가 원문보다 먼저, 공식 조건과 구분 안내`, order && (await text('#item .memo')).includes('나중에 다시 확인할 수 있어요') && (await text('#item .memo')).includes('공식 근로조건이나 확인된 사실로 표시되지 않'));
    await page.click('#memo-add'); await page.fill('#memo-text', '담당자: 연봉은 계약서 기준 (가상 메모)'); await page.click('#memo-save');
    await page.waitForSelector('.memo-item');
    await page.click('#item .detail-actions a'); await view('record'); await page.waitForTimeout(300);
    check(`[${tag}] 상세에서 돌아오면 보던 카드 위치, 메모 표시 유지`, await inView(`#cmp-item-${item}`) && (await text(`#cmp-item-${item}`)).includes('내 메모 있음'));
    await page.click(`#cmp-item-${item} .cmp-detail-link`); await view('item');
    await page.goBack(); await view('record'); await page.waitForTimeout(300);
    check(`[${tag}] 브라우저 뒤로 가기도 보던 카드 위치로`, await inView(`#cmp-item-${item}`));
    check(`[${tag}] 결과 화면 가로 넘침 없음`, await noOverflow());

    // ---- 5) 비교 결과 정리본 ----
    const recUrl = page.url();
    await page.click('#open-report'); await view('report');
    const rep = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('#report [data-group]')].map((g) => g.dataset.group),
      items: document.querySelectorAll('#report .report-item').length,
      docs: document.querySelector('#report .report-docs').textContent,
      q: document.querySelectorAll('#report .report-questions li').length,
    }));
    check(`[${tag}] 정리본: 비교한 문서 A·B, 묶음(차이 먼저), 질문 포함`, rep.docs.includes('문서 A · 채용공고') && rep.docs.includes('문서 B · 근로계약서') && rep.groups[0] === 'different' && rep.items > 0 && rep.q > 0, JSON.stringify(rep.groups));
    await page.click('#report-copy'); await page.waitForTimeout(200);
    const all = await clip();
    check(`[${tag}] 정리본 전체 복사: 제목·문서·값·원문 근거·질문 구분`, ['비교 결과 정리본', '[비교한 문서]', '문서 A(채용공고)', '원문 근거', '[회사에 확인할 질문]', '[안내]'].every((s) => all.includes(s)), `${all.length}자`);
    await page.click('#report-copy-q'); await page.waitForTimeout(200);
    const qOnly = await clip();
    check(`[${tag}] 질문만 복사: 질문 문장만 (정리본과 구분)`, qOnly.length > 0 && !qOnly.includes('[비교한 문서]') && qOnly.split('\n\n').length === rep.q);
    check(`[${tag}] 정리본 가로 넘침 없음`, await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-5-report.png`, fullPage: true });
    if (tag === 'desk') {
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => ({ toolbar: getComputedStyle(document.querySelector('.report-toolbar')).display, header: getComputedStyle(document.querySelector('.topbar')).display, avoid: getComputedStyle(document.querySelector('.report-item')).breakInside }));
      const buf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      writeFileSync(`${OUT}/report-a4.pdf`, buf);
      const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      check(`[${tag}] 인쇄: 메뉴·버튼 제외, 항목이 페이지 경계에서 잘리지 않게, A4 PDF 생성`, printed.toolbar === 'none' && printed.header === 'none' && printed.avoid === 'avoid' && buf.length > 5000 && pages >= 1, `${JSON.stringify(printed)} pages=${pages}`);
      await page.emulateMedia({ media: 'screen' });
    }

    // 세 문서: A·B 바꾸면 정리본에 반영
    await page.goto(recUrl); await view('record');
    await addDoc(); await register('offer', QA2_OFFER);
    await page.selectOption('#compare-doc-b', { index: 2 }); await page.waitForTimeout(200);
    await page.click('#open-report'); await view('report');
    check(`[${tag}] 세 문서 기록: 선택한 두 문서(채용공고 ↔ 처우 안내)만 정리`, (await text('#report .report-docs')).includes('문서 B · 처우·근로조건 안내') && !(await text('#report .report-docs')).includes('근로계약서'));

    // 질문 없는 비교 (같은 문서 두 번)
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING); await addDoc(); await register('job_posting', GQ_POSTING);
    const noQ = !(await page.isVisible('#cmp-questions'));
    await page.click('#open-report'); await view('report');
    check(`[${tag}] 질문 없는 비교: 질문 강요 없음, 정리본에 '질문 없음', 질문만 복사 버튼 없음`, noQ && (await text('#report .report-questions')).includes('만든 확인 질문은 없어요') && !(await page.isVisible('#report-copy-q')) && (await page.$$('#report [data-group="same"] .report-item')).length > 0);

    // 분석 확인 불가 포함
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING); await addDoc();
    forgeWage = true; await register('contract', QA2_CONTRACT); forgeWage = false;
    const unavailCard = await page.$('[data-group="unavailable"] [data-item="01"]');
    await page.click('#open-report'); await view('report');
    const un = await text('#report').catch(() => '');
    check(`[${tag}] 분석 확인 불가: 조건 없음으로 쓰지 않고 정리본에 별도 묶음, 원문에 없는 인용 없음`, Boolean(unavailCard) && (await page.$$('#report [data-group="unavailable"] .report-item')).length > 0 && un.includes('적혀 있지 않다는 뜻은 아님') && !un.includes('9,999'));

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
console.log(`\n사용자 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
