// OCR 정확도 비교용 가상 채용공고 이미지를 만든다 (실제 개인정보·실제 회사 없음). 결과는 test/fixtures/ocr-bench/에 커밋한다.
//   OCR_FONT_DIR=<Pretendard woff2 폴더> node scripts/make-ocr-bench-fixtures.mjs
// 실제 사용 환경과 비슷하게 만든다:
//   - app-*: 채용 앱 화면을 휴대폰에서 2장으로 나눠 캡처 (회색 항목명 + 값 2열 표, 칩, 색 배너·버튼의 흰 글자)
//     app-hi: 원본 캡처(1080px), app-msg: 메신저 전송으로 줄어든 JPEG(720px), app-low: 저해상도 JPEG(360px)
//   - web-*: PC 채용 사이트 캡처 (항목명·값이 2쌍씩 있는 4칸 표, 일부만 어두운 배너)
// Pretendard(SIL OFL)는 국내 앱에서 흔히 쓰는 글꼴이다. 없으면 설치된 한글 글꼴로 만든다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = 'test/fixtures/ocr-bench';
await mkdir(OUT, { recursive: true });

const FONT_DIR = process.env.OCR_FONT_DIR;
let fontFace = '';
if (FONT_DIR) {
  const face = async (file, weight) => `@font-face { font-family: 'Pretendard'; font-weight: ${weight}; src: url(data:font/woff2;base64,${(await readFile(path.join(FONT_DIR, file))).toString('base64')}) format('woff2'); }`;
  fontFace = [await face('Pretendard-Regular.woff2', 400), await face('Pretendard-SemiBold.woff2', 600), await face('Pretendard-Bold.woff2', 700)].join('\n');
} else {
  console.warn('OCR_FONT_DIR가 없어 설치된 한글 글꼴로 만듭니다.');
}
const FONT = "'Pretendard', 'WenQuanYi Zen Hei', sans-serif";

