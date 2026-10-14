// 비교 결과 정리본 → PDF (브라우저에서 바로 생성, 서버·외부 서비스로 보내지 않음).
// pdf-lib로 글자를 직접 그려 텍스트를 선택·복사할 수 있는 PDF를 만든다 (화면 캡처 이미지 아님).
// 한글은 Pretendard(SIL OFL) TTF를 쓰인 글자만 골라(subset) 넣는다. 내용은 정리본 모델(compare-report.js)과 같다.
//
// buildReportPdf({ PDFLib, fontkit, fonts: { regular, bold }, model }) → Uint8Array
// - A4 세로, 조건 카드·표 행은 페이지 경계에서 나누지 않고 다음 쪽으로 넘긴다 (한 쪽보다 긴 카드만 나눔)
// - 쪽 아래에 '일단확인 · 비교 결과 정리본 · n / 전체'
import { sideText, REPORT_NOTICES } from './compare-report.js';

const A4 = [595.28, 841.89];
const M = { l: 46, r: 46, t: 50, b: 58 };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const C = {
  ink: '#1C1F24', ink2: '#4A5059', ink3: '#6B717A', rule: '#E3E5E8', ruleSoft: '#ECEEF0', wash: '#F6F6F3',
  brand: '#FEDF7F', brandSoft: '#FFF6D8', brandInk: '#6B4E00', green: '#155E3D', greenSoft: '#EAF3EE',
};
const TONE = {
  different: ['#6B4E00', '#FFF6D8', '#F3CF5E'],
  review: ['#6D28D9', '#F5F3FF', '#C4B5FD'],
  onesided: ['#475569', '#F1F5F9', '#94A3B8'],
  unavailable: ['#64748B', '#F8FAFC', '#CBD5E1'],
  same: ['#15803D', '#F0FDF4', '#86EFAC'],
};

// 날짜 → 파일 이름 (일단확인_비교결과_20261014.pdf)
export function reportPdfName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `일단확인_비교결과_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.pdf`;
}

