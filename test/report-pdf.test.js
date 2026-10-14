import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildReportPdf, reportPdfName } from '../public/report-pdf.js';

const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fonts = {
  regular: readFileSync(new URL('../public/vendor/fonts/pretendard-pdf/Pretendard-Regular-KR.ttf', import.meta.url)),
  bold: readFileSync(new URL('../public/vendor/fonts/pretendard-pdf/Pretendard-Bold-UI.ttf', import.meta.url)),
};

// 가상 문서 정리본 (실제 회사·개인 정보 아님)
const row = (i, extra = {}) => ({ label: i === 1 ? '임금' : `근무시간 ${i}`, badge: '서로 다른 조건',
  a: { state: 'present', value: '연봉 36,000,000원(세전) · 월 지급 기준액 3,000,000원(세전)', calc: i === 2 ? '주 40시간' : null },
  b: { state: 'missing', value: '원문에 언급 없음' }, line: '자료마다 임금 금액이 다르게 안내되었어요.', detail: null,
  evidence: { a: [{ line: 10, text: '연봉 36,000,000원(세전)', facets: ['임금 금액'] }], b: [] }, questionNo: i === 1 ? 1 : null, ...extra });
const model = (n = 2) => ({
  title: '비교 결과 정리본', recordName: '이름 없는 기록', createdAt: '2026.10.14 10:00',
  docs: [{ side: 'A', type: '근로계약서', name: '[가상] 근로계약서', registered: '2026.10.14 09:00' }, { side: 'B', type: '채용공고', name: '[가상] 뷁 채용', registered: '2026.10.14 09:05' }],
  summary: [{ key: 'different', label: '서로 다른 조건', count: n, items: ['임금'] }], skipped: 0,
  groups: [{ key: 'different', label: '서로 다른 조건', rows: Array.from({ length: n }, (_, i) => row(i + 1)) },
    { key: 'unavailable', label: '분석 확인 불가', rows: [row(99, { label: '휴일', badge: '분석 확인 불가', a: { state: 'unavailable', value: '분석 확인 불가', cause: '근거를 원문에서 확인하지 못했어요' }, evidence: { a: [], b: [] }, questionNo: null })] }],
  questions: [{ no: 1, label: '임금', text: '실제 적용되는 연봉(36,000,000원)을 확인 부탁드립니다. (가상 수정)', edited: true }],
});

async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push({ text: tc.items.map((x) => x.str).join(''), view: p.view });
  }
  return pages;
}

test('정리본 PDF: A4, 한글·숫자·금액 텍스트가 그대로(선택·복사 가능), 수정한 질문 반영', async () => {
  const bytes = await buildReportPdf({ PDFLib, fontkit, fonts, model: model() });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const pages = await pdfText(bytes);
  const all = pages.map((p) => p.text).join('');
  for (const s of ['비교 결과 정리본', '비교한 문서', '문서 A · 근로계약서', '[가상] 뷁 채용', '전체 비교 요약', '서로 다른 조건', '36,000,000원(세전)', '주 40시간 (계산값)',
    '원문에 언급 없음 (없어지거나 바뀐 것으로 보지 않음)', '분석 확인 불가', '원문 근거', '회사에 확인할 질문', '직접 고친 질문', '(가상 수정)', '법률 위반 여부']) {
    assert.ok(all.replace(/\s/g, '').includes(s.replace(/\s/g, '')), s);
  }
  assert.deepEqual(pages[0].view.map(Math.round), [0, 0, 595, 842]);
});

test('정리본 PDF: 길면 여러 쪽, 쪽 번호, 빈 쪽 없음', async () => {
  const bytes = await buildReportPdf({ PDFLib, fontkit, fonts, model: model(14) });
  const pages = await pdfText(bytes);
  assert.ok(pages.length >= 3);
  pages.forEach((p, i) => {
    assert.ok(p.text.includes(`${i + 1} / ${pages.length}`), `쪽 번호 ${i + 1}`);
    assert.ok(p.text.replace(/일단확인 · 비교 결과 정리본|\d+ \/ \d+/g, '').trim().length > 20, `빈 쪽 아님 ${i + 1}`);
  });
});

test('PDF 파일 이름: 일단확인_비교결과_YYYYMMDD.pdf', () => {
  assert.equal(reportPdfName(new Date(2026, 9, 14)), '일단확인_비교결과_20261014.pdf');
});
