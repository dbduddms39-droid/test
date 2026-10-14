// S04 입사조건 기록·S05 항목 상세를 실제 브라우저로 확인한다 (점검 기준 v2.2 화면).
//   node scripts/e2e-result.mjs
// 실제 AI를 호출하지 않는다. 서버를 이 프로세스 안에서 띄우고, 가상 문서 F01~F11의 '올바른 추출값'(사람이 작성)을
// 돌려주는 가짜 분석기를 쓴다. 따라서 이 검사는 화면 표시와 원문 연결을 보는 것이며 AI 정확도와 무관하다.
// 검사: 상세의 원문 근거 줄·근거 칩이 API 근거와 같은 줄·구절을 가리키는지, 내부 코드 비노출,
//       분석 확인 불가를 미기재로 표시하지 않음, 08 조건부 표시, 격주 근무 주별 값, 공식 링크, 가로 스크롤.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { FIXTURES, buildExtraction, rangesOf } from '../test/v22-fixtures.js';

const OUT = 'e2e-artifacts/result';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const INTERNAL_CODE = /\b\d{2}-[a-g]\b|\bL-[MW]\b|MAIN_[A-Z]+|CONFIRMED|NOT_APPLICABLE|UNAVAILABLE|\bC\/D\b/;

// 입력 텍스트로 해당 픽스처를 찾아 올바른 추출값을 돌려주는 가짜 분석기
const fixtureAI = {
  name: 'demo',
  async analyze({ segments, criterionIds }) {
    const text = segments.map((s) => s.text).join('\n');
    const f = FIXTURES.find((x) => segmentText(x.text).map((s) => s.text).join('\n') === text);
    if (!f) throw Object.assign(new Error('unknown fixture'), { code: 'api_error' });
    return buildExtraction(segments, f.extraction, criterionIds);
  },
};

