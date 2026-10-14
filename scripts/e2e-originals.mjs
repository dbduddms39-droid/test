// v3.2 원본 PDF 저장·문서별 역할을 실제 브라우저(IndexedDB)로 확인한다. 1440px·390px 두 폭.
//   node scripts/e2e-originals.mjs
// 항상 로컬 서버를 데모 모드로 띄우고 GEMINI_API_KEY를 넘기지 않는다 → 실제 AI 호출 없음 (분석 결과는 개발용 키워드 규칙).
// 분석 실패는 /api/analyze 응답을 가로채고, 저장 실패는 IndexedDB put을 막아 만든다. 문서는 모두 가상(주식회사 파란스텝).
// TC01 공고 PDF 단독 · TC07 저장→새로고침→보기/다운로드 바이트 동일 · TC08 분석 실패(원본 유지·재분석·중복 없음)
// TC09 저장소 쓰기 실패(성공으로 표시하지 않음) · TC10 예전 기록(DB v1 → v2 업그레이드, 원본 없음) · TC11 기록 삭제 시 그 기록의 원본만 삭제
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { DEMO_POSTING, DEMO_CONTRACT } from '../test/demo-docs.js';

const PORT = Number(process.env.E2E_PORT) || 3216;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'e2e-artifacts/originals';
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
await mkdir(OUT, { recursive: true });

const env = { ...process.env, PORT: String(PORT), DEMO_MODE: 'true', RATE_LIMIT_PER_IP: '200', RATE_LIMIT_GLOBAL_PER_MINUTE: '200' };
delete env.GEMINI_API_KEY;
const server = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' });

// 저장소 쓰기 실패 흉내: sessionStorage 'e2e-fail-files'=1 이면 files 저장소만, 'e2e-fail-put'=1 이면 모든 저장소
const FAIL_PUT = () => {
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function put(...a) {
    if (sessionStorage.getItem('e2e-fail-put') === '1') throw new DOMException('mock quota exceeded', 'QuotaExceededError');
    if (sessionStorage.getItem('e2e-fail-files') === '1' && this.name === 'files') throw new DOMException('mock quota exceeded', 'QuotaExceededError');
    return orig.apply(this, a);
  };
};
const idb = (page, storeName) => page.evaluate((name) => new Promise((res, rej) => {
  const q = indexedDB.open('ildan-hwagin');
  q.onsuccess = () => {
    const db = q.result;
    if (!db.objectStoreNames.contains(name)) { db.close(); return res([]); }
    const g = db.transaction(name).objectStore(name).getAll();
    g.onsuccess = async () => {
      const rows = await Promise.all(g.result.map(async (v) => (v.blob ? { ...v, blob: undefined, bytes: Array.from(new Uint8Array(await v.blob.arrayBuffer())) } : v)));
      db.close(); res(rows);
    };
    g.onerror = () => rej(g.error);
  };
  q.onerror = () => rej(q.error);
}), storeName);

