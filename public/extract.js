// 업로드한 파일에서 텍스트를 추출한다. 모든 처리는 브라우저 안에서 하며 파일을 서버로 보내지 않는다.
// - 일반 PDF: pdf.js로 텍스트 레이어 추출
// - 이미지(JPG·PNG·WebP)와 스캔 PDF 쪽: Tesseract.js로 한국어·영어 글자 인식(OCR)
// 라이브러리는 같은 사이트의 /vendor/에서 처음 사용할 때만 불러온다.
import {
  UPLOAD_MESSAGES, MAX_PDF_PAGES, MAX_OCR_PAGES, LOW_CONFIDENCE,
  checkFile, pageTextFromItems, needsOcr, joinPages, hasText, tidyText, fitSize,
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
  return { text: tidyText(data.text ?? ''), confidence: data.confidence ?? 0 };
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

// onProgress({ stage, page, pages, progress }) 로 진행 상황을 알린다.
export async function extractTextFromFile(file, onProgress = () => {}) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const check = checkFile({ size: file.size, head });
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
