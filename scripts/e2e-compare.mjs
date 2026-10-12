// 근로조건 2문서 비교·근로계약서 단독 확인·확인 질문 복사 흐름을 실제 브라우저로 확인한다.
//   node scripts/e2e-compare.mjs        (데모 모드 로컬 서버만 사용, 외부 AI 호출 없음)
// 검사: 입력 검사(빈 문서·같은 유형), 비교 결과(핵심 차이·항목별 비교·양쪽 원문 근거), 질문 수정·복사,
//       사진·PDF로 넣은 문서(S-03 확인 후 그 문서의 내용으로 사용), 입력 오류(400)·AI 실패(S-07 재시도·원문 수정),
//       근로계약서 단독 확인(기재 상태 라벨·질문), 좁은 화면에서 가로 넘침 없음.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-artifacts/compare';
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.E2E_PORT ?? 3218);
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), DEMO_MODE: 'true', GEMINI_API_KEY: '', RATE_LIMIT_PER_IP: '100', RATE_LIMIT_GLOBAL_PER_MINUTE: '100' },
  stdio: 'ignore',
});
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`); };

let browser;
try {
  for (let i = 0; i < 30; i += 1) { try { await fetch(`${BASE}/api/config`); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
  const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 20_000 });

  // 1) 시작 화면에서 두 기능을 고를 수 있다
  await page.goto(BASE);
  await view('landing');
  check('시작 화면: 근로조건 비교하기·근로계약서 확인하기', (await page.getAttribute('#landing-compare', 'href')) === '#/compare' && (await page.getAttribute('#landing-start', 'href')) === '#/input');
  check('시작 화면 슬로건', (await page.innerText('.hero-title')).replace(/\s+/g, ' ').includes('입사 전, 근로조건부터 일단 확인하세요.'));
  await page.click('#landing-compare');
  await view('input');

  // 2) 입력 검사
  check('비교 입력: 비어 있으면 시작 버튼 비활성', await page.isDisabled('#submit-btn'));
  await page.click('#example-btn'); // 문서 A: 채용공고 예시
  check('문서 A만 넣으면 문서 B 안내', (await page.isDisabled('#submit-btn')) && (await page.textContent('#submit-hint')).includes('문서 B'));
  await page.click('#slot-tab-B');
  check('문서 B로 바꾸면 입력란이 비어 있음 (문서마다 따로)', (await page.inputValue('#doc-text')) === '');
  await page.selectOption('#slot-type-B', 'job_posting');
  await page.fill('#doc-text', '[가상] 다른 채용공고\n연봉 3,000만원');
  check('같은 유형 두 개는 비교하지 않음', (await page.isDisabled('#submit-btn')) && (await page.textContent('#submit-hint')).includes('서로 다른 두 종류'));
  await page.selectOption('#slot-type-B', 'contract');
  await page.fill('#doc-text', '');
  await page.click('#example-btn'); // 문서 B: 근로계약서 예시
  check('두 문서가 준비되면 시작 가능', !(await page.isDisabled('#submit-btn')), `${await page.textContent('#slot-state-A')} / ${await page.textContent('#slot-state-B')}`);
  await page.click('#slot-tab-A');
  check('문서 A로 돌아가면 A 내용이 그대로', (await page.inputValue('#doc-text')).includes('채용'));

  // 3) 비교 결과
  const before = posts.length;
  await page.click('#submit-btn');
  await view('compare');
  check('비교 요청은 /api/compare 한 번', posts.slice(before).filter((u) => u.endsWith('/api/compare')).length === 1 && !posts.slice(before).some((u) => u.endsWith('/api/analyze')));
  check('비교한 두 문서 표시', (await page.textContent('#cmp-title')).includes('채용공고 ↔ 근로계약서'));
  const items = await page.$$eval('.cmp-item', (els) => els.map((e) => ({ title: e.querySelector('h3').textContent, state: e.querySelector('.badge').textContent })));
  check('항목별 비교 8개', items.length === 8, items.map((x) => `${x.title}:${x.state}`).join(' / '));
  check('핵심 차이 요약: 달라진 급여', (await page.textContent('#cmp-highlights')).includes('급여 금액') && (await page.textContent('#cmp-highlights')).includes('3,600만원 → 3,400만원'));
  const evidence = await page.$$eval('.cmp-evidence li', (els) => els.map((e) => e.textContent));
  check('양쪽 문서의 원문 근거(줄 번호와 인용)', evidence.length > 6 && evidence.every((t) => /\d+번 줄/.test(t)), `${evidence.length}개`);
  check('한쪽 미기재를 삭제·폐지로 표현하지 않음', !/(삭제됨|폐지|없어졌어요)/.test(await page.textContent('#cmp-list')));
  check('법률·신뢰도·적합성 판단 안 함 안내', (await page.textContent('#compare-notice')).includes('입사 적합성'));
  const qCount = await page.$$eval('#compare-question-list .q-text', (els) => els.length);
  check('확인 질문 생성', qCount > 0, `${qCount}개`);
  // 앞 문서(채용공고)에 없고 뒤 문서(근로계약서)에 새로 적힌 계약기간·수습 중 급여: 비교 상태는 그대로, 확정 여부 질문
  const qLabels = await page.$$eval('#compare-question-list .q-label', (els) => els.map((e) => e.textContent));
  const qTexts = await page.$$eval('#compare-question-list .q-text', (els) => els.map((e) => e.value));
  const newQ = qTexts.filter((t) => t.includes('채용공고에서는') && t.includes('근로계약서에는 다음과 같이 적혀 있습니다'));
  check('새로 적힌 계약기간·수습 중 급여 질문 (두 문서 유형·원문 조건 포함)', qLabels.includes('계약기간') && qLabels.includes('수습기간 중 급여') && newQ.length === 2
    && newQ.some((t) => t.includes('기간의 정함이 없음')) && newQ.some((t) => t.includes('90%')), qLabels.join(', '));
  check('새로 적힌 조건도 비교 상태는 그대로(새로 추가된 조건), 변경·위반으로 표현하지 않음',
    items.find((x) => x.title === '계약기간')?.state === '새로 추가된 조건' && items.find((x) => x.title === '수습기간 중 급여')?.state === '새로 추가된 조건'
    && newQ.every((t) => !/(변경되|바뀌|삭제|위반)/.test(t)));
  check('같은 조건(수습기간 동일)은 다시 묻지 않음', !qLabels.includes('수습기간'));
  await page.fill('#compare-question-list-0', '수정한 질문입니다 (가상)');
  await page.click('#compare-question-list button[data-copy="compare-question-list-0"]');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check('질문 수정 후 복사하면 수정한 문장 그대로', copied === '수정한 질문입니다 (가상)' && (await page.textContent('#compare-question-list .q-status')).includes('복사했어요'));
  await page.click('#compare-questions [data-copy-all]');
  const all = await page.evaluate(() => navigator.clipboard.readText());
  check('질문 모두 복사', all.split('\n\n').length === qCount, `${all.split('\n\n').length}개`);
  await page.screenshot({ path: `${OUT}/compare-result-1280.png`, fullPage: true });

  // 4) 좁은 화면
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  check('390px: 비교 결과 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${OUT}/compare-result-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // 5) 사진·PDF로 넣은 문서: 문서 B를 PDF로 바꾸고 S-03에서 확인한 텍스트를 그 문서 내용으로 쓴다
  await page.click('#compare-back');
  await view('input');
  await page.click('#slot-tab-B');
  await page.click('#tab-upload');
  await page.setInputFiles('#file-input', 'test/fixtures/upload/contract-text.pdf');
  await view('review');
  check('S-03 버튼: 분석하지 않고 문서 B 내용으로 쓰기', (await page.textContent('#review-submit')).includes('문서 B로 쓰기'));
  const reviewPosts = posts.length;
  await page.click('#review-submit');
  await view('input');
  check('S-03 확인 후 비교 입력으로 돌아오고 분석 요청 없음', posts.length === reviewPosts && (await page.textContent('#slot-state-B')).includes('사진·PDF 텍스트') && await page.isVisible('#slot-file'),
    `요청 ${posts.length - reviewPosts}, ${await page.textContent('#slot-state-B')}, 파일 표시 ${await page.isVisible('#slot-file')}`);
  await page.click('#submit-btn');
  await view('compare');
  check('PDF 문서와 비교: 추출 텍스트 기준 안내', (await page.isVisible('#compare-input-note')) && (await page.textContent('#compare-input-note')).includes('근로계약서'));

  // 6) 입력 오류(400)는 입력 화면에서, AI 실패는 S-07에서 재시도·원문 수정
  await page.click('#compare-back');
  await view('input');
  await page.route('**/api/compare', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '문서 B: 문서 내용을 입력해 주세요.' }) }));
  const r400 = page.waitForResponse((r) => r.url().endsWith('/api/compare'));
  await page.click('#submit-btn');
  await r400;
  await view('input');
  await page.waitForSelector('#input-error:not([hidden])');
  check('입력 오류(400): 비교 입력 화면에 안내', (await page.textContent('#input-error')).includes('문서 B'));
  await page.unroute('**/api/compare');
  await page.route('**/api/compare', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI 요청 설정에 문제가 있어 분석하지 못했어요.' }) }));
  await page.click('#submit-btn');
  await view('error');
  check('AI 실패: 결과를 만들지 않고 S-07 오류', (await page.textContent('#error-message')).includes('분석하지 못했어요') && !(await page.isVisible('#view-compare')));
  check('S-07 원문 수정은 비교 입력으로', (await page.getAttribute('#error-edit', 'href')) === '#/compare');
  await page.unroute('**/api/compare');
  await page.click('#retry-btn');
  await view('compare');
  check('S-07 재시도 → 비교 결과', await page.isVisible('#cmp-list'));

  // 7) 근로계약서 단독 확인
  await page.goto(`${BASE}/#/input`);
  await view('input');
  check('근로계약서 확인: 문서 유형 선택 없이 근로계약서', await page.isHidden('#compare-setup') && (await page.textContent('#input-title')).includes('근로계약서'));
  await page.fill('#doc-text', '[가상] 근로계약서\n임금: 월 250만원, 매월 25일 지급\n근무장소: 서울 마포구\n수습기간: 추후 협의');
  await page.click('#submit-btn');
  await view('result');
  const badges = await page.$$eval('.topic-card .badge', (els) => els.map((e) => e.textContent));
  check('근로계약서 결과: 기재됨·내용이 모호함·문서에서 확인되지 않음 라벨', badges.every((b) => ['기재됨', '내용이 모호함', '문서에서 확인되지 않음', '분석 확인 불가'].includes(b)) && badges.includes('문서에서 확인되지 않음'), badges.join(','));
  const cq = await page.$$eval('#result-question-list .q-text', (els) => els.map((e) => e.value));
  check('근로계약서 결과: 확인 질문(미기재·모호 항목만)', cq.length > 0 && cq.every((q) => q.startsWith('안녕하세요. 근로계약서에서')), `${cq.length}개`);
  await page.click('#result-questions [data-copy-all]');
  check('근로계약서 질문 모두 복사', (await page.evaluate(() => navigator.clipboard.readText())).split('\n\n').length === cq.length);
  await page.screenshot({ path: `${OUT}/contract-result-1280.png`, fullPage: true });

  check('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('예외 없이 완료', false, err.message.split('\n')[0]);
} finally {
  await browser?.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n비교·질문 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exitCode = 1;