await mkdir(OUT, { recursive: true });
const server = createServer({ ai: fixtureAI, limiter: { check: () => ({ ok: true }) } });
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch();
  const pageErrors = [];
  const open = async (width, height) => {
    const p = await browser.newPage({ viewport: { width, height } });
    p.on('pageerror', (e) => pageErrors.push(e.message));
    return p;
  };
  // 문서를 붙여넣어 분석. OCR 저신뢰 전제가 있는 문서는 S-03에서 확인하지 않은 구간을 보낸 것과 같은 요청을 만든다.
  const analyze = async (p, key) => {
    const f = FIXTURES.find((x) => x.key === key);
    let data = null;
    await p.route('**/api/analyze', async (route) => {
      const body = JSON.parse(route.request().postData());
      if (f.lowConfidence) body.lowConfidence = rangesOf(body.text, f.lowConfidence);
      const res = await route.fetch({ postData: JSON.stringify(body) });
      data = await res.json();
      await route.fulfill({ response: res });
    });
    await p.goto(`${BASE}/#/new`);
    await p.waitForSelector('#view-input:not([hidden])');
    await p.check(`input[name="doc-type"][value="${f.docType}"]`);
    await p.fill('#doc-text', f.text);
    await p.click('#submit-btn');
    await p.waitForSelector('#view-record:not([hidden])');
    await p.unroute('**/api/analyze');
    const rec = p.url().match(/#\/records\/(rec_[A-Za-z0-9]+)/)[1];
    return { f, data, rec };
  };
  const evidenceOf = (t) => t.criteria.flatMap((c) => c.evidence);
  const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // 1) 데스크톱(1440): S04 주요 근로조건 + S05 항목 상세의 원문 근거 (근거 줄만 형광펜)
  const d = await open(1440, 900);
  const { data: r5, rec: rec5 } = await analyze(d, 'F05');
  const visible5 = r5.topics.filter((t) => t.visible);
  const rows5 = await d.$$eval('#condition-list .cmp-card', (els) => els.map((e) => e.dataset.item));
  check('근로계약서: 표시 항목 10개(08 표시) 모두 기재 상태로', visible5.length === 10 && sameSet(rows5, visible5.map((t) => t.id)));
  const t03 = r5.topics.find((t) => t.id === '03');
  const row03 = await d.textContent('#condition-list [data-item="03"]');
  check('분석 확인 불가를 미기재로 표시하지 않음 (S04)', t03.status === 'MAIN_UNAVAILABLE' && row03.includes('분석 확인 불가') && !row03.includes('확인되지 않') && /적혀 있지 않다는 뜻[이은] 아니에요/.test(row03));
  check('분석 확인 불가는 재분석 안내 (회사 질문 아님)', await d.isVisible('[data-group="unavailable"] button[data-reanalyze]') && !(await d.$('[data-group="unavailable"] .q-text')));
  await d.screenshot({ path: `${OUT}/S04-desktop.png`, fullPage: true });

  // 2) 상세(데스크톱): 세부기준 근거 칩 = API 근거, 원문 근거 줄 = API 근거 줄, 칩을 누르면 같은 줄로 이동
  const chipProblems = [];
  for (const t of visible5) {
    await d.goto(`${BASE}/#/records/${rec5}/item/${t.id}`);
    await d.waitForSelector('#view-item:not([hidden])');
    const cards = await d.$$eval('#item .criterion', (els) => els.map((e) => ({ id: e.dataset.criterion, status: e.querySelector('.badge').textContent, count: Number([...e.querySelectorAll('.card-detail p')].map((p) => p.textContent.match(/관련 원문 근거 (\d+)곳/)?.[1]).find(Boolean) ?? 0) })));
    for (const c of t.criteria) {
      const card = cards.find((x) => x.id === c.id);
      if (!card || card.status !== c.statusLabel || card.count !== c.evidence.length) chipProblems.push(c.id);
    }
    const ev = evidenceOf(t);
    const shown = await d.$$eval('#item .doc-block .paper-sheet > .doc-lines .doc-line', (els) => els.map((e) => ({ line: Number(e.dataset.line), marks: [...e.querySelectorAll('mark')].map((m) => m.textContent) })));
    const linesOk = sameSet(shown.map((x) => String(x.line)), [...new Set(ev.map((e) => String(e.line)))]);
    const marksOk = ev.every((e) => shown.find((x) => x.line === e.line)?.marks.some((mk) => mk.includes(e.text)))
      && shown.every((x) => x.marks.every((mk) => ev.some((e) => e.line === x.line && mk.includes(e.text)) && r5.lines[x.line - 1].text.includes(mk)));
    if (!linesOk || !marksOk) chipProblems.push(`${t.id} 원문 근거 줄`);
    // 카드에는 근거 건수만 (인용 전문은 아래 '원문 근거'에서 한 번만), 카드 안 인용 칩 없음
    if ((await d.$$('#item .evidence-chip')).length) chipProblems.push(`${t.id} 인용 반복`);
    const text = await d.$eval('main', (m) => m.innerText);
    if (INTERNAL_CODE.test(text)) chipProblems.push(`${t.id} 내부 코드 노출: ${text.match(INTERNAL_CODE)[0]}`);
    const hrefs = await d.$$eval('#item .source-accordion a', (as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
    if (!sameSet(hrefs.map((h) => h.href), t.links.map((l) => l.url)) || hrefs.some((h) => h.target !== '_blank' || !h.rel.includes('noopener'))) chipProblems.push(`${t.id} 링크`);
    const notes = await d.$$eval('#item .doc-block .note', (els) => els.length);
    if (notes !== ['neutral', 'applicability', 'probationHold'].filter((k) => t.notes[k]).length) chipProblems.push(`${t.id} 안내`);
  }
  check('상세: 세부 상태·근거 건수·원문 근거 줄과 강조가 API와 같고, 인용은 한 번만', chipProblems.length === 0, chipProblems.slice(0, 6).join(', '));
  check('상세: 내부 코드(세부기준 ID·C/D·출처 코드) 비노출, 공식 링크 정확, 안내 영역 분리', !chipProblems.some((p) => /노출|링크|안내/.test(p)));
  await d.goto(`${BASE}/#/records/${rec5}/item/03`);
  await d.waitForSelector('#view-item:not([hidden])');
  const d03 = await d.$eval('main', (m) => m.innerText);
  check('분석 확인 불가 상세: 근거 구절을 보이지 않고, 미기재가 아니라고 안내', (await d.$$('#item .evidence-chip')).length === 0 && d03.includes('글자 인식(OCR)이 불확실한 곳') && d03.includes('적혀 있지 않다는 뜻이 아니에요'));
  await d.screenshot({ path: `${OUT}/S05-desktop-03.png`, fullPage: true });

  // 3) 격주 근무(D03): 주별 값을 평균 없이 표시
  const { rec: rec9 } = await analyze(d, 'F09');
  await d.goto(`${BASE}/#/records/${rec9}/item/02`);
  await d.waitForSelector('#view-item:not([hidden])');
  const calc = await d.$$eval('#item .value-row.is-calculated .value', (els) => els.map((e) => e.textContent));
  check('격주 근무시간: 주별 계산값을 평균 없이 표시 (원문 값이 아닌 계산값으로 표시)', calc.length === 2 && calc[0].endsWith('주 40시간') && calc[1].endsWith('주 43시간') && !(await d.$eval('main', (m) => m.innerText)).includes('41.5'), calc.join(' / '));
  await d.screenshot({ path: `${OUT}/S05-desktop-F09-02.png`, fullPage: true });

  // 4) 수습 미정 문서: 08 미표시, 07에 보류 안내
  const { data: r2, rec: rec2 } = await analyze(d, 'F02');
  const rows2 = await d.$$eval('#condition-list .cmp-card', (els) => els.map((e) => e.dataset.item));
  check('수습 미정 문서: 08 미표시 (표시 대상 9개)', !rows2.includes('08') && r2.counts.shown === 9);
  await d.goto(`${BASE}/#/records/${rec2}/item/07`);
  await d.waitForSelector('#view-item:not([hidden])');
  check('07 상세에 수습 중 급여 보류 안내', (await d.$$eval('#item .doc-block .note-hold', (els) => els.length)) === 1);
  await d.goto(`${BASE}/#/records/${rec2}/item/08`);
  await d.waitForSelector('#view-record:not([hidden])');
  check('표시하지 않은 08 상세 주소는 기록 화면으로', d.url().endsWith(`#/records/${rec2}`));

  // 5) 모바일(390): 항목 상세의 원문 근거 줄
  const m = await open(390, 844);
  const { data: rm, rec: recm } = await analyze(m, 'F05');
  const mobileProblems = [];
  for (const t of rm.topics.filter((x) => x.visible)) {
    await m.goto(`${BASE}/#/records/${recm}/item/${t.id}`);
    await m.waitForSelector('#view-item:not([hidden])');
    const lines = await m.$$eval('#item .doc-block .paper-sheet > .doc-lines .doc-line', (els) => els.map((e) => e.dataset.line));
    if (!sameSet(lines, [...new Set(evidenceOf(t).map((e) => String(e.line)))])) mobileProblems.push(t.id);
  }
  check('모바일: 항목마다 원문 근거 줄 확인 (근거 없는 항목은 근거 없음 안내)', mobileProblems.length === 0, mobileProblems.join(', '));
  await m.screenshot({ path: `${OUT}/S05-mobile.png`, fullPage: true });

  // 6) 가로 스크롤 없음
  for (const [w, h] of [[390, 844], [1280, 800], [1440, 900]]) {
    const p = await open(w, h);
    const { rec } = await analyze(p, 'F04');
    const s04 = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await p.goto(`${BASE}/#/records/${rec}/item/10`);
    await p.waitForSelector('#view-item:not([hidden]), #view-record:not([hidden])');
    const s05 = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(`${w}px: S04·S05 가로 스크롤 없음`, !s04 && !s05);
  }
  check('브라우저 스크립트 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  check('예외 없이 완료', false, err.message);
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n결과 화면 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
