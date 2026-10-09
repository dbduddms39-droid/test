// 업로드한 파일에서 텍스트를 추출한다. 모든 처리는 브라우저 안에서 하며 파일을 서버로 보내지 않는다.
// - 일반 PDF: pdf.js로 텍스트 레이어 추출
// - 이미지(JPG·PNG·WebP)와 스캔 PDF 쪽: Tesseract.js로 한국어·영어 글자 인식(OCR)
// 라이브러리는 같은 사이트의 /vendor/에서 처음 사용할 때만 불러온다.
import {
  UPLOAD_MESSAGES, MAX_PDF_PAGES, MAX_OCR_PAGES,
  checkFile, pageTextFromItems, needsOcr, joinPages, hasText, tidyText, stripOcrJunk, fitSize, combineImageResults, reviewOcr,
} from './upload-rules.js';
import { toGray, writeGray, normalizeForOcr, estimateTextHeight, textLineStats, ocrScale, removeLongLines } from './ocr-prep.js';
import { analyzeLayout, placeWords, assembleLines } from './ocr-layout.js';

const VENDOR = `${location.origin}/vendor`;

export class UploadError extends Error {
  constructor(code) {
    super(UPLOAD_MESSAGES[code] ?? UPLOAD_MESSAGES.extract_failed);
    this.code = code;
  }
}

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import(`${VENDOR}/pdfjs/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdfjs/pdf.worker.min.mjs`;
    return pdfjs;
  }).catch((err) => { pdfjsPromise = null; throw Object.assign(new UploadError('library_failed'), { cause: err }); });
  return pdfjsPromise;
}

