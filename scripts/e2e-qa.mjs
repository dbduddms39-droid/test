// QA 시나리오(채용공고 → 최종합격 안내 → 근로계약서)를 실제 브라우저로 확인한다. 모의 AI(test/qa-docs.js의 사람이 작성한 응답) 사용.
//   node scripts/e2e-qa.mjs
// 실제 Gemini 호출 없음 → AI 추출 정확도가 아니라 화면 구조·판정 표시·질문·저장 호환성을 본다.
// 검사: 첫 화면에 '입사 전 확인할 내용', 서로 다른 조건(급여·근무시간)·새롭게 구체화된 조건(수습 중 급여),
//   계약기간·고용형태 구분, 수습기간 같은 3개월, 상세는 기본 접힘, 대표 질문 1개·복사·편집, 메모 유지,
//   예전 형식(이전 버전) 기록 열기, 계약서 임금 '분석 확인 불가' 원인 표시, 1440·390px 가로 넘침·화면 길이.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from '../server.js';
import { segmentText } from '../src/segment.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { createRateLimiter } from '../src/rateLimit.js';
import { buildExtraction } from '../test/v22-fixtures.js';
import { QA_POSTING, QA_OFFER, QA_CONTRACT, QA_POSTING_SPECS, QA_OFFER_SPECS, QA_CONTRACT_SPECS, WAGE_FAILURE_MODES } from '../test/qa-docs.js';
import { DEMO_POSTING, DEMO_OFFER, DEMO_CONTRACT, DEMO_POSTING_SPECS, DEMO_OFFER_SPECS, DEMO_CONTRACT_SPECS } from '../test/demo-docs.js';
import { GQ_POSTING, GQ_CONTRACT, GQ_POSTING_SPECS, GQ_CONTRACT_SPECS } from '../test/gemini-qa-docs.js';

