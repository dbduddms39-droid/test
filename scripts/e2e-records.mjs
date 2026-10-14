// 입사 기록 흐름(PRD v3.1)을 실제 브라우저(Chromium)로 확인한다.
//   node scripts/e2e-records.mjs
// 분석기는 실제 Gemini가 아니다: 데모 분석기(키워드 규칙)를 감싼 '모의 AI'를 같은 프로세스의 서버에 넣는다.
//   - normal: 데모 분석기 그대로
//   - fail:   AI 오류(무료 한도 초과)를 던진다 → 분석 실패 화면·재시도 확인
//   - forge:  급여 금액 근거를 원문에 없는 문구로 바꾼다 → 근거 검증 실패('분석 확인 불가')·재분석 확인
// 외부 AI 호출·과금 없음. GEMINI_API_KEY를 쓰지 않는다.
// 검사: 문서 유형별 단독 등록(공고·오퍼·계약서), 결과 화면 순서, 저장 성공 표시, 기록 목록·재열람,
//   새 안내 추가(서로 다른 안내·새롭게 적힘·비교 어려움), 이전 자료 보존, 같은 회사 다른 기록,
//   메모 작성·수정·삭제, 기록 삭제(저장소에서 사라짐), 브라우저 종료 후 재열람(영구 프로필),
//   저장 실패(IndexedDB 쓰기 실패) → '저장되지 않았어요'·다시 저장, 기존 기록에 추가 중 저장 실패 → 이전 기록 보존,
//   AI 오류 → 재시도, 근거 검증 실패 → 재분석, PDF 추출 텍스트 수정본만 저장, 주소에 문서 내용 없음, 390·1440px 가로 넘침 없음.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { createDemoAnalyzer } from '../src/ai/demo.js';
import { AIError } from '../src/ai/errors.js';
import { createRateLimiter } from '../src/rateLimit.js';

const OUT = 'e2e-artifacts/records';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
await mkdir(OUT, { recursive: true });

