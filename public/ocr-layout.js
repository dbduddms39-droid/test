// OCR 결과를 이미지의 배치(행·칸)에 맞춰 다시 줄로 엮는다 (브라우저와 Node 테스트에서 함께 사용, DOM 의존 없음).
// Tesseract는 같은 높이에 있는 글자를 한 줄로 읽어서
//   - 표의 항목명이 두 줄짜리 값의 가운데에 있으면 아래 줄 값에 붙이고 (예: '수습기간 중 급여' + '(수습기간 3개월)')
//   - 아이콘을 글자로 읽고 (예: 'g 연봉', '® 근무장소')
//   - 좌우 2열 목록의 두 항목을 한 줄로 합친다 (예: '4대 보험 가입 건강검진 지원').
// 그래서 정리된 이미지에서 행(가로 빈 띠로 나뉜 영역)과 칸(넓은 세로 빈 곳으로 나뉜 영역)을 찾고,
// 인식된 단어를 위치로 칸에 넣은 뒤 '항목명 + 값의 첫 줄', 값의 나머지 줄 순서로 다시 엮는다.
// 글자는 Tesseract가 읽은 단어 그대로 쓰며, 새 글자를 만들거나 고치지 않는다(아이콘으로 판단한 칸만 뺀다).

const HANGUL = /[가-힣]/;

// ink: 1이면 글자 점. th: 글자 줄 높이(px). 반환: [{ y0, y1, segs: [{ x0, x1, y0, y1 }] }]
export function analyzeLayout(ink, width, height, th) {
  const h = Math.max(6, th);
  const rowHas = new Uint8Array(height);
  for (let y = 0; y < height; y += 1) {
    let n = 0;
    for (let x = 0; x < width && n < 2; x += 1) n += ink[y * width + x];
    rowHas[y] = n >= 2 ? 1 : 0;
  }
  // 글자가 있는 가로 띠 → 가까운 띠(한 칸 안의 여러 줄)는 한 행으로 묶는다
  const bands = [];
  let start = -1;
  for (let y = 0; y <= height; y += 1) {
    if (y < height && rowHas[y]) { if (start < 0) start = y; } else if (start >= 0) { bands.push([start, y]); start = -1; }
  }
  const blocks = [];
  for (const [y0, y1] of bands) {
    const last = blocks.at(-1);
    if (last && y0 - last.y1 < h * 0.5) last.y1 = y1;
    else blocks.push({ y0, y1 });
  }
  // 행마다 세로로 빈 곳을 찾아 칸을 나눈다 (글자 사이·단어 사이 간격보다 넓은 빈 곳만)
  for (const b of blocks) {
    const colHas = new Uint8Array(width);
    for (let y = b.y0; y < b.y1; y += 1) for (let x = 0; x < width; x += 1) if (ink[y * width + x]) colHas[x] = 1;
    const runs = [];
    let s = -1;
    for (let x = 0; x <= width; x += 1) {
      if (x < width && colHas[x]) { if (s < 0) s = x; } else if (s >= 0) { runs.push([s, x]); s = -1; }
    }
    const segs = [];
    for (const [x0, x1] of runs) {
      const prev = segs.at(-1);
      if (prev && x0 - prev.x1 < h * 0.9) prev.x1 = x1;
      else segs.push({ x0, x1 });
    }
    // 칸마다 실제 글자 높이
    for (const seg of segs) {
      let top = b.y1;
      let bottom = b.y0;
      for (let y = b.y0; y < b.y1; y += 1) {
        for (let x = seg.x0; x < seg.x1; x += 1) if (ink[y * width + x]) { if (y < top) top = y; if (y + 1 > bottom) bottom = y + 1; break; }
      }
      Object.assign(seg, { y0: top, y1: bottom });
    }
    b.segs = segs;
  }
  return blocks;
}

const center = (bb) => ({ x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 });

// 같은 인식 줄에서 온 단어는 Tesseract의 띄어쓰기(space)를 그대로 쓰고, 다른 줄에서 온 단어 사이는 간격으로 판단한다
function joinWords(words, glyph) {
  let out = '';
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (i && (prev.lineId != null && prev.lineId === w.lineId ? w.space : w.bbox.x0 - prev.bbox.x1 > glyph * 0.3)) out += ' ';
    out += w.text;
  });
  return out;
}