let browser;
try {
  for (let i = 0; i < 30; i += 1) { try { await fetch(`${BASE}/api/config`); break; } catch { await sleep(500); } }
  browser = await chromium.launch();

  // 가상 문서 PDF 만들기 (브라우저 인쇄 기능으로, 텍스트가 들어 있는 PDF)
  const maker = await browser.newPage();
  const makePdf = async (lines) => {
    await maker.setContent(`<html><body style="font-family:sans-serif;font-size:14px">${lines.split('\n').map((l) => `<p>${l.replace(/</g, '&lt;')}</p>`).join('')}</body></html>`);
    return maker.pdf({ format: 'A4' });
  };
  const POSTING_PDF = await makePdf(DEMO_POSTING);
  const CONTRACT_PDF = await makePdf(DEMO_CONTRACT);
  await maker.close();

  for (const [vw, vh, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, acceptDownloads: true });
    await context.addInitScript(FAIL_PUT);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const waitView = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 30_000 });
    // 원본 목록은 기록 상단 '등록 문서·원본 보기' 펼침 안에 있다
    const openOriginals = () => page.$eval('#original-dropdown', (d) => { d.open = true; });
    const text = (sel) => page.textContent(sel);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const recordId = () => page.evaluate(() => location.hash.match(/#\/records\/(rec_\w+)/)?.[1]);
    const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: true });
    const uploadPdf = async (docType, name, buffer, { add = null } = {}) => {
      await page.goto(add ? `${BASE}/#/records/${add}/add` : `${BASE}/#/new`);
      await waitView('input');
      await page.check(`input[name="doc-type"][value="${docType}"]`);
      await page.click('#tab-upload');
      await page.setInputFiles('#file-input', { name, mimeType: 'application/pdf', buffer });
      await waitView('review');
      await page.waitForFunction(() => document.querySelector('#review-text').value.length > 20, null, { timeout: 30_000 });
      await page.click('#review-submit');
    };
    // 화면의 '원본 PDF 보기' 링크가 가리키는 실제 Blob 바이트
    const viewBytes = (i = 0) => page.evaluate(async (k) => {
      const a = document.querySelectorAll('#original-list .original-view')[k];
      if (!a?.href?.startsWith('blob:')) return null;
      return Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer()));
    }, i);
    const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

    // ---- TC01 채용공고 PDF 단독 ----
    await uploadPdf('job_posting', '파란스텝_채용공고.pdf', POSTING_PDF);
    await waitView('record');
    await page.waitForSelector('#original-list .original-view:not([aria-disabled])', { state: 'attached', timeout: 10_000 }); await openOriginals();
    const rec1 = await recordId();
    check(`[${tag}] TC01 공고 단독: 저장·원본 저장 안내`, /저장됐어요/.test(await text('#save-status')) && (await page.$$('#original-list .original-item')).length === 1);
    check(`[${tag}] TC01 주요 조건 미리보기 표시 (등록 완료)`, (await text('#conditions-title')) === '주요 조건 미리보기' && (await page.$$('#condition-list .ccard')).length > 0 && (await text('#brief-done')).includes('등록 완료'));
    const recText = await text('#view-record');
    check(`[${tag}] TC01 10개 기준 미기재·불명확 경고와 확인 질문 없음`, !(await page.$('[data-group="needs"]')) && (await page.$$('#view-record .q-text')).length === 0
      && !/문서에서 확인되지 않음|내용이 모호함|일부만 확인돼요|찾지 못했어요/.test(await text('#condition-list')), recText.length);
    check(`[${tag}] TC01 협의 예정은 질문 없이 상태로`, (await text('#condition-list')).includes('협의 예정') && !(await page.$('#view-record .q-text')));
    check(`[${tag}] TC01 원본 PDF 보기·다운로드 버튼(기록 상단), 새 안내 추가`, await page.isVisible('#original-list .original-view') && await page.isVisible('#original-list .original-download') && await page.isVisible('#add-second'));
    check(`[${tag}] TC01 브라우저 저장 안내 문구`, (await text('#original-notice')).includes('파일은 현재 브라우저에 저장됩니다. 다른 기기에서는 확인할 수 없으며 브라우저 데이터 삭제 시 함께 사라질 수 있습니다.'));
    check(`[${tag}] TC01 가로 넘침 없음`, await noOverflow());
    await shot('tc01-posting');
    // 항목 상세: 근거 있는 세부 기준만, 기준 출처 안내 없음
    await page.click('#condition-list .ccard a.btn-text');
    await waitView('item');
    check(`[${tag}] TC01 항목 상세: '미기재' 세부 기준 없음, 기준 출처 아코디언 없음`, !(await page.$('#item .source-accordion')) && !/문서에서 확인되지 않음/.test(await text('#item')));
    await page.goBack(); await waitView('record');

    // ---- TC07 저장 → 새로고침 → 보기·다운로드 바이트 동일 ----
    await page.reload();
    await waitView('record');
    await page.waitForSelector('#original-list .original-view:not([aria-disabled])', { state: 'attached', timeout: 10_000 }); await openOriginals();
    const files1 = await idb(page, 'files');
    const orig = Array.from(POSTING_PDF);
    check(`[${tag}] TC07 IndexedDB에 원본 Blob·파일명·형식·크기·기록/자료 ID 저장`, files1.length === 1 && same(files1[0].bytes, orig) && files1[0].name === '파란스텝_채용공고.pdf'
      && files1[0].type === 'application/pdf' && files1[0].size === POSTING_PDF.length && files1[0].recordId === rec1 && !!files1[0].docId);
    check(`[${tag}] TC07 새로고침 후 '원본 PDF 보기'가 저장된 바이트 그대로`, same(await viewBytes(), orig));
    // 보기: 새 창(target=_blank)으로 저장된 Blob 주소를 연다. 헤드리스 Chromium에는 PDF 뷰어가 없어 새 창이 열리는 것까지만 확인한다.
    const viewAttrs = await page.$eval('#original-list .original-view', (a) => ({ target: a.target, blob: a.href.startsWith('blob:') }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#original-list .original-view')]);
    check(`[${tag}] TC07 '원본 PDF 보기' → 새 창으로 저장된 파일(Blob) 열기`, !!popup && viewAttrs.target === '_blank' && viewAttrs.blob);
    await popup.close();
    // 다운로드: 저장된 Blob 그대로, 파일명은 저장한 원래 이름 (download 속성).
    // 헤드리스 Chromium은 한글 파일명을 'download'로 바꿔 보고하므로(영문 이름은 유지) 이름은 링크 속성으로 확인한다.
    const dlName = await page.$eval('#original-list .original-download', (a) => a.getAttribute('download'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#original-list .original-download')]);
    const dlBytes = await readFile(await dl.path());
    check(`[${tag}] TC07 다운로드: 바이트 동일, 파일명 속성은 원래 이름`, dlName === '파란스텝_채용공고.pdf' && Buffer.compare(dlBytes, POSTING_PDF) === 0, `${dl.suggestedFilename()} ${dlBytes.length}B / ${POSTING_PDF.length}B`);

    // ---- TC08 분석 실패: 원본 유지, 재분석, 중복 저장 없음 ----
    await page.route('**/api/analyze', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI 분석 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.' }) }));
    await uploadPdf('contract', '파란스텝_근로계약서.pdf', CONTRACT_PDF);
    await waitView('record');
    const rec2 = await recordId();
    await page.unroute('**/api/analyze');
    await page.waitForSelector('#original-list .original-view:not([aria-disabled])', { state: 'attached', timeout: 10_000 }); await openOriginals();
    check(`[${tag}] TC08 원본 저장 완료 / 분석 실패 표시`, (await text('#save-status')).includes('원본 PDF도 이 브라우저에 저장했어요') && (await text('#save-status')).includes('분석은 완료하지 못했어요')
      && (await text('#doc-list')).includes('원본 저장 완료') && (await text('#doc-list')).includes('분석 실패'));
    check(`[${tag}] TC08 분석 실패여도 원본 보기 가능 (바이트 동일)`, same(await viewBytes(), Array.from(CONTRACT_PDF)));
    check(`[${tag}] TC08 분석 결과가 없으면 조건 카드·질문 없이 안내`, (await page.$$('#condition-list .ccard')).length === 0 && (await text('#conditions-empty')).includes('아직 분석된 자료가 없어요'));
    await shot('tc08-failed');
    const filesBefore = (await idb(page, 'files')).length;
    await page.click('#doc-list button[data-reanalyze]');
    await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('다시 분석한 결과'), null, { timeout: 30_000 });
    const rec2Row = (await idb(page, 'records')).find((r) => r.id === rec2);
    check(`[${tag}] TC08 같은 텍스트로 다시 분석 → 분석됨, 원본 다시 저장 안 함`, rec2Row.documents[0].status === 'analyzed' && (await idb(page, 'files')).length === filesBefore && (await page.$$('#condition-list .ccard, #contract-glance-list > li')).length > 0);
    check(`[${tag}] TC06 계약서 단독: 기재 내용 확인 화면 유지 ('근로계약서 확인 결과')`, (await text('#conditions-title')) === '근로계약서 확인 결과');
    // 같은 PDF를 같은 기록에 다시 등록 → 원본은 한 번만
    await uploadPdf('contract', '파란스텝_근로계약서(사본).pdf', CONTRACT_PDF, { add: rec2 });
    await waitView('record');
    check(`[${tag}] TC08 같은 PDF 재등록: 원본 중복 저장 없음, 연결 안내`, (await text('#save-status')).includes('같은 PDF 원본이 이미 이 기록에 있어') && (await idb(page, 'files')).filter((f) => f.recordId === rec2).length === 1);

    // ---- TC02·TC04 공고 → 계약서 바로 (같은 기록에 추가) ----
    await page.goto(`${BASE}/#/records/${rec1}/add`);
    await waitView('input');
    check(`[${tag}] 새 안내 추가: 처우·근로조건 안내는 선택 자료로 표시`, (await text('#doc-type-field')).includes('처우·근로조건 안내') && (await text('#doc-type-field')).includes('선택'));
    await uploadPdf('contract', '파란스텝_근로계약서.pdf', CONTRACT_PDF, { add: rec1 });
    await waitView('record');
    await page.waitForSelector('#original-list .original-item:nth-child(2) .original-view:not([aria-disabled])', { state: 'attached', timeout: 10_000 }); await openOriginals();
    const diff = (await page.$('[data-group="different"]')) ? await text('[data-group="different"]') : '';
    check(`[${tag}] TC02 공고 09:00~18:00 ↔ 계약서 10:00~19:00: 서로 다른 안내 + 질문`, diff.includes('근무시간') && (await page.$$('[data-group="different"] .q-text')).length >= 1, diff.slice(0, 100));
    check(`[${tag}] TC04 공고 → 계약서 바로: 계약서가 있으면 '입사 전 확인할 내용'이 먼저, 원본 2개`, await page.$eval('#now-section', (n) => !!(n.compareDocumentPosition(document.querySelector('#conditions-section')) & Node.DOCUMENT_POSITION_FOLLOWING))
      && (await page.$$('#original-list .original-item')).length === 2);
    check(`[${tag}] TC04 가로 넘침 없음`, await noOverflow());
    await shot('tc04-posting-contract');

    // ---- TC09 저장소 쓰기 실패 ----
    // (a) 원본만 저장 실패 → 텍스트·분석은 저장, 원본은 '저장하지 못했어요' (저장했다고 하지 않음)
    await page.evaluate(() => sessionStorage.setItem('e2e-fail-files', '1'));
    await uploadPdf('job_posting', '파란스텝_채용공고.pdf', POSTING_PDF);
    await waitView('record');
    const rec3 = await recordId();
    await page.evaluate(() => sessionStorage.removeItem('e2e-fail-files'));
    const s3 = await text('#save-status');
    check(`[${tag}] TC09 원본 저장 실패: 성공으로 표시하지 않음, 보기 버튼 없음`, s3.includes('원본 PDF는') && s3.includes('저장하지 못했어요') && !s3.includes('원본 PDF도 이 브라우저에 저장했어요')
      && (await page.$$('#original-list .original-item')).length === 0 && (await text('#doc-list')).includes('저장하지 못했어요'));
    check(`[${tag}] TC09 원본 저장 실패한 기록에는 파일이 없음`, (await idb(page, 'files')).every((f) => f.recordId !== rec3));
    // (b) 저장소 전체 실패 → '저장되지 않았어요', 원본도 남지 않음
    const filesBeforeFail = (await idb(page, 'files')).length;
    await page.evaluate(() => sessionStorage.setItem('e2e-fail-put', '1'));
    await uploadPdf('job_posting', '파란스텝_채용공고_새.pdf', await (async () => Buffer.concat([POSTING_PDF, Buffer.from('\n% v2\n')]))());
    await waitView('record');
    check(`[${tag}] TC09 저장소 실패: '저장되지 않았어요', 저장했다고 하지 않음`, (await text('#save-status')).includes('저장되지 않았어요') && !/저장했어요|저장됐어요/.test(await text('#save-status')) && (await page.$$('#original-list .original-item')).length === 0);
    await page.evaluate(() => sessionStorage.removeItem('e2e-fail-put'));
    check(`[${tag}] TC09 저장 실패 시 원본 파일도 남지 않음`, (await idb(page, 'files')).length === filesBeforeFail);
    await page.click('#save-retry');
    await page.waitForFunction(() => /#\/records\/rec_/.test(location.hash));
    await waitView('record');
    check(`[${tag}] TC09 다시 저장하면 원본도 함께 저장`, /저장됐어요/.test(await text('#save-status')) && (await idb(page, 'files')).length === filesBeforeFail + 1);

    // ---- TC11 기록 삭제: 그 기록의 원본만 ----
    const filesAll = await idb(page, 'files');
    await page.goto(`${BASE}/#/records/${rec2}`);
    await waitView('record');
    await page.click('#delete-record');
    await waitView('records');
    const filesAfter = await idb(page, 'files');
    check(`[${tag}] TC11 기록 삭제: 그 기록의 원본만 삭제, 다른 기록 원본은 그대로`, filesAfter.every((f) => f.recordId !== rec2) && filesAfter.length === filesAll.filter((f) => f.recordId !== rec2).length && filesAfter.some((f) => f.recordId === rec1));
    check(`[${tag}] S06 보관 안내에 원본 PDF 저장 범위`, (await text('.storage-note')).includes('사진 원본은 저장하지 않아요') && (await text('.storage-note')).includes('파일은 현재 브라우저에 저장됩니다'));
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors.join(' | ').slice(0, 200));
    await context.close();
  }

  // ---- TC10 예전 기록: DB v1(records만) → 앱이 v2로 올리며 files 저장소 추가, 기존 기록 그대로 ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/robots.txt`); // 같은 출처에서 예전 형식의 DB를 먼저 만든다
    // 예전(v3.1) 형식 기록: 상태·원본 정보 없음, PDF로 등록했던 자료. 분석 결과는 데모 서버로 만든 v2.2 형식
    const legacyAnalysis = ((await (await fetch(`${BASE}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docType: 'job_posting', text: DEMO_POSTING }) })).json()));
    await page.evaluate((analysis) => new Promise((res, rej) => {
      const q = indexedDB.open('ildan-hwagin', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('records', { keyPath: 'id' });
      q.onsuccess = () => {
        const tx = q.result.transaction('records', 'readwrite');
        tx.objectStore('records').put({ id: 'rec_legacy', alias: '예전 기록(가상)', aliasSource: 'user', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', notes: [],
          documents: [{ id: 'doc_legacy', recordId: 'rec_legacy', docType: 'job_posting', confirmedText: analysis.lines.map((l) => l.text).join('\n'), inputSource: 'pdf', extractNotes: [], lowConfidence: [],
            registeredAt: '2026-09-01T00:00:00.000Z', analyzedAt: '2026-09-01T00:00:00.000Z', mode: 'demo', analysis }] });
        tx.oncomplete = () => { q.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      q.onerror = () => rej(q.error);
    }), { version: legacyAnalysis.version, docType: legacyAnalysis.docType, counts: legacyAnalysis.counts, topics: legacyAnalysis.topics, criteria: legacyAnalysis.criteria,
      lines: legacyAnalysis.lines, sourceGuide: legacyAnalysis.sourceGuide, notice: legacyAnalysis.notice });
    await page.goto(`${BASE}/#/records/rec_legacy`);
    await page.waitForSelector('#view-record:not([hidden])', { timeout: 30_000 });
    const ver = await page.evaluate(() => new Promise((res) => { const q = indexedDB.open('ildan-hwagin'); q.onsuccess = () => { const v = { version: q.result.version, stores: [...q.result.objectStoreNames] }; q.result.close(); res(v); }; }));
    check('TC10 DB v1 → v2: files 저장소 추가, 기존 기록 유지', ver.version === 2 && ver.stores.includes('files') && ver.stores.includes('records'));
    check('TC10 예전 기록 열기: 원본 보기 버튼 없음, 안내 문구', (await page.$$('#original-list .original-item')).length === 0 && (await page.textContent('#doc-list')).includes('이전에 등록한 자료는 원본 파일이 보관되어 있지 않아요'));
    check('TC10 예전 기록: 조건 카드·텍스트 그대로, 분석 실패로 보지 않음', (await page.$$('#condition-list .ccard')).length > 0 && !(await page.textContent('#doc-list')).includes('분석 실패'));
    const stored = await idb(page, 'records');
    check('TC10 예전 기록은 열기만으로 바뀌지 않음', stored.length === 1 && stored[0].documents[0].status === undefined && stored[0].updatedAt === '2026-09-01T00:00:00.000Z');
    check('TC10 페이지 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 200));
    await page.screenshot({ path: `${OUT}/tc10-legacy.png`, fullPage: true });
    await context.close();
  }
} catch (e) {
  check('예외 없이 완료', false, e.message.split('\n')[0]);
} finally {
  await browser?.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n원본 PDF·문서 역할 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
