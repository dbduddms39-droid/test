// 실제 브라우저로 사용자 흐름을 확인한다: S-01 → 근로계약서 확인하기 → 가상 근로계약서 붙여넣기 → 분석 시작
// → 결과(점검 기준 v2.2: 9개 또는 10개 주제) 표시 → 세부기준별 원문 근거 확인 → '담당자에게 이렇게 물어보세요' 질문 복사.
// 키 노출 여부도 함께 검사한다.
//   DEMO_MODE=true node scripts/e2e-browser.mjs          (키 없이 흐름만 확인, 데모 결과)
//   GEMINI_API_KEY=... E2E_REQUIRE_AI=true node scripts/e2e-browser.mjs   (실제 AI 분석)
//   E2E_BASE_URL=https://배포주소 E2E_REQUIRE_AI=true node scripts/e2e-browser.mjs   (배포된 사이트를 직접 검사)
// 출력에는 API 키와 문서 원문을 남기지 않는다 (항목 이름·상태·근거 줄 번호·일치 여부만).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { FIXTURES } from '../test/v22-fixtures.js';
import { detailOnly } from '../public/followups.js';

const PORT = Number(process.env.E2E_PORT) || 3210;
const REMOTE = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : null;
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts';
const REQUIRE_AI = process.env.E2E_REQUIRE_AI === 'true';
const KEY = process.env.GEMINI_API_KEY || '';
const sample = FIXTURES.find((f) => f.key === 'F03'); // 가상 기간제·단시간 근로계약서 (단독 확인은 근로계약서만)
const UNIQUE_PHRASE = '라이트랩'; // 원문이 서버 로그에 남는지 확인용 (가상 문서의 일부)
const missing = FIXTURES.find((f) => f.key === 'F10'); // 근무 일정의 부정문·휴가 미부여가 있는 가상 근로계약서
const ASK_STATUSES = ['MAIN_PARTIAL', 'MAIN_MISSING'];

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await mkdir(OUT, { recursive: true });
const server = REMOTE ? null : spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server?.stdout.on('data', (d) => { serverLog += d; });
server?.stderr.on('data', (d) => { serverLog += d; });

