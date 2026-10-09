// 실제 브라우저로 사용자 흐름을 확인한다: 문서 유형 선택 → 가상 채용공고 붙여넣기 → 분석 시작
// → 결과(8개 항목) 표시 → 항목별 원문 근거 확인 → '담당자에게 이렇게 물어보세요' 질문 복사.
// 키 노출 여부도 함께 검사한다.
//   DEMO_MODE=true node scripts/e2e-browser.mjs          (키 없이 흐름만 확인, 데모 결과)
//   GEMINI_API_KEY=... E2E_REQUIRE_AI=true node scripts/e2e-browser.mjs   (실제 AI 분석)
//   E2E_BASE_URL=https://배포주소 E2E_REQUIRE_AI=true node scripts/e2e-browser.mjs   (배포된 사이트를 직접 검사)
// 출력에는 API 키와 문서 원문을 남기지 않는다 (항목 이름·상태·근거 줄 번호·일치 여부만).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { SAMPLES } from '../test/samples.js';

const PORT = Number(process.env.E2E_PORT) || 3210;
const REMOTE = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : null;
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts';
const REQUIRE_AI = process.env.E2E_REQUIRE_AI === 'true';
const KEY = process.env.GEMINI_API_KEY || '';
const sample = SAMPLES.find((s) => s.key === 'X3_intern_word'); // 가상 채용공고
const UNIQUE_PHRASE = '지표 대시보드'; // 원문이 서버 로그에 남는지 확인용 (가상 문서의 일부)
const missing = SAMPLES.find((s) => s.key === 'S3_missing'); // 조건 일부가 빠진 가상 오퍼 (찾지 못함 항목 확인용)
const ASK_STATUSES = ['unclear', 'not_found'];

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

  await page.goto(BASE);
  await page.screenshot({ path: `${OUT}/01-input.png`, fullPage: true });

  // 1) 문서 유형 선택
  await page.check('input[name=docType][value=job_posting]');
  check('문서 유형 선택 (채용공고)', await page.isChecked('input[value=job_posting]'));

  // 2) 가상 채용공고 붙여넣기
  await page.fill('#doc-text', sample.text);
  check('가상 채용공고 입력', (await page.inputValue('#doc-text')) === sample.text, `${sample.text.length}자`);

  // 3) 분석 시작
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/analyze'), { timeout: 150_000 });
  await page.click('#submit-btn');
  const res = await responsePromise;
  const data = await res.json();
  check('분석 API 응답', res.status() === 200, `HTTP ${res.status()}${data.code ? `, ${data.code}` : ''}${res.status() !== 200 ? `, "${data.error}"` : ''}`);
  if (res.status() !== 200) throw new Error('analysis failed');
  check('분석 주체', !REQUIRE_AI || data.mode === 'gemini', `mode=${data.mode}`);

  await page.waitForSelector('#view-result:not([hidden])', { timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/02-result.png`, fullPage: true });

  // 4) 8개 근로조건 결과
  const ids = data.items.map((i) => i.id);
  check('API 결과 항목 수 8개 (중복 없음)', ids.length === 8 && new Set(ids).size === 8);
  const unavailable = data.items.filter((i) => i.status === 'unavailable').length;
  check('분석 확인 불가 없음', unavailable === 0, `${unavailable}개`);
  const visible = data.items.filter((i) => i.visible);
  const rows = await page.$$eval('.item-row', (els) => els.map((e) => ({
    label: e.querySelector('.item-label').textContent, status: e.querySelector('.badge').textContent,
  })));
  const rowsMatch = rows.length === visible.length && rows.every((r, k) => r.label === visible[k].label && r.status === visible[k].statusLabel);
  check('화면 항목 = 표시 대상 항목', rowsMatch, `표시 ${rows.length}개 / 숨김 ${8 - visible.length}개`);
  for (const it of data.items) console.log(`      ${it.visible ? '표시' : '숨김'}  ${it.label}: ${it.statusLabel}${it.evidence.length ? ` (근거 ${it.evidence.map((e) => e.id).join(',')}번 줄)` : ''}`);
  check('붙여넣기 결과에는 추출 텍스트 안내가 없음', !(await page.isVisible('#input-source-note')));
  const sourceText = await page.textContent('#analysis-source');
  check('결과 화면의 분석 주체 안내', REQUIRE_AI ? sourceText.includes('AI(Gemini)') : true, sourceText.includes('데모') ? '데모 결과 표시' : 'AI 결과 표시');

  // 상세 화면의 질문 영역: '분명하지 않음'·'찾지 못함'에만 있고, 다른 상태에는 없어야 한다
  const askMismatch = [];
  const checkAsk = async (it) => {
    const hasAsk = await page.isVisible('#ask-copy');
    if (hasAsk !== ASK_STATUSES.includes(it.status)) askMismatch.push(`${it.label}(${it.statusLabel})`);
    return hasAsk;
  };

  // 분명하지 않음 설명: 적힌 사실과 확인이 필요한 부분이 나뉘어 있고, 인용(' ')은 입력 원문에 있는 문구만,
  // 원문에 없는 사유('내규', '서로 다른')를 말하지 않는다
  const reasonProblems = [];
  const checkReason = async (it, docText) => {
    if (it.status !== 'unclear') return;
    const fact = (await page.textContent('.reason-fact').catch(() => null)) ?? '';
    const pending = (await page.textContent('.reason-pending').catch(() => null)) ?? '';
    const quotes = [...`${fact} ${pending}`.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const squeeze = (s) => s.replace(/\s+/g, '');
    const firstFollowUp = await page.textContent('.follow-ups li');
    if (!fact || !pending) reasonProblems.push(`${it.label}: 설명 없음`);
    if (quotes.some((q) => !squeeze(docText).includes(squeeze(q)))) reasonProblems.push(`${it.label}: 원문에 없는 인용`);
    if (['내규', '서로 다른'].some((w) => `${fact}${pending}`.includes(w) && !docText.includes(w))) reasonProblems.push(`${it.label}: 원문에 없는 사유`);
    if (!firstFollowUp.startsWith('실제')) reasonProblems.push(`${it.label}: 핵심 확인 사항이 맨 앞이 아님`);
    console.log(`      ${it.label} 설명 [${it.reasonKind}] 인용 ${quotes.length}개, 우선 확인: ${firstFollowUp}`);
  };

  // '추가로 확인해 보세요': 분석 결과의 확인 사항과 화면 목록이 같고, 확인 사항이 없으면 제목·목록을 숨긴다
  const followUpProblems = [];
  const checkFollowUps = async (it) => {
    const shown = await page.$$eval('#detail .follow-ups li', (els) => els.map((e) => e.textContent));
    const heading = await page.$$eval('#detail h2', (els) => els.some((e) => e.textContent === '추가로 확인해 보세요'));
    if (JSON.stringify(shown) !== JSON.stringify(it.followUps) || heading !== it.followUps.length > 0) followUpProblems.push(it.label);
  };

  // 5) 항목별 원문 근거 확인
  let evidenceOk = true;
  for (const [k, it] of visible.entries()) {
    await page.click(`.item-row >> nth=${k}`);
    await page.waitForSelector('#view-detail:not([hidden])');
    const shown = await page.$$eval('.evidence-text', (els) => els.map((e) => e.textContent));
    const sameAsApi = shown.length === it.evidence.length && shown.every((t, n) => t === it.evidence[n].text);
    const fromInput = shown.every((t) => sample.text.includes(t));
    if (!sameAsApi || !fromInput) evidenceOk = false;
    const hasAsk = await checkAsk(it);
    await checkReason(it, sample.text);
    await checkFollowUps(it);
    console.log(`      ${it.label}: 원문 근거 ${shown.length}줄, 입력 원문과 일치 ${fromInput ? '예' : '아니오'}, 질문 영역 ${hasAsk ? '있음' : '없음'}`);
    if (k === 0) await page.screenshot({ path: `${OUT}/03-detail.png`, fullPage: true });
    await page.goBack();
    await page.waitForSelector('#view-result:not([hidden])');
  }
  check('원문 근거가 입력 원문 그대로 표시됨', evidenceOk);

  // 6) 조건 일부가 빠진 가상 오퍼로 다시 분석 → '찾지 못함' 항목에서 질문 복사
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('#view-input:not([hidden])');
  await page.check(`input[name=docType][value=${missing.docType}]`);
  await page.fill('#doc-text', missing.text);
  const res2Promise = page.waitForResponse((r) => r.url().endsWith('/api/analyze'), { timeout: 150_000 });
  await page.click('#submit-btn');
  const res2 = await res2Promise;
  const data2 = await res2.json();
  check('두 번째 분석 API 응답 (조건 일부가 빠진 오퍼)', res2.status() === 200, `HTTP ${res2.status()}${data2.code ? `, ${data2.code}` : ''}`);
  if (res2.status() !== 200) throw new Error('second analysis failed');
  await page.waitForSelector('#view-result:not([hidden])', { timeout: 10_000 });
  const visible2 = data2.items.filter((i) => i.visible);
  let copied = null;
  for (const [k, it] of visible2.entries()) {
    await page.click(`.item-row >> nth=${k}`);
    await page.waitForSelector('#view-detail:not([hidden])');
    const hasAsk = await checkAsk(it);
    await checkReason(it, missing.text);
    await checkFollowUps(it);
    console.log(`      ${it.label}: ${it.statusLabel}, 질문 영역 ${hasAsk ? '있음' : '없음'}`);
    if (hasAsk && !copied) {
      const shownQ = await page.textContent('#ask-text');
      await page.click('#ask-copy');
      await page.waitForSelector('.ask-status-done, .ask-status-error', { timeout: 5_000 });
      const statusMsg = await page.textContent('.ask-status');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      copied = { label: it.label, ok: clip === shownQ && statusMsg.includes('질문을 복사했어요'), noDigits: !/\d/.test(shownQ),
        sections: await page.$$eval('#view-detail h2', (els) => els.map((e) => e.textContent)) };
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check('질문 영역 모바일 화면(375px)에서 가로 스크롤 없음', noScroll);
      await page.screenshot({ path: `${OUT}/04-ask-copied.png`, fullPage: true });
    }
    await page.goBack();
    await page.waitForSelector('#view-result:not([hidden])');
  }
  const hidden2 = data2.items.filter((i) => !i.visible).map((i) => i.label);
  console.log(`      숨김 항목(질문 없음): ${hidden2.join(', ') || '없음'}`);
  check("'추가로 확인해 보세요' 목록 = 분석 결과 (없으면 제목까지 숨김)", followUpProblems.length === 0, followUpProblems.join(', '));
  check('분명하지 않음 설명: 적힌 사실/확인 필요 구분, 원문 인용만, 원문에 없는 사유 없음, 핵심 확인 사항 우선', reasonProblems.length === 0, reasonProblems.join(', '));
  check('질문 영역은 분명하지 않음·찾지 못함 항목에만 표시', askMismatch.length === 0, askMismatch.join(', '));
  check('찾지 못함 항목에서 질문 복사 → 클립보드에 같은 문장 + 완료 안내', Boolean(copied?.ok), copied ? copied.label : '질문 영역이 있는 항목 없음');
  check('복사한 질문에 숫자(금액·날짜) 없음', Boolean(copied?.noDigits));
  check('상세 화면 기존 영역 유지', Boolean(copied) && ['이 결과의 의미', '추가로 확인해 보세요', '담당자에게 이렇게 물어보세요'].every((h) => copied.sections.some((x) => x.includes(h))), copied?.sections.join(' / '));
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
