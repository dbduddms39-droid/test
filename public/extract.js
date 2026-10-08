// 업로드한 파일에서 텍스트를 추출한다. 모든 처리는 브라우저 안에서 하며 파일을 서버로 보내지 않는다.
// - 일반 PDF: pdf.js로 텍스트 레이어 추출
// - 이미지(JPG·PNG·WebP)와 스캔 PDF 쪽: Tesseract.js로 한국어·영어 글자 인식(OCR)
// 라이브러리는 같은 사이트의 /vendor/에서 처음 사용할 때만 불러온다.
import {
  UPLOAD_MESSAGES, MAX_PDF_PAGES, MAX_OCR_PAGES, LOW_CONFIDENCE,
  checkFile, pageTextFromItems, needsOcr, joinPages, hasText, tidyText, fitSize, combineImageResults,
} from './upload-rules.js';

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

async function ocr(worker, image) {
  const { data } = await worker.recognize(image);
  // 표의 칸 사이 넓은 공백은 한 칸으로 줄인다 (줄 순서·내용은 그대로)
  return { text: tidyText((data.text ?? '').replace(/[ \t]{2,}/g, ' ')), confidence: data.confidence ?? 0 };
}

// 어두운 배경 위 밝은 글자(앱 캡처의 색 머리글 등)는 OCR이 놓치기 쉽다.
// 밝은 줄과 어두운 줄이 섞인 이미지에서만 어두운 가로 줄을 반전해 '밝은 바탕 위 어두운 글자'로 만든다.
// 전체가 어두운 사진(어두운 곳에서 찍은 문서 등)은 반전하지 않는다.
function invertDarkBands(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  // 줄마다 배경 밝기: 표본(최대 400점)의 중앙값 (글자 픽셀보다 배경 픽셀이 많다)
  const rowLum = new Float32Array(height);
  const step = Math.max(1, Math.floor(width / 400));
  const samples = new Float32Array(Math.ceil(width / step));
  for (let y = 0; y < height; y += 1) {
    let n = 0;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      samples[n] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n += 1;
    }
    rowLum[y] = samples.subarray(0, n).sort()[n >> 1];
  }
  const brightRows = rowLum.filter((l) => l > 170).length;
  const darkRows = rowLum.filter((l) => l < 100).length;
  if (darkRows === 0 || brightRows < height * 0.3) return false;
  for (let y = 0; y < height; y += 1) {
    if (rowLum[y] >= 100) continue;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

async function imageToCanvas(file) {
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
  invertDarkBands(canvas);
  return canvas;
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
  invertDarkBands(canvas);
  return canvas;
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

// 파일 크기와 앞부분 바이트로 형식을 검사한다 (파일 내용을 읽어 서버로 보내지 않음).
export async function inspectFile(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return checkFile({ size: file.size, head });
}

// 여러 장의 이미지를 주어진 순서대로 OCR해 하나의 문서로 합친다. 일부가 실패해도 나머지 결과는 돌려준다.
// onProgress({ stage, page, pages }), onItem(index, { ok, code }) 로 진행 상황과 이미지별 결과를 알린다.
export async function extractTextFromImages(files, onProgress = () => {}, onItem = () => {}) {
  let worker = null;
  const results = [];
  try {
    for (const [i, file] of files.entries()) {
      onProgress({ stage: 'ocr', page: i + 1, pages: files.length });
      let result;
      try {
        const check = await inspectFile(file);
        if (!check.ok || check.kind === 'pdf') throw new UploadError(check.code ?? 'unsupported_type');
        const canvas = await imageToCanvas(file);
        if (!worker) worker = await createOcrWorker(onProgress); // 도구를 못 불러오면 전체 중단
        const { text, confidence } = await ocr(worker, canvas);
        result = hasText(text) ? { ok: true, text, confidence } : { ok: false, code: 'no_text_found' };
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
      const canvas = await imageToCanvas(file);
      worker = await createOcrWorker(onProgress);
      onProgress({ stage: 'ocr', page: 1, pages: 1 });
      const { text, confidence } = await ocr(worker, canvas);
      if (!hasText(text)) throw new UploadError('no_text_found');
      return { text, kind: check.kind, method: 'ocr', pages: 1, ocrPages: 1, lowConfidence: confidence < LOW_CONFIDENCE };
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
      if (scanned.length) {
        worker = await createOcrWorker(onProgress);
        for (const [k, n] of scanned.entries()) {
          onProgress({ stage: 'ocr', page: k + 1, pages: scanned.length });
          const canvas = await renderPdfPage(await doc.getPage(n));
          const { text, confidence } = await ocr(worker, canvas);
          pageTexts[n - 1] = text;
          if (hasText(text) && confidence < LOW_CONFIDENCE) lowConfidence = true;
        }
      }
      const text = joinPages(pageTexts);
      if (!hasText(text)) throw new UploadError('no_text_found');
      const method = !scanned.length ? 'pdf-text' : scanned.length === doc.numPages ? 'ocr' : 'mixed';
      return { text, kind: 'pdf', method, pages: doc.numPages, ocrPages: scanned.length, lowConfidence };
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
