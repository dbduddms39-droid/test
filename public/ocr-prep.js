// OCR 전처리 (브라우저와 Node 테스트에서 함께 사용, DOM·라이브러리 의존 없음).
// 화면 캡처는 흰 바탕 외에 색 배너·버튼(흰 글자), 회색 칩·표 머리글(회색 바탕) 등 바탕이 여러 가지라
// 이미지 전체에 한 기준(Tesseract의 전역 이진화)을 쓰면 일부 글자가 사라진다.
// 그래서 작은 칸마다 바탕 밝기를 구하고, 바탕이 비슷한 칸을 한 영역으로 묶어
//   - 영역의 글자가 바탕보다 밝으면(색 배너의 흰 글자 등) 반전하고
//   - 바탕은 흰색, 글자는 바탕과의 차이에 따라 검은색으로 펴서
// 모든 영역을 '흰 바탕 위 검은 글자'로 맞춘다. 글자 모양은 바꾸지 않고 밝기만 바꾼다(글자를 추측해 만들지 않음).
// 이전 방식(어두운 가로줄 전체 반전)은 중간 밝기 배너(주황·파랑 등)의 흰 글자를 놓치고,
// 일부만 어두운 배너에서는 줄 전체를 반전해 밝은 쪽 글자까지 망가뜨렸다.

const BINS = 32; // 밝기 막대그래프 칸 수 (8단계씩)
const BG_TOL = 28; // 이웃 칸을 같은 바탕으로 볼 밝기 차이
const INK_FLOOR = 36; // 글자 방향을 정할 때: 바탕과 이보다 덜 차이 나는 점은 세지 않는다
const PRESENCE = 24; // 글자가 있는 줄을 셀 때: 바탕과 이보다 더 차이 나는 점
const MIN_CONTRAST = 50; // 주변에서 바탕과의 최대 차이가 이보다 작으면 글자가 없는 곳(잡티·옅은 테두리)으로 본다

export function toGray(rgba, width, height) {
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < g.length; i += 4, p += 1) g[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return g;
}

export function writeGray(gray, rgba) {
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    rgba[i] = gray[p]; rgba[i + 1] = gray[p]; rgba[i + 2] = gray[p]; rgba[i + 3] = 255;
  }
}

// 칸 크기: 이미지 크기에 비례 (글자보다 조금 큰 정도)
export const cellSize = (width, height) => Math.max(8, Math.min(40, Math.round(Math.max(width, height) / 60)));

// 칸마다 바탕 밝기 = 주변 3×3 칸의 밝기 최빈값(글자보다 바탕 점이 많다)
function backgroundGrid(gray, width, height, cell) {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hist = new Uint32Array(cols * rows * BINS);
  const sums = new Float64Array(cols * rows * BINS);
  for (let y = 0; y < height; y += 1) {
    const r = Math.floor(y / cell);
    for (let x = 0; x < width; x += 1) {
      const v = gray[y * width + x];
      const k = (r * cols + Math.floor(x / cell)) * BINS + (v >> 3);
      hist[k] += 1;
      sums[k] += v;
    }
  }
  const bg = new Float32Array(cols * rows);
  const acc = new Uint32Array(BINS);
  const accSum = new Float64Array(BINS);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      acc.fill(0); accSum.fill(0);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = r + dr; const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const base = (rr * cols + cc) * BINS;
          for (let b = 0; b < BINS; b += 1) { acc[b] += hist[base + b]; accSum[b] += sums[base + b]; }
        }
      }
      let best = 0;
      for (let b = 1; b < BINS; b += 1) if (acc[b] > acc[best]) best = b;
      bg[r * cols + c] = accSum[best] / acc[best];
    }
  }
  return { bg, cols, rows };
}

// 바탕이 비슷한 이웃 칸을 한 영역으로 묶는다
function regions(bg, cols, rows) {
  const label = new Int32Array(cols * rows).fill(-1);
  let n = 0;
  const stack = [];
  for (let s = 0; s < label.length; s += 1) {
    if (label[s] >= 0) continue;
    label[s] = n; stack.push(s);
    while (stack.length) {
      const k = stack.pop();
      const r = Math.floor(k / cols); const c = k % cols;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (label[j] < 0 && Math.abs(bg[j] - bg[k]) < BG_TOL) { label[j] = n; stack.push(j); }
      }
    }
    n += 1;
  }
  return { label, count: n };
}

