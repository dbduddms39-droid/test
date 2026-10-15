// MVP 통합 QA 회귀 검사 (실제 브라우저, 1280px·390px). 모의 AI: test/gemini-qa-docs.js·test/demo-docs.js의 사람이 작성한 응답 (실제 Gemini 아님).
//   node scripts/e2e-mvpqa.mjs
// 문서 1개(채용공고·처우 안내 미리보기, 근로계약서 확인), 문서 2개(세 조합), 분석 정확성(임금 차이·같은 금액·계산값·목차 제거),
// UI(null 노출, 형광펜 범위, 분석 중 문구, 질문 복사, 개인정보 안내 펼치기, 가상 문서 개별·ZIP 다운로드, 가로 넘침).
// 체험용 가상 문서: 저장소 public/samples/의 원본으로 실제 다운로드·ZIP을 받아 원본과 비교한다 (파일이 없을 때 숨김은 404로 확인).
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, GQ_POSTING_LONG_EVIDENCE, GQ_POSTING_LONG_EVIDENCE_SPECS, QA2_OFFER, QA2_OFFER_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';
import { DEMO_POSTING, DEMO_POSTING_SPECS } from '../test/demo-docs.js';
import { DUP_POSTING, DUP_POSTING_SPECS, DUP_OFFER, DUP_OFFER_SPECS, DUP_CONTRACT, DUP_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';
import { SAMPLE_FILES, SAMPLE_ZIP_NAME } from '../public/samples.js';

const OUT = 'e2e-artifacts/mvpqa';
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const DOCS = [[DUP_POSTING, DUP_POSTING_SPECS], [DUP_OFFER, DUP_OFFER_SPECS], [DUP_CONTRACT, DUP_CONTRACT_SPECS], [GQ_POSTING, GQ_POSTING_SPECS], [GQ_POSTING_LONG_EVIDENCE, GQ_POSTING_LONG_EVIDENCE_SPECS], [QA2_OFFER, QA2_OFFER_SPECS], [QA2_CONTRACT, QA2_CONTRACT_SPECS], [DEMO_POSTING, DEMO_POSTING_SPECS]];
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
  // 체험용 가상 문서 원본 (저장소 public/samples/, 사용자가 제공한 파일 그대로)
  const originals = SAMPLE_FILES.map((f) => readFileSync(join('public', f.path)));

  for (const [w, h, tag] of [[1280, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let dialogAnswer = 'accept'; const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); return dialogAnswer === 'accept' ? d.accept() : d.dismiss(); });
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15000 });
    const text = (sel) => page.textContent(sel);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    // 보이는 화면 글자에 null·undefined가 없는지 (숨은 화면 포함, 질문 입력칸 포함)
    const noNull = () => page.evaluate(() => {
      const w2 = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
      let n; while ((n = w2.nextNode())) if (/\bnull\b|\bundefined\b|NaN/.test(n.textContent)) return false;
      return [...document.querySelectorAll('textarea')].every((t) => !/\bnull\b|\bundefined\b/.test(t.value));
    });
    const register = async (type, body) => {
      await view('input');
      await page.check(`input[name="doc-type"][value="${type}"]`);
      await page.fill('#doc-text', body);
      await page.click('#submit-btn');
      await view('record'); await page.waitForTimeout(150);
    };
    const addDoc = async () => { await page.click('#add-second:visible, #add-doc-top:visible'); };
    const groups = () => page.$$eval('#condition-list [data-group]', (els) => els.map((g) => ({ key: g.dataset.group, count: g.querySelector(':scope > .cgroup-title .sum-count') ? Number(g.querySelector(':scope > .cgroup-title .sum-count').textContent) : null, cards: g.querySelectorAll('.ccard, .cmp-card').length, open: g.tagName === 'DETAILS' ? g.open : null })));
    // 비교 요약 칸 숫자 (상태 → 건수)
    const tiles = () => page.$$eval('#cmp-tiles .cmp-tile', (els) => Object.fromEntries(els.map((t) => [t.dataset.jump, Number(t.querySelector('.cmp-tile-count strong').textContent)])));
    const card = (id) => text(`#condition-list [data-item="${id}"]`);

    // ---- 문서 1개: 채용공고 → 간결한 미리보기 ----
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', DEMO_POSTING);
    const g1 = await groups();
    const single = async () => ({ doc: await text('#cmp-docs'), tl: await tiles(), cards: await page.$$eval('#condition-list .cmp-card', (els) => els.map((e) => ({ id: e.dataset.item, st: e.dataset.status, panels: e.querySelectorAll('.cmp-panel').length, compact: e.classList.contains('cmp-row') }))) });
    const s1 = await single();
    // 목록형 묶음('문서에 적힌/기재된 조건')은 제목 옆 건수를 다시 적지 않는다 (요약 칸에만)
    const sumMatches = (s, g) => g.every((x) => (x.count === x.cards || (x.count === null && ['stated', 'written'].includes(x.key))) && s.tl[x.key] === x.cards) && Object.values(s.tl).reduce((a, b) => a + b, 0) === s.cards.length;
    check(`[${tag}] 채용공고 단독: 문서 정보 카드(유형·등록 완료·등록일) → 요약 칸 → 조건 카드, 두 번째 문서 CTA`, s1.doc.includes('채용공고') && s1.doc.includes('등록 완료') && s1.doc.includes('등록 ')
      && (await text('#conditions-title')) === '주요 조건 미리보기' && g1.map((g) => g.key).every((k) => ['stated', 'deferred', 'unavailable'].includes(k)) && s1.cards.length >= 4 && s1.cards.every((c) => c.panels === 1 || (c.compact && c.st === 'stated'))
      && await page.isVisible('#add-second') && (await text('#add-second')).includes('비교할 두 번째 문서 추가하기') && (await text('#next-step')).includes('다른 문서를 추가하면 근로조건이 어떻게 달라졌는지 비교할 수 있어요.'), JSON.stringify(s1.tl));
    check(`[${tag}] 채용공고 단독: 요약 숫자 = 묶음 숫자 = 카드 수`, sumMatches(s1, g1), g1.map((g) => `${g.key}:${g.count}/${g.cards}`).join(' '));
    check(`[${tag}] 채용공고 단독: 회사 질문·미기재 판정 없음`, (await page.$$('#view-record .q-text')).length === 0 && !(await page.isVisible('#now-section')) && !(await page.isVisible('#cmp-questions')) && !(await text('#condition-list')).includes('문서에서 확인되지 않음') && !(await page.isVisible('#copy-all-questions')));
    check(`[${tag}] 채용공고 단독: 같은 조건 반복 없음 (전체 목록 중복 숨김), 원문·기록 관리 유지`, !(await page.isVisible('#all-conditions')) && await page.isVisible('#docs-box') && !(await page.$eval('#docs-box', (d) => d.open)) && (await text('#actions-title')) === '기록 관리');
    await page.click('#cmp-item-01 details.cmp-evidence > summary');
    const ev1 = await page.$eval('#cmp-item-01 details.cmp-evidence', (d) => ({ open: d.open, quotes: [...d.querySelectorAll('.cmp-quote')].map((q) => q.textContent), labels: [...d.querySelectorAll('.cmp-evidence-for')].map((x) => x.textContent) }));
    check(`[${tag}] 채용공고 단독: 원문 근거 펼치기 (원문 그대로·대상 조건·줄 번호, 중복 없음)`, ev1.open && ev1.quotes.length > 0 && ev1.quotes.every((q) => DEMO_POSTING.includes(q)) && new Set(ev1.quotes).size === ev1.quotes.length && ev1.labels.every((l) => l.includes('의 근거') && l.includes('번째 줄')), ev1.quotes[0]);
    check(`[${tag}] 채용공고 단독: 미리보기 값 (임금 범위·협의 예정 표시)`, (await card('01')).includes('3,400만~3,800만') && (await card('01')).includes('협의 예정'));
    // 협의·추후 안내: 값은 문서에 적힌 그대로, 설명은 뜻만 (같은 원문·범위를 되풀이하지 않음)
    const defNote = await page.$$eval('[data-group="deferred"] .cmp-card', (els) => els.map((e) => ({ id: e.dataset.item, value: e.querySelector('.cmp-value').textContent, note: e.querySelector('.cmp-note p:not(.cmp-note-title)')?.textContent ?? '' })));
    check(`[${tag}] 협의·추후 안내 카드: 값은 원문 그대로, 설명은 뜻만 ('구체적인 금액은 협의 후 정해져요.' 등), 원문 반복 없음`, defNote.length >= 2 && defNote.every((x) => /^구체적인 (금액|내용)은 (협의 후 정해져요|추후 안내 예정이에요)\.$/.test(x.note) && !x.note.includes(x.value) && !x.note.includes("'")) && defNote.find((x) => x.id === '01').note === '구체적인 금액은 협의 후 정해져요.' && defNote.find((x) => x.id === '01').value.includes('3,400만~3,800만'), JSON.stringify(defNote));
    // 분석 후 저장: 넓은 안내 대신 제목 아래 작은 '이 브라우저에 저장됨' (실제 저장 후에만)
    const ind = await page.$eval('#save-indicator', (e) => ({ text: e.textContent, state: e.dataset.state, visible: e.offsetParent !== null, h: Math.round(e.getBoundingClientRect().height), title: e.title }));
    check(`[${tag}] 분석 후 저장 상태: 작은 '이 브라우저에 저장됨' 표시(브라우저 저장 설명 포함), 넓은 저장 안내 영역 없음`, ind.visible && ind.state === 'saved' && ind.text.includes('이 브라우저에 저장됨') && ind.text.includes('다른 기기나 브라우저에서는 보이지 않아요') && ind.h <= 28 && !(await page.isVisible('#save-status')), JSON.stringify(ind));
    check(`[${tag}] 채용공고 단독: null 없음·가로 넘침 없음`, await noNull() && await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-1-posting.png`, fullPage: true });
    // 두 번째 문서 추가 CTA → 같은 기록에 추가
    const rec1 = page.url();
    await addDoc(); await view('input');
    check(`[${tag}] '비교할 두 번째 문서 추가하기' → 이 기록에 추가 화면`, page.url() === `${rec1}/add` && await page.isVisible('#target-banner'));

    // ---- 문서 1개: 원문 근거가 긴 채용공고 → 값이 짧은 근무시간은 목록형, 값이 긴 담당업무만 전체 너비 ----
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING_LONG_EVIDENCE);
    const kindOf = (id) => page.$eval(`#cmp-item-${id}`, (e) => (e.classList.contains('is-compact') ? 'compact' : e.classList.contains('is-wide') ? 'wide' : 'card'));
    check(`[${tag}] 원문 근거가 길어도 값이 짧은 근무시간은 목록형, 값이 긴 담당업무는 같은 목록에서 전체 너비, 협의·추후 안내는 넓은 카드`, (await kindOf('02')) === 'compact' && (await kindOf('04')) === 'wide' && (await kindOf('08')) === 'card'
      && (await page.$$('[data-group="stated"] .cmp-row .badge')).length === 0 && (await page.$$('#condition-list .cmp-no')).length === 0 && (await page.$$('[data-group="deferred"] .badge')).length === 1);
    // 원문 근거를 모두 펼쳐도 2열이 깨지지 않음: 같은 줄의 두 칸이 겹치지 않고, 근거 글이 칸 밖으로 나가지 않음
    await page.$$eval('[data-group="stated"] details.cmp-evidence', (ds) => ds.forEach((d) => { d.open = true; }));
    await page.waitForTimeout(100);
    const fit = await page.$$eval('[data-group="stated"] .cmp-row', (rows) => {
      const boxes = rows.map((r) => r.getBoundingClientRect());
      const overlap = boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
      const spill = rows.some((r) => { const rb = r.getBoundingClientRect(); return [...r.querySelectorAll('.cmp-quote, .cmp-goto, .cmp-evidence-for')].some((q) => { const b = q.getBoundingClientRect(); return b.right > rb.right + 1 || b.left < rb.left - 1; }); });
      const cols = new Set(boxes.filter((b, i) => rows[i].classList.contains('is-compact')).map((b) => Math.round(b.left))).size;
      return { overlap, spill, cols, hours: rows.find((r) => r.dataset.item === '02').querySelector('details').open };
    });
    // 두 링크 위치 고정 (펼치기 전후 같은 자리), 모바일 터치 높이 44px 이상·서로 떨어져 있음, 키보드 포커스 표시
    await page.$$eval('[data-group="stated"] details.cmp-evidence', (ds) => ds.forEach((d) => { d.open = false; }));
    const linkPos = () => page.$eval('#cmp-item-02', (r) => { const top = r.getBoundingClientRect().top; return ['.cmp-evidence > summary', '.cmp-detail-link'].map((q) => { const b = r.querySelector(q).getBoundingClientRect(); return { y: Math.round(b.top - top), x: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; }); });
    const lp0 = await linkPos();
    await page.click('#cmp-item-02 details.cmp-evidence > summary');
    const lp1 = await linkPos();
    const opened = await page.$eval('#cmp-item-02', (r) => { const s = r.querySelector('.cmp-evidence > summary').getBoundingClientRect(); const q = r.querySelector('.cmp-quote').getBoundingClientRect(); return q.top >= s.bottom; });
    check(`[${tag}] 원문 근거를 펼쳐도 '원문 근거 보기'·'조건 상세·답변 메모'는 같은 자리, 근거는 두 링크 아래`, JSON.stringify(lp0) === JSON.stringify(lp1) && lp0[0].y === lp0[1].y && opened, JSON.stringify([lp0, lp1]));
    check(`[${tag}] 두 링크 터치 영역 ${tag === 'mob' ? '44px 이상' : '32px 이상'}, 서로 16px 이상 떨어짐`, lp0.every((b) => b.h >= (tag === 'mob' ? 44 : 32)) && lp0[1].x - lp0[0].r >= 16, JSON.stringify(lp0));
    await page.focus('#cmp-item-03 .cmp-evidence > summary'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const a = document.activeElement; const st = getComputedStyle(a); return { tag: a.tagName, outline: st.outlineStyle, w: st.outlineWidth }; });
    await page.keyboard.press('Tab');
    const ring2 = await page.evaluate(() => { const a = document.activeElement; const st = getComputedStyle(a); return { cls: a.className, outline: st.outlineStyle }; });
    check(`[${tag}] 키보드: '원문 근거 보기' → '조건 상세·답변 메모' 순서로 이동, 포커스 표시 있음`, ring.tag === 'SUMMARY' && ring.outline !== 'none' && ring2.cls.includes('cmp-detail-link') && ring2.outline !== 'none', JSON.stringify([ring, ring2]));
    await page.$$eval('[data-group="stated"] details.cmp-evidence', (ds) => ds.forEach((d) => { d.open = true; }));
    await page.waitForTimeout(100);
    const fit2 = await page.$$eval('[data-group="stated"] .cmp-row', (rows) => rows.every((r) => { const rb = r.getBoundingClientRect(); return [...r.querySelectorAll('.cmp-row-actions > *')].every((x) => { const b = x.getBoundingClientRect(); return b.left >= rb.left - 1 && b.right <= rb.right + 1; }); }));
    check(`[${tag}] 모두 펼쳐도 링크·근거가 각 칸 안에 있음`, fit2);
    check(`[${tag}] 원문 근거를 펼쳐도 ${tag === 'desk' ? '2열' : '1열'} 유지, 칸끼리 겹치거나 옆 칸을 침범하지 않음, 가로 넘침 없음`, !fit.overlap && !fit.spill && fit.cols === (tag === 'desk' ? 2 : 1) && fit.hours && await noOverflow(), JSON.stringify(fit));

    // ---- 문서 1개: 값 앞 항목명 중복·맨 앞 불렛 (번호·콜론 없는 줄) → 결과 목록 값에서만 정리, 원문 근거·상세 화면은 원문 그대로 ----
    for (const [type, body, expect, quotes] of [
      ['job_posting', DUP_POSTING, { '03': '서울 성동구 성수이로 00, 4층', '04': '브랜드 공식 SNS 채널 운영 · 월간 콘텐츠 캘린더 수립', '05': '정규직', '07': '3개월' }, { '03': '근무장소 서울 성동구 성수이로 00, 4층', '04': '• 브랜드 공식 SNS 채널 운영' }],
      ['offer', DUP_OFFER, { '03': '서울 성동구 성수동 본사', '05': '정규직', '07': '입사 후 3개월' }, { '03': '근무장소 서울 성동구 성수동 본사', '07': '수습기간 입사 후 3개월' }],
      ['contract', DUP_CONTRACT, { '03': '서울 성동구 성수동 본사', '04': '브랜드 공식 SNS 채널 운영 · SNS 콘텐츠 기획·제작 일정 관리', '05': '정규직', '07': '입사 후 3개월' }, { '05': '고용형태 정규직', '04': '• SNS 콘텐츠 기획·제작 일정 관리' }],
    ]) {
      await page.goto(`${BASE}/#/new`);
      await register(type, body);
      const vals = await page.$$eval('#condition-list .cmp-card', (els) => Object.fromEntries(els.map((e) => [e.dataset.item, e.querySelector('.cmp-value').textContent])));
      const okVals = Object.entries(expect).every(([id, v]) => vals[id] === v);
      // 원문 근거: 원문 줄 그대로 (항목명·불렛 포함), 원문 문서에 실제로 있는 글자
      await page.$$eval('#condition-list details.cmp-evidence', (ds) => ds.forEach((d) => { d.open = true; }));
      const ev = await page.$$eval('#condition-list .cmp-card', (els) => Object.fromEntries(els.map((e) => [e.dataset.item, [...e.querySelectorAll('.cmp-quote')].map((q) => q.textContent)])));
      const okEv = Object.entries(quotes).every(([id, q]) => ev[id]?.includes(q)) && Object.values(ev).flat().every((q) => body.includes(q));
      check(`[${tag}] ${type} 단독: 값 앞 항목명·맨 앞 불렛 없이 표시 (번호·콜론 없는 줄 포함), 여러 업무 구분 유지`, okVals, JSON.stringify(Object.fromEntries(Object.keys(expect).map((id) => [id, vals[id]]))));
      check(`[${tag}] ${type} 단독: 원문 근거는 원본 줄 그대로 (항목명·불렛 포함)`, okEv, JSON.stringify(Object.fromEntries(Object.keys(quotes).map((id) => [id, ev[id]]))));
      if (type === 'contract') {
        const recId = page.url().split('/').pop();
        await page.goto(`${BASE}/#/records/${recId}/item/05`); await page.waitForTimeout(400);
        await page.waitForSelector('#view-item:not([hidden])', { timeout: 5000 });
        const detail = (await text('#view-item')).replace(/\s+/g, ' ').trim();
        const at = detail.indexOf('고용형태 정규직');
        check(`[${tag}] 조건 상세 화면은 이번 변경과 무관 (원문 근거 '고용형태 정규직' 그대로)`, await page.isVisible('#view-item') && at >= 0, detail.slice(Math.max(0, at - 30), at + 30));
      }
      await page.screenshot({ path: `${OUT}/${tag}-dup-${type}.png`, fullPage: true });
    }

    // ---- 문서 1개: 처우 안내 → 간결한 미리보기 ----
    await page.goto(`${BASE}/#/new`);
    await register('offer', QA2_OFFER);
    const s2 = await single();
    check(`[${tag}] 처우 안내 단독: 문서 카드·카드형 미리보기·질문 없음`, s2.doc.includes('처우·근로조건 안내') && s2.cards.length > 0 && sumMatches(s2, await groups()) && (await page.$$('#view-record .q-text')).length === 0 && await page.isVisible('#add-second'));
    await page.screenshot({ path: `${OUT}/${tag}-1-offer.png`, fullPage: true });

    // ---- 문서 1개: 근로계약서 → 기재 내용 확인 ----
    await page.goto(`${BASE}/#/new`);
    await register('contract', QA2_CONTRACT);
    const g3 = await groups();
    const s3 = await single();
    const order3 = g3.map((g) => g.key);
    check(`[${tag}] 근로계약서 단독: 10개 기준 카드, 추가 확인 필요 → 계산으로 확인 → 기재된 조건 순서 (요약 칸도 같은 순서)`, s3.cards.length === 10 && order3[0] === 'needs' && order3.every((k, i) => i === 0 || ['needs', 'calculated', 'written', 'unavailable'].indexOf(k) > ['needs', 'calculated', 'written', 'unavailable'].indexOf(order3[i - 1])) && JSON.stringify(Object.keys(s3.tl)) === JSON.stringify(order3.filter((k) => k !== 'unavailable' || s3.tl.unavailable)), order3.join());
    check(`[${tag}] 근로계약서 단독: 요약 숫자 = 묶음 숫자 = 카드 수, 법률 판단 안 함 안내`, sumMatches(s3, g3) && (await text('#cmp-summary-total')).includes('법률 위반 여부는 판단하지 않아요'), JSON.stringify(s3.tl));
    check(`[${tag}] 근로계약서 단독: '여전히' 없이 '추가 확인이 필요한 조건', 미리보기 CTA 없음, 점검표·요약 중복 영역 없음`, (await text('#condition-list')).includes('추가 확인이 필요한 조건') && !(await text('#view-record')).includes('여전히') && !(await page.isVisible('#next-step')) && !(await page.$('#contract-checklist, #contract-glance, #result-overview')) && !(await page.isVisible('#all-conditions')));
    const c02 = await card('02');
    check(`[${tag}] 계산값: 근무시간은 '계산으로 확인한 조건' 묶음, 원문 기재값과 '(계산값)' 구분, '내용이 모호함' 아님`, (await page.getAttribute('#cmp-item-02', 'data-status')) === 'calculated' && c02.includes('10:00~19:00') && c02.includes('주 40시간 (계산값)') && c02.includes('원문 기재값') && !c02.includes('내용이 모호함'), c02.slice(0, 160));
    check(`[${tag}] 요약 값에 원문 목차·항목명 없음 (근무장소·담당업무·수습기간)`, (await text('#cmp-item-03 .cmp-value')).includes('서울 성동구 성수동 본사') && !(await text('#cmp-item-03 .cmp-value')).includes('2. 근무장소') && !(await text('#cmp-item-04 .cmp-value')).includes('업무의 내용') && (await text('#cmp-item-07 .cmp-value')).includes('입사 후 3개월'));
    // 목록형: 문서에 기재된 조건은 한 목록(데스크톱 2열/모바일 1열), 반복 '기재됨' 배지·번호·묶음 제목 옆 건수 없음, 근거·상세 링크 유지. 추가 확인·계산값은 넓은 카드
    const compact = await page.$eval('[data-group="written"]', (g) => {
      const rows = g.querySelector('.cmp-rows');
      const items = [...g.querySelectorAll('.cmp-rows > .cmp-row')];
      return { n: items.length, all: g.querySelectorAll('.cmp-card').length, cols: getComputedStyle(rows).gridTemplateColumns.split(' ').length,
        ev: items.every((r) => r.querySelector('details.cmp-evidence > summary')?.textContent === '원문 근거 보기'), link: items.every((r) => r.querySelector('a.cmp-detail-link')?.textContent.includes('조건 상세·답변 메모')),
        plainBadges: g.querySelectorAll('.cmp-row .badge').length, nos: g.querySelectorAll('.cmp-no').length, titleCount: Boolean(g.querySelector(':scope > .cgroup-title .sum-count')) };
    });
    const keepWide = await page.$$eval('[data-group="needs"] .cmp-card, [data-group="calculated"] .cmp-card', (els) => els.length >= 2 && els.every((e) => !e.classList.contains('cmp-row') && e.querySelector('.badge') && !e.querySelector('.cmp-no')));
    check(`[${tag}] 근로계약서 단독: 기재된 조건은 목록형 ${tag === 'desk' ? '2열' : '1열'}, 반복 배지·번호·중복 건수 없음, 근거·상세 유지, 추가 확인·계산값은 넓은 카드(상태 배지 유지)`, compact.n === compact.all && compact.n >= 3 && compact.cols === (tag === 'desk' ? 2 : 1) && compact.ev && compact.link && compact.plainBadges === 0 && compact.nos === 0 && !compact.titleCount && keepWide && (await page.$$('[data-group="needs"] .sum-count')).length === 1, JSON.stringify(compact));
    const needQ = await page.$$eval('[data-group="needs"] .cmp-card', (els) => els.map((e) => e.querySelectorAll('.q-text').length));
    check(`[${tag}] 근로계약서 단독: 질문 모아보기 조건명 이동 목록은 비교 화면에만 (단독 화면 변경 없음)`, !(await page.isVisible('#cmp-q-links')) && (await page.$$('#cmp-q-links li')).length === 0 && (await page.$$('#condition-list .cmp-question.is-action, #condition-list .cmp-sec-label')).length === 0);
    check(`[${tag}] 근로계약서 단독: 질문은 추가 확인 카드 안 + 위쪽 '질문 전체 복사' 하나 (아래 중복 없음)`, (await page.$$('[data-group="written"] .q-text, [data-group="calculated"] .q-text')).length === 0 && needQ.length > 0 && (await page.isVisible('#copy-all-top')) && !(await page.isVisible('#copy-all-questions')), JSON.stringify(needQ));
    check(`[${tag}] 근로계약서 단독: null 없음·가로 넘침 없음`, await noNull() && await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-3-contract.png`, fullPage: true });
    // 원문 근거 형광펜: 줄 전체가 아니라 글자에만
    await page.click('#cmp-item-03 .cmp-detail-link');
    await view('item'); await page.waitForTimeout(150);
    const hl = await page.evaluate(() => {
      const li = document.querySelector('#item .doc-line.is-marked');
      const mark = li?.querySelector('mark');
      if (!li || !mark) return null;
      const rowBg = getComputedStyle(li).backgroundColor;
      const textW = [...mark.getClientRects()].reduce((a, r) => a + r.width, 0);
      return { rowBg, textW, lineW: li.getBoundingClientRect().width, inline: getComputedStyle(mark).display };
    });
    check(`[${tag}] 원문 형광펜: 강조할 글자 길이까지만 (줄 배경 없음, 인라인)`, hl && /rgba\(0, 0, 0, 0\)|transparent/.test(hl.rowBg) && hl.inline === 'inline' && hl.textW < hl.lineW * 0.9, JSON.stringify(hl));
    check(`[${tag}] 항목 상세: null 없음`, await noNull());
    await page.screenshot({ path: `${OUT}/${tag}-3-contract-item03.png`, fullPage: true });

    // ---- 문서 2개: 세 조합 ----
    const combos = [
      ['채용공고 ↔ 처우 안내', [['job_posting', GQ_POSTING], ['offer', QA2_OFFER]]],
      ['채용공고 ↔ 근로계약서', [['job_posting', GQ_POSTING], ['contract', QA2_CONTRACT]]],
      ['처우 안내 ↔ 근로계약서', [['offer', QA2_OFFER], ['contract', QA2_CONTRACT]]],
      ['근로계약서 → 채용공고 (등록 순서 반대)', [['contract', QA2_CONTRACT], ['job_posting', GQ_POSTING]]],
    ];
    for (const [name, docs] of combos) {
      await page.goto(`${BASE}/#/new`);
      for (const [i, [t, x]] of docs.entries()) { if (i) { await addDoc(); } await register(t, x); }
      const g = await groups();
      const order = ['different', 'review', 'onesided', 'unavailable', 'same'];
      const tl = await tiles();
      check(`[${tag}] ${name}: 서로 다른 → 추가 대조 → 한쪽에만 → 확인 불가 → 같은 조건(접힘) 순서, 묶음 숫자 = 카드 수 = 요약 칸 숫자`, (await text('#conditions-title')) === '두 문서의 근로조건을 비교했어요'
        && g.every((x) => x.count === x.cards && tl[x.key] === x.cards) && order.every((k) => (tl[k] ?? -1) === (g.find((x) => x.key === k)?.cards ?? 0))
        && g.map((x) => order.indexOf(x.key)).every((v, k, a) => v >= 0 && (k === 0 || v > a[k - 1])) && g.filter((x) => x.key === 'same').every((x) => x.open === false),
      `${g.map((x) => `${x.key}:${x.count}/${x.cards}`).join(' ')} tiles=${JSON.stringify(tl)}`);
      const docCards = await page.$$eval('#cmp-docs .cmp-doc', (els) => els.map((e) => e.querySelector('.cmp-doc-label').textContent));
      check(`[${tag}] ${name}: 문서 A·B 카드 = 등록 순서, 등록일 표시`, docCards.length === 2 && docCards[0].startsWith('문서 A') && docCards[1].startsWith('문서 B') && (await text('#cmp-docs')).includes('등록 '), docCards.join(' / '));
      const panelsOk = await page.$$eval('#condition-list .cmp-card', (els) => els.every((c) => c.querySelectorAll(':scope > .cmp-panels > .cmp-panel').length === 2));
      check(`[${tag}] ${name}: 모든 조건 카드에 A·B 값 칸 2개`, panelsOk);
      const oneSided = await page.$$eval('#condition-list .cmp-card.is-onesided .cmp-panel.is-empty', (els) => els.map((e) => e.textContent));
      check(`[${tag}] ${name}: 한쪽에만 기재 → '원문에 언급 없음', 삭제·변경으로 보지 않음`, oneSided.every((t) => t.includes('원문에 언급 없음') && t.includes('없어지거나 바뀐 것으로 보지 않아요')) && !/삭제됐|삭제되었|변경됐|변경되었/.test(await text('#condition-list')), `${oneSided.length}칸`);
      const cardIds = await page.$$eval('#condition-list .cmp-card', (els) => els.map((e) => e.dataset.item));
      if (docs.some(([t]) => t === 'contract')) {
        const pv = async (id) => page.$eval(`#cmp-item-${id} .cmp-panels`, (e) => e.textContent).catch(() => '');
        const [p03, p04, p07] = [await pv('03'), await pv('04'), await pv('07')];
        check(`[${tag}] ${name}: A·B 값에 원문 목차·항목명 없음 (근무장소·담당업무·수습기간)`, p03.includes('서울 성동구 성수동 본사') && !p03.includes('2. 근무장소') && !p04.includes('업무의 내용') && p07.includes('입사 후 3개월') && !/7\.|수습기간 및 수습 중 임금/.test(p07), `${p03.slice(0, 60)} | ${p07.slice(0, 60)}`);
        const c02 = await pv('02');
        check(`[${tag}] ${name}: 근무시간 계산값은 '(계산값)'으로 원문 기재값과 구분`, c02.includes('10:00~19:00') && c02.includes('주 40시간 (계산값)') && !c02.includes('내용이 모호함'), c02.slice(0, 120));
      }
      check(`[${tag}] ${name}: 같은 조건 카드가 여러 영역에 반복되지 않음`, new Set(cardIds).size === cardIds.length && !(await page.isVisible('#more-box') && (await page.$$('#more-list [data-topic]')).some(() => false)));
      if (docs.some(([t]) => t === 'job_posting')) {
        const d = await page.$('[data-group="different"] [data-item="01"]');
        check(`[${tag}] ${name}: 임금 3,400만 ↔ 3,600만(36,000,000원) 차이 감지 + 질문`, !!d && (await d.textContent()).includes('3,400만') && (await d.$$('.q-text')).length >= 1);
      } else {
        const c01 = await card('01');
        check(`[${tag}] ${name}: 3,600만 원 = 36,000,000원 같은 금액, 월 지급 기준액·지급일은 추가 세부 조건으로 구분`, !(await page.$('[data-group="different"] [data-item="01"]')) && c01.includes('같은 조건 · 세부 조건 추가')
          && c01.includes("연봉은 동일하며, 근로계약서에 '월 지급 기준액 3,000,000원(세전)', 지급일(매월 25일)이 추가로 기재되어 있어요.") && !c01.includes('새롭게 적혔어요'), c01.slice(0, 200));
      }
      check(`[${tag}] ${name}: null 없음·가로 넘침 없음`, await noNull() && await noOverflow());
      await page.screenshot({ path: `${OUT}/${tag}-2-${name.replace(/[^가-힣a-z]+/gi, '_')}.png`, fullPage: true });
    }
    // 확인 질문 복사 (카드 안 질문)
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING); await addDoc(); await register('contract', QA2_CONTRACT);
    // 원문 근거 펼치기: A·B 나뉨, 어떤 조건의 근거인지, 같은 인용 반복 없음
    await page.click('[data-group="different"] [data-item="01"] details.cmp-evidence > summary');
    const ev = await page.$eval('[data-group="different"] [data-item="01"] details.cmp-evidence', (d) => ({ open: d.open, cols: d.querySelectorAll('.cmp-evidence-doc').length,
      labels: [...d.querySelectorAll('.cmp-evidence-for')].map((x) => x.textContent), quotes: [...d.querySelectorAll('.cmp-evidence-doc')].map((c) => [...c.querySelectorAll('.cmp-quote')].map((q) => q.textContent)) }));
    check(`[${tag}] 원문 근거 보기: A·B 두 칸, 근거마다 대상 조건·줄 번호, 같은 칸 안 인용 중복 없음`, ev.open && ev.cols === 2 && ev.labels.length > 0 && ev.labels.every((l) => l.includes('의 근거') && l.includes('번째 줄')) && ev.quotes.every((q) => new Set(q).size === q.length), JSON.stringify(ev.labels).slice(0, 160));
    await page.click('#copy-all-top');
    await page.waitForTimeout(200);
    const clipAll = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(`[${tag}] 위쪽 '질문 전체 복사': 질문 수 = 모아보기 건수`, (await text('#copy-all-top-status')).includes('복사했어요') && clipAll.split('\n\n').length === Number((await text('#cmp-q-count')).replace(/\D/g, '')), await text('#cmp-q-count'));
    const qText = await page.$eval('[data-group="different"] [data-item="01"] .q-text', (e) => e.value);
    await page.click('[data-group="different"] [data-item="01"] .q-block button');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(`[${tag}] 확인 질문 복사`, clip === qText && /임금이/.test(qText), qText.slice(0, 80));
    // 비교 화면: '질문 전체 복사'는 위쪽 질문 모아보기 한 곳에만 (아래 '질문 모두 복사' 중복 없음)
    check(`[${tag}] 질문 전체 복사 버튼은 한 곳에만`, await page.isVisible('#copy-all-top') && !(await page.isVisible('#copy-all-questions')));

    // ---- 부스 피드백 1: 질문 모아보기 조건명 → 그 조건 카드의 질문 영역 (해시 유지·포커스·강조·조건명 확인) ----
    const qCards = await page.$$eval('#condition-list .cmp-card', (els) => els.filter((e) => e.querySelector('.cmp-question .q-text')).map((e) => ({ id: e.dataset.item, label: e.querySelector('h3').textContent })));
    const chips = await page.$$eval('#cmp-q-links .cmp-q-link', (els) => els.map((b) => ({ id: b.dataset.qTarget, text: b.textContent, aria: b.getAttribute('aria-label') })));
    check(`[${tag}] 질문 모아보기: 질문이 있는 조건명만 카드 순서대로 '조건명↓' (질문 수 = 조건명 수, 질문 문장은 복제하지 않음)`, chips.length === qCards.length && chips.length === Number((await text('#cmp-q-count')).replace(/\D/g, ''))
      && chips.every((c, i) => c.id === qCards[i].id && c.text === `${qCards[i].label}↓` && c.aria === `${qCards[i].label} 질문으로 이동`) && (await page.$$('#cmp-questions .q-text')).length === 0, JSON.stringify(chips.map((c) => c.text)));
    const hash0 = await page.evaluate(() => location.hash);
    const jumps = [];
    for (const c of chips) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click(`#cmp-q-links [data-q-target="${c.id}"]`);
      await page.waitForTimeout(700);
      jumps.push(await page.evaluate((id) => {
        const a = document.activeElement; const r = a.getBoundingClientRect();
        return { ok: a.id === `cmp-q-${id}` && a.closest('.cmp-card')?.dataset.item === id, inView: r.top >= 0 && r.top < innerHeight, title: a.querySelector('.cmp-question-title')?.textContent ?? '', arrived: a.classList.contains('is-arrived'), named: a.getAttribute('aria-labelledby') === `cmp-q-title-${id}` };
      }, c.id));
    }
    check(`[${tag}] 조건명 누르면 그 조건의 질문 영역으로 이동·포커스·강조, 도착한 곳에 조건명 표시, 해시 라우팅 그대로`, jumps.every((j, i) => j.ok && j.inView && j.arrived && j.named && j.title === `회사에 확인할 질문 · ${qCards[i].label}`) && (await page.evaluate(() => location.hash)) === hash0, JSON.stringify(jumps.map((j) => [j.ok, j.inView, j.arrived])));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.focus(`#cmp-q-links [data-q-target="${chips.at(-1).id}"]`); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    check(`[${tag}] 키보드(Enter)로도 질문 영역으로 이동, 다음 Tab은 그 질문 입력칸`, (await page.evaluate(() => document.activeElement.id)) === `cmp-q-${chips.at(-1).id}` && await page.keyboard.press('Tab').then(() => page.evaluate(() => document.activeElement.classList.contains('q-text'))));
    await page.screenshot({ path: `${OUT}/${tag}-q-arrived.png` });
    // 이동 후 질문 고치기·복사 그대로
    const qa = `#cmp-q-${chips[0].id} .q-text`;
    await page.fill(qa, '가상 질문: 실제 지급되는 연봉을 확인 부탁드립니다.');
    await page.click(`#cmp-q-${chips[0].id} .q-block button`); await page.waitForTimeout(200);
    check(`[${tag}] 이동한 질문을 고쳐 복사하면 고친 문장이 복사됨`, (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === '가상 질문: 실제 지급되는 연봉을 확인 부탁드립니다.');

    // ---- 부스 피드백 2·3: 사실·대조·할 일 구분, 노랑은 '서로 다른 조건'에만 ----
    const YELLOWS = ['rgb(254, 223, 127)', 'rgba(254, 223, 127, 0.62)', 'rgb(255, 248, 225)', 'rgb(243, 207, 94)'];
    const colorScan = (sel) => page.$eval(sel, (card, Y) => {
      card.querySelectorAll('details').forEach((d) => { d.open = true; });
      const hits = [];
      for (const n of [card, ...card.querySelectorAll('*')]) {
        const st = getComputedStyle(n);
        for (const v of [st.backgroundColor, st.borderLeftColor, st.borderBottomColor, st.boxShadow]) if (Y.some((y) => v.includes(y.slice(4, -1)))) hits.push(`${n.className || n.tagName}:${v}`);
      }
      return hits;
    }, YELLOWS);
    const sameHits = await colorScan('#condition-list .cmp-card[data-status="same"]');
    const diffHits = await colorScan('#condition-list .cmp-card[data-status="different"]');
    check(`[${tag}] 같은 조건 카드에는 노란색 요소 없음 (문서 A 표시·원문 강조 포함), 다른 조건 카드는 노란 가장자리·배지`, sameHits.length === 0 && diffHits.some((h) => h.includes('cmp-card')) && diffHits.some((h) => h.includes('badge')), JSON.stringify({ sameHits, diff: diffHits.slice(0, 3) }));
    const sect = await page.$eval('#condition-list .cmp-card[data-status="different"]', (c) => {
      const q = c.querySelector('.cmp-question'); const note = c.querySelector('.cmp-note');
      return { label: c.querySelector('.cmp-sec-label')?.textContent, note: note.querySelector('.cmp-note-title').textContent, noteBg: getComputedStyle(note).backgroundColor, qBg: getComputedStyle(q).backgroundColor, qBorder: getComputedStyle(q).borderLeftWidth, qTitle: q.querySelector('.cmp-question-title').textContent };
    });
    check(`[${tag}] 카드 안 구분: '두 문서에 적힌 내용' → '대조 요약'(구분선) → '회사에 확인할 질문'(연한 배경·왼쪽 선·제목)`, sect.label === '두 문서에 적힌 내용' && sect.note === '대조 요약' && sect.noteBg === 'rgba(0, 0, 0, 0)' && sect.qBg !== 'rgba(0, 0, 0, 0)' && sect.qBorder === '3px' && sect.qTitle.startsWith('회사에 확인할 질문 · '), JSON.stringify(sect));

    check(`[${tag}] 같은 화면에 '새 문서 추가' 버튼은 하나`, (await page.$$('#view-record a[href$="/add"]:visible')).length === 1);

    // ---- 기록 관리: 이름 바꾸기(새로고침 후 유지) · 개별 삭제 확인창 ----
    const recUrl = page.url();
    check(`[${tag}] 이름이 없으면 제목 자리에 안내 문구 + 연필 버튼 (회사명 자동 표시 없음)`, (await text('#record-title')) === '기록 이름을 입력해 주세요' && (await page.$$('#rename-open svg')).length === 1 && (await text('#rename-open')).includes('이름 입력'));
    await page.click('#rename-open');
    // 저장 실패: 사라지지 않는 오류를 입력칸 아래에 (토스트·성공 문구 없음), 고쳐서 다시 저장 가능
    await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('막힘', 'QuotaExceededError'); }; });
    await page.fill('#rename-input', '파란스텝 콘텐츠 마케터 (가상)');
    await page.click('#rename-form button[type="submit"]');
    await page.waitForSelector('#rename-error:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3200);
    check(`[${tag}] 기록 이름 저장 실패: 입력칸 아래 오류가 남아 있음, 성공 토스트 없음`, await page.isVisible('#rename-error') && (await text('#rename-error')).includes('이름을 저장하지 못했어요') && (await page.getAttribute('#rename-error', 'role')) === 'alert' && await page.isVisible('#rename-input') && !(await text('#toast')).includes('저장했어요'));
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
    // 저장 성공: 넓은 안내 영역 대신 짧은 토스트(aria-live), 몇 초 뒤 사라짐
    await page.click('#rename-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#record-title')?.textContent === '파란스텝 콘텐츠 마케터 (가상)');
    const toast1 = await page.evaluate(() => { const t = document.querySelector('#toast'); const r = t.getBoundingClientRect(); return { text: t.textContent, live: t.getAttribute('aria-live'), shown: t.classList.contains('is-shown'), w: r.width, inView: r.left >= 0 && r.right <= window.innerWidth }; });
    const flash = await page.$eval('#save-status', (e) => (e.hidden ? '' : e.textContent));
    await page.screenshot({ path: `${OUT}/${tag}-rename-toast.png` });
    await page.waitForTimeout(3300);
    const toastGone = await page.$eval('#toast', (t) => !t.classList.contains('is-shown') && getComputedStyle(t).opacity === '0');
    check(`[${tag}] 기록 이름 저장 성공: 토스트 '기록 이름을 저장했어요.'(aria-live) 후 자동으로 사라짐, 넓은 저장 안내 없음`, toast1.text === '기록 이름을 저장했어요.' && toast1.live === 'polite' && toast1.shown && toast1.inView && toastGone && !flash.includes('기록 이름'), JSON.stringify(toast1));
    await page.reload(); await view('record');
    check(`[${tag}] 기록 이름 변경 → 새로고침 후에도 유지`, page.url() === recUrl && (await text('#record-title')) === '파란스텝 콘텐츠 마케터 (가상)' && (await page.$$('#doc-list > li')).length === 2);
    dialogAnswer = 'dismiss'; const d0 = dialogs.length;
    await page.click('#delete-record'); await page.waitForTimeout(200);
    const keptOnCancel = dialogs.length === d0 + 1 && /삭제할까요/.test(dialogs.at(-1)) && page.url() === recUrl;
    dialogAnswer = 'accept';
    await page.click('#delete-record'); await view('records');
    await page.goto(recUrl); await page.waitForTimeout(400);
    check(`[${tag}] 개별 기록 삭제: 확인창(취소 시 유지·확인 시 삭제)`, keptOnCancel && !(await page.isVisible('#view-record')), dialogs.at(-1)?.slice(0, 40));

    // ---- 분석 중 문구 (조사 오류 없음) ----
    await page.goto(`${BASE}/#/new`);
    let release; const gate = new Promise((r) => { release = r; });
    await page.route('**/api/analyze', async (route) => { await gate; await route.continue(); });
    await view('input'); await page.check('input[name="doc-type"][value="contract"]'); await page.fill('#doc-text', QA2_CONTRACT); await page.click('#submit-btn');
    await view('analyzing');
    const an = await text('#view-analyzing');
    check(`[${tag}] 분석 중: '근로조건을 확인하고 있어요.' (을(를) 표기 없음, 진행률 표현 없음)`, (await text('#analyzing-title')) === '근로조건을 확인하고 있어요.' && an.includes('문서에 적힌 내용을 항목별로 정리하고 있어요.') && !/\(를\)|\(가\)|\(는\)|%/.test(an));
    release(); await view('record'); await page.unroute('**/api/analyze');

    // ---- 개인정보 안내: 핵심은 항상, 상세는 펼쳐보기 ----
    await page.goto(`${BASE}/#/new`); await view('input');
    const core = await text('#privacy-note .privacy-core');
    check(`[${tag}] 개인정보: 접힌 상태에서도 Gemini 사용·전달 시점·저장 범위·브라우저 저장 한계 표시`, /Gemini/.test(core) && core.includes('분석 버튼을 누를 때') && core.includes('사진 원본은 저장하지 않아요') && core.includes('PDF는 원본도 함께 저장') && core.includes('이 브라우저에만 저장') && core.includes('브라우저 데이터를 지우면') && !(await page.$eval('#privacy-more', (d) => d.open)));
    await page.click('#privacy-more > summary');
    const more = await page.$eval('#privacy-more', (d) => ({ open: d.open, visible: d.querySelector('p').getBoundingClientRect().height > 0 }));
    await page.click('#privacy-more > summary');
    check(`[${tag}] 개인정보: '자세한 데이터 처리 안내 보기' 펼치기·접기`, more.open && more.visible && !(await page.$eval('#privacy-more', (d) => d.open)) && (await text('#privacy-more > summary')) === '자세한 데이터 처리 안내 보기');
    check(`[${tag}] 등록 화면: 가로 넘침 없음, 다운로드 영역 없음`, await noOverflow() && !(await page.$('#view-input #sample-download, #view-input .sample-download')));

    // ---- 가상 문서 다운로드 ----
    // (1) 파일이 없으면 영역을 숨긴다 (깨진 링크 없음): 서버 응답을 404로 바꿔 확인
    await page.route('**/samples/*.pdf', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto(`${BASE}/#/`); await page.reload(); await view('landing'); await page.waitForTimeout(400);
    check(`[${tag}] 가상 문서 파일이 없으면 다운로드 영역 숨김`, !(await page.isVisible('#sample-download')));
    await page.unroute('**/samples/*.pdf');
    // (2) 실제 파일(public/samples/): 영역 노출, 개별 다운로드, 전체 ZIP — 가로채지 않고 실제 다운로드
    await page.reload(); await view('landing');
    await page.waitForSelector('#sample-download:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.$eval('#sample-download', (e) => e.scrollIntoView());
    const dlBox = await text('#sample-download').catch(() => '');
    const inView = await page.$eval('#sample-download', (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1; });
    check(`[${tag}] 가상 문서 영역 노출: 제목·가상 문서 안내·링크 3개·전체 다운로드, 화면 안에 들어옴, 메인 CTA보다 덜 강조`, await page.isVisible('#sample-download') && inView && dlBox.includes('샘플 문서로 직접 체험해 보세요') && dlBox.includes('가상 회사와 가상의 근로조건')
      && (await page.$$('#sample-dl-list a')).length === 3 && (await text('#sample-zip')) === '전체 다운로드'
      && await page.$eval('#landing-start', (b) => getComputedStyle(b).backgroundColor) !== await page.$eval('#sample-zip', (b) => getComputedStyle(b).backgroundColor));
    await page.screenshot({ path: `${OUT}/${tag}-0-download.png` });
    // 개별 다운로드: 실제로 받은 파일 = 원본 (저장 이름은 링크의 download 속성; 헤드리스는 한글 저장 이름을 'download'로 보고함)
    const links = await page.$$('#sample-dl-list a');
    const names = [];
    let singleOk = links.length === 3;
    for (const [k, a] of links.entries()) {
      const [dl] = await Promise.all([page.waitForEvent('download'), a.click()]);
      names.push(await a.getAttribute('download'));
      singleOk &&= Buffer.compare(readFileSync(await dl.path()), originals[k]) === 0 && names[k] === SAMPLE_FILES[k].name;
    }
    check(`[${tag}] 가상 문서 개별 다운로드 3종: 받은 파일이 원본과 같음`, singleOk, names.join(', '));
    check(`[${tag}] 두 번째 문서 다운로드 이름 = '처우·근로조건 안내'`, names[1] === '일단확인_샘플문서_2_처우·근로조건안내.pdf' && (await text('#sample-dl-list')).includes('처우·근로조건 안내 PDF'), names[1]);
    const [zdl] = await Promise.all([page.waitForEvent('download'), page.click('#sample-zip')]);
    const dir = mkdtempSync(join(tmpdir(), 'ildan-zip-'));
    const zipPath = join(dir, 'samples.zip');
    writeFileSync(zipPath, readFileSync(await zdl.path()));
    // 표준 ZIP 도구(파이썬 zipfile)로 열어 이름·바이트·CRC 확인
    const listing = JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([[i.filename, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]))', zipPath]).toString());
    const sha = (b) => execFileSync('python3', ['-I', '-c', 'import sys,hashlib;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'], { input: b }).toString().trim();
    const hashOk = listing.length === 3 && listing.every(([, h], k) => h === sha(originals[k]));
    check(`[${tag}] '전체 다운로드' ZIP: PDF 3개, 안의 파일이 원본과 같음, 정상 열림`, SAMPLE_ZIP_NAME.endsWith('.zip') && hashOk && listing.every(([n], k) => n === SAMPLE_FILES[k].name), `${JSON.stringify(listing.map((x) => x[0]))} hashOk=${hashOk}`);
    // 받은 PDF를 기존 등록 기능에 올리면 글자를 읽어 확인 화면으로 (분석 요청은 보내지 않음)
    if (tag === 'desk') {
      for (const [k, f] of SAMPLE_FILES.entries()) {
        await page.goto(`${BASE}/#/new`); await view('input');
        await page.check(`input[name="doc-type"][value="${['job_posting', 'offer', 'contract'][k]}"]`);
        await page.click('#tab-upload');
        await page.setInputFiles('#file-input', { name: f.name, mimeType: 'application/pdf', buffer: originals[k] });
        await view('review');
        await page.waitForFunction(() => document.querySelector('#review-text').value.length > 50, null, { timeout: 30000 }).catch(() => {});
        const t = await page.inputValue('#review-text');
        check(`[${tag}] 가상 문서 ${k + 1} (${f.label}): 업로드하면 글자를 읽어 확인 화면으로`, t.length > 50 && /가상/.test(t), `${t.length}자`);
      }
      await page.goto(`${BASE}/#/`); await view('landing');
    }

    // ---- 메인: 이용 방법 두 기능·확인 기준 ----
    const flow = await text('#landing-workflow');
    const landingText = await text('#view-landing');
    check(`[${tag}] 메인: 문서 2개 비교 / 근로계약서 단독 확인 구분, 10개 조건`, flow.includes('문서 2개 비교') && flow.includes('근로계약서 단독 확인') && (await page.$$('#landing-criteria .criteria-chips li')).length === 10);
    check(`[${tag}] 메인: 확인 기준(기재 여부·구체성·계산값 구분) + 법률 판단 안 함 + Gemini·브라우저 저장 안내`, ['기재 여부', '구체성', '계산값'].every((x) => flow.includes(x)) && landingText.includes('법률 위반 여부나 계약의 적법성') && landingText.includes('Google Gemini') && landingText.includes('브라우저에만 저장') && !/100% ?로컬|안전하게/.test(landingText));
    check(`[${tag}] 메인: 핵심 카피 유지·CTA는 히어로 '첫 문서 등록하기' 하나·가로 넘침 없음`, landingText.includes('입사 전, 놓치지 말고') && (await text('#landing-start')).includes('첫 문서 등록하기') && (await page.$$('#view-landing a[href="#/new"]')).length === 2 && (await text('#sample-register')).includes('다운로드한 문서 등록하기') && !(await page.$('#landing-records, #landing-start-bottom')) && await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-0-landing.png`, fullPage: true });

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
console.log(`\nMVP 통합 QA 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