// 칸 안의 단어를 위아래 줄로 나눈다. '*'·'.' 같은 작은 기호는 위아래로 겹치는 줄에 붙인다.
function sublines(words) {
  const sorted = [...words].sort((a, b) => (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0)); // 큰 글자부터 줄을 만든다
  const out = [];
  for (const w of sorted) {
    const c = center(w.bbox).y;
    const small = w.bbox.y1 - w.bbox.y0 < (out[0] ? out[0].y1 - out[0].y0 : Infinity) * 0.6;
    const line = out.find((l) => (c > l.y0 && c < l.y1) || (small && w.bbox.y1 > l.y0 && w.bbox.y0 < l.y1));
    if (line) { line.words.push(w); line.y0 = Math.min(line.y0, w.bbox.y0); line.y1 = Math.max(line.y1, w.bbox.y1); } else out.push({ y0: w.bbox.y0, y1: w.bbox.y1, words: [w] });
  }
  return out.sort((a, b) => a.y0 - b.y0).map((l) => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

// 아이콘 칸: 글자 한두 자 크기의 좁은 칸이고
//   - 읽힌 글자에 한글이 없으면서 확신이 낮거나 글자보다 훨씬 크다 (예: 'g', '®', '<?', 아이콘을 '8'로 읽음)
//   - 또는 아이콘 하나 크기이면서 확신이 낮다 (예: 포크·나이프 아이콘을 '범0'으로 읽음)
// 두 글자 항목명(예: '연봉')은 아이콘보다 넓고, 표의 번호 칸 숫자는 글자 높이와 같아 남는다.
export function isIcon(seg, segWords, th, segCount, glyph = th * 0.6) {
  if (segCount < 2 || !segWords.length) return false;
  const w = seg.x1 - seg.x0;
  const hgt = seg.y1 - seg.y0;
  if (w > th * 1.8 || hgt < th * 0.45) return false;
  const text = segWords.map((x) => x.text).join('');
  const conf = segWords.reduce((n, x) => n + x.confidence, 0) / segWords.length;
  if (!HANGUL.test(text)) return conf < 75 || hgt >= glyph * 1.2;
  return w <= th * 1.15 && conf < 60;
}

// 칸 맨 앞의 로고·아이콘이 글자와 같은 칸에 붙어 읽힌 경우: 한글이 없고, 글자보다 훨씬 크고, 뒤 글자와 떨어져 있으면 뺀다
function dropLeadingIcon(words, glyph) {
  const [first, next] = words;
  if (!first || !next || HANGUL.test(first.text)) return words;
  const tall = first.bbox.y1 - first.bbox.y0 >= glyph * 1.3;
  const apart = next.bbox.x0 - first.bbox.x1 >= glyph * 0.35;
  return tall && apart ? words.slice(1) : words;
}

// 단어를 행·칸에 넣는다 (가운데가 들어가는 곳, 없으면 가장 가까운 곳). 반환: cells[행][칸] = 단어 목록, 또는 null
export function placeWords(words, blocks) {
  if (!blocks.length || !words.length) return null;
  const cells = blocks.map((b) => b.segs.map(() => []));
  let placed = 0;
  for (const w of words) {
    const c = center(w.bbox);
    let bi = blocks.findIndex((b) => c.y >= b.y0 - 2 && c.y <= b.y1 + 2);
    if (bi < 0) bi = blocks.reduce((best, b, i) => (Math.abs((b.y0 + b.y1) / 2 - c.y) < Math.abs((blocks[best].y0 + blocks[best].y1) / 2 - c.y) ? i : best), 0);
    const segs = blocks[bi].segs;
    if (!segs.length) continue;
    let si = segs.findIndex((s) => c.x >= s.x0 - 2 && c.x <= s.x1 + 2);
    if (si < 0) si = segs.reduce((best, s, i) => (Math.abs((s.x0 + s.x1) / 2 - c.x) < Math.abs((segs[best].x0 + segs[best].x1) / 2 - c.x) ? i : best), 0);
    cells[bi][si].push(w);
    placed += 1;
  }
  return placed >= words.length * 0.9 ? cells : null;
}

// cells: placeWords 결과(칸별로 다시 읽은 단어로 바꿨을 수 있음). 반환: { lines: [{ text, words }], icons: 뺀 아이콘 칸 수 }
export function assembleLines(blocks, cells, th) {
  const all = cells.flat(2);
  const glyph = (() => {
    const hs = all.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    return hs[hs.length >> 1] || th;
  })();
  const lines = [];
  let icons = 0;
  blocks.forEach((b, bi) => {
    const segs = b.segs;
    // 아이콘 칸을 빼고, 행 가운데의 아이콘은 새 항목의 시작으로 본다 (좌우 2열 목록)
    const groups = [[]];
    segs.forEach((seg, si) => {
      const ws = cells[bi][si];
      if (isIcon(seg, ws, th, segs.length, glyph)) {
        icons += 1;
        if (groups.at(-1).length) groups.push([]);
        return;
      }
      if (ws.length) groups.at(-1).push(ws);
    });
    for (const group of groups.filter((g) => g.length)) {
      // 칸마다 위아래 줄로 나눈 뒤, i번째 줄끼리 이어 붙인다 (항목명 + 값의 첫 줄, 값의 둘째 줄 …)
      const parts = group.map((ws, gi) => {
        const lines = sublines(ws);
        if (gi === 0 && lines.length) lines[0] = dropLeadingIcon(lines[0], glyph);
        return lines;
      });
      const n = Math.max(...parts.map((p) => p.length));
      for (let i = 0; i < n; i += 1) {
        const lineWords = parts.flatMap((p) => p[i] ?? []);
        const text = parts.map((p) => (p[i] ? joinWords(p[i], glyph) : '')).filter(Boolean).join(' ');
        if (text) lines.push({ text, words: lineWords });
      }
    }
  });
  return { lines, icons };
}