async function createOcrWorker(onProgress) {
  let Tesseract;
  try {
    Tesseract = (await import(`${VENDOR}/tesseract/tesseract.esm.min.js`)).default;
  } catch (err) {
    throw Object.assign(new UploadError('library_failed'), { cause: err });
  }
  onProgress({ stage: 'ocr-load' });
  try {
    const worker = await Tesseract.createWorker(['kor', 'eng'], Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${VENDOR}/tesseract/worker.min.js`,
      corePath: `${VENDOR}/tesseract-core`,
      langPath: `${VENDOR}/tessdata`,
      workerBlobURL: false,
      gzip: true,
    });
    // 한국어 띄어쓰기 보존
    await worker.setParameters({ preserve_interword_spaces: '1' });
    return worker;
  } catch (err) {
    throw Object.assign(new UploadError('library_failed'), { cause: err });
  }
}

const RETRY_BELOW = 65; // 줄 안에 이보다 신뢰도가 낮은 단어가 있으면 그 줄만 다시 인식
const MAX_RETRY_LINES = 8; // 이미지마다 다시 인식하는 줄 수 상한 (속도)
const RETRY_GAIN = 8; // 다시 인식한 결과가 이만큼 더 확실할 때만 바꾼다
const LINE_OK = 60; // 평균 신뢰도가 이 이상인 줄을 '읽힌 줄'로 센다
const JUNK = /^[_|¦、]+$/;

const meanConf = (words) => {
  const real = words.filter((w) => !JUNK.test(w.text));
  return real.length ? real.reduce((n, w) => n + w.confidence, 0) / real.length : 0;
};
// 줄 비교 점수: 평균 신뢰도와 가장 불확실한 단어의 신뢰도를 함께 본다 (한 단어만 크게 틀린 줄을 가려내기 위해)
const lineScore = (words) => {
  const real = words.filter((w) => !JUNK.test(w.text));
  return real.length ? (meanConf(real) + Math.min(...real.map((w) => w.confidence))) / 2 : 0;
};

// Tesseract 결과를 줄 단위로 정리한다 (줄 위치, 단어별 신뢰도·위치·앞 띄어쓰기, 문단 경계)
let lineSeq = 0;
function linesOf(data) {
  const lines = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      (p.lines ?? []).forEach((l, i) => {
        const text = (l.text ?? '').replace(/\s+$/, '');
        const lineId = (lineSeq += 1);
        let cursor = 0;
        const words = (l.words ?? []).filter((w) => w.text?.trim()).map((w) => {
          const at = text.indexOf(w.text, cursor);
          const space = at > 0 && /\s/.test(text[at - 1]);
          if (at >= 0) cursor = at + w.text.length;
          return { text: w.text, confidence: w.confidence ?? 0, bbox: w.bbox, lineId, space };
        });
        lines.push({ text, bbox: l.bbox, words, paraStart: i === 0 });
      });
    }
  }
  return lines;
}

// 버튼·카드 모서리 같은 그림 조각을 글자로 읽은 것: Tesseract도 확신하지 못한(신뢰도 낮은) 괄호·기호 단독 토큰과
// 한 글자짜리 줄만 지운다. 글자·숫자가 섞인 단어나 확신이 높은 기호는 그대로 둔다.
const NOISE_TOKEN = /^[[\](){}<>|_¦、‘’'"`^\\/.,;·•]+$/; // '~'·'-'·':'은 범위·시간 표기라 제외
const NOISE_BELOW = 60;
function dropNoise(line) {
  const real = line.words.filter((w) => !JUNK.test(w.text));
  if (real.length === 1 && [...real[0].text].length === 1 && real[0].confidence < 30) return null;
  let { text } = line;
  for (const w of line.words) {
    if (NOISE_TOKEN.test(w.text) && w.confidence < NOISE_BELOW) {
      const esc = w.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(^|\\s)${esc}(?=\\s|$)`), '$1');
    }
  }
  return { ...line, text: text.trim() };
}
const linesToText = (lines) => tidyText(stripOcrJunk(lines.map(dropNoise).filter((l) => l && l.text)
  .map((l, i) => `${i && l.paraStart ? '\n' : ''}${l.text}`).join('\n')));

// 단어 상자들이 칸의 가로 폭을 덮는 비율
function coverage(words, seg) {
  const spans = words.map((w) => [Math.max(seg.x0, w.bbox.x0), Math.min(seg.x1, w.bbox.x1)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = seg.x0;
  for (const [a, b] of spans) { if (b > end) { covered += b - Math.max(a, end); end = b; } }
  return covered / Math.max(1, seg.x1 - seg.x0);
}
const squeezedLength = (ls) => ls.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0);

const CROP_PAD = 12;
function cropCanvas(canvas, { x0, y0, x1, y1 }, zoom = 1, pad = CROP_PAD) {
  const w = Math.round((x1 - x0) * zoom);
  const h = Math.round((y1 - y0) * zoom);
  const out = canvasOf(w + pad * 2, h + pad * 2);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, pad, pad, w, h);
  return out;
}

// 신뢰도가 낮은 줄만 묶어서(위아래로 거의 붙은 조각 줄은 한 줄로) 다시 인식할 영역을 만든다
function retryGroups(lines, width, height) {
  const heights = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
  const medianH = heights[heights.length >> 1] || 20;
  const low = (l) => {
    const real = l.words.filter((w) => !JUNK.test(w.text));
    return real.length > 0 && Math.min(...real.map((w) => w.confidence)) < RETRY_BELOW;
  };
  // 글자 한 줄이 위아래 두 조각으로 나뉘어 인식된 경우: 보통 줄보다 낮은 조각 줄이 바로 붙어 있다
  const fragment = (i) => lines[i] && lines[i].bbox.y1 - lines[i].bbox.y0 < medianH * 0.75;
  const touching = (a, b) => lines[b].bbox.y0 - lines[a].bbox.y1 < medianH * 0.3;
  const groups = [];
  lines.forEach((l, i) => {
    if (!low(l) || groups.some((g) => i >= g.start && i <= g.end)) return;
    let start = i;
    let end = i;
    if (fragment(i)) {
      while (start > 0 && fragment(start - 1) && touching(start - 1, start)) start -= 1;
      while (end < lines.length - 1 && fragment(end + 1) && touching(end, end + 1)) end += 1;
    }
    const box = { ...lines[start].bbox };
    for (let k = start + 1; k <= end; k += 1) {
      Object.assign(box, { x0: Math.min(box.x0, lines[k].bbox.x0), x1: Math.max(box.x1, lines[k].bbox.x1), y1: Math.max(box.y1, lines[k].bbox.y1) });
    }
    groups.push({ start, end, box });
  });
  return groups.slice(0, MAX_RETRY_LINES).map((g) => {
    const h = g.box.y1 - g.box.y0;
    const m = Math.max(h, medianH);
    const rect = {
      x0: Math.max(0, Math.round(g.box.x0 - m * 0.5)), x1: Math.min(width, Math.round(g.box.x1 + m * 0.5)),
      y0: Math.max(0, Math.round(g.box.y0 - m * 0.3)), y1: Math.min(height, Math.round(g.box.y1 + m * 0.3)),
    };
    // 이웃 줄(표의 옆 칸 항목명·위아래 줄)이 잘라 낸 영역에 들어오지 않게 한다. 들어오면 그 줄을 함께 읽어
    // 같은 내용이 두 번 나온다 (예: 표 가운데의 '수습기간 중 급여'가 아래 줄에 다시 붙음)
    lines.forEach((o, k) => {
      if (k >= g.start && k <= g.end || o.bbox.x1 <= rect.x0 || o.bbox.x0 >= rect.x1) return;
      if (o.bbox.y1 <= g.box.y0 + h * 0.3) rect.y0 = Math.max(rect.y0, Math.min(o.bbox.y1, g.box.y0));
      else if (o.bbox.y0 >= g.box.y1 - h * 0.3) rect.y1 = Math.min(rect.y1, Math.max(o.bbox.y0, g.box.y1));
    });
    return { ...g, rect };
  }).reduce((out, g) => {
    // 다시 읽을 영역이 겹치면 한 번만 읽는다 (큰 제목이 여러 조각 줄로 나뉜 경우 같은 제목을 두 번 읽지 않게)
    const prev = out.at(-1);
    const overlap = prev && Math.min(prev.rect.y1, g.rect.y1) - Math.max(prev.rect.y0, g.rect.y0) > 0
      && Math.min(prev.rect.x1, g.rect.x1) - Math.max(prev.rect.x0, g.rect.x0) > 0;
    if (overlap && g.start === prev.end + 1) {
      prev.end = g.end;
      prev.rect = { x0: Math.min(prev.rect.x0, g.rect.x0), x1: Math.max(prev.rect.x1, g.rect.x1), y0: Math.min(prev.rect.y0, g.rect.y0), y1: Math.max(prev.rect.y1, g.rect.y1) };
    } else out.push(g);
    return out;
  }, []);
}

// 이미지 1장 인식: 전처리 이미지 전체를 인식한 뒤, 신뢰도가 낮은 줄만 전처리·원본·확대 이미지에서
// 한 줄 모드로 다시 인식해 가장 확실한 결과를 고른다. 어느 결과든 실제 이미지에서 읽은 글자이며 추측해 고치지 않는다.
async function recognize(worker, prepared, opts = {}) {
  const params = opts.psm ? { tessedit_pageseg_mode: String(opts.psm) } : {};
  const { data } = await worker.recognize(prepared.canvas, params, { text: true, blocks: true });
  let lines = linesOf(data);
  let retried = 0;
  let replaced = 0;
  if (opts.retry !== false && lines.length) {
    const groups = retryGroups(lines, prepared.canvas.width, prepared.canvas.height);
    const next = [...lines];
    for (const g of groups) {
      const current = lines.slice(g.start, g.end + 1).flatMap((l) => l.words);
      let best = { conf: lineScore(current), lines: null };
      // 후보: 전처리 이미지, 원본 이미지, 전처리 이미지를 1.5배로 키운 것 (같은 줄을 다른 조건에서 읽기)
      const sources = [[prepared.canvas, 1], [prepared.original, 1], ...(opts.zoomRetry === false ? [] : [[prepared.canvas, 1.5]])];
      for (const [source, zoom] of sources.filter(([c]) => c)) {
        retried += 1;
        const { data: d } = await worker.recognize(cropCanvas(source, g.rect, zoom), { tessedit_pageseg_mode: '7' }, { text: true, blocks: true });
        const cand = linesOf(d).filter((l) => l.words.length);
        const conf = lineScore(cand.flatMap((l) => l.words));
        // 원래 줄보다 훨씬 길게 읽혔다면 옆 내용까지 읽은 것이므로 쓰지 않는다
        const longer = squeezedLength(cand) > squeezedLength(lines.slice(g.start, g.end + 1)) * 1.5 + 2;
        if (cand.length && !longer && conf > best.conf + RETRY_GAIN) best = { conf, lines: cand, zoom };
      }
      if (best.lines) {
        replaced += 1;
        const text = best.lines.map((l) => l.text).join(' ');
        // 잘라 낸 이미지 안의 단어 위치를 전체 이미지 좌표로 되돌린다 (배치 분석에 사용)
        const back = (v, o) => o + (v - CROP_PAD) / best.zoom;
        const words = best.lines.flatMap((l) => l.words).map((w) => ({ ...w, bbox: w.bbox && {
          x0: back(w.bbox.x0, g.rect.x0), x1: back(w.bbox.x1, g.rect.x0), y0: back(w.bbox.y0, g.rect.y0), y1: back(w.bbox.y1, g.rect.y0),
        } }));
        next.splice(g.start, g.end - g.start + 1, { ...lines[g.start], text, words, replaced: true },
          ...Array(g.end - g.start).fill(null));
      }
    }
    lines = next.filter(Boolean);
  }
  // 이미지의 행·칸 배치에 맞춰 줄을 다시 엮는다 (표의 항목명-값 연결, 아이콘 제외, 좌우 2열 목록 분리)
  let icons = 0;
  if (opts.layout !== false && prepared.layout) {
    const { gray, width, height, pad, th } = prepared.layout;
    const ink = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) ink[i] = gray[i] < 160 ? 1 : 0;
    const shift = (w) => ({ ...w, bbox: { x0: w.bbox.x0 - pad, x1: w.bbox.x1 - pad, y0: w.bbox.y0 - pad, y1: w.bbox.y1 - pad } });
    const words = lines.flatMap((l) => l.words).filter((w) => w.bbox).map(shift);
    const blocks = analyzeLayout(ink, width, height, th);
    opts.onLayout?.({ blocks, th, words }); // 비교 도구에서 배치 분석 결과를 확인할 때만 사용
    const cells = placeWords(words, blocks);
    // 영역별 인식: 칸이 여러 개인 행(표·2열 목록)은 칸마다 따로 읽어, 전체 인식보다 확실하면 그 칸의 결과로 바꾼다.
    // (전체 인식은 두 줄짜리 값 가운데의 항목명을 위아래로 잘라 읽는 일이 있다. 예: '근무시간' → '근' + '=e')
    if (cells && opts.cells !== false) {
      for (const [bi, b] of blocks.entries()) {
        if (b.segs.length < 2) continue;
        for (const [si, seg] of b.segs.entries()) {
          const m = Math.round(th * 0.25);
          const rect = {
            x0: Math.max(0, seg.x0 + pad - m), x1: Math.min(prepared.canvas.width, seg.x1 + pad + m),
            y0: Math.max(0, seg.y0 + pad - m), y1: Math.min(prepared.canvas.height, seg.y1 + pad + m),
          };
          const psm = seg.y1 - seg.y0 > th * 1.5 ? '6' : '7';
          const readCell = async (source, zoom) => {
            retried += 1;
            const { data: d } = await worker.recognize(cropCanvas(source, rect, zoom), { tessedit_pageseg_mode: psm }, { text: true, blocks: true });
            const back = (v, o) => o + (v - CROP_PAD) / zoom - pad;
            return linesOf(d).flatMap((l) => l.words).map((w) => ({ ...w, bbox: {
              x0: back(w.bbox.x0, rect.x0), x1: back(w.bbox.x1, rect.x0), y0: back(w.bbox.y0, rect.y0), y1: back(w.bbox.y1, rect.y0),
            } }));
          };
          // 전체 인식에서 칸 일부가 비어 있으면(아이콘과 한 단어로 붙어 다른 칸에 들어간 경우 등) 칸을 더 많이 덮은 쪽을 쓴다
          const better = (cand, cur) => cand.length && (!cur.length
            || (coverage(cand, seg) - coverage(cur, seg) > 0.1 && lineScore(cand) >= LINE_OK)
            || lineScore(cand) > lineScore(cur) + 3);
          let best = cells[bi][si];
          const region = await readCell(prepared.canvas, 1);
          if (better(region, best)) best = region;
          // 그래도 확신이 낮은 단어가 남으면 원본·확대 이미지에서도 읽어 본다 (줄 다시 읽기와 같은 방식)
          const weak = (ws) => ws.some((w) => !JUNK.test(w.text) && w.confidence < RETRY_BELOW);
          if (weak(best)) {
            for (const [source, zoom] of [[prepared.original, 1], [prepared.canvas, 1.5]]) {
              const cand = await readCell(source, zoom);
              if (better(cand, best)) best = cand;
            }
          }
          opts.onCell?.({ bi, si, whole: cells[bi][si].map((w) => `${w.text}(${Math.round(w.confidence)})`).join(' '), chosen: best.map((w) => `${w.text}(${Math.round(w.confidence)})`).join(' ') });
          if (best !== cells[bi][si]) { cells[bi][si] = best; replaced += 1; }
        }
      }
    }
    const assembled = cells && assembleLines(blocks, cells, th);
    if (assembled) {
      icons = assembled.icons;
      lines = assembled.lines.map((l) => ({ ...l, paraStart: false }));
    }
  }
  const words = lines.flatMap((l) => l.words);
  const text = linesToText(lines);
  const confidence = lines.length ? meanConf(words) : (data.confidence ?? 0);
  // 확실하게 읽힌 줄 수 (흐린 부분에서 나온 신뢰도 낮은 조각 줄은 세지 않는다)
  const readLines = lines.map(dropNoise).filter((l) => l && l.text && meanConf(l.words) >= LINE_OK).length;
  return { text, confidence, words, lines: readLines, inkLines: prepared.inkLines ?? 0, retried, replaced, icons, ...reviewOcr({ words, confidence, lines: readLines, inkLines: prepared.inkLines ?? 0 }) };
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function padCanvas(canvas, pad) {
  const padded = canvasOf(canvas.width + pad * 2, canvas.height + pad * 2);
  const ctx = padded.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, padded.width, padded.height);
  ctx.drawImage(canvas, pad, pad);
  return padded;
}

// 글자 영역을 '흰 바탕 위 검은 글자'로 맞추고(색 배너·버튼·회색 칸 포함), 글자 크기에 맞게 배율을 조정한다.
// 같은 크기·여백의 원본 이미지(original)도 함께 돌려줘, 신뢰도가 낮은 줄을 원본에서 다시 읽어 비교할 수 있게 한다.
// opts(비교용): prep 'none'이면 원본 그대로, scale·lines·pad false면 해당 단계 생략, stretch는 ocr-prep.js 참고
function prepareForOcr(src, opts = {}) {
  if (opts.prep === 'none') return { canvas: src, original: null, scale: 1, inkLines: 0 };
  const work = canvasOf(src.width, src.height);
  work.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0);
  const normalize = (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { gray, rowInk } = normalizeForOcr(toGray(img.data, canvas.width, canvas.height), canvas.width, canvas.height, opts);
    return { ctx, img, gray, rowInk };
  };
  let n = normalize(work);
  const textHeight = estimateTextHeight(n.gray, work.width, work.height);
  const scale = opts.scale === false ? 1 : ocrScale(textHeight, work.width, work.height, undefined, opts.target);
  let canvas = work;
  let original = src;
  if (Math.abs(scale - 1) >= 0.05) {
    // 원본을 부드럽게 확대·축소한 뒤 다시 정리한다 (정리된 흑백 이미지를 확대하면 글자 가장자리가 거칠어진다)
    original = canvasOf(Math.round(src.width * scale), Math.round(src.height * scale));
    const octx = original.getContext('2d', { willReadFrequently: true });
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, original.width, original.height);
    canvas = canvasOf(original.width, original.height);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(original, 0, 0);
    n = normalize(canvas);
  }
  if (opts.lines !== false) removeLongLines(n.gray, canvas.width, canvas.height, estimateTextHeight(n.gray, canvas.width, canvas.height));
  const inkLines = textLineStats(n.gray, canvas.width, canvas.height, n.rowInk).count; // 일부만 인식했는지 비교할 기준
  const th = estimateTextHeight(n.gray, canvas.width, canvas.height);
  writeGray(n.gray, n.img.data);
  n.ctx.putImageData(n.img, 0, 0);
  // 가장자리에 붙은 글자도 읽도록 흰 여백을 둔다 (원본도 같은 여백으로 위치를 맞춘다)
  const pad = opts.pad === false ? 0 : Math.max(16, Math.round(Math.max(canvas.width, canvas.height) * 0.02));
  return {
    canvas: padCanvas(canvas, pad), original: padCanvas(original, pad), scale, textHeight, inkLines,
    layout: { gray: n.gray, width: canvas.width, height: canvas.height, pad, th },
  };
}

async function prepareImage(file, opts) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError('image_decode_failed');
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 투명 배경 PNG도 흰 바탕에서 인식
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const prepared = prepareForOcr(canvas, opts);
  opts.onPrepared?.(prepared.canvas); // 비교 도구에서 전처리 결과를 확인할 때만 사용
  return prepared;
}

async function renderPdfPage(page) {
  const base = page.getViewport({ scale: 1 });
  // OCR에 충분한 해상도(긴 변 약 2000px)로 렌더링
  const scale = Math.min(3, 2000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  return prepareForOcr(canvas);
}

async function openPdf(pdfjs, data) {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${VENDOR}/pdfjs/cmaps/`,
    cMapPacked: true,
    isEvalSupported: false,
  });
  try {
    return { task, doc: await task.promise };
  } catch (err) {
    task.destroy();
    if (err?.name === 'PasswordException') throw new UploadError('encrypted_pdf');
    throw new UploadError('invalid_pdf');
  }
}

// S-03 원본 미리보기: PDF 각 쪽을 화면 표시용 이미지(blob URL)로 만든다. 파일은 브라우저 밖으로 보내지 않는다.
// 다 쓴 URL은 호출한 쪽에서 URL.revokeObjectURL로 해제한다.
export async function renderPdfPreview(file, maxWidth = 1000) {
  const pdfjs = await loadPdfjs();
  const { task, doc } = await openPdf(pdfjs, new Uint8Array(await file.arrayBuffer()));
  const urls = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) urls.push(URL.createObjectURL(blob));
    }
    return urls;
  } catch (err) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw err;
  } finally {
    await task.destroy();
  }
}

