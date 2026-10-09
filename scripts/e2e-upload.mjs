// 파일 업로드 → 브라우저 안 텍스트 추출(pdf.js·Tesseract.js) → 사용자 수정 → 분석 흐름을 실제 브라우저로 확인한다.
//   DEMO_MODE=true node scripts/e2e-upload.mjs                 (분석은 데모, 추출·OCR은 실제)
//   GEMINI_API_KEY=... E2E_REQUIRE_AI=true node scripts/e2e-upload.mjs
//   E2E_BASE_URL=https://배포주소 E2E_REQUIRE_AI=true node scripts/e2e-upload.mjs   (배포된 사이트를 직접 검사, 로컬 서버 없음)
// 검사: 추출 정확도(정답 대비 글자 일치율), 오류 안내, 수정한 텍스트가 그대로 분석 요청에 들어가는지,
//       파일이 서버·외부로 전송되지 않는지(외부 요청 없음, POST는 /api/analyze JSON뿐), 서버 로그에 원문 없음.
// 출력에는 API 키와 문서 원문을 남기지 않는다.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT) || 3211;
const REMOTE = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : null;
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts/upload';
const FIX = 'test/fixtures/upload';
const REQUIRE_AI = process.env.E2E_REQUIRE_AI === 'true';
const KEY = process.env.GEMINI_API_KEY || '';
const TRUTH = JSON.parse(await readFile(`${FIX}/truth.json`, 'utf8'));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 공백을 뺀 글자 기준 일치율 (1 - 편집거리 / 긴 쪽 길이)
function similarity(a, b) {
  const x = [...a.replace(/\s/g, '')];
  const y = [...b.replace(/\s/g, '')];
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// 확인 대상: [파일, 문서 유형, 정답 키, 기대 방식, 최소 일치율, 분석까지 진행]
const EXTRACT_CASES = [
  ['contract-text.pdf', 'contract', 'contract', '텍스트를 추출했어요', 0.98, true],
  ['posting-ko.png', 'job_posting', 'posting', '1장 중 1장에서 글자를 인식', 0.9, true],
  ['posting-ko.webp', 'job_posting', 'posting', '1장 중 1장에서 글자를 인식', 0.9, false],
  ['posting-ko-photo.jpg', 'job_posting', 'posting', '1장 중 1장에서 글자를 인식', 0.7, false],
  ['scanned.pdf', 'contract', 'scanned', '스캔된 1쪽은 글자 인식', 0.9, true],
];
const ERROR_CASES = [
  ['encrypted.pdf', '암호가 걸린 PDF'],
  ['too-many-pages.pdf', '10쪽까지'],
  ['not-really.pdf', 'JPG, PNG, WebP 이미지나 PDF'],
  ['broken.pdf', 'PDF 파일을 열지 못했어요'],
  [{ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024)]) }, '10MB 이하'],
];

await mkdir(OUT, { recursive: true });
// 배포 사이트를 검사할 때는 로컬 서버를 띄우지 않는다 (서버 로그 검사는 생략).
const server = REMOTE ? null : spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server?.stdout.on('data', (d) => { serverLog += d; });
server?.stderr.on('data', (d) => { serverLog += d; });
if (REMOTE) console.log(`대상: 배포 사이트 ${REMOTE}`);

