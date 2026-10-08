// 업로드 테스트용 가상 문서 파일을 만든다 (실제 개인정보 없음). 결과는 test/fixtures/upload/에 커밋한다.
//   node scripts/make-upload-fixtures.mjs        (Chromium·한글 글꼴 필요, 암호화 PDF는 python3 + pypdf 필요)
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = 'test/fixtures/upload';
await mkdir(OUT, { recursive: true });

// 각 파일에 담길 가상 문서 (OCR 정확도 비교용 정답)
const TRUTH = {
  contract: `표준 근로계약서 (가상 예시)
1. 근로계약기간: 2026년 11월 1일부터 2027년 10월 31일까지
2. 근무장소: 서울특별시 마포구 양화로 00, 5층
3. 업무내용: 온라인 고객 문의 응대 및 상담 기록 관리
4. 고용형태: 기간제(계약직)
5. 소정근로시간: 09:00 ~ 18:00 (휴게시간 12:00 ~ 13:00), 주 5일
6. 임금: 월 2,600,000원 (기본급 2,400,000원, 식대 200,000원)
7. 수습기간: 입사일로부터 3개월
8. 수습기간 중 임금: 월 급여의 90% 지급`,
  posting: `[채용] 물류센터 사무보조 모집 (가상 예시)
고용형태: 정규직
근무시간: 09:00~18:00, 주 5일
근무지: 경기도 이천시 마장면
담당업무: 입출고 서류 정리, 재고 데이터 입력
급여: 월 230만원
수습: 3개월 (수습 기간 급여는 내규에 따름)`,
  scanned: `근로계약서 사본 (가상 예시)
근무장소: 부산광역시 해운대구 센텀중앙로 00
업무의 내용: 매장 판매 및 재고 관리
근로시간: 10시부터 19시까지 (휴게 1시간)
임금: 시간급 10,500원
고용형태: 정규직
수습기간: 없음`,
};

// 여러 장 캡처용 채용공고 (가상 예시)
const TRUTH_MULTI_ROWS = {
  title: '[채용] 고객센터 상담원 모집',
  company: 'OO서비스 (가상 예시)',
  table: [
    ['고용형태', '정규직'],
    ['근무지', '대전광역시 서구 둔산로 00'],
    ['근무시간', '09:00~18:00, 주 5일'],
    ['급여', '월 240만원'],
  ],
  sections: [
    ['담당업무', ['고객 문의 전화 응대', '상담 내역 기록 및 관리']],
    ['수습기간', ['3개월 (수습 기간 급여 월 216만원)']],
    ['지원 방법', ['이메일 접수 (가상 예시)']],
  ],
};
TRUTH.multi = [
  TRUTH_MULTI_ROWS.title, TRUTH_MULTI_ROWS.company,
  ...TRUTH_MULTI_ROWS.table.map(([k, v]) => `${k} ${v}`),
  ...TRUTH_MULTI_ROWS.sections.flatMap(([h, lines]) => [h, ...lines]),
].join('\n');

const page = (text, { size = 22 } = {}) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  body { margin: 48px; font-family: 'WenQuanYi Zen Hei', 'Noto Sans CJK KR', sans-serif; font-size: ${size}px; line-height: 1.7; color: #111; background: #fff; }
  p { margin: 0 0 6px; white-space: pre-wrap; }
</style></head><body>${text.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')}</body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 700 } });
const p = await ctx.newPage();

// 1) 일반 PDF (텍스트 레이어 있음)
await p.setContent(page(TRUTH.contract, { size: 14 }));
await p.pdf({ path: `${OUT}/contract-text.pdf`, format: 'A4' });

// 2) 한국어 이미지 (PNG, WebP)
await p.setContent(page(TRUTH.posting));
const png = await p.screenshot({ fullPage: true });
await writeFile(`${OUT}/posting-ko.png`, png);
const webpDataUrl = await p.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.92);
}, png.toString('base64'));
await writeFile(`${OUT}/posting-ko.webp`, Buffer.from(webpDataUrl.split(',')[1], 'base64'));

// 2-1) 휴대폰 사진에 가까운 어려운 조건: 저해상도, 약한 흐림, 회색 배경, 1.5도 기울어짐, JPEG 압축
const lowCtx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 900, height: 700 } });
const lp = await lowCtx.newPage();
await lp.setContent(page(TRUTH.posting, { size: 20 }).replace('background: #fff;', 'background: #d9d6cf;')
  .replace('<body>', '<body><div style="transform: rotate(1.5deg); filter: blur(0.5px); padding: 8px">').replace('</body>', '</div></body>'));