// 파일 크기와 앞부분 바이트로 형식을 검사한다 (파일 내용을 읽어 서버로 보내지 않음).
export async function inspectFile(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return checkFile({ size: file.size, head });
}

// 여러 장의 이미지를 주어진 순서대로 OCR해 하나의 문서로 합친다. 일부가 실패해도 나머지 결과는 돌려준다.
// onProgress({ stage, page, pages }), onItem(index, { ok, code }) 로 진행 상황과 이미지별 결과를 알린다.
// opts: 전처리 비교용 설정 (화면에서는 쓰지 않음, scripts/ocr-bench.mjs 참고)
export async function extractTextFromImages(files, onProgress = () => {}, onItem = () => {}, opts = {}) {
  let worker = null;
  const results = [];
  try {
    for (const [i, file] of files.entries()) {
      onProgress({ stage: 'ocr', page: i + 1, pages: files.length });
      let result;
      try {
        const check = await inspectFile(file);
        if (!check.ok || check.kind === 'pdf') throw new UploadError(check.code ?? 'unsupported_type');
        const prepared = await prepareImage(file, opts);
        if (!worker) worker = await createOcrWorker(onProgress); // 도구를 못 불러오면 전체 중단
        const r = await recognize(worker, prepared, opts);
        result = hasText(r.text) ? { ok: true, ...r } : { ok: false, code: 'no_text_found' };
      } catch (err) {
        if (err?.code === 'library_failed') throw err;
        result = { ok: false, code: err?.code ?? 'extract_failed' };
      }
      results.push(result);
      onItem(i, result);
    }
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
  return combineImageResults(results);
}

// 파일 1개(PDF 또는 이미지 1장)에서 텍스트를 추출한다.
// onProgress({ stage, page, pages, progress }) 로 진행 상황을 알린다.
export async function extractTextFromFile(file, onProgress = () => {}) {
  const check = await inspectFile(file);
  if (!check.ok) throw new UploadError(check.code);

  let worker = null;
  try {
    if (check.kind !== 'pdf') {
      onProgress({ stage: 'image' });
      const prepared = await prepareImage(file);
      worker = await createOcrWorker(onProgress);
      onProgress({ stage: 'ocr', page: 1, pages: 1 });
      const { text, quality, uncertain } = await recognize(worker, prepared);
      if (!hasText(text)) throw new UploadError('no_text_found');
      return { text, kind: check.kind, method: 'ocr', pages: 1, ocrPages: 1, lowConfidence: quality === 'low', uncertain };
    }

    onProgress({ stage: 'pdf-load' });
    const pdfjs = await loadPdfjs();
    const { task, doc } = await openPdf(pdfjs, new Uint8Array(await file.arrayBuffer()));
    try {
      if (doc.numPages > MAX_PDF_PAGES) throw new UploadError('too_many_pages');
      const pageTexts = [];
      const scanned = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        onProgress({ stage: 'pdf-text', page: n, pages: doc.numPages });
        const page = await doc.getPage(n);
        const text = pageTextFromItems((await page.getTextContent()).items);
        pageTexts.push(text);
        if (needsOcr(text)) scanned.push(n);
      }
      if (scanned.length > MAX_OCR_PAGES) throw new UploadError('too_many_scanned_pages');

      let lowConfidence = false;
      const uncertain = [];
      if (scanned.length) {
        worker = await createOcrWorker(onProgress);
        for (const [k, n] of scanned.entries()) {
          onProgress({ stage: 'ocr', page: k + 1, pages: scanned.length });
          const prepared = await renderPdfPage(await doc.getPage(n));
          const r = await recognize(worker, prepared);
          pageTexts[n - 1] = r.text;
          if (hasText(r.text) && r.quality === 'low') lowConfidence = true;
          if (hasText(r.text)) uncertain.push(...r.uncertain);
        }
      }
      const text = joinPages(pageTexts);
      if (!hasText(text)) throw new UploadError('no_text_found');
      const method = !scanned.length ? 'pdf-text' : scanned.length === doc.numPages ? 'ocr' : 'mixed';
      return { text, kind: 'pdf', method, pages: doc.numPages, ocrPages: scanned.length, lowConfidence, uncertain: [...new Set(uncertain)].slice(0, 6) };
    } finally {
      await task.destroy(); // 문서와 pdf.js worker 자원 해제
    }
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw Object.assign(new UploadError('extract_failed'), { cause: err });
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}