// 반환: { gray: 흰 바탕·검은 글자로 맞춘 밝기, rowInk: 줄마다 글자 점 수(일부만 인식됐는지 비교할 때 사용) }
// opts.stretch: 'soft'(기본, 옅은 글자를 진하게 하되 획 가장자리는 유지) | 'local'(칸별 글자 대비만큼 끝까지 펴기) | 'none'(대비 유지)
export function normalizeForOcr(gray, width, height, opts = {}) {
  const stretch = opts.stretch ?? 'soft';
  const cell = cellSize(width, height);
  const { bg, cols, rows } = backgroundGrid(gray, width, height, cell);
  const { label, count } = regions(bg, cols, rows);

  // 영역마다 바탕보다 뚜렷이 밝은 점(밝은 글자)과 어두운 점(어두운 글자) 수를 세어 글자 방향을 정한다
  // 영역 경계에 걸친 칸은 이웃 영역의 바탕(예: 다크 모드 화면 위 파란 버튼의 가장자리)이 섞여 있어 세지 않는다.
  // 경계 칸만 있는 작은 영역은 모든 칸을 센다.
  const lighter = new Float64Array(count * 2);
  const darker = new Float64Array(count * 2);
  const inner = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c;
      inner[k] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        .every(([rr, cc]) => rr < 0 || cc < 0 || rr >= rows || cc >= cols || label[rr * cols + cc] === label[k]) ? 1 : 0;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const r = Math.floor(y / cell);
    for (let x = 0; x < width; x += 1) {
      const k = r * cols + Math.floor(x / cell);
      const d = gray[y * width + x] - bg[k];
      const slot = label[k] * 2 + inner[k];
      if (d > INK_FLOOR) lighter[slot] += 1;
      else if (d < -INK_FLOOR) darker[slot] += 1;
    }
  }
  const invert = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const hasInner = lighter[i * 2 + 1] + darker[i * 2 + 1] > 0;
    const l = hasInner ? lighter[i * 2 + 1] : lighter[i * 2];
    const d = hasInner ? darker[i * 2 + 1] : darker[i * 2];
    invert[i] = l > d * 1.5 ? 1 : 0;
  }

  // 칸마다 글자 대비 = 주변 3×3 칸에서 바탕과의 최대 차이. 글자 대비만큼 펴서 회색 글자도 진하게 하되,
  // 글자 가장자리의 중간 밝기는 비율대로 남겨 획이 두꺼워지지 않게 한다.
  const diff = (k, v) => (invert[label[k]] ? v - bg[k] : bg[k] - v);
  const cellMax = new Float32Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    const r = Math.floor(y / cell);
    for (let x = 0; x < width; x += 1) {
      const k = r * cols + Math.floor(x / cell);
      const d = diff(k, gray[y * width + x]);
      if (d > cellMax[k]) cellMax[k] = d;
    }
  }
  const contrast = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let m = 0;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr; const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && cellMax[rr * cols + cc] > m) m = cellMax[rr * cols + cc];
      }
      contrast[r * cols + c] = m;
    }
  }
  // 넓은 바탕 영역만 기준으로 삼는다. 글자가 빽빽한 몇 칸이 따로 묶인 작은 영역(바탕이 글자색)은 제외해야
  // 그 옆의 실제 글자가 지워지지 않는다.
  const size = new Uint32Array(count);
  for (let k = 0; k < label.length; k += 1) size[label[k]] += 1;
  const wide = Math.max(16, label.length * 0.01);
  const edgeBg = (r, c, v) => {
    const own = label[r * cols + c];
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const rr = r + dr; const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (label[j] !== own && size[label[j]] >= wide && Math.abs(v - bg[j]) < BG_TOL) return true;
    }
    return false;
  };
  const out = new Uint8Array(width * height);
  // 줄마다 바탕과 뚜렷이 다른 점의 수 (글자가 흐려 정리 과정에서 옅어져도 '무언가 있는 줄'로 센다)
  const rowInk = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    const r = Math.floor(y / cell);
    for (let x = 0; x < width; x += 1) {
      const k = r * cols + Math.floor(x / cell);
      const c = contrast[k];
      if (c < MIN_CONTRAST) { out[y * width + x] = 255; continue; }
      const floor = c * 0.15; // 바탕 잡티
      const full = stretch === 'local' ? c * 0.9 : stretch === 'soft' ? Math.max(c * 0.9, 170) : 255; // 이만큼 차이 나면 검은색
      const v = gray[y * width + x];
      if (inner[k] && Math.abs(v - bg[k]) > PRESENCE) rowInk[y] += 1;
      // 영역 경계 칸: 이웃한 넓은 바탕 영역과 같은 밝기의 점은 그 바탕으로 본다 (버튼·배너 가장자리 잔상 제거)
      if (!inner[k] && edgeBg(r, Math.floor(x / cell), v)) { out[y * width + x] = 255; continue; }
      const d = diff(k, v);
      const ink = d <= floor ? 0 : d >= full ? 1 : (d - floor) / (full - floor);
      out[y * width + x] = 255 - Math.round(ink * 255);
    }
  }
  return { gray: out, rowInk };
}