await writeFile(`${OUT}/posting-ko-photo.jpg`, await lp.screenshot({ type: 'jpeg', quality: 60, fullPage: true }));
await lowCtx.close();

// 3) 스캔 PDF (글자가 이미지로만 들어 있고 텍스트 레이어 없음)
await p.setContent(page(TRUTH.scanned));
const scanPng = await p.screenshot({ fullPage: true });
await p.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/png;base64,${scanPng.toString('base64')}" style="width:100%"></body></html>`);
await p.pdf({ path: `${OUT}/scanned.pdf`, format: 'A4', printBackground: true });

// 4) 쪽수 초과 PDF (12쪽)
await p.setContent(`<!doctype html><html><body>${Array.from({ length: 12 }, (_, i) => `<p style="page-break-after:always">가상 문서 ${i + 1}쪽</p>`).join('')}</body></html>`);
await p.pdf({ path: `${OUT}/too-many-pages.pdf`, format: 'A4' });

// 5) 여러 장 연속 캡처: 모바일 채용공고 화면(머리글·표·본문)을 블록 경계에서 3장으로 나눠 캡처
const rows = TRUTH_MULTI_ROWS;
const mobile = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 420, height: 800 } });
const mp = await mobile.newPage();
await mp.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: 'WenQuanYi Zen Hei', 'Noto Sans CJK KR', sans-serif; color: #1b1f24; background: #fff; font-size: 16px; }
  .top { background: #2f5d8a; color: #fff; padding: 18px 16px; } .top h1 { font-size: 19px; margin: 0 0 4px; } .top p { margin: 0; font-size: 14px; }
  table { width: calc(100% - 32px); margin: 12px 16px; border-collapse: collapse; }
  th, td { border-top: 1px solid #d6dbe0; padding: 10px 6px; text-align: left; vertical-align: top; }
  th { width: 88px; color: #4b5563; font-weight: 600; }
  section { padding: 6px 16px 12px; } h2 { font-size: 17px; margin: 8px 0; } p { margin: 0 0 6px; line-height: 1.6; }
</style></head><body>
<div class="top cut"><h1>${rows.title}</h1><p>${rows.company}</p></div>
<table class="cut">${rows.table.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
${rows.sections.map(([h, lines]) => `<section class="cut"><h2>${h}</h2>${lines.map((l) => `<p>${l}</p>`).join('')}</section>`).join('')}
</body></html>`);
// 캡처 경계: 블록 요소의 아래쪽 경계에서만 자른다 (글자가 잘리지 않게, 겹치지 않게)
const bottoms = await mp.$$eval('.cut', (els) => els.map((e) => Math.ceil(e.getBoundingClientRect().bottom)));
const cuts = [0, bottoms[1], bottoms[2], bottoms[bottoms.length - 1]];
for (let k = 0; k < 3; k += 1) {
  await writeFile(`${OUT}/multi-${k + 1}.png`, await mp.screenshot({ clip: { x: 0, y: cuts[k], width: 420, height: cuts[k + 1] - cuts[k] }, fullPage: true }));
}
// 글자가 없는 이미지 (일부 실패 확인용)
await mp.setContent('<!doctype html><html><body style="margin:0;background:#f4f4f4"><div style="width:420px;height:300px"></div></body></html>');
await writeFile(`${OUT}/blank.png`, await mp.screenshot({ clip: { x: 0, y: 0, width: 420, height: 300 } }));
await mobile.close();

await browser.close();

// 6) 손상된 이미지 (PNG 시그니처만 맞고 내용은 깨짐)
await writeFile(`${OUT}/corrupt.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('broken image data (가상)')]));

// 7) 암호화 PDF
execFileSync('python3', ['-c', `
from pypdf import PdfReader, PdfWriter
w = PdfWriter(clone_from=PdfReader("${OUT}/contract-text.pdf"))
w.encrypt(user_password="test-only-password", algorithm="AES-256")
w.write("${OUT}/encrypted.pdf")
`]);

// 8) 확장자만 PDF인 텍스트 파일, 손상된 PDF
await writeFile(`${OUT}/not-really.pdf`, '이 파일은 PDF가 아닙니다 (가상 예시).\n');
await writeFile(`${OUT}/broken.pdf`, '%PDF-1.7\n이 파일은 손상된 PDF입니다.\n');

await writeFile(`${OUT}/truth.json`, `${JSON.stringify(TRUTH, null, 2)}\n`);
console.log('업로드 테스트 파일을 만들었어요:', OUT);