// ---- 모의 AI 서버 ----
const demo = createDemoAnalyzer();
let aiMode = 'normal';
let aiCalls = 0;
const ai = {
  name: 'demo',
  async analyze(args) {
    aiCalls += 1;
    if (aiMode === 'fail') throw new AIError('rate_limited', 'mock rate limit');
    const out = await demo.analyze(args);
    if (aiMode === 'forge') {
      for (const c of out.criteria) if (c.id === '01-a' && c.quotes[0]) c.quotes[0].text = '연봉 9,999만원(원문에 없는 문구)';
    }
    return out;
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- 가상 문서 (실제 회사·인물과 무관) ----
const POSTING_3400 = ['[가상] 데이터 분석 담당자 채용', '회사명: 가상상사', '고용형태: 정규직', '연봉: 3,400만원', '근무지: 서울 마포구 양화로 00', '담당업무: 데이터 품질 점검'].join('\n');
const OFFER_3600 = ['[가상] 최종합격 안내', '연봉: 3,600만원', '수습기간: 3개월', '수습 중 급여: 별도 협의'].join('\n');
// 데모 분석기는 '급여'가 든 줄을 함께 읽어 금액을 '정해지지 않음'으로 볼 수 있어, 자료 사이 비교에는 수습 중 급여 줄이 없는 안내를 쓴다
const OFFER_3600_SHORT = ['[가상] 최종합격 안내', '연봉: 3,600만원', '수습기간: 3개월'].join('\n');
const POSTING_NO_WAGE = ['[가상] 디자인 담당자 채용', '회사명: 가상상사', '고용형태: 정규직', '근무지: 서울 마포구 양화로 00', '담당업무: 디자인 시안 제작'].join('\n');
const POSTING_ANNUAL = ['[가상] 운영 담당자 채용', '연봉 3,600만원', '근무지: 서울 마포구'].join('\n');
const OFFER_MONTHLY = ['[가상] 합격 안내', '급여: 월 300', '근무지: 서울 마포구'].join('\n');
const CONTRACT = ['[가상] 근로계약서', '1. 근로계약기간: 기간의 정함이 없음', '2. 근무장소: 서울 마포구 양화로 00', '3. 업무내용: 데이터 품질 점검', '4. 소정근로시간: 09:00~18:00 (휴게 12:00~13:00), 주 40시간', '5. 임금: 연봉 3,600만원, 매월 25일 지급', '6. 고용형태: 정규직', '7. 수습: 없음'].join('\n');
const MARK = '가상상사';

const userDir = await mkdtemp(path.join(tmpdir(), 'ildan-e2e-'));
// IndexedDB 쓰기 실패를 흉내 내는 장치 (sessionStorage 표시가 있을 때만 put이 실패)
const FAIL_PUT = () => {
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function put(...a) {
    if (sessionStorage.getItem('e2e-fail-put') === '1') throw new DOMException('mock quota exceeded', 'QuotaExceededError');
    return orig.apply(this, a);
  };
};

let context;
try {
  context = await chromium.launchPersistentContext(userDir, { viewport: { width: 390, height: 844 } });
  await context.addInitScript(FAIL_PUT);
  let page = context.pages()[0] ?? await context.newPage();
  const pageErrors = [];
  const dialogs = [];
  const urls = [];
  const wire = (p) => {
    p.on('pageerror', (e) => pageErrors.push(e.message));
    p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) urls.push(f.url()); });
  };
  wire(page);
  const waitView = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15_000 });
  const text = (sel) => page.textContent(sel);
  const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // 새 기록: 유형 선택 → 붙여넣기 → 정리하기
  async function register(docType, body, { add = false } = {}) {
    await waitView('input');
    await page.check(`input[name="doc-type"][value="${docType}"]`);
    await page.fill('#doc-text', body);
    await page.click('#submit-btn');
    await waitView(add ? 'record' : 'record');
  }
  const recordId = () => page.evaluate(() => location.hash.match(/#\/records\/(rec_[A-Za-z0-9]+)/)?.[1] ?? null);
  const idbRecords = () => page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('ildan-hwagin');
    r.onsuccess = () => {
      const tx = r.result.transaction('records', 'readonly');
      const g = tx.objectStore('records').getAll();
      g.onsuccess = () => { resolve(g.result); r.result.close(); };
      g.onerror = () => reject(g.error);
    };
    r.onerror = () => reject(r.error);
  }));

  // ---- S01 ----
  await page.goto(`${BASE}/#/`);
  await waitView('landing');
  check('S01: 핵심 행동은 \'첫 문서 등록하기\'', (await text('#landing-start')).includes('첫 문서 등록하기'));
  // 두 문서 비교는 기능 안내로만 (별도 비교 모드·두 문서 필수 없음, 문서 하나로 시작 가능)
  check('S01: 두 문서를 필수로 요구하지 않음', !(await page.isVisible('#landing-compare')) && (await page.textContent('#view-landing')).includes('문서 하나만 있어도 시작할 수 있어요'));
  await page.click('#landing-start');
  await waitView('input');
  check('S02: 문서 유형 3개(채용공고·오퍼·계약서) 선택지', (await page.$$('input[name="doc-type"]')).length === 3);
  check('S02: 유형을 고르기 전에는 진행 불가', await page.isDisabled('#submit-btn'));
  check('S02: 개인정보 가림·외부 AI 전달·브라우저 저장 고지', /가리고/.test(await text('#privacy-note')) && /외부 AI/.test(await text('#privacy-note')) && /이 브라우저/.test(await text('#privacy-note')));

  // ---- T01 채용공고 하나 ----
  await register('job_posting', POSTING_3400);
  const rec1 = await recordId();
  check('T01 채용공고 하나로 결과·기록 도달', Boolean(rec1));
  check('T01 저장을 확인한 뒤에만 \'저장했어요\' 표시', /저장됐어요|추가됐어요/.test(await text('#save-status')));
  check('T01 회사명이 분명하면 기록 이름으로 제안', (await text('#record-title')) === MARK);
  const order = await page.evaluate(() => ['now-title', 'conditions-title', 'details-title', 'actions-title'].map((id) => document.getElementById(id).getBoundingClientRect().top));
  check('결과 화면 순서: 입사 전 확인할 내용 → 핵심 조건 요약 → 상세 확인(접힘) → 필요할 때 하기', order.every((v, i) => i === 0 || v > order[i - 1]), order.map(Math.round).join(' < '));
  check('T01 공고에서 찾지 못한 항목을 우선 질문으로 쏟아내지 않음', (await page.$$('#summary-groups .sum-item')).length <= 3 && !(await text('#summary-groups')).includes('휴일'));
  check('T01 문제없음·안전 같은 단정 표현 없음', !/(문제\s*없|안전한)/.test(await text('#view-record')));
  check('390px 가로 넘침 없음 (기록 화면)', await noHScroll());
  await page.screenshot({ path: `${OUT}/s04-posting-390.png`, fullPage: true });

  // ---- T05 새 안내 추가: 공고 3,400만원 → 오퍼 3,600만원 ----
  await page.click('#add-doc:visible, #add-second:visible');
  await waitView('input');
  check('S07: 어느 기록에 추가하는지 표시', (await text('#target-alias')) === MARK && await page.isVisible('#target-banner'));
  await register('offer', OFFER_3600_SHORT, { add: true });
  check('S07 → 같은 기록으로 돌아옴', (await recordId()) === rec1);
  check('T05 자료 2건이 한 기록에', (await page.$$('#doc-list > li')).length === 2);
  const wageRow = page.locator('#condition-list [data-item="01"]');
  check('T05 급여: 서로 다른 조건', (await wageRow.locator('.badge-relation').textContent()) === '서로 다른 조건' && (await wageRow.getAttribute('data-status')) === 'different');
  const nowText = await text('#condition-list [data-group="different"]');
  check('T05 서로 다른 조건에 두 출처·원문을 함께', nowText.includes('3,400만원') && nowText.includes('3,600만원') && nowText.includes('채용공고') && nowText.includes('처우·근로조건 안내'));
  check('T05 \'변경됨\'으로 단정하지 않음', !/변경됐|변경되었|조건이 변경/.test(await text('#view-record')));
  const stored = (await idbRecords()).find((r) => r.id === rec1);
  check('T05 이전 자료(공고) 텍스트·근거가 그대로 저장돼 있음', stored.documents[0].confirmedText === POSTING_3400 && JSON.stringify(stored.documents[0].analysis).includes('3,400만원'));
  await page.screenshot({ path: `${OUT}/s04-two-docs-390.png`, fullPage: true });

  // ---- S05 항목 상세 + 메모 ----
  await page.goto(`${BASE}/#/records/${rec1}/item/01`);
  await waitView('item');
  const itemText = await text('#item');
  check('S05 자료별 원문(두 자료 모두)', itemText.includes('연봉: 3,400만원') && itemText.includes('연봉: 3,600만원'));
  check('S05 서로 다른 안내의 이유 표시', itemText.includes('자료 사이 관계') && /최종 조건인지|판단하지 않아요/.test(itemText));
  check('T09 메모 없이도 상세 이용 가능 (추가 버튼만)', await page.isVisible('#memo-add') && !(await page.$('.memo-item')));
  await page.click('#memo-add');
  await page.fill('#memo-text', '전화로 연봉 3,600만원이라고 들음 (가상)');
  await page.click('#memo-save');
  await page.waitForSelector('.memo-item');
  check('T09 메모 작성 → \'내가 기록한 답변\' 라벨, 회사 확인·최종 표현 없음', (await text('.memo-item')).includes('내가 기록한 답변') && !/(회사 확인 완료|최종 확정)/.test(await text('.memo-item')));
  await page.click('[data-memo-edit]');
  await page.fill('#memo-text', '메일로 3,600만원 재확인 (가상)');
  await page.click('#memo-save');
  await page.waitForSelector('.memo-item');
  await page.reload();
  await waitView('item');
  check('T09 메모 수정 후 새로고침해도 유지', (await text('.memo-item .memo-text')) === '메일로 3,600만원 재확인 (가상)');
  await page.click('[data-memo-delete]');
  await page.waitForFunction(() => !document.querySelector('.memo-item'));
  check('T09 메모 삭제', ((await idbRecords()).find((r) => r.id === rec1).notes ?? []).length === 0);
  check('390px 가로 넘침 없음 (항목 상세)', await noHScroll());
  await page.screenshot({ path: `${OUT}/s05-item-390.png`, fullPage: true });

  // ---- T06 새로 적힘 ----
  await page.goto(`${BASE}/#/new`);
  await register('job_posting', POSTING_NO_WAGE);
  const rec2 = await recordId();
  check('T11 같은 회사라도 새 등록은 별도 기록', rec2 && rec2 !== rec1);
  await page.click('#add-doc:visible, #add-second:visible');
  await register('offer', OFFER_3600_SHORT, { add: true });
  const wage2 = await page.locator('#condition-list [data-item="01"] .badge-relation').textContent();
  check('T06 공고에 없던 급여가 오퍼에 처음: \'한쪽에만 기재\' (변경·삭제로 보지 않음)', wage2 === '한쪽에만 기재' && (await text('#condition-list [data-item="01"] .cmp-panel.is-a')).includes('원문에 언급 없음'), wage2);
  check('T06 급여를 서로 다른 안내·변경으로 표시하지 않음', !(await text('#summary-groups')).includes('서로 다르게 안내된 조건'));
  const list2 = await idbRecords();
  check('T11 두 기록의 자료가 섞이지 않음', list2.find((r) => r.id === rec1).documents.length === 2 && list2.find((r) => r.id === rec2).documents.length === 2
    && !list2.find((r) => r.id === rec2).documents.some((d) => d.confirmedText.includes('데이터 품질')));

  // ---- T07 비교 어려움 ----
  await page.goto(`${BASE}/#/new`);
  await register('job_posting', POSTING_ANNUAL);
  check('회사명이 없으면 \'새 입사 기록\'', (await text('#record-title')) === '새 입사 기록');
  await page.click('#add-doc:visible, #add-second:visible');
  await register('offer', OFFER_MONTHLY, { add: true });
  const wage3 = await page.locator('#condition-list [data-item="01"] .badge-relation').textContent();
  check('T07 연 3,600만원 ↔ 월 300: 같다고 추측하지 않고 \'추가 대조 필요\' (단위 환산·합산 없음)', wage3 === '추가 대조 필요' && !(await page.$('#cmp-group-same [data-item="01"]')), wage3);

  // ---- T03 근로계약서 하나 ----
  await page.goto(`${BASE}/#/new`);
  await register('contract', CONTRACT);
  const rec4 = await recordId();
  const condText = await text('#all-condition-list');
  check('T03 계약서 하나로 결과·저장', Boolean(rec4) && /저장됐어요|추가됐어요/.test(await text('#save-status')));
  check('T03 계약서는 기재 상태 라벨(기재됨 등)로', condText.includes('기재됨'));
  check('T15 수습 없음이면 수습 중 급여 항목·질문 없음', !(await page.$('#condition-list [data-item="08"]')) && !(await text('#view-record')).includes('수습 중 급여에 관한'));
  check('계약서 결과에 법 위반·효력 판정 표현 없음', !/(위반입니다|불법|합법|무효|위험도)/.test(await text('#view-record')));

  // ---- T02 짧은 오퍼 하나 ----
  await page.goto(`${BASE}/#/new`);
  await register('offer', OFFER_3600);
  check('T02 오퍼 하나로 결과 도달, 우선 질문 3건 이하', Boolean(await recordId()) && (await page.$$('[data-group="needs"] .sum-item')).length <= 3);

  // ---- S06 목록 ----
  await page.goto(`${BASE}/#/records`);
  await waitView('records');
  const cards = await page.$$('#record-list > li');
  check('S06 기록 목록: 지원 건별 5개', cards.length === 5, String(cards.length));
  check('S06 저장 위치·범위·손실 조건·외부 AI 전달 안내', /이 브라우저\(이 기기\)/.test(await text('.storage-note')) && /다른 기기/.test(await text('.storage-note')) && /사진 원본은 저장하지 않아요/.test(await text('.storage-note')) && /파일은 현재 브라우저에 저장됩니다/.test(await text('.storage-note')));
  check('390px 가로 넘침 없음 (목록)', await noHScroll());

  // ---- T10 브라우저 종료 후 다시 열기 ----
  await context.close();
  context = await chromium.launchPersistentContext(userDir, { viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FAIL_PUT);
  page = context.pages()[0] ?? await context.newPage();
  wire(page);
  await page.goto(`${BASE}/#/records`);
  await waitView('records');
  check('T10 브라우저를 닫았다 다시 열어도 기록 5개', (await page.$$('#record-list > li')).length === 5);
  await page.goto(`${BASE}/#/records/${rec1}`);
  await waitView('record');
  check('T10 다시 연 기록의 자료·원문 유지', (await page.$$('#doc-list > li')).length === 2 && (await text('#condition-list [data-group="different"]')).includes('3,400만원'));
  check('1440px 가로 넘침 없음 (기록 화면)', await noHScroll());
  await page.screenshot({ path: `${OUT}/s04-two-docs-1440.png`, fullPage: true });

  // ---- T12 저장 실패 ----
  await page.evaluate(() => sessionStorage.setItem('e2e-fail-put', '1'));
  await page.goto(`${BASE}/#/new`);
  await waitView('input');
  await page.check('input[name="doc-type"][value="job_posting"]');
  await page.fill('#doc-text', POSTING_ANNUAL);
  await page.click('#submit-btn');
  await waitView('record');
  check('T12 저장 실패: \'저장되지 않았어요\'와 다시 저장 버튼', (await text('#save-status')).includes('저장되지 않았어요') && await page.isVisible('#save-retry'));
  check('T12 저장 실패를 성공으로 표시하지 않음', !/저장했어요|저장됐어요|추가됐어요/.test(await text('#save-status')) && (await page.evaluate(() => location.hash)) === '#/unsaved');
  check('T12 저장 안 된 기록은 목록·저장소에 없음', (await idbRecords()).length === 5);
  await page.evaluate(() => sessionStorage.removeItem('e2e-fail-put'));
  await page.click('#save-retry');
  await page.waitForFunction(() => /#\/records\/rec_/.test(location.hash));
  await waitView('record');
  check('T12 같은 세션에서 다시 저장하면 정상 저장', /저장됐어요|추가됐어요/.test(await text('#save-status')) && (await idbRecords()).length === 6);
  // 기존 기록에 추가하다 저장 실패 → 이전 기록 훼손 없음
  await page.evaluate(() => sessionStorage.setItem('e2e-fail-put', '1'));
  await page.goto(`${BASE}/#/records/${rec4}/add`);
  await register('offer', OFFER_3600, { add: true });
  check('T12 추가 중 저장 실패: 이전 기록은 그대로라고 안내', (await text('#save-status')).includes('이전 기록(자료 1건)은 그대로'));
  check('T12 저장소의 이전 기록은 자료 1건 그대로', (await idbRecords()).find((r) => r.id === rec4).documents.length === 1);
  await page.evaluate(() => sessionStorage.removeItem('e2e-fail-put'));
  await page.click('#save-retry');
  await page.waitForFunction((id) => location.hash === `#/records/${id}`, rec4);
  await waitView('record');
  check('T12 다시 저장하면 자료 2건', (await idbRecords()).find((r) => r.id === rec4).documents.length === 2);

  // ---- Gemini(모의) 오류 → 재시도 ----
  aiMode = 'fail';
  await page.goto(`${BASE}/#/new`);
  await waitView('input');
  await page.check('input[name="doc-type"][value="offer"]');
  await page.fill('#doc-text', OFFER_3600);
  await page.click('#submit-btn');
  await waitView('record');
  // v3.2: 저장과 분석을 나눈다 — 자료는 저장되고 '분석 실패'로 남는다 (미기재 결과로 바꾸지 않음)
  check('AI 오류: 분석 실패로 안내 (미기재 결과로 바꾸지 않음)', (await text('#save-status')).includes('한도') && (await text('#save-status')).includes('분석은 완료하지 못했어요') && (await page.$$('#condition-list .ccard')).length === 0);
  const failedRec = (await idbRecords()).find((r) => r.documents.some((d) => d.status === 'analysis_failed'));
  check('AI 오류: 자료는 저장, 상태는 분석 실패, 분석 결과 없음', (await idbRecords()).length === 7 && failedRec?.documents[0].analysis === null && failedRec.documents[0].confirmedText === OFFER_3600);
  aiMode = 'normal';
  await page.click('#doc-list button[data-reanalyze]');
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('다시 분석한 결과'));
  check('AI 오류 후 같은 텍스트로 다시 분석 → 같은 기록에 저장 (새 기록 없음)', (await idbRecords()).length === 7 && (await idbRecords()).find((r) => r.id === failedRec.id).documents[0].status === 'analyzed');

  // ---- 근거 검증 실패 → 분석 확인 불가 → 재분석 ----
  aiMode = 'forge';
  await page.goto(`${BASE}/#/new`);
  await register('job_posting', POSTING_3400);
  const rec7 = await recordId();
  check('T08 근거 검증 실패: 재분석 안내 표시', await page.isVisible('#reanalyze-box'));
  check('T08 원문에 없는 인용을 보여 주지 않음', !(await text('#view-record')).includes('9,999'));
  check('T08 \'찾지 못함\'이 아니라 \'분석 확인 불가\'', (await page.locator('#condition-list [data-item="01"]').textContent()).includes('분석 확인 불가'));
  check('T08 분석 확인 불가로 회사 질문을 만들지 않음', !((await page.$('[data-group="needs"]')) && (await text('[data-group="needs"]')).includes('급여')) && !(await text('#more-list')).includes('급여'));
  aiMode = 'normal';
  await page.click('button[data-reanalyze]');
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('다시 분석한 결과'));
  check('T08 같은 텍스트로 재분석하면 복구', !(await page.isVisible('#reanalyze-box')) && (await page.locator('#condition-list [data-item="01"]').textContent()).includes('3,400만원'));
  check('T08 재분석해도 확인 텍스트는 그대로', (await idbRecords()).find((r) => r.id === rec7).documents[0].confirmedText === POSTING_3400);

  // ---- T04 파일 추출 텍스트 수정본만 저장 ----
  await page.goto(`${BASE}/#/new`);
  await waitView('input');
  await page.check('input[name="doc-type"][value="contract"]');
  await page.click('#tab-upload');
  await page.setInputFiles('#file-input', 'test/fixtures/upload/contract-text.pdf');
  await waitView('review');
  const extracted = await page.inputValue('#review-text');
  check('T04 PDF 텍스트 추출 → S03 확인 화면', extracted.includes('2,600,000원'));
  await page.fill('#review-text', extracted.replace('월 2,600,000원', '월 2,700,000원'));
  const reqText = page.waitForRequest('**/api/analyze').then((r) => JSON.parse(r.postData()).text);
  await page.click('#review-submit');
  const sent = await reqText;
  await waitView('record');
  const rec8 = await recordId();
  const saved8 = (await idbRecords()).find((r) => r.id === rec8);
  check('T04 분석 요청은 수정본만 (수정 전 값 없음)', sent.includes('월 2,700,000원') && !sent.includes('월 2,600,000원'));
  check('T04 저장된 확인 텍스트·근거도 수정본', saved8.documents[0].confirmedText.includes('2,700,000원') && !JSON.stringify(saved8).includes('2,600,000원') && saved8.documents[0].inputSource === 'pdf');
  check('T04 원본 파일은 저장하지 않음', !JSON.stringify(saved8).includes('%PDF'));

  // ---- T13 기록 삭제 ----
  await page.goto(`${BASE}/#/records/${rec1}`);
  await waitView('record');
  await page.click('#delete-record');
  await waitView('records');
  const after = await idbRecords();
  check('T13 기록 삭제: 저장소에서 자료·텍스트·메모까지 사라짐', !after.some((r) => r.id === rec1) && !JSON.stringify(after).includes('데이터 품질 점검\n') && !JSON.stringify(after).includes('3,400만원\n근무지'));
  check('T13 삭제 안내 표시', (await text('#records-notice')).includes('삭제했어요'));
  await page.goto(`${BASE}/#/records/${rec1}`);
  await waitView('records');
  check('T13 삭제된 기록 주소로 들어가면 목록으로, 내용 없음', (await text('#records-notice')).includes('찾을 수 없어요'));
  check('1440px 가로 넘침 없음 (목록)', await noHScroll());
  await page.screenshot({ path: `${OUT}/s06-records-1440.png`, fullPage: true });

  // ---- 공통 ----
  check('주소(해시)에 문서 내용·회사명이 들어가지 않음', urls.every((u) => !decodeURIComponent(u).includes(MARK) && !decodeURIComponent(u).includes('연봉')), `${urls.length}개 주소`);
  check('페이지 스크립트 오류 없음', pageErrors.length === 0, pageErrors.join(' | '));
  console.log(`(모의 AI 호출 ${aiCalls}회, 확인 대화상자 ${dialogs.length}회)`);
} catch (err) {
  check('예상치 못한 오류 없이 끝까지 실행', false, err.stack);
} finally {
  await context?.close().catch(() => {});
  server.close();
  await rm(userDir, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