let browser;
const accuracy = [];
try {
  let config = null;
  for (let i = 0; i < 30 && !config; i += 1) {
    try { config = await (await fetch(`${BASE}/api/config`)).json(); } catch { await sleep(500); }
  }
  check(REMOTE ? '배포 사이트 응답' : '서버 시작', Boolean(config), `mode=${config?.mode}`);
  if (!config) throw new Error('server not ready');
  check('분석 모드', !REQUIRE_AI || config.mode === 'gemini', `mode=${config.mode}`);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const external = [];
  const posts = [];
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (!['http:', 'https:'].includes(u.protocol)) return; // blob:, data: 는 브라우저 내부
    if (u.origin !== BASE) external.push(u.origin);
    if (r.method() !== 'GET') posts.push({ path: u.pathname, body: r.postData() ?? '' });
  });
  const page = await context.newPage();
  let dialogAnswer = 'accept'; // 입력란 내용 바꾸기 확인 대화상자에 대한 응답
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs += 1; return dialogAnswer === 'accept' ? d.accept() : d.dismiss(); });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE);

  const waitStatus = async () => {
    await page.waitForFunction(() => { const e = document.querySelector('#upload-status'); return !e.hidden && /upload-status-(done|warn|error)/.test(e.className); }, null, { timeout: 240_000 });
    return {
      kind: (await page.getAttribute('#upload-status', 'class')).match(/upload-status-(\w+)$/)[1],
      text: await page.textContent('#upload-status'),
    };
  };
  // S-02를 새로 열고(메모리 상태 초기화) 문서 유형을 고른 뒤 '사진·PDF 업로드' 탭으로 바꾼다.
  // prefill은 '텍스트 직접 붙여넣기' 입력란에 미리 넣어 두는 내용 (파일 추출이 이 내용을 건드리지 않는지 확인용)
  const fresh = async (docType = 'job_posting', prefill = '') => {
    await page.goto(`${BASE}/#/input`);
    await page.reload();
    await page.waitForSelector('#view-input:not([hidden])');
    await page.check(`input[name=docType][value=${docType}]`);
    if (prefill) await page.fill('#doc-text', prefill);
    await page.click('#tab-upload');
    dialogAnswer = 'accept';
  };
  const reviewValue = () => page.inputValue('#review-text');
  // 이전 단계의 안내를 지워, 새 업로드의 안내가 나올 때까지 기다리게 한다 (화면 동작에는 영향 없음)
  const resetStatus = () => page.evaluate(() => { const e = document.querySelector('#upload-status'); e.hidden = true; e.className = 'upload-status'; e.textContent = ''; });
  const fix = (f) => (typeof f === 'string' ? path.join(FIX, f) : f);
  const names = () => page.$$eval('.image-name', (els) => els.map((e) => e.textContent));
  const analyzeCount = () => posts.filter((p) => p.path === '/api/analyze').length;
  const isImage = (f) => /\.(png|jpe?g|webp)$/i.test(f);

  // 이미지는 목록에 올린 뒤 '텍스트 추출'을 눌러야 추출된다. PDF는 바로 추출된다.
  async function uploadAndExtract(files) {
    const list = [].concat(files);
    await resetStatus();
    await page.setInputFiles('#file-input', list.map(fix));
    if (list.every((f) => typeof f === 'string' && isImage(f))) {
      await page.waitForSelector('#image-panel:not([hidden])');
      await page.click('#extract-btn');
    }
    return waitStatus();
  }

  // 사용자가 S-03에서 추출 결과를 확인·수정한 뒤 분석을 시작하는 흐름 (S-03 → S-04 → 결과)
  async function analyzeEdited(label, docType, extracted) {
    const edited = `${extracted}\n문의: 인사팀 (가상 예시)`;
    // 내용을 비우면 분석 버튼이 비활성 → 요청이 나가지 않아야 한다 (고친 내용이 없으면 확인 없이 비움)
    const before = analyzeCount();
    await page.click('#review-clear');
    check(`[${label}] S-03: 내용을 비우면 분석 버튼 비활성`, (await page.isDisabled('#review-submit')) && analyzeCount() === before);
    await page.fill('#review-text', edited);
    const reqPromise = page.waitForRequest((r) => r.url().endsWith('/api/analyze'));
    const resPromise = page.waitForResponse((r) => r.url().endsWith('/api/analyze'), { timeout: 150_000 });
    await page.click('#review-submit');
    const body = JSON.parse((await reqPromise).postData());
    const res = await resPromise;
    const data = await res.json();
    check(`[${label}] 확인·수정한 텍스트만 분석 요청에 전달`, body.text === edited && body.docType === docType && Object.keys(body).length === 2);
    const shownTopics = data.topics?.filter((t) => t.visible) ?? [];
    check(`[${label}] 분석 결과 (점검 기준 v2.2, 9개 또는 10개 주제)`, res.status() === 200 && data.version === 'v2.2' && data.topics?.length === 10 && [9, 10].includes(shownTopics.length) && (!REQUIRE_AI || data.mode === 'gemini'),
      `HTTP ${res.status()}${data.code ? ` ${data.code}` : ''}, mode=${data.mode}, 표시 ${shownTopics.length}개, 분석 확인 불가 ${shownTopics.filter((t) => t.status === 'MAIN_UNAVAILABLE').length}개`);
    if (res.status() === 200) {
      await page.waitForSelector('#view-result:not([hidden])');
      const note = await page.isVisible('#input-source-note') ? await page.textContent('#input-source-note') : '';
      check(`[${label}] 결과 화면에 '추출·확인한 텍스트 기준' 안내`, note.includes('확인·수정한 텍스트 기준'));
      const lines = edited.split('\n');
      const allEvidence = shownTopics.flatMap((t) => t.criteria.flatMap((c) => c.evidence));
      check(`[${label}] 원문 근거가 확인한 텍스트의 해당 줄에 그대로 있음`, allEvidence.every((e) => data.lines[e.line - 1]?.text.includes(e.text) && lines.some((l) => l.includes(e.text))), `${allEvidence.length}개`);
      const first = shownTopics.find((t) => t.criteria.some((c) => c.evidence.length));
      if (first) {
        await page.click(`.item-row >> text=${first.label}`);
        await page.waitForSelector('#view-detail:not([hidden])');
        const shown = await page.$$eval('.evidence-text', (els) => els.map((e) => e.textContent));
        const srcNote = await page.isVisible('#detail .evidence-source');
        check(`[${label}] 상세 화면: 추출·확인한 텍스트 기준 근거 (${first.label})`, srcNote && shown.length > 0 && shown.every((t) => edited.includes(t)), `${shown.length}개`);
        await page.screenshot({ path: `${OUT}/${label}-detail.png`, fullPage: true });
        await page.goBack();
        await page.waitForSelector('#view-result:not([hidden])');
      }
      // 결과 화면의 '다시 입력' → 파일 추출 경로이므로 S-03으로, 수정한 텍스트가 그대로
      await page.click('#result-back');
      await page.waitForSelector('#view-review:not([hidden])');
      check(`[${label}] 결과 → '다시 입력'은 S-03으로, 수정한 텍스트 유지`, (await reviewValue()) === edited);
    }
    await sleep(REQUIRE_AI ? 16_000 : 0); // 서버 분당 요청 제한(기본 4회)과 무료 한도 여유
  }

  // 1) 파일 1개: 일반 PDF·한국어 이미지·스캔 PDF
  for (const [file, docType, truthKey, expectPhrase, minSim, analyze] of EXTRACT_CASES) {
    await fresh(docType);
    const before = analyzeCount();
    const t0 = Date.now();
    const status = await uploadAndExtract(file);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const extracted = await reviewValue();
    const sim = similarity(extracted, TRUTH[truthKey]);
    accuracy.push({ file, sim, secs });
    check(`[${file}] 추출 완료 안내`, status.kind !== 'error' && status.text.includes(expectPhrase), `${status.kind}, ${secs}초`);
    check(`[${file}] 추출 정확도 ≥ ${Math.round(minSim * 100)}%`, sim >= minSim, `${(sim * 100).toFixed(1)}%`);
    await sleep(1000);
    check(`[${file}] 자동으로 분석하지 않고 S-03 확인 화면으로 이동`, (await page.isVisible('#view-review')) && analyzeCount() === before && !(await page.isDisabled('#review-submit')));
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
    if (analyze) await analyzeEdited(file, docType, extracted);
  }

  // 2) 여러 장: 순서 섞어 올림 → 미리보기 → 관계없는 이미지 삭제 → 순서 변경 → 순서대로 추출·합치기 → 확인 후 분석
  {
    const label = 'multi-capture';
    await fresh('job_posting');
    await page.setInputFiles('#file-input', ['multi-3.png', 'multi-1.png', 'blank.png', 'multi-2.png'].map(fix));
    await page.waitForSelector('#image-panel:not([hidden])');
    const thumbsOk = await page.$$eval('.image-thumb', (els) => els.length === 4 && els.every((e) => e.complete && e.naturalWidth > 0));
    check(`[${label}] 4장 미리보기`, thumbsOk && (await names()).join(',') === 'multi-3.png,multi-1.png,blank.png,multi-2.png');
    await page.click('button[aria-label="3번째 이미지 삭제"]');
    check(`[${label}] 개별 삭제`, (await names()).join(',') === 'multi-3.png,multi-1.png,multi-2.png' && (await page.textContent('#upload-status')).includes('이미지 3장'));
    await page.click('button[aria-label="1번째 이미지 아래로"]');
    await page.click('button[aria-label="2번째 이미지 아래로"]');
    check(`[${label}] 순서 변경`, (await names()).join(',') === 'multi-1.png,multi-2.png,multi-3.png', (await names()).join(','));
    await page.screenshot({ path: `${OUT}/${label}-list.png`, fullPage: true });
    const before = analyzeCount();
    const t0 = Date.now();
    await resetStatus();
    await page.click('#extract-btn');
    const status = await waitStatus();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForSelector('#view-review:not([hidden])');
    const extracted = await reviewValue();
    const sim = similarity(extracted, TRUTH.multi);
    // 좁은 화면: 원본 탭으로 바꿨다가 돌아와도 텍스트 유지, 원본 미리보기 3쪽
    await page.fill('#review-text', `${extracted}\n(탭 전환 확인)`);
    await page.click('#rtab-source');
    const srcShown = (await page.isVisible('#preview-img')) && !(await page.isVisible('#review-text'));
    const pageLabel = await page.textContent('#preview-page');
    await page.click('#preview-next');
    const pageLabel2 = await page.textContent('#preview-page');
    await page.click('#rtab-text');
    check(`[${label}] S-03 모바일 탭: 원본 미리보기 ↔ 텍스트, 수정 내용 유지`, srcShown && pageLabel === '1 / 3' && pageLabel2 === '2 / 3' && (await reviewValue()) === `${extracted}\n(탭 전환 확인)`, `${pageLabel} → ${pageLabel2}`);
    await page.fill('#review-text', extracted);
    accuracy.push({ file: '연속 캡처 3장', sim, secs });
    const pos = (t) => extracted.replace(/\s/g, '').indexOf(t);
    check(`[${label}] 3장 추출 완료`, status.kind === 'done' && status.text.includes('3장 중 3장'), `${status.kind}, ${secs}초`);
    check(`[${label}] 정한 순서대로 합쳐짐`, pos('고객센터') >= 0 && pos('고객센터') < pos('담당업무') && pos('담당업무') < pos('지원방법'));
    check(`[${label}] 추출 정확도 ≥ 90%`, sim >= 0.9, `${(sim * 100).toFixed(1)}%`);
    check(`[${label}] 자동으로 분석하지 않음`, analyzeCount() === before);
    await analyzeEdited(label, 'job_posting', extracted);
  }

  // 3) 일부 이미지 실패: 글자 없는 이미지·손상된 이미지가 섞여도 나머지는 합치고 실패한 장을 알려 준다
  {
    const label = 'partial-failure';
    await fresh('job_posting');
    const status = await uploadAndExtract(['multi-1.png', 'blank.png', 'corrupt.png']);
    const extracted = await reviewValue();
    await page.click('#review-back'); // 실패 표시는 S-02 이미지 목록에 있다
    await page.waitForSelector('#view-input:not([hidden])');
    const failedItems = await page.$$eval('.image-item-failed .image-fail', (els) => els.map((e) => e.textContent));
    check(`[${label}] 일부 실패 안내`, status.kind === 'warn' && status.text.includes('3장 중 1장') && status.text.includes('2번째, 3번째'), status.text.slice(0, 80));
    check(`[${label}] 실패한 이미지 표시`, failedItems.length === 2, failedItems.join(' / '));
    check(`[${label}] 성공한 이미지 텍스트는 S-03 확인란에`, extracted.includes('고객센터') && extracted.includes('240'));
  }

  // 3-1) 일부만 읽힌 이미지: 성공으로만 처리하지 않고 '확인 필요'로 알린다 (인식한 글자는 고치지 않고 입력란에 그대로)
  {
    const label = 'partial-read';
    await fresh('job_posting');
    const status = await uploadAndExtract(['../ocr-bench/check-blur-1.png', '../ocr-bench/check-blur-2.png']);
    const extracted = await reviewValue();
    const onReview = await page.isVisible('#view-review');
    const reviewStatus = await page.textContent('#review-status');
    await page.click('#review-back');
    await page.waitForSelector('#view-input:not([hidden])');
    const reviewItems = await page.$$eval('.image-item', (els) => els.map((e) => (e.classList.contains('image-item-review') ? e.querySelector('.image-review').textContent : '')));
    check(`[${label}] 흐린 2번째 이미지에 확인 필요 표시`, reviewItems[1].includes('일부만 읽혔거나') && !reviewItems[0].includes('일부만'), reviewItems.join(' / '));
    check(`[${label}] 안내에 확인할 이미지 번호`, status.kind === 'warn' && status.text.includes('2번째 이미지는 일부만 읽혔거나'), status.text.slice(0, 120));
    check(`[${label}] 읽힌 텍스트는 순서대로 S-03 확인란에 (사용자가 확인·수정)`, onReview && extracted.indexOf('급여') >= 0 && extracted.indexOf('담당업무') > extracted.indexOf('급여'));
    check(`[${label}] S-03에도 같은 확인 안내`, reviewStatus === status.text);
    const nums = status.text.match(/인식이 불확실한 부분: (.+?)\. 원본 이미지와/)?.[1] ?? '';
    await page.screenshot({ path: `${OUT}/partial-read.png`, fullPage: true });
    check(`[${label}] 확인할 숫자는 인식한 그대로 안내 (고친 값을 만들지 않음)`, [...nums.matchAll(/'([^']+)'/g)].every((m) => extracted.includes(m[1])), nums || '없음');
  }

  // 3-2) 실제 서비스에서 오류가 났던 오퍼 안내문 캡처 2장 (아이콘이 있는 표, 좌우 2열 복리후생)
  {
    const label = 'real-offer';
    await fresh('offer');
    const status = await uploadAndExtract(['../ocr-real/offer-1.webp', '../ocr-real/offer-2.webp']);
    const lines = (await reviewValue()).split('\n').map((l) => l.trim());
    const need = ['연봉 4,000만원', '수습기간 중 급여 월 300만원 (세전)', '근무시간 주 5일 (월~금) 10:00 ~ 19:00', '계약기간 기간의 정함이 없는 근로계약', '직무 서비스 기획자', '입사 예정일 2026년 11월 1일 (예정)'];
    const missingPairs = need.filter((n) => !lines.includes(n));
    check(`[${label}] 항목명과 값이 같은 줄에 연결됨`, missingPairs.length === 0, missingPairs.join(' / ') || `${need.length}개`);
    const benefits = ['4대 보험 가입', '건강검진 지원', '연차 및 반차 자유 사용', '명절 선물 및 경조사비 지원', '점심 식대 지원', '자율 복장 근무', '최신 업무 장비 제공', '사내 스낵바 및 커피 무제한'];
    const own = benefits.filter((b) => lines.includes(b));
    check(`[${label}] 복리후생이 한 줄에 하나씩 (8개 중)`, own.length >= 7, `${own.length}/8`);
    // 수정 전에 아이콘이 글자로 읽혀 줄 앞에 붙었던 조각들 ('•' 글머리표를 'o'로 읽는 것은 제외)
    const iconJunk = lines.filter((l) => /^(g|ad|=<|\(\)|=e|®|=r|B|a|©|@|Q@|<\?|범0|OO|Cp|67) ?[(가-힣0-9]/.test(l));
    check(`[${label}] 아이콘을 글자로 읽은 조각 없음`, iconJunk.length === 0, iconJunk.join(' / '));
    const unsure = status.text.match(/인식이 불확실한 부분: (.+?)\. 원본 이미지와/)?.[1] ?? '';
    check(`[${label}] 불확실한 부분은 인식한 그대로 확인 요청`, unsure && [...unsure.matchAll(/'([^']+)'/g)].every((m) => lines.join('\n').includes(m[1])), unsure || '없음');
    await page.screenshot({ path: `${OUT}/real-offer.png`, fullPage: true });
  }

  // 4) 실패해도 이미 입력한 내용은 그대로: 전부 인식 실패 / 형식 오류 / PDF와 이미지 섞음 / 바꾸기 취소
  const KEEP = '이미 입력해 둔 내용입니다 (가상 예시)\n급여: 월 200만원';
  {
    await fresh('job_posting', KEEP);
    const s1 = await uploadAndExtract(['blank.png']);
    check('[all-failed] 전부 인식 실패: S-02에 머물고 OCR 실패 안내, 입력란 유지', s1.kind === 'error' && (await page.isVisible('#view-input')) && (await page.inputValue('#doc-text')) === KEEP && dialogs === 0, s1.text.slice(0, 60));

    await resetStatus();
    await page.setInputFiles('#file-input', fix('not-really.pdf'));
    const s2 = await waitStatus();
    check('[format-error] 형식 오류에도 입력란·이미지 목록 유지', s2.kind === 'error' && s2.text.includes('JPG, PNG, WebP') && (await page.inputValue('#doc-text')) === KEEP && (await names()).length === 1);

    await resetStatus();
    await page.setInputFiles('#file-input', fix('contract-text.pdf'));
    const s3 = await waitStatus();
    check('[pdf-with-images] 이미지 목록이 있으면 PDF를 함께 처리하지 않음', s3.kind === 'error' && s3.text.includes('PDF는 이미지와 함께') && (await names()).length === 1 && (await page.inputValue('#doc-text')) === KEEP);

    await page.click('#clear-images');
    await resetStatus();
    await page.setInputFiles('#file-input', [fix('contract-text.pdf'), fix('scanned.pdf')]);
    const s4 = await waitStatus();
    check('[two-pdfs] PDF는 1개씩만', s4.kind === 'error' && s4.text.includes('1개만') && (await page.inputValue('#doc-text')) === KEEP);

    // 파일 추출은 직접 입력란을 건드리지 않는다. 확인·수정하던 추출 텍스트를 새 추출로 바꿀 때만 묻고, 취소하면 그대로 둔다.
    const s5a = await uploadAndExtract(['multi-1.png']);
    await page.waitForSelector('#view-review:not([hidden])');
    check('[separate] 파일 추출 후에도 직접 입력란 내용 유지', s5a.kind !== 'error' && (await page.inputValue('#doc-text')) === KEEP && dialogs === 0);
    const EDITED = `${await reviewValue()}\n수정한 줄 (가상 예시)`;
    await page.fill('#review-text', EDITED);
    await page.click('#review-back');
    await page.waitForSelector('#view-input:not([hidden])');
    dialogAnswer = 'dismiss';
    const before = dialogs;
    await resetStatus();
    await page.click('#extract-btn');
    const s5 = await waitStatus();
    check('[replace-cancel] 다시 추출할 때 바꾸기를 취소하면 수정한 추출 텍스트 유지', dialogs === before + 1 && s5.kind === 'warn' && (await reviewValue()) === EDITED && (await page.inputValue('#doc-text')) === KEEP && (await page.isVisible('#view-input')));
    dialogAnswer = 'accept';
  }

  // 5) 최대 5장 제한
  {
    await fresh('job_posting');
    await page.setInputFiles('#file-input', ['multi-1.png', 'multi-2.png', 'multi-3.png', 'posting-ko.png', 'posting-ko.webp', 'posting-ko-photo.jpg'].map(fix));
    await page.waitForSelector('#image-panel:not([hidden])');
    const st = await page.textContent('#upload-status');
    check('[max-5] 이미지는 5장까지만 추가', (await names()).length === 5 && st.includes('최대 5장') && st.includes('1장은 추가하지 않았어요'));
  }

  // 6) 오류 안내 (PDF·파일 형식·크기)
  for (const [file, phrase] of ERROR_CASES) {
    await fresh('job_posting', KEEP);
    const name = typeof file === 'string' ? file : file.name;
    await resetStatus();
    await page.setInputFiles('#file-input', fix(file));
    const status = await waitStatus();
    check(`[${name}] 오류 안내, 입력란 유지`, status.kind === 'error' && status.text.includes(phrase) && (await page.inputValue('#doc-text')) === KEEP, status.text);
  }

  check('파일·추출 텍스트를 외부로 보내지 않음 (외부 요청 없음)', external.length === 0, external.length ? [...new Set(external)].join(', ') : '같은 사이트 요청만 있음');
  check('서버로 가는 전송은 분석 요청(JSON 텍스트)뿐', posts.every((p) => p.path === '/api/analyze' && !/%PDF|\u0089PNG|JFIF|WEBP/.test(p.body)), `POST ${posts.length}건`);
  check('브라우저 스크립트 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  if (KEY) check('서버 로그·브라우저 요청에 API 키 없음', !serverLog.includes(KEY) && !posts.some((p) => p.body.includes(KEY)));
  if (!REMOTE) check('서버 로그에 추출 원문 없음', !['입출고 서류 정리', '양화로 00', '센텀중앙로', '둔산로', '상담 내역'].some((s) => serverLog.includes(s)));
} catch (err) {
  check('예외 없이 완료', false, err.message);
} finally {
  if (browser) await browser.close();
  server?.kill();
}

console.log('\n추출 정확도 (공백 제외 글자 일치율):');
for (const a of accuracy) console.log(`  ${a.file}: ${(a.sim * 100).toFixed(1)}% (${a.secs}초)`);
const failed = checks.filter((c) => !c.ok);
console.log(`\n업로드 흐름 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
