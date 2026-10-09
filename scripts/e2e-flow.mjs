// 화면 이동·입력 보존 흐름을 실제 브라우저로 확인한다 (S-01~S-04, S-07).
//   node scripts/e2e-flow.mjs
// 항상 로컬 서버를 데모 모드로 띄우고 GEMINI_API_KEY를 넘기지 않는다 → 실제 AI 호출·과금 없음.
// 분석 실패·지연은 브라우저에서 /api/analyze 응답을 가로채 만든다.
// 검사: 직접 입력 S-02→S-04→결과, 뒤로 가기·다시 입력 시 텍스트 유지, 분석 실패 → S-07 → 수정/재시도,
//       중복 요청 방지, 분석 중 뒤로 가기(취소), 데이터 없는 결과·상세 주소 접근, 주소에 문서 내용 없음,
//       탭 키보드 조작·비활성 버튼, 390px·1440px 가로 스크롤 없음.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { SAMPLES } from '../test/samples.js';

const PORT = Number(process.env.E2E_PORT) || 3212;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts/flow';
const sample = SAMPLES.find((s) => s.key === 'X3_intern_word'); // 가상 채용공고
const MARK = '지표 대시보드'; // 가상 문서의 일부 — 주소에 들어가지 않는지 확인용

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await mkdir(OUT, { recursive: true });
const env = { ...process.env, PORT: String(PORT), DEMO_MODE: 'true' };
delete env.GEMINI_API_KEY;
const server = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let browser;
try {
  let config = null;
  for (let i = 0; i < 30 && !config; i += 1) {
    try { config = await (await fetch(`${BASE}/api/config`)).json(); } catch { await sleep(500); }
  }
  check('서버 시작 (데모 모드, AI 호출 없음)', config?.mode === 'demo', `mode=${config?.mode}`);
  if (!config) throw new Error('server not ready');

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  let dialogAnswer = 'accept';
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); return dialogAnswer === 'accept' ? d.accept() : d.dismiss(); });
  const urls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  const requests = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/analyze')) requests.push(JSON.parse(r.postData() ?? '{}')); });
  const visible = async (v) => page.isVisible(`#view-${v}`);
  const waitView = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15_000 });
  // 다음 분석 요청을 붙잡아 두는 장치 (S-04 확인·중복 요청 검사용)
  const hold = async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/analyze', async (route) => { await gate; await route.continue().catch(() => {}); });
    return async () => { release(); await page.unroute('**/api/analyze'); };
  };

  // 1) 데이터 없이 결과·상세·확인·분석 중·오류 주소로 바로 들어와도 화면이 깨지지 않음
  for (const hash of ['#/result', '#/detail/wage', '#/review', '#/analyzing', '#/error']) {
    await page.goto(`${BASE}/${hash}`);
    await waitView('input');
    const notice = await page.isVisible('#route-notice') ? await page.textContent('#route-notice') : '';
    check(`직접 접근 ${hash} → S-02로 이동`, page.url().endsWith('#/input') && (hash === '#/error' || notice.length > 0), notice.slice(0, 40) || '안내 없음');
  }
  check('직접 접근으로 분석 요청이 나가지 않음', requests.length === 0);

  // 2) 키보드: 입력 방식 탭(→ 키), 빈 입력만 분석 버튼 비활성 (최소 글자 수 없음)
  await page.goto(`${BASE}/#/input`);
  await page.reload();
  await waitView('input');
  await page.focus('#tab-paste');
  await page.keyboard.press('ArrowRight');
  const uploadTab = (await page.getAttribute('#tab-upload', 'aria-selected')) === 'true' && (await page.isVisible('#panel-upload')) && (await page.evaluate(() => document.activeElement.id)) === 'tab-upload';
  await page.keyboard.press('ArrowLeft');
  const pasteTab = (await page.getAttribute('#tab-paste', 'aria-selected')) === 'true' && (await page.isVisible('#panel-paste'));
  check('입력 방식 탭: 방향키로 전환, 선택한 패널만 표시', uploadTab && pasteTab);
  await page.fill('#doc-text', '   \n  ');
  check('공백만 있으면 분석 버튼 비활성', await page.isDisabled('#submit-btn'));
  await page.fill('#doc-text', '급여 300만원');
  check('짧은 입력도 분석 버튼 활성 + 한계 안내', !(await page.isDisabled('#submit-btn')) && (await page.textContent('#submit-hint')).includes('관련 내용 찾지 못함'));
  await page.fill('#doc-text', sample.text);
  // 탭을 오가도 입력한 텍스트 유지
  await page.click('#tab-upload');
  await page.click('#tab-paste');
  check('탭을 오가도 직접 입력한 텍스트 유지', (await page.inputValue('#doc-text')) === sample.text);

  // 3) 직접 입력: S-02 → S-04 → 결과. 분석 중 버튼을 여러 번 눌러도 요청은 1번
  let release = await hold();
  await page.click('#submit-btn');
  await waitView('analyzing');
  await page.screenshot({ path: `${OUT}/S04-mobile.png`, fullPage: true });
  await page.evaluate(() => { document.querySelector('#input-form').requestSubmit(); document.querySelector('#input-form').requestSubmit(); });
  await sleep(300);
  check('S-02 → S-04 (분석 중 화면)', await visible('analyzing'));
  check('분석 중 중복 요청 방지 (요청 1번)', requests.length === 1, `${requests.length}번`);
  await release();
  await waitView('result');
  check('S-04 → 결과 화면', page.url().endsWith('#/result') && requests.length === 1);

  await page.click('.item-row >> nth=0');
  await waitView('detail');
  await page.goBack();
  await waitView('result');

  // 4) 뒤로 가기·다시 입력: 텍스트 유지
  await page.goBack();
  await waitView('input');
  check('결과에서 브라우저 뒤로 가기 → S-02 (분석 중 화면 건너뜀), 텍스트 유지', (await page.inputValue('#doc-text')) === sample.text);
  await page.goForward();
  await waitView('result');
  await page.click('#result-back');
  await waitView('input');
  check("결과의 '다시 입력' → 직접 입력 경로라 S-02, 텍스트 유지", page.url().endsWith('#/input') && (await page.inputValue('#doc-text')) === sample.text);
  // 결과 화면 다시 그리기·주소 이동만으로는 분석을 다시 요청하지 않음 (분석 중 주소로 직접 가도 결과로)
  await page.goBack();
  await waitView('result');
  await page.goto(`${BASE}/#/analyzing`);
  await waitView('result');
  await page.goto(`${BASE}/#/input`);
  await waitView('input');
  check('라우트 이동·재렌더링으로 분석 재요청 없음', requests.length === 1, `${requests.length}번`);

  // 5) 분석 실패 → S-07 → 문서 내용 확인(S-02) / 다시 분석
  const EDITED = `${sample.text}\n문의: 인사팀 (가상 예시)`;
  await page.fill('#doc-text', EDITED);
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'AI 응답이 늦어져 분석을 중단했어요. 잠시 후 다시 시도해 주세요.', code: 'timeout' }) }));
  await page.click('#submit-btn');
  await waitView('error');
  const errMsg = await page.textContent('#error-message');
  check('AI 실패 → S-07 (실패 이유 표시, 결과로 바꾸지 않음)', errMsg.includes('AI 응답이 늦어져'), errMsg);
  await page.screenshot({ path: `${OUT}/S07-mobile.png`, fullPage: true });
  await page.click('#error-edit');
  await waitView('input');
  check('S-07 문서 내용 확인 → 직접 입력 경로라 S-02, 마지막 텍스트 유지', (await page.inputValue('#doc-text')) === EDITED);
  await page.click('#submit-btn');
  await waitView('error');
  await page.unroute('**/api/analyze');
  const before = requests.length;
  await page.click('#retry-btn');
  await waitView('result');
  check('S-07 다시 분석 → 마지막으로 확인한 텍스트로 재요청 → 결과', requests.length === before + 1 && requests.at(-1).text === EDITED);

  // 네트워크 오류도 S-07, 입력 오류(400)는 입력 화면에서 바로 안내
  await page.goto(`${BASE}/#/input`);
  await waitView('input');
  await page.route('**/api/analyze', (route) => route.abort('failed'));
  await page.click('#submit-btn');
  await waitView('error');
  check('네트워크 실패 → S-07', (await page.textContent('#error-message')).includes('서버에 연결하지 못했어요'));
  await page.unroute('**/api/analyze');
  await page.click('#error-edit');
  await waitView('input');
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '문서 유형을 선택해 주세요.' }) }));
  await page.click('#submit-btn');
  await waitView('input');
  check('입력 형식 오류(400) → S-02에서 바로 안내, 텍스트 유지', (await page.isVisible('#input-error')) && (await page.inputValue('#doc-text')) === EDITED);
  await page.unroute('**/api/analyze');

  // 6) 분석 중 뒤로 가기 → 요청 취소, 결과로 넘어가지 않음, 텍스트 유지
  release = await hold();
  await page.click('#submit-btn');
  await waitView('analyzing');
  await page.goBack();
  await waitView('input');
  await release();
  await sleep(500);
  const abortNotice = await page.isVisible('#route-notice') ? await page.textContent('#route-notice') : '';
  check('분석 중 뒤로 가기 → 취소 안내, S-02 유지, 텍스트 유지', (await visible('input')) && abortNotice.includes('중단') && (await page.inputValue('#doc-text')) === EDITED, abortNotice);

  // 6-1) 파일 경로: S-02 → S-03 → (실패) S-07 → 문서 내용 확인은 S-03, 수정한 추출 텍스트 유지
  await page.goto(`${BASE}/#/input`);
  await waitView('input');
  await page.click('#tab-upload');
  const reqBeforeFile = requests.length;
  await page.setInputFiles('#file-input', 'test/fixtures/upload/contract-text.pdf');
  await waitView('review');
  const extracted = await page.inputValue('#review-text');
  check('파일 경로: S-02 → S-03 (자동 분석 없음), 직접 입력란은 그대로', extracted.length > 20 && (await page.inputValue('#doc-text')) === EDITED && requests.length === reqBeforeFile);
  const FILE_EDITED = `${extracted}\n수정한 줄 (가상 예시)`;
  await page.fill('#review-text', FILE_EDITED);
  // 고친 내용이 있으면 '비우기' 전에 확인: 취소하면 그대로, 확인하면 비우고 '원래 내용으로' 복구 가능
  dialogAnswer = 'dismiss';
  const d0 = dialogs.length;
  await page.click('#review-clear');
  const keptOnCancel = dialogs.length === d0 + 1 && (await page.inputValue('#review-text')) === FILE_EDITED;
  dialogAnswer = 'accept';
  await page.click('#review-clear');
  const cleared = (await page.inputValue('#review-text')) === '' && (await page.isDisabled('#review-submit'));
  await page.click('#review-restore');
  const restored = (await page.inputValue('#review-text')) === extracted;
  check("S-03 수정 후 '비우기'는 확인을 받음 (취소 시 유지, 확인 시 비움, 원래 내용으로 복구)", keptOnCancel && cleared && restored);
  await page.fill('#review-text', FILE_EDITED);
  await page.click('#review-back');
  await waitView('input');
  await page.click('#review-resume a');
  await waitView('review');
  check("S-03 → 이전으로(S-02) → '추출 텍스트 확인 화면으로 돌아가기': 수정한 추출 텍스트 유지", (await page.inputValue('#review-text')) === FILE_EDITED);
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI 분석이 아직 설정되지 않았어요.', code: 'missing_key' }) }));
  await page.click('#review-submit');
  await waitView('error');
  await page.click('#error-edit');
  await waitView('review');
  check('파일 경로 S-07 문서 내용 확인 → S-03, 마지막 텍스트 유지', (await page.inputValue('#review-text')) === FILE_EDITED);
  await page.unroute('**/api/analyze');
  await page.click('#review-submit');
  await waitView('result');
  check('S-03 → S-04 → 결과: 수정한 텍스트로 요청', requests.at(-1).text === FILE_EDITED);
  await page.click('#result-back');
  await waitView('review');
  check("파일 경로 결과의 '다시 입력' → S-03", (await page.inputValue('#review-text')) === FILE_EDITED);

  // 7) 새로고침: 메모리에만 두므로 결과·입력이 사라지고 안내 후 S-02로 (저장된다고 안내하지 않음)
  await page.goto(`${BASE}/#/input`);
  await waitView('input');
  await page.click('#tab-paste');
  await page.click('#submit-btn');
  await waitView('result');
  await page.reload();
  await waitView('input');
  check('결과 화면 새로고침 → 데이터 없음 안내 후 S-02 (입력란 비어 있음)', (await page.textContent('#route-notice')).includes('새로고침') && (await page.inputValue('#doc-text')) === '');

  // 8) 주소(해시)에 문서 내용이 들어가지 않음
  check('주소에 문서 내용 없음', urls.every((u) => !decodeURIComponent(u).includes(MARK) && !u.includes('text=')), `${urls.length}개 주소 확인`);

  // 9) 가로 스크롤 없음 (390px, 1440px)
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    const bad = [];
    for (const hash of ['#/', '#/input']) {
      await page.goto(`${BASE}/${hash}`);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) bad.push(hash);
    }
    check(`${w}px 가로 스크롤 없음 (S-01, S-02)`, bad.length === 0, bad.join(', '));
  }
  check('브라우저 스크립트 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  check('예외 없이 완료', false, err.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n화면 이동 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
