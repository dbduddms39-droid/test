// OCR 처리 정책(추출 실패·빈 쪽) 확인용 가상 PDF를 만든다 (실제 개인정보 없음). 결과는 test/fixtures/upload/에 커밋한다.
//   node scripts/make-ocr-failure-fixtures.mjs   (Chromium·한글 글꼴, python3 + pypdf 필요)
// 기존 업로드 테스트 파일은 다시 만들지 않는다.
//   three-page-ocr-failed.pdf : 1쪽 텍스트, 2쪽 글자가 있지만 심하게 흐려 OCR이 글자를 얻지 못하는 스캔 쪽, 3쪽 텍스트
//   three-page-blank.pdf      : 1쪽 텍스트, 2쪽 실제 빈 쪽(글자·이미지 없음), 3쪽 텍스트
//   all-blank.pdf             : 빈 쪽 1장
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = 'test/fixtures/upload';
const TMP = await mkdtemp(path.join(tmpdir(), 'ocr-fail-'));
const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Noto Sans KR',sans-serif;font-size:18px;line-height:1.7;margin:48px}</style></head><body>${body}</body></html>`;

const PAGE1 = ['근로계약서 1쪽 (가상 예시)', '근무장소: 대전광역시 서구 둔산로 00', '업무내용: 매장 판매 및 재고 관리', '임금: 월 2,500,000원'];
const PAGE2 = ['근로계약서 2쪽 (가상 예시)', '근로시간: 09:00 ~ 18:00 (휴게 1시간)', '휴일: 매주 일요일'];
const PAGE3 = ['근로계약서 3쪽 (가상 예시)', '연차 유급휴가: 근로기준법에 따름', '계약기간: 2026년 11월 1일부터 2027년 10월 31일까지'];

const browser = await chromium.launch();
const p = await browser.newPage();
const textPdf = async (lines, file) => {
  await p.setContent(html(lines.map((l) => `<p>${l}</p>`).join('')));
  await p.pdf({ path: file, format: 'A4' });
};
await textPdf(PAGE1, `${TMP}/p1.pdf`);
await textPdf(PAGE3, `${TMP}/p3.pdf`);
// 2쪽: 글자를 그린 뒤 심하게 흐린 이미지로만 넣는다 (텍스트 레이어 없음, 사람 눈에는 글자 줄이 보임)
await p.setViewportSize({ width: 900, height: 500 });
await p.setContent(html(`<div style="filter: blur(9px); color: #8a8a8a">${PAGE2.map((l) => `<p>${l}</p>`).join('')}</div>`));
const blurred = await p.screenshot();
await p.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/png;base64,${blurred.toString('base64')}" style="width:100%"></body></html>`);
await p.pdf({ path: `${TMP}/p2.pdf`, format: 'A4', printBackground: true });
await browser.close();

execFileSync('python3', ['-c', `
from pypdf import PdfReader, PdfWriter
tmp, out = ${JSON.stringify(TMP)}, ${JSON.stringify(OUT)}
pages = [PdfReader(f"{tmp}/p{i}.pdf").pages[0] for i in (1, 2, 3)]
w = PdfWriter()
for pg in pages: w.add_page(pg)
w.write(f"{out}/three-page-ocr-failed.pdf")
size = dict(width=pages[0].mediabox.width, height=pages[0].mediabox.height)
w = PdfWriter()
w.add_page(pages[0]); w.add_blank_page(**size); w.add_page(pages[2])
w.write(f"{out}/three-page-blank.pdf")
w = PdfWriter()
w.add_blank_page(**size)
w.write(f"{out}/all-blank.pdf")
`]);
await rm(TMP, { recursive: true, force: true });
console.log('OCR 실패·빈 쪽 테스트 파일을 만들었어요:', OUT);