// 표 테두리·버튼 외곽선·밑줄처럼 글자보다 훨씬 긴 가로·세로 직선을 지운다.
// OCR이 이런 선을 '|', '_', 'l' 등으로 읽거나 선에 붙은 글자를 잘못 읽는 것을 줄인다. 글자 획은 이 길이에 못 미친다.
export function removeLongLines(gray, width, height, textHeight) {
  const th = textHeight || 20;
  const minH = Math.max(Math.round(th * 3), Math.round(width * 0.1));
  const minV = Math.max(Math.round(th * 2.2), 12);
  let removed = 0;
  const clearRun = (start, end, idx) => { for (let i = start; i < end; i += 1) { gray[idx(i)] = 255; removed += 1; } };
  const dark = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) dark[i] = gray[i] < 160 ? 1 : 0;
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      if (x < width && dark[y * width + x]) { if (start < 0) start = x; } else if (start >= 0) {
        if (x - start >= minH) clearRun(start, x, (i) => y * width + i);
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      if (y < height && dark[y * width + x]) { if (start < 0) start = y; } else if (start >= 0) {
        if (y - start >= minV) clearRun(start, y, (i) => i * width + x);
        start = -1;
      }
    }
  }
  return removed;
}

// 정리된 이미지(흰 바탕·검은 글자)에서 글자 줄 수와 줄 높이의 중앙값(px)을 구한다.
// 가로로 잉크가 있는 행이 이어진 구간을 한 줄로 본다 (구분선처럼 너무 얇은 구간은 뺀다).
// rowInk를 주면 그 값(줄마다 글자 점 수)을 쓴다.
export function textLineStats(gray, width, height, rowInk = null) {
  const runs = [];
  let start = -1;
  const minInk = Math.max(2, Math.round(width * 0.004));
  for (let y = 0; y <= height; y += 1) {
    let ink = 0;
    if (y < height && rowInk) ink = rowInk[y];
    else if (y < height) for (let x = 0; x < width; x += 1) if (gray[y * width + x] < 128) ink += 1;
    if (y < height && ink >= minInk) { if (start < 0) start = y; } else if (start >= 0) { runs.push(y - start); start = -1; }
  }
  const lines = runs.filter((h) => h >= 4).sort((a, b) => a - b);
  const median = lines.length ? lines[lines.length >> 1] : 0;
  return { height: median, count: lines.filter((h) => h >= median * 0.5).length };
}
export const estimateTextHeight = (gray, width, height) => textLineStats(gray, width, height).height;

// OCR에 알맞은 글자 크기로 맞출 배율. 작은 글자는 키우고(최대 3배) 아주 큰 글자는 줄인다.
export const TARGET_TEXT_HEIGHT = 40;
export function ocrScale(textHeight, width, height, maxSide = 3000, target = TARGET_TEXT_HEIGHT) {
  if (!textHeight) return 1;
  let s = 1;
  if (textHeight < 26) s = Math.min(3, target / textHeight);
  else if (textHeight > 90) s = 60 / textHeight;
  return Math.min(s, maxSide / Math.max(width, height));
}