const OUT = 'e2e-artifacts/qa';
await mkdir(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 모의 AI: 입력 텍스트로 문서를 찾아 미리 정한 응답을 돌려준다. wageFailure이면 계약서 임금 기재값을 바꿔 쓴 응답(QA 증상 재현)
let wageFailure = false;
const ai = {
  name: 'demo',
  async analyze({ segments, criterionIds }) {
    const text = segments.map((s) => s.text).join('\n');
    const doc = [[QA_POSTING, QA_POSTING_SPECS], [QA_OFFER, QA_OFFER_SPECS], [QA_CONTRACT, QA_CONTRACT_SPECS],
      [DEMO_POSTING, DEMO_POSTING_SPECS], [DEMO_OFFER, DEMO_OFFER_SPECS], [DEMO_CONTRACT, DEMO_CONTRACT_SPECS],
      [GQ_POSTING, GQ_POSTING_SPECS], [GQ_CONTRACT, GQ_CONTRACT_SPECS]]
      .find(([t]) => segmentText(t).map((s) => s.text).join('\n') === text);
    if (!doc) throw Object.assign(new Error('unknown'), { code: 'api_error' });
    const specs = doc[0] === QA_CONTRACT && wageFailure ? WAGE_FAILURE_MODES.rewritten_value(doc[1]) : doc[1];
    const all = buildExtraction(segments, specs, CRITERION_IDS);
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
};
const server = createServer({ ai, limiter: createRateLimiter({ perIp: 1000, globalPerMinute: 1000, globalPerDay: 10000 }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const view = (v) => page.waitForSelector(`#view-${v}:not([hidden])`, { timeout: 15000 });
    const text = (sel) => page.textContent(sel);
    const register = async (docType, body) => {
      await view('input');
      await page.check(`input[name="doc-type"][value="${docType}"]`);
      await page.fill('#doc-text', body);
      await page.click('#submit-btn');
      await view('record');
    };
    // 비교 화면: 한쪽에만 기재 · 추가 대조 필요 묶음 (예전 '새롭게 기재되거나 확인이 필요한 조건')
    const specText = async () => `${await groupText('onesided')}${await groupText('review')}`;
    const groupText = async (g) => ((await page.$(`[data-group="${g}"]`)) ? text(`[data-group="${g}"]`) : '');
    const firstScreen = async (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().top < window.innerHeight);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    // 1) 채용공고만
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', QA_POSTING);
    const rec = page.url().match(/#\/records\/(rec_\w+)/)[1];
    const c01 = await text('#condition-list [data-item="01"]');
    check(`[${tag}] 1) 공고: 급여 3,400만원`, c01.includes('3,400만원'));
    check(`[${tag}] 1) 공고: 근무시간 09:00~18:00 (휴게 12:00~13:00)`, (await text('#condition-list [data-item="02"]')).includes('09:00~18:00 · 휴게 12:00~13:00'));
    const c02 = await text('#condition-list [data-item="02"]');
    // v3.2: 채용공고는 기록만 — 빠진 세부 정보(주 소정근로시간 숫자)를 지적하지 않고 적힌 값만, 확인 질문 없음
    check(`[${tag}] 1) 공고 단독: 적힌 근무시간만, 미기재·불명확 표시와 질문 없음`, c02.includes('09:00~18:00') && !c02.includes('주 소정근로시간') && !c02.includes('일부만') && !c02.includes('정해지지 않았어요') && !(await groupText('needs')) && (await page.$$('#view-record .q-text')).length === 0, c02.slice(0, 120));
    check(`[${tag}] 1) 공고 단독: 주요 조건 미리보기 + 두 번째 문서 추가 안내 (원문·전체 조건은 접힘)`, (await text('#conditions-title')) === '주요 조건 미리보기' && await page.isVisible('#add-second') && !(await page.$eval('#docs-box', (d) => d.open)));
    const c08 = await text('#condition-list [data-item="08"]');
    check(`[${tag}] 1) 수습 급여 '별도 안내'를 금액으로 보지 않음`, c08.includes('최종합격 시 별도 안내') && !/\d+만원|\d+%/.test(c08));
    check(`[${tag}] 1) 계약기간: 공고의 정규직 문구를 계약기간으로 쓰지 않음`, !(await page.$('#condition-list [data-item="06"]')) || !(await text('#condition-list [data-item="06"]')).includes('정규직'));

    // 2) 오퍼 추가
    await page.click('#add-doc:visible, #add-second:visible');
    await register('offer', QA_OFFER);
    const diff2 = await groupText('different');
    check(`[${tag}] 2) 서로 다른 조건: 임금·근무시간`, diff2.includes('임금') && diff2.includes('근무시간') && diff2.includes('3,400만원') && diff2.includes('3,600만원'), diff2.slice(0, 160));
    check(`[${tag}] 2) 근무장소·고용형태 공통`, (await text('#condition-list [data-item="03"] .badge-relation')) === '같은 조건' && (await text('#condition-list [data-item="05"] .badge-relation')) === '같은 조건');
    const hoursQ = await page.$eval('[data-group="different"] [data-topic="02"] .q-block > .question .q-text', (e) => e.value);
    check(`[${tag}] 2) 근무시간 대표 질문 1개`, hoursQ === '채용공고에는 근무시간이 09:00~18:00, 처우·근로조건 안내에는 10:00~19:00으로 기재되어 있습니다. 실제 적용되는 근무시간을 확인 부탁드립니다.', hoursQ);
    const qCount = await page.$$eval('[data-group="different"] [data-topic="02"] .q-block > .question', (e) => e.length);
    check(`[${tag}] 2) 근무시간 질문은 대표 1개 + 접힌 추가 질문`, qCount === 1 && (await page.$$('[data-group="different"] [data-topic="02"] details.extra-q')).length <= 1);

    // 3) 계약서 추가
    await page.click('#add-doc:visible, #add-second:visible');
    await register('contract', QA_CONTRACT);
    // 문서 3건: 기본은 앞의 두 문서 비교 → 두 번째 칸을 근로계약서로 바꿔 채용공고 ↔ 근로계약서 비교
    check(`[${tag}] 3) 문서 3건: 비교할 두 문서 선택 칸 표시`, await page.isVisible('#compare-pair') && (await page.$$('#compare-doc-b option')).length === 3);
    await page.selectOption('#compare-doc-b', { index: 2 }); await page.waitForTimeout(200);
    check(`[${tag}] 3) 선택한 두 문서(채용공고 ↔ 근로계약서)만 A·B로 비교`, (await text('#cmp-docs .cmp-doc.is-a')).includes('채용공고') && (await text('#cmp-docs .cmp-doc.is-b')).includes('근로계약서'), await text('#cmp-docs'));
    check(`[${tag}] 3) 자료 3건, 이전 자료 보존`, (await page.$$('#doc-list > li')).length === 3 && (await text('#doc-list')).includes('연봉: 3,400만원'));
    check(`[${tag}] 3) 첫 화면에 '입사 전 확인할 내용'`, await firstScreen('#cmp-docs'));
    const spec = await specText();
    check(`[${tag}] 3) 새롭게 구체화된 조건: 수습 중 급여 90%`, spec.includes('이전 자료에는 구체적인 수습 중 임금이 없었지만, 근로계약서에는 정규 급여의 90%, 월 2,700,000원(세전)으로 적혀 있어요.'), spec.slice(0, 160));
    check(`[${tag}] 3) 계약기간: 계약서에 처음 적힘(기간의 정함 없음), 고용형태와 분리`, spec.includes('계약기간') && (await text('#condition-list [data-item="06"]')).includes('기간의 정함 없음') && !(await text('#condition-list [data-item="06"]')).includes('정규직'));
    check(`[${tag}] 3) 수습기간 3개월: 같은 내용 (날짜는 따로)`, (await text('#condition-list [data-item="07"] .badge-relation')) === '같은 조건');
    check(`[${tag}] 3) 계약서 임금 확인됨 (올바른 응답), 금액 표시`, (await text('#condition-list [data-item="01"]')).includes('연봉 36,000,000원(세전)') && !(await groupText('unavailable')));
    check(`[${tag}] 3) 근무시간: 서로 다른 안내 + 근로계약서 10:00~19:00`, (await text('#condition-list [data-item="02"] .badge-relation')) === '서로 다른 조건' && (await text('#condition-list [data-item="02"]')).includes('10:00~19:00'));
    check(`[${tag}] 3) 상세 정보는 기본 접힘`, !(await page.$eval('#all-conditions', (d) => d.open)) && !(await page.$eval('#docs-box', (d) => d.open)) && !(await page.$eval('#more-box', (d) => d.open)));
    check(`[${tag}] 3) 요약·카드에 원문 인용 반복 없음 (원문은 상세에서)`, (await page.$$('#summary-groups q, #condition-list q')).length === 0);
    const qTexts = await page.$$eval('#condition-list .q-block > .question .q-text', (e) => e.map((x) => x.value));
    check(`[${tag}] 3) 대표 질문 중복 없음`, new Set(qTexts).size === qTexts.length, `${qTexts.length}개`);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`      [${tag}] 기록 화면 길이 ${height}px (자료 3건)`);
    check(`[${tag}] 가로 넘침 없음 (기록)`, await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-s04-three-docs.png`, fullPage: true });
    await page.screenshot({ path: `${OUT}/${tag}-s04-first-screen.png`, fullPage: false });

    // 질문 편집·복사
    const ta = '[data-group="different"] [data-topic="01"] .q-block > .question .q-text';
    await page.fill(ta, '급여를 확인 부탁드립니다. (가상 편집)');
    await page.click('[data-group="different"] [data-topic="01"] .q-block > .question [data-copy]');
    await page.waitForFunction(() => document.querySelector('[data-group="different"] [data-topic="01"] .q-status')?.textContent);
    check(`[${tag}] 질문 편집 후 복사 → 편집한 문장`, (await page.evaluate(() => navigator.clipboard.readText())) === '급여를 확인 부탁드립니다. (가상 편집)');
    // 접힌 상세 펼치기
    await page.click('#all-conditions > summary');
    check(`[${tag}] 전체 근로조건 목록 펼침`, await page.isVisible('#all-condition-list [data-item="10"]'));

    // S05 + 메모
    await page.goto(`${BASE}/#/records/${rec}/item/02`);
    await view('item');
    const itemText = await text('#item');
    check(`[${tag}] S05: 자료별 원문 근거와 관계 이유`, itemText.includes('09:00~18:00') && itemText.includes('10:00~19:00') && itemText.includes('자료 사이 관계'));
    await page.click('#memo-add');
    await page.fill('#memo-text', '담당자: 10시 출근 (가상)');
    await page.click('#memo-save');
    await page.waitForSelector('.memo-item');
    await page.goto(`${BASE}/#/records/${rec}`);
    await view('record');
    check(`[${tag}] 메모 유지·카드에 표시`, (await text('#condition-list [data-item="02"]')).includes('내 메모 있음'));
    await page.screenshot({ path: `${OUT}/${tag}-s05-hours.png`, fullPage: true });

    // 예전 형식 기록(이전 버전에서 저장, 이유 코드 없음) 열기
    const oldId = await page.evaluate(async (id) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ildan-hwagin'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const get = () => new Promise((res) => { const g = db.transaction('records').objectStore('records').get(id); g.onsuccess = () => res(g.result); });
      const cur = await get();
      const old = structuredClone(cur);
      old.id = 'rec_oldformat0001';
      old.alias = '예전 형식 기록';
      for (const d of old.documents) {
        for (const t of d.analysis.topics) for (const c of t.criteria) { delete c.boundary; delete c.unavailableCodes; }
        for (const c of Object.values(d.analysis.criteria)) { delete c.boundary; delete c.codes; }
      }
      await new Promise((res, rej) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(old); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      return old.id;
    }, rec);
    await page.goto(`${BASE}/#/records/${oldId}`);
    await view('record');
    check(`[${tag}] 예전 형식 기록도 열림·요약 표시`, (await text('#record-title')) === '예전 형식 기록' && (await groupText('different')).includes('임금') && (await text('#condition-list [data-item="02"]')).length > 0);

    // 실제 Gemini QA 결과 재현(모의 응답, test/gemini-qa-docs.js): 공고 → 계약서 바로
    await page.goto(`${BASE}/#/new`);
    await register('job_posting', GQ_POSTING);
    await page.click('#add-doc:visible, #add-second:visible');
    await register('contract', GQ_CONTRACT);
    await page.waitForTimeout(200);
    const gqDiff = await groupText('different');
    check(`[${tag}] GQ 유지: 급여·근무시간 서로 다른 안내, 수습 급여 구체화, 계약기간 처음 적힘, 수습기간 같음`, gqDiff.includes('임금') && gqDiff.includes('근무시간') && (await specText()).includes('수습 중 임금')
      && (await text('#condition-list [data-item="06"] .badge-relation')) === '한쪽에만 기재' && (await text('#condition-list [data-item="07"] .badge-relation')) === '같은 조건');
    const gq02 = await text('#condition-list [data-item="02"]');
    check(`[${tag}] GQ 근무시간 카드: 두 자료의 시간 차이가 먼저, '내용이 모호함' 대신 세부 확인 안내`, gq02.includes('09:00~18:00') && gq02.includes('10:00~19:00') && gq02.includes('서로 다른 조건')
      && !gq02.includes('내용이 모호함') && gq02.includes('세부 확인 필요') && gq02.includes('출퇴근 시각·휴게시간은 적혀 있어요. 주 소정근로시간은 별도로 확인이 필요해요.')
      && gq02.indexOf('자료마다') < gq02.indexOf('주 소정근로시간은 별도로'), gq02.slice(0, 200));
    const allRow02 = await text('#all-condition-list [data-item="02"]');
    check(`[${tag}] GQ 전체 목록: 근로계약서 근무시간도 '세부 확인 필요'`, !allRow02.includes('내용이 모호함') && allRow02.includes('세부 확인 필요'));
    const moreItems = await page.$$eval('#more-list > li', (els) => els.map((e) => ({ text: e.innerText, q: e.querySelectorAll('.q-text').length })));
    const moreCount = Number((await text('#more-count')).replace(/\D/g, ''));
    check(`[${tag}] GQ 추가 질문 수 = 실제 질문이 있는 항목 수, 휴일(질문 없음) 제외`, moreCount === moreItems.length && moreItems.every((x) => x.q >= 1) && !moreItems.some((x) => x.text.includes('휴일')), JSON.stringify(moreItems.map((x) => x.text.split('\n')[0])));
    const dutyQ = await page.$$eval('#view-record .q-text', (els) => els.map((e) => e.value).find((v) => v.includes('업무 범위')) ?? '');
    check(`[${tag}] GQ 담당업무: 원문 조각으로 구체적인 질문 (같은 조건인지 묻지 않음)`, dutyQ === "채용공고에는 '브랜드 공식 SNS 채널 운영'이, 근로계약서에는 'SNS 콘텐츠 기획·제작 일정 관리'도 적혀 있습니다. 근로계약서에 적힌 업무 범위를 담당하는 것으로 이해하면 될까요?"
      && !(await text('#view-record')).includes('같은 조건인지 확인 부탁드립니다'), dutyQ);
    check(`[${tag}] GQ 휴일: 핵심 요약·전체 목록에서 계속 확인 가능`, (await text('#all-condition-list')).includes('휴일') && (await text('#all-condition-list [data-item="09"]')).includes('주휴일 매주 일요일'));
    check(`[${tag}] GQ 가로 넘침 없음`, await noOverflow());
    await page.screenshot({ path: `${OUT}/${tag}-gq-posting-contract.png`, fullPage: true });

    // 계약서 임금 분석 확인 불가 (QA 증상 재현: 기재값을 바꿔 쓴 AI 응답) → 원인 표시, 값·질문 없음
    wageFailure = true;
    await page.goto(`${BASE}/#/new`);
    await register('contract', QA_CONTRACT);
    wageFailure = false;
    const un = await groupText('unavailable');
    check(`[${tag}] 임금 분석 확인 불가: 원인 표시 (값을 바꿔 쓴 응답)`, un.includes('근로계약서 · 임금') && un.includes('AI가 정리한 값이 인용한 원문 안에 글자 그대로 있지 않았어요'), un.slice(0, 160));
    check(`[${tag}] 임금 분석 확인 불가: 검증되지 않은 값(3,600만원)·회사 질문 없음`, !(await text('#view-record')).includes('3,600만원') && !(await groupText('needs')).includes('급여'));
    await page.click('button[data-reanalyze]');
    await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('다시 분석한 결과'));
    check(`[${tag}] 같은 텍스트로 재분석 → 임금 확인됨`, !(await page.$('[data-group="unavailable"]')) && !(await page.isVisible('#now-section')) && (await text('#contract-checklist-items > li:first-child')).includes('기재됨'), await text('#contract-checklist-items > li:first-child'));
    // 시연 문서(주식회사 파란스텝): 협의 예정 → 범위 안에서 구체화 → 계약서에서 수습 급여 구체화
    if (tag === 'desk') {
      await page.goto(`${BASE}/#/new`);
      await register('job_posting', DEMO_POSTING);
      check('[demo] 공고 하나: 기록 이름 = 주식회사 파란스텝', (await text('#record-title')) === '주식회사 파란스텝');
      // 문서 하나(채용공고): 미리보기에 협의·추후 안내 예정 상태만 표시, 질문 없음
      check('[demo] 공고 하나: 연봉 범위·수습 임금은 협의·추후 안내 예정 상태 (질문 없음)', (await text('#condition-list [data-item="01"]')).includes('3,400만~3,800만') && (await text('#condition-list [data-item="01"]')).includes('협의 예정') && (await text('#condition-list [data-item="08"]')).includes('추후 안내 예정') && !(await page.$('#view-record .q-text')));
      check('[demo] 공고 카드: 수습 중 급여 배지 = 추후 안내 예정', (await text('#condition-list [data-item="08"]')).includes('추후 안내 예정'));
      await page.click('#add-doc:visible, #add-second:visible');
      await register('offer', DEMO_OFFER);
      await page.click('#add-doc:visible, #add-second:visible');
      await register('contract', DEMO_CONTRACT);
      await page.selectOption('#compare-doc-b', { index: 2 }); await page.waitForTimeout(200); // 채용공고 ↔ 근로계약서
      const spec = await specText();
      check('[demo] 급여: 범위 안에서 구체화 (서로 다른 안내 아님)', spec.includes('채용공고에는 협의 가능한 연봉 범위(3,400만~3,800만원)가 적혀 있고') && /3,600만 원(\(세전\))?으로 기재되어 있어요\./.test(spec) && (await text('#cmp-item-01 .badge-relation')) === '추가 대조 필요' && !(await groupText('different')).includes('급여'), spec.slice(0, 300));
      check('[demo] 수습 중 급여: 근로계약서에서 처음 구체화, 질문 없음', spec.includes('근로계약서에는 월 270만 원(세전, 정규 급여의 90%)으로 적혀 있어요') && !(await page.$('#cmp-item-08 .q-text')));
      check('[demo] 서로 다른 안내는 근무시간 하나', (await page.$$('[data-group="different"] .cmp-card')).length === 1 && (await groupText('different')).includes('근무시간'));
      check('[demo] 협의 완료·확정 단정 표현 없음', !/(협의 완료|확정된 합의|협의가 끝났)/.test(await text('#view-record')));
      await page.screenshot({ path: `${OUT}/demo-s04-three-docs.png`, fullPage: true });
    }
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} catch (err) {
  check('예외 없이 완료', false, err.stack);
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\nQA 시나리오 확인: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
