// 실제 브라우저로 사용자 흐름을 확인한다: 문서 유형 선택 → 가상 채용공고 붙여넣기 → 분석 시작
// → 결과(8개 항목) 표시 → 항목별 원문 근거 확인. 키 노출 여부도 함께 검사한다.
//   DEMO_MODE=true node scripts/e2e-browser.mjs          (키 없이 흐름만 확인, 데모 결과)
//   GEMINI_API_KEY=... E2E_REQUIRE_AI=true node scripts/e2e-browser.mjs   (실제 AI 분석)
// 출력에는 API 키와 문서 원문을 남기지 않는다 (항목 이름·상태·근거 줄 번호·일치 여부만).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { SAMPLES } from '../test/samples.js';

const PORT = Number(process.env.E2E_PORT) || 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts';
const REQUIRE_AI = process.env.E2E_REQUIRE_AI === 'true';
const KEY = process.env.GEMINI_API_KEY || '';
const sample = SAMPLES.find((s) => s.key === 'X3_intern_word'); // 가상 채용공고
const UNIQUE_PHRASE = '지표 대시보드'; // 원문이 서버 로그에 남는지 확인용 (가상 문서의 일부)

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

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
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
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
  const sourceText = await page.textContent('#analysis-source');
  check('결과 화면의 분석 주체 안내', REQUIRE_AI ? sourceText.includes('AI(Gemini)') : true, sourceText.includes('데모') ? '데모 결과 표시' : 'AI 결과 표시');

  // 5) 항목별 원문 근거 확인
  let evidenceOk = true;
  for (const [k, it] of visible.entries()) {
    await page.click(`.item-row >> nth=${k}`);
    await page.waitForSelector('#view-detail:not([hidden])');
    const shown = await page.$$eval('.evidence-text', (els) => els.map((e) => e.textContent));
    const sameAsApi = shown.length === it.evidence.length && shown.every((t, n) => t === it.evidence[n].text);
    const fromInput = shown.every((t) => sample.text.includes(t));
    if (!sameAsApi || !fromInput) evidenceOk = false;
    console.log(`      ${it.label}: 원문 근거 ${shown.length}줄, 입력 원문과 일치 ${fromInput ? '예' : '아니오'}`);
    if (k === 0) await page.screenshot({ path: `${OUT}/03-detail.png`, fullPage: true });
    await page.goBack();
    await page.waitForSelector('#view-result:not([hidden])');
  }
  check('원문 근거가 입력 원문 그대로 표시됨', evidenceOk);
  check('브라우저 스크립트 오류 없음', pageErrors.length === 0, pageErrors.length ? `${pageErrors.length}건` : '');

  // 보안 검사: 키가 브라우저 응답·페이지에 없고, 서버 로그에 키·원문이 없음
  const html = await page.content();
  if (KEY) {
    check('브라우저로 전달된 응답에 API 키 없음', !bodies.some((b) => b.includes(KEY)) && !html.includes(KEY), `응답 ${bodies.length}개 검사`);
    check('서버 로그에 API 키 없음', !serverLog.includes(KEY));
  } else {
    check('API 키 노출 검사', true, '키가 설정되지 않은 실행이라 생략');
  }
  check('서버 로그에 입력 원문 없음', !serverLog.includes(UNIQUE_PHRASE));
} catch (err) {
  check('예외 없이 완료', false, err.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n브라우저 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