export async function buildReportPdf({ PDFLib, fontkit, fonts, model }) {
  const { PDFDocument, rgb } = PDFLib;
  const col = (h) => rgb(...hex(h));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${model.title} — ${model.recordName}`);
  doc.setAuthor('일단확인');
  doc.setCreator('일단확인 (브라우저에서 생성)');
  doc.setProducer('일단확인');
  doc.setLanguage('ko-KR');
  // 글꼴은 통째로 넣는다: pdf-lib의 부분 추출(subset)은 이 한글 글꼴에서 글자가 빠져 보이는 문제가 있다.
  // 대신 미리 줄인 글꼴을 쓴다 (scripts/build-pdf-fonts.py: Regular = 한글 음절 전체+라틴·기호, Bold = 앱 고정 문구 글자만).
  const R = await doc.embedFont(fonts.regular, { subset: false });
  const Bfull = await doc.embedFont(fonts.bold, { subset: false });
  // 글꼴에 없는 글자는 그리지 못하므로 가까운 글자로 (원문 인용에는 거의 없음)
  const charset = new Set(R.getCharacterSet());
  const boldSet = new Set(Bfull.getCharacterSet());
  // 굵은 글꼴에 없는 글자가 있는 문구(문서에서 온 값 등)는 Regular로 그린다
  const pick = (font, str) => (font === Bfull && [...String(str)].some((ch) => !/\s/.test(ch) && !boldSet.has(ch.codePointAt(0))) ? R : font);
  const B = Bfull;
  const SUB = { '↔': '⇄', '→': '→', '“': '"', '”': '"', '‘': "'", '’': "'", '∼': '~', '～': '~' };
  const clean = (t) => [...String(t ?? '')].map((ch) => (charset.has(ch.codePointAt(0)) || /\s/.test(ch) ? ch : charset.has((SUB[ch] ?? '?').codePointAt(0)) ? SUB[ch] ?? '?' : '?')).join('');

  const [W, H] = A4;
  const CW = W - M.l - M.r;
  let page;
  let y;
  const newPage = () => { page = doc.addPage(A4); y = H - M.t; };
  newPage();
  const room = () => y - M.b;
  const FULL = H - M.t - M.b;

  // 줄 나누기: 띄어쓰기 단위로, 한 단어가 너무 길면 글자 단위로
  function wrap(text, font, size, width) {
    const out = [];
    for (const para of clean(text).split('\n')) {
      let cur = '';
      for (const ch of para) {
        const cand = cur + ch;
        if (cur && font.widthOfTextAtSize(cand, size) > width) {
          const sp = cur.lastIndexOf(' ');
          if (sp > 0 && cur.length - sp < 14 && ch !== ' ') { out.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; } else { out.push(cur.trimEnd()); cur = ch === ' ' ? '' : ch; }
        } else cur = cand;
      }
      out.push(cur);
    }
    return out;
  }
  // 문단 블록: { h, draw(x, top) }
  function text(str, { font: want = R, size = 9.5, color = C.ink, width = CW, lh = 1.55, after = 0 } = {}) {
    const font = pick(want, clean(str));
    const lines = wrap(str, font, size, width);
    const step = size * lh;
    return {
      h: lines.length * step + after,
      lines: lines.map((l) => ({ l, font, size, color, step })),
      draw(x, top) { lines.forEach((l, i) => page.drawText(l, { x, y: top - size - i * step + (step - size) * 0.25, size, font, color: col(color) })); },
    };
  }
  const place = (block, x = M.l) => { if (block.h > room()) newPage(); block.draw(x, y); y -= block.h; };
  // 여러 블록을 한 묶음으로 (한 쪽에 들어가면 나누지 않음)
  function group(blocks, { x = M.l, keep = true } = {}) {
    const total = blocks.reduce((a, b) => a + b.h, 0);
    if (keep && total > room() && total <= FULL) newPage();
    for (const b of blocks) place(b, x);
  }
  const gap = (h) => ({ h, draw() {} });
  const rule = (color = C.rule, w = 0.8, width = CW) => ({ h: w + 6, draw(x, top) { page.drawRectangle({ x, y: top - w - 3, width, height: w, color: col(color) }); } });
  // 배지 (둥근 사각형 + 글자)
  const badgeW = (t, size = 8) => pick(B, clean(t)).widthOfTextAtSize(clean(t), size) + 12;
  function drawBadge(t, x, top, tone, size = 8) {
    const [fg, bg, bd] = TONE[tone] ?? [C.ink2, C.wash, C.rule];
    const w = badgeW(t, size);
    page.drawRectangle({ x, y: top - size - 7, width: w, height: size + 7, color: col(bg), borderColor: col(bd), borderWidth: 0.6 });
    page.drawText(clean(t), { x: x + 6, y: top - size - 3.4, size, font: pick(B, clean(t)), color: col(fg) });
    return w;
  }

  // ---- 1. 머리말 ----
  group([
    text('일단확인', { font: B, size: 8.5, color: C.ink3, after: 2 }),
    text(model.title, { font: B, size: 21, lh: 1.3, after: 4 }),
    text(`${model.recordName} · 정리한 때 ${model.createdAt}`, { size: 9, color: C.ink2, after: 6 }),
    rule(C.ink, 1.6),
    gap(10),
  ]);

  const section = (title, count) => {
    const t = text(count != null ? `${title}  ${count}건` : title, { font: B, size: 13, lh: 1.35, after: 2 });
    return [t, rule(), gap(4)];
  };
  // 제목은 다음 내용과 붙여 둔다 (제목만 쪽 끝에 남지 않게)
  const withHeading = (heading, first) => group([...heading, ...first]);

  // ---- 2. 비교한 문서 ----
  const docRow = (d) => {
    const label = `문서 ${d.side} · ${d.type}`;
    const lf = pick(B, clean(label));
    const lw = lf.widthOfTextAtSize(clean(label), 10) + 8;
    const body = text(`${d.name} (등록 ${d.registered})`, { size: 10, width: CW - 20 - lw });
    const h = Math.max(body.h, 15.5) + 10;
    return {
      h: h + 4,
      draw(x, top) {
        page.drawRectangle({ x, y: top - h, width: CW, height: h, color: col(C.wash) });
        page.drawRectangle({ x, y: top - h, width: 3.5, height: h, color: col(d.side === 'A' ? C.brand : C.green) });
        page.drawText(clean(label), { x: x + 12, y: top - 5 - 10 - 1.5, size: 10, font: lf, color: col(C.ink) });
        body.draw(x + 12 + lw, top - 5);
      },
    };
  };
  withHeading(section('비교한 문서'), [docRow(model.docs[0])]);
  place(docRow(model.docs[1]));
  place(text(REPORT_NOTICES[0], { size: 8.5, color: C.ink3, after: 10 }));

  // ---- 3. 전체 비교 요약 (표) ----
  const sumRow = (g) => {
    const c1 = 150; const c2 = 44;
    const items = text(g.items.join(', ') || '—', { size: 9.5, width: CW - c1 - c2 - 12 });
    const h = Math.max(items.h, 15) + 8;
    return {
      h,
      draw(x, top) {
        const [, , bd] = TONE[g.key] ?? [];
        page.drawRectangle({ x, y: top - h / 2 - 3, width: 6, height: 6, color: col(bd ?? C.rule) });
        page.drawText(clean(g.label), { x: x + 12, y: top - 4 - 9.5 - 1.5, size: 9.5, font: pick(B, clean(g.label)), color: col(C.ink) });
        page.drawText(`${g.count}건`, { x: x + c1, y: top - 4 - 9.5 - 1.5, size: 9.5, font: B, color: col(g.count ? C.ink : C.ink3) });
        items.draw(x + c1 + c2, top - 4);
        page.drawRectangle({ x, y: top - h, width: CW, height: 0.5, color: col(C.ruleSoft) });
      },
    };
  };
  withHeading(section('전체 비교 요약'), [sumRow(model.summary[0])]);
  for (const g of model.summary.slice(1)) place(sumRow(g));
  if (model.skipped) place(text(`두 문서 모두에 적혀 있지 않은 조건 ${model.skipped}개는 정리본에 넣지 않았어요.`, { size: 8.5, color: C.ink3 }));
  place(gap(12));

  // ---- 4. 조건 묶음 · 카드 ----
  const sideBox = (s, k, w) => {
    const label = text(`문서 ${'AB'[k]} · ${model.docs[k].type}`, { size: 7.5, color: C.ink3, width: w - 16 });
    const value = text(sideText(s), { font: s?.state === 'present' ? B : R, size: 10, color: s?.state === 'present' ? C.ink : C.ink2, width: w - 16 });
    return { h: label.h + value.h + 10, label, value, empty: s?.state !== 'present' };
  };
  const card = (r, tone) => {
    const head = {
      h: 24,
      draw(x, top) {
        const lf = pick(B, clean(r.label));
        page.drawText(clean(r.label), { x, y: top - 13, size: 12, font: lf, color: col(C.ink) });
        drawBadge(r.badge, x + lf.widthOfTextAtSize(clean(r.label), 12) + 8, top - 2.5, tone);
      },
    };
    const w = (CW - 8) / 2;
    const a = sideBox(r.a, 0, w);
    const b = sideBox(r.b, 1, w);
    const sh = Math.max(a.h, b.h);
    const sides = {
      h: sh + 6,
      draw(x, top) {
        [[a, 0], [b, 1]].forEach(([s, k]) => {
          const sx = x + k * (w + 8);
          page.drawRectangle({ x: sx, y: top - sh, width: w, height: sh, color: col(s.empty ? C.wash : '#FFFFFF'), borderColor: col(C.ruleSoft), borderWidth: 0.6 });
          page.drawRectangle({ x: sx, y: top - sh, width: 3, height: sh, color: col(k ? C.green : C.brand) });
          s.label.draw(sx + 10, top - 5);
          s.value.draw(sx + 10, top - 5 - s.label.h);
        });
      },
    };
    const blocks = [head, sides];
    if (r.line) blocks.push(text(`대조 요약  ${r.line}`, { size: 9, color: C.ink2, after: 2 }));
    if (r.detail) blocks.push(text(`참고  ${r.detail}`, { size: 9, color: C.ink2, after: 2 }));
    const ev = [...r.evidence.a.map((e) => ['A', e]), ...r.evidence.b.map((e) => ['B', e])];
    if (ev.length) {
      blocks.push(text('원문 근거', { font: B, size: 8.5, color: C.ink2, after: 1 }));
      for (const [side, e] of ev) {
        blocks.push(text(`문서 ${side}${e.line != null ? ` ${e.line}번째 줄` : ''} · ${e.facets.join('·')}`, { size: 7.5, color: C.ink3, width: CW - 10 }));
        blocks.push(text(`“${e.text}”`, { size: 9, width: CW - 10, after: 2 }));
      }
    }
    if (r.questionNo) blocks.push(text(`→ 회사에 확인할 질문 ${r.questionNo}번`, { font: B, size: 8.5, color: C.green, after: 1 }));
    blocks.push(rule(C.ruleSoft, 0.6), gap(6));
    return blocks;
  };
  for (const g of model.groups) {
    const cards = g.rows.map((r) => card(r, g.key));
    withHeading(section(g.label, g.rows.length), cards[0]);
    for (const c of cards.slice(1)) group(c);
    place(gap(6));
  }

  // ---- 5. 회사에 확인할 질문 ----
  const qItem = (q) => {
    const num = `${q.no}.`;
    const nw = 18;
    const label = text(`${q.label}${q.edited ? ' · 직접 고친 질문' : ''}`, { font: B, size: 9.5, width: CW - nw, after: 1 });
    const body = text(q.text, { size: 10, width: CW - nw, after: 6 });
    return { h: label.h + body.h, draw(x, top) { page.drawText(num, { x, y: top - 11, size: 10, font: B, color: col(C.green) }); label.draw(x + nw, top); body.draw(x + nw, top - label.h); } };
  };
  const qs = model.questions.length ? model.questions.map(qItem) : [text('이번 비교에서 만든 확인 질문은 없어요.', { size: 10 })];
  withHeading(section('회사에 확인할 질문'), [qs[0]]);
  for (const q of qs.slice(1)) place(q);
  if (model.questions.length) place(text('질문은 회사에 직접 확인할 때 참고하는 문장이에요. 일단확인은 회사에 보내지 않아요.', { size: 8.5, color: C.ink3 }));
  place(gap(12));

  // ---- 6. 안내 ----
  const notes = REPORT_NOTICES.map((n) => {
    const t = text(n, { size: 8.5, color: C.ink2, width: CW - 10, after: 2 });
    return { h: t.h, draw(x, top) { page.drawText('·', { x, y: top - 9, size: 9, font: B, color: col(C.ink3) }); t.draw(x + 10, top); } };
  });
  withHeading(section('원문 근거와 서비스 안내'), [notes[0]]);
  for (const n of notes.slice(1)) place(n);

  // ---- 쪽 번호 ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const left = '일단확인 · 비교 결과 정리본';
    const right = `${i + 1} / ${pages.length}`;
    p.drawRectangle({ x: M.l, y: M.b - 18, width: CW, height: 0.5, color: col(C.rule) });
    p.drawText(left, { x: M.l, y: M.b - 32, size: 7.5, font: R, color: col(C.ink3) });
    p.drawText(right, { x: W - M.r - R.widthOfTextAtSize(right, 7.5), y: M.b - 32, size: 7.5, font: R, color: col(C.ink3) });
  });
  return doc.save();
}