// ---------- 채용 앱 화면 (2장) ----------
const APP = {
  top: {
    banner: '신입·경력 수시채용',
    company: '오늘물류 (가상 예시)',
    title: '물류센터 운영관리 사무직 채용',
    chips: ['정규직', '경력 무관', '서울 송파구'],
    heading: '근무조건',
    rows: [
      ['급여', '연봉 3,200만원 ~ 4,000만원'],
      ['근무시간', '주 5일(월~금) 09:30 ~ 18:30'],
      ['근무지', '서울 송파구 법원로 00 (가상)'],
      ['계약기간', '2027.01.04 ~ 2027.12.31'],
      ['수습기간', '3개월 (급여 90% 지급)'],
    ],
  },
  bottom: {
    sections: [
      ['담당업무', ['· 입출고 일정 관리 및 거래처 연락', '· 재고 현황 엑셀 정리 (주 1회 보고)']],
      ['우대사항', ['· 물류관리사 자격증 소지자']],
    ],
    note: '※ 연장근무 시 수당 별도 지급',
    period: ['접수기간', '2026.11.01 ~ 2026.11.30'],
    button: '지원하기',
  },
};
const appTruth = {
  top: [APP.top.banner, APP.top.company, APP.top.title, APP.top.chips.join(' '), APP.top.heading, ...APP.top.rows.map((r) => r.join(' '))],
  bottom: [...APP.bottom.sections.flatMap(([h, ls]) => [h, ...ls]), APP.bottom.note, APP.bottom.period.join(' '), APP.bottom.button],
};
const appHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${fontFace}
  * { box-sizing: border-box; } body { margin: 0; width: 360px; font-family: ${FONT}; color: #191f28; background: #fff; }
  .banner { background: linear-gradient(90deg, #ff7a45, #ff9a3c); color: #fff; font-weight: 700; font-size: 15px; padding: 12px 20px; }
  .head { padding: 16px 20px 8px; } .company { color: #6b7684; font-size: 14px; margin: 0 0 4px; } h1 { font-size: 20px; margin: 0 0 12px; font-weight: 700; }
  .chips span { display: inline-block; background: #f2f4f6; color: #4e5968; font-size: 13px; border-radius: 6px; padding: 4px 8px; margin-right: 4px; }
  .card { margin: 8px 20px 16px; } h2 { font-size: 17px; margin: 16px 0 8px; font-weight: 700; }
  .row { display: flex; padding: 7px 0; } .row .k { width: 76px; flex: none; color: #8b95a1; font-size: 14px; } .row .v { font-size: 15px; }
  .sec { padding: 0 20px; } .sec p { margin: 0 0 6px; font-size: 15px; line-height: 1.5; }
  .note { color: #8b95a1; font-size: 12px; margin: 10px 0; } .period { font-size: 14px; margin: 8px 0 16px; } .period b { color: #6b7684; font-weight: 400; margin-right: 8px; }
  .btn { margin: 8px 20px 20px; background: #3182f6; color: #fff; font-weight: 700; font-size: 16px; text-align: center; border-radius: 12px; padding: 14px; }
</style></head><body>
<div class="part" id="top">
  <div class="banner">${APP.top.banner}</div>
  <div class="head"><p class="company">${APP.top.company}</p><h1>${APP.top.title}</h1>
    <div class="chips">${APP.top.chips.map((c) => `<span>${c}</span>`).join('')}</div></div>
  <div class="card"><h2>${APP.top.heading}</h2>${APP.top.rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
</div>
<div class="part" id="bottom">
  <div class="sec">${APP.bottom.sections.map(([h, ls]) => `<h2>${h}</h2>${ls.map((l) => `<p>${l}</p>`).join('')}`).join('')}
    <p class="note">${APP.bottom.note}</p><p class="period"><b>${APP.bottom.period[0]}</b>${APP.bottom.period[1]}</p></div>
  <div class="btn">${APP.bottom.button}</div>
</div></body></html>`;

// ---------- PC 채용 사이트 화면 (2장) ----------
const WEB = {
  banner: ['하나테크 2027 상반기 채용 (가상)', '마감 D-12'],
  table: [
    [['경력', '신입'], ['학력', '대졸 이상']],
    [['고용형태', '계약직 (6개월)'], ['급여', '월 260만원']],
    [['근무요일', '주 5일'], ['근무시간', '10:00 ~ 19:00']],
    [['근무지역', '경기 성남시 분당구']],
  ],
  detail: [
    '상세요강',
    '계약기간: 2027년 3월 2일 ~ 2027년 8월 31일',
    '수습기간: 없음',
    '급여는 매월 25일에 지급합니다.',
    '담당업무: 사내 시스템 운영 지원, 장애 접수',
    '문의: 인사팀 02-000-0000 (가상)',
  ],
};
const webTruth = {
  top: [WEB.banner.join(' '), ...WEB.table.map((pairs) => pairs.flat().join(' '))],
  bottom: WEB.detail,
};
const webHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${fontFace}
  * { box-sizing: border-box; } body { margin: 0; width: 900px; font-family: ${FONT}; color: #222; background: #fff; font-size: 15px; }
  .banner { display: flex; height: 64px; } .banner .l { width: 55%; background: #1e2a3a; color: #fff; font-size: 20px; font-weight: 700; padding: 18px 24px; }
  .banner .r { flex: 1; background: #fff; color: #e5484d; font-weight: 700; font-size: 18px; padding: 20px 24px; text-align: right; }
  table { margin: 20px 24px; border-collapse: collapse; width: 852px; } th, td { border: 1px solid #e1e4e8; padding: 10px 12px; text-align: left; }
  th { background: #f7f8fa; color: #6a7380; font-weight: 400; width: 110px; } td { width: 316px; }
  .detail { padding: 8px 24px 24px; } .detail h3 { font-size: 18px; margin: 0 0 10px; } .detail p { margin: 0 0 8px; line-height: 1.6; }
</style></head><body>
<div class="part" id="top">
  <div class="banner"><div class="l">${WEB.banner[0]}</div><div class="r">${WEB.banner[1]}</div></div>
  <table>${WEB.table.map((pairs) => `<tr>${pairs.map(([k, v], i) => `<th>${k}</th><td${pairs.length === 1 ? ' colspan="3"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</table>
</div>
<div class="part" id="bottom"><div class="detail"><h3>${WEB.detail[0]}</h3>${WEB.detail.slice(1).map((l) => `<p>${l}</p>`).join('')}</div></div>
</body></html>`;

// ---------- 검증용(조정에 쓰지 않은) 화면: 다크 모드 앱, 회색 바탕 카드형 화면 ----------
const appDarkHtml = appHtml
  .replace('color: #191f28; background: #fff;', 'color: #e5e8eb; background: #17171c;')
  .replace('.company { color: #6b7684;', '.company { color: #9ea7b3;')
  .replace('background: #f2f4f6; color: #4e5968;', 'background: #2c2c35; color: #c3c9d0;')
  .replace('.row .k { width: 76px; flex: none; color: #8b95a1;', '.row .k { width: 76px; flex: none; color: #8b95a1;');
const CARD = {
  top: [
    ['카페 매니저 (가상 예시)', 'h'],
    ['카페온 성수점 · 아르바이트', 'sub'],
    [['시급', '12,500원'], 'kv'],
    [['근무요일', '월, 수, 금'], 'kv'],
    [['근무시간', '14:00 ~ 22:00 (휴게 30분)'], 'kv'],
    [['근무기간', '3개월 ~ 6개월'], 'kv'],
  ],
  bottom: [
    ['상세 내용', 'h'],
    ['음료 제조 및 매장 관리', 'p'],
    ['주휴수당 별도 지급, 4대보험 가입', 'p'],
    ['급여일: 매월 10일', 'p'],
    ['모집 마감: 2026년 12월 15일', 'p'],
  ],
};
const cardTruth = Object.fromEntries(Object.entries(CARD).map(([k, rows]) => [k, rows.map(([v]) => (Array.isArray(v) ? v.join(' ') : v))]));
const cardPairs = Object.fromEntries(Object.entries(CARD).map(([k, rows]) => [k, rows.filter(([, t]) => t === 'kv').map(([v]) => v)]));
const cardHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; } body { margin: 0; width: 375px; font-family: 'WenQuanYi Zen Hei', sans-serif; color: #222; background: #eef0f3; padding: 12px 0; }
  .card { background: #fff; border-radius: 14px; margin: 0 12px 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .h { font-size: 18px; font-weight: 700; margin: 0 0 6px; } .sub { font-size: 13px; color: #7a828c; margin: 0 0 12px; }
  .kv { display: flex; justify-content: space-between; font-size: 15px; padding: 9px 0; border-top: 1px solid #f0f1f3; } .kv span:first-child { color: #7a828c; }
  .p { font-size: 15px; margin: 0 0 8px; line-height: 1.5; }
</style></head><body>${Object.entries(CARD).map(([k, rows]) => `<div class="part" id="${k}"><div class="card">${rows.map(([v, t]) => (t === 'kv' ? `<div class="kv"><span>${v[0]}</span><span>${v[1]}</span></div>` : `<p class="${t}">${v}</p>`)).join('')}</div></div>`).join('')}</body></html>`;

const browser = await chromium.launch();
async function capture(html, width, scale, { type = 'png', quality, resizeTo } = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: scale, viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const shots = [];
  for (const id of ['top', 'bottom']) {
    const box = await p.$eval(`#${id}`, (e) => { const r = e.getBoundingClientRect(); return { x: 0, y: Math.floor(r.top), width: document.body.clientWidth, height: Math.ceil(r.height) }; });
    let buf = await p.screenshot({ clip: box, fullPage: true });
    if (resizeTo || type === 'jpeg') {
      // 메신저 전송·저화질 저장처럼 크기를 줄이고 JPEG로 다시 저장
      const url = await p.evaluate(async ({ b64, resizeTo: w, q }) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const s = w ? w / img.width : 1;
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', q);
      }, { b64: buf.toString('base64'), resizeTo, q: quality });
      buf = Buffer.from(url.split(',')[1], 'base64');
    }
    shots.push(buf);
  }
  await ctx.close();
  return shots;
}

const sets = [];
async function addSet(name, title, html, truth, pairs, width, scale, opts = {}) {
  const shots = await capture(html, width, scale, opts);
  const ext = opts.type === 'jpeg' ? 'jpg' : 'png';
  const images = [];
  for (const [k, part] of ['top', 'bottom'].entries()) {
    const file = `${name}-${k + 1}.${ext}`;
    await writeFile(path.join(OUT, file), shots[k]);
    images.push({ file, lines: truth[part], pairs: pairs[part] });
  }
  sets.push({ name, title, images });
}

const appPairs = { top: APP.top.rows, bottom: [APP.bottom.period] };
const webPairs = { top: WEB.table.flat(), bottom: [] };
await addSet('app-hi', '채용 앱 원본 캡처 (1080px, PNG)', appHtml, appTruth, appPairs, 360, 3);
await addSet('app-msg', '메신저로 받은 캡처 (720px, JPEG 60%)', appHtml, appTruth, appPairs, 360, 3, { type: 'jpeg', quality: 0.6, resizeTo: 720 });
await addSet('app-low', '저해상도 캡처 (360px, JPEG 75%)', appHtml, appTruth, appPairs, 360, 1, { type: 'jpeg', quality: 0.75 });
await addSet('web-table', 'PC 채용 사이트 캡처 (4칸 표, 부분 어두운 배너)', webHtml, webTruth, webPairs, 900, 1);
await addSet('check-dark', '[검증용] 다크 모드 앱 캡처 (720px)', appDarkHtml, appTruth, appPairs, 360, 2);
// 일부만 읽히는 경우: 아래쪽 절반이 심하게 흐린 캡처 (일부 인식 실패를 '확인 필요'로 알리는지 확인)
const blurHtml = appHtml.replace('</style>', '#bottom .sec h2:nth-of-type(2), #bottom .sec h2:nth-of-type(2) ~ *, #bottom .btn { filter: blur(3.5px); }</style>');
await addSet('check-blur', '[검증용] 아래쪽 절반이 흐린 캡처 (일부만 인식)', blurHtml, appTruth, appPairs, 360, 2);
await addSet('check-card', '[검증용] 회색 바탕 카드형 화면 (다른 글꼴, 1125px)', cardHtml, cardTruth, cardPairs, 375, 3);
await browser.close();

// 기존 업로드 테스트의 3장 캡처도 같은 기준으로 비교한다 (회귀 확인)
const old = JSON.parse(await readFile('test/fixtures/upload/truth.json', 'utf8')).multi.split('\n');
sets.push({
  name: 'multi-existing', title: '기존 3장 연속 캡처 (회귀 확인)',
  images: [
    { file: '../upload/multi-1.png', lines: old.slice(0, 6), pairs: [['고용형태', '정규직'], ['근무지', '대전광역시 서구 둔산로 00'], ['근무시간', '09:00~18:00, 주 5일'], ['급여', '월 240만원']] },
    { file: '../upload/multi-2.png', lines: old.slice(6, 9), pairs: [] },
    { file: '../upload/multi-3.png', lines: old.slice(9), pairs: [] },
  ],
});

await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify({ font: FONT_DIR ? 'Pretendard' : 'system', sets }, null, 2)}\n`);
console.log(`OCR 비교용 이미지 ${sets.reduce((n, s) => n + s.images.length, 0)}장 (${sets.length}세트):`, OUT);