let browser;
try {
  // 서버 준비 대기 (최대 15초)
  let config = null;
  for (let i = 0; i < 30 && !config; i += 1) {
    try { config = await (await fetch(`${BASE}/api/config`)).json(); } catch { await sleep(500); }
  }
  check('서버 시작', Boolean(config));
  if (!config) throw new Error('server not ready');
  check('분석 모드', !REQUIRE_AI || config.mode === 'gemini', `mode=${config.mode}`);

  browser = await chromium.launch();
  // 질문 복사 확인을 위해 클립보드 권한을 준다
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // 브라우저가 받은 모든 응답 본문에 키가 들어 있는지 검사
  const bodies = [];
  page.on('response', async (r) => { try { bodies.push(await r.text()); } catch { /* 본문 없음 */ } });

  // S01 시작 → '입사조건 확인하기' → S02 자료 등록 (두 화면은 별도)
  await page.goto(BASE);
  await page.waitForSelector('#view-landing:not([hidden])');
  check('S01 시작 화면 (입력 화면과 분리)', !(await page.isVisible('#view-input')));
  await page.click('#landing-start');
  await page.waitForSelector('#view-input:not([hidden])');
  check('S01 → S02 이동', page.url().endsWith('#/new'));
  await page.screenshot({ path: `${OUT}/01-input.png`, fullPage: true });

  // 1) 문서 유형 3개 중 근로계약서 선택 (유형을 고르기 전에는 진행 불가)
  check('S02: 문서 유형 3개, 고르기 전에는 진행 불가', (await page.$$('input[name="doc-type"]')).length === 3 && (await page.isDisabled('#submit-btn')));
  await page.check('input[name="doc-type"][value="contract"]');

  // 2) 가상 근로계약서 붙여넣기
  await page.fill('#doc-text', sample.text);
  check('가상 근로계약서 입력', (await page.inputValue('#doc-text')) === sample.text, `${sample.text.length}자`);

  // 3) 분석 시작 → 기록 저장
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/analyze'), { timeout: 150_000 });
  await page.click('#submit-btn');
  const res = await responsePromise;
  const data = await res.json();
  check('분석 API 응답', res.status() === 200, `HTTP ${res.status()}${data.code ? `, ${data.code}` : ''}${res.status() !== 200 ? `, "${data.error}"` : ''}`);
  if (res.status() !== 200) throw new Error('analysis failed');
  check('분석 주체', !REQUIRE_AI || data.mode === 'gemini', `mode=${data.mode}`);

  await page.waitForSelector('#view-record:not([hidden])', { timeout: 10_000 });
  check('기록 저장 확인 후 표시', (await page.textContent('#save-status')).includes('저장했어요'));
  await page.screenshot({ path: `${OUT}/02-result.png`, fullPage: true });
  const recordUrl = page.url();

  // 4) 점검 기준 v2.2 결과: 10개 주제, 08은 수습 적용이 확인될 때만 표시
  check('API 결과: v2.2 형식, 주제 10개(중복 없음), 세부기준 결과 포함', data.version === 'v2.2' && data.topics.length === 10 && new Set(data.topics.map((t) => t.id)).size === 10 && data.items === undefined && Object.keys(data.criteria ?? {}).length === 32);
  const visible = data.topics.filter((t) => t.visible);
  check('표시 항목 수 9개 또는 10개, 08 미표시면 상태 없음', [9, 10].includes(visible.length) && visible.length === data.counts.shown
    && data.topics.filter((t) => !t.visible).every((t) => t.id === '08' && t.status === null), `표시 ${visible.length}개`);
  const rows = await page.$$eval('#all-condition-list .condition', (els) => els.map((e) => ({
    id: e.dataset.item, status: e.querySelector('.condition-doc .badge').textContent,
  })));
  // 근로계약서의 상위 상태 라벨 (판정 코드는 v2.2 그대로, 화면 라벨만 서비스 기획에 맞춤)
  const SHOWN_LABEL = { MAIN_FOUND: '기재됨', MAIN_PARTIAL: '내용이 모호함', MAIN_MISSING: '문서에서 확인되지 않음', MAIN_UNAVAILABLE: '분석 확인 불가' };
  // 핵심 내용은 적혀 있고 세부 숫자(주 소정근로시간 등)만 직접 적혀 있지 않은 일부 확인은 '세부 확인 필요'로 구분해 보여 준다 (판정은 그대로)
  const labelFor = (t) => (detailOnly(t) ? '세부 확인 필요' : SHOWN_LABEL[t.status]);
  const rowsMatch = rows.length === visible.length && rows.every((r, k) => r.id === visible[k].id && r.status === labelFor(visible[k]));
  check('주요 근로조건 = 표시 대상 항목 (계약서는 모든 항목의 기재 상태)', rowsMatch, `표시 ${rows.length}개`);
  for (const t of data.topics) console.log(`      ${t.visible ? '표시' : '숨김'}  ${t.id} ${t.label}: ${t.statusLabel ?? '-'}`);
  check('붙여넣기 결과에는 추출 텍스트 안내가 없음', (await page.$$('#doc-list .input-source-note')).length === 0);
  const sourceText = await page.textContent('#analysis-source');
  check('결과 화면의 분석 주체 안내', REQUIRE_AI ? !sourceText.includes('데모') : true, sourceText.includes('데모') ? '데모 결과 표시' : 'AI 결과 표시');

  // 항목 상세의 질문: 근로계약서 단독이면 '내용이 모호함'·'문서에서 확인되지 않음'에만 있고, 기재됨·분석 확인 불가에는 없어야 한다
  const askMismatch = [];
  const checkAsk = async (t) => {
    const hasAsk = await page.isVisible('#item .item-followup .q-text');
    if (hasAsk !== ASK_STATUSES.includes(t.status)) askMismatch.push(`${t.label}(${t.statusLabel})`);
    return hasAsk;
  };
  // 세부기준: 화면의 세부 상태 라벨이 API와 같고, 근거는 입력 원문 그대로이며, 분석 확인 불가에는 근거를 보이지 않음
  const detailProblems = [];
  const checkCriteria = async (t, docText) => {
    const shown = await page.$$eval('#item .criterion', (els) => els.map((e) => ({
      id: e.dataset.criterion,
      status: e.querySelector('.badge').textContent,
      evidence: [...e.querySelectorAll('.evidence-text')].map((x) => x.textContent),
    })));
    for (const c of t.criteria) {
      const s = shown.find((x) => x.id === c.id);
      if (!s || s.status !== c.statusLabel) detailProblems.push(`${c.id} 상태`);
      else if (JSON.stringify(s.evidence) !== JSON.stringify(c.evidence.map((e) => e.text))) detailProblems.push(`${c.id} 근거`);
      else if (s.evidence.some((x) => !docText.includes(x))) detailProblems.push(`${c.id} 원문에 없는 근거`);
      else if (c.status === 'UNAVAILABLE' && s.evidence.length) detailProblems.push(`${c.id} 확인 불가에 근거 표시`);
    }
    const notes = await page.$$eval('#item .doc-block .note', (els) => els.map((e) => e.className));
    const expected = ['neutral', 'applicability', 'probationHold'].filter((k) => t.notes[k]).length;
    if (notes.length !== expected) detailProblems.push(`${t.id} 안내 수`);
  };
  const openItem = async (t) => {
    await page.goto(`${page.url().replace(/#.*/, '')}#/records/${page.url().match(/rec_\w+/)[0]}/item/${t.id}`);
    await page.waitForSelector('#view-item:not([hidden])');
  };

  // 5) 항목별 세부기준·원문 근거 확인
  for (const [k, t] of visible.entries()) {
    await openItem(t);
    await checkCriteria(t, sample.text);
    const hasAsk = await checkAsk(t);
    console.log(`      ${t.id} ${t.label}: 세부 ${t.criteria.map((c) => `${c.id}=${c.status}`).join(' ')}, 질문 ${hasAsk ? '있음' : '없음'}`);
    if (k === 0) await page.screenshot({ path: `${OUT}/03-detail.png`, fullPage: true });
    await page.goBack();
    await page.waitForSelector('#view-record:not([hidden])');
  }

  // 6) 부정 표현이 있는 가상 근로계약서로 새 기록 → 질문 복사
  await page.goto(`${BASE}/#/new`);
  await page.waitForSelector('#view-input:not([hidden])');
  await page.check('input[name="doc-type"][value="contract"]');
  await page.fill('#doc-text', missing.text);
  const res2Promise = page.waitForResponse((r) => r.url().endsWith('/api/analyze'), { timeout: 150_000 });
  await page.click('#submit-btn');
  const res2 = await res2Promise;
  const data2 = await res2.json();
  check('두 번째 분석 API 응답 (부정 표현이 있는 근로계약서)', res2.status() === 200, `HTTP ${res2.status()}${data2.code ? `, ${data2.code}` : ''}`);
  if (res2.status() !== 200) throw new Error('second analysis failed');
  await page.waitForSelector('#view-record:not([hidden])', { timeout: 10_000 });
  check('두 번째 문서는 별도 기록', page.url() !== recordUrl);
  const visible2 = data2.topics.filter((t) => t.visible);
  let copied = null;
  for (const t of visible2) {
    await openItem(t);
    await checkCriteria(t, missing.text);
    const hasAsk = await checkAsk(t);
    console.log(`      ${t.id} ${t.label}: ${t.statusLabel}, 질문 ${hasAsk ? '있음' : '없음'}`);
    if (hasAsk && !copied) {
      const shownQ = await page.inputValue('#item .item-followup .q-text');
      await page.click('#item .item-followup [data-copy]');
      await page.waitForFunction(() => document.querySelector('#item .item-followup .q-status')?.textContent);
      const statusMsg = await page.textContent('#item .item-followup .q-status');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      copied = { label: t.label, ok: clip === shownQ && statusMsg.includes('복사했어요'), noDigits: !/\d/.test(shownQ) };
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check('질문 영역 모바일 화면(375px)에서 가로 스크롤 없음', noScroll);
      await page.screenshot({ path: `${OUT}/04-ask-copied.png`, fullPage: true });
    }
    await page.goBack();
    await page.waitForSelector('#view-record:not([hidden])');
  }
  check('세부기준 상태·근거·안내가 API 결과와 같고 근거는 입력 원문 그대로', detailProblems.length === 0, detailProblems.slice(0, 5).join(', '));
  check('질문은 내용이 모호함·문서에서 확인되지 않음 항목에만 (근로계약서 단독)', askMismatch.length === 0, askMismatch.join(', '));
  check('질문 복사 → 클립보드에 같은 문장 + 완료 안내', Boolean(copied?.ok), copied ? copied.label : '질문 영역이 있는 주제 없음');
  check('복사한 질문에 숫자(금액·날짜) 없음', Boolean(copied?.noDigits));
  check('브라우저 스크립트 오류 없음', pageErrors.length === 0, pageErrors.length ? `${pageErrors.length}건` : '');

  // 보안 검사: 키가 브라우저 응답·페이지에 없고, 서버 로그에 키·원문이 없음
  const html = await page.content();
  if (KEY) {
    check('브라우저로 전달된 응답에 API 키 없음', !bodies.some((b) => b.includes(KEY)) && !html.includes(KEY), `응답 ${bodies.length}개 검사`);
    check('서버 로그에 API 키 없음', !serverLog.includes(KEY));
  } else {
    check('API 키 노출 검사', true, '키가 설정되지 않은 실행이라 생략');
  }
  if (!REMOTE) check('서버 로그에 입력 원문 없음', !serverLog.includes(UNIQUE_PHRASE));
} catch (err) {
  check('예외 없이 완료', false, err.message);
} finally {
  if (browser) await browser.close();
  server?.kill();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n브라우저 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
