// 파일 업로드 규칙과 텍스트 정리 함수 (브라우저와 Node 테스트에서 함께 사용, DOM·라이브러리 의존 없음)

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_PDF_PAGES = 10;
export const MAX_OCR_PAGES = 5; // 글자 인식(OCR)은 느려서 스캔 쪽수를 따로 제한
export const MIN_PAGE_TEXT_CHARS = 20; // 이보다 글자가 적은 PDF 쪽은 스캔 이미지로 보고 OCR
export const LOW_CONFIDENCE = 60; // OCR 평균 신뢰도(0~100)가 이보다 낮으면 주의 안내
export const UNCERTAIN_NUMBER_BELOW = 75; // 숫자가 든 단어의 신뢰도가 이보다 낮으면 '확인할 숫자'로 알린다
export const MAX_IMAGE_SIDE = 3000; // OCR 전에 긴 변을 이 크기로 줄인다 (메모리·속도)
export const MAX_IMAGES = 5; // 같은 문서의 연속 캡처로 보고 한 번에 처리하는 이미지 수

export const UPLOAD_MESSAGES = {
  too_large: `파일이 너무 커요. ${MAX_FILE_BYTES / 1024 / 1024}MB 이하 파일만 올릴 수 있어요.`,
  empty: '빈 파일이에요. 다른 파일을 선택해 주세요.',
  unsupported_type: 'JPG, PNG, WebP 이미지나 PDF 파일만 올릴 수 있어요.',
  encrypted_pdf: '암호가 걸린 PDF는 열 수 없어요. 암호를 해제한 PDF나 화면 캡처 이미지를 올려 주세요.',
  invalid_pdf: 'PDF 파일을 열지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.',
  too_many_pages: `PDF는 ${MAX_PDF_PAGES}쪽까지 읽을 수 있어요. 필요한 쪽만 나눠서 올려 주세요.`,
  too_many_scanned_pages: `스캔된(이미지로 된) 쪽은 ${MAX_OCR_PAGES}쪽까지 글자 인식할 수 있어요. 필요한 쪽만 나눠서 올려 주세요.`,
  no_text_found: '파일에서 글자를 찾지 못했어요. 더 선명한 이미지를 올리거나 내용을 직접 붙여넣어 주세요.',
  image_decode_failed: '이미지를 열지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.',
  library_failed: '파일을 읽는 도구를 불러오지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
  extract_failed: '파일에서 텍스트를 추출하지 못했어요. 내용을 직접 붙여넣어 주세요.',
  too_many_images: `이미지는 한 번에 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`,
  multiple_pdfs: 'PDF는 한 번에 1개만 올릴 수 있어요.',
  pdf_with_images: 'PDF는 이미지와 함께 올릴 수 없어요. PDF만 따로 올리거나 이미지 목록을 비워 주세요.',
  all_images_failed: '이미지에서 글자를 찾지 못했어요. 더 선명한 이미지를 올리거나 내용을 직접 입력해 주세요.',
};

// 파일 앞부분 바이트(시그니처)로 형식을 판별한다. 확장자·MIME은 바꿀 수 있어 믿지 않는다.
export function detectFileKind(bytes) {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf'; // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'; // RIFF....WEBP
  return null;
}

// 크기와 형식을 검사한다. head: 파일 앞 16바이트
export function checkFile({ size, head }) {
  if (!size) return { ok: false, code: 'empty' };
  if (size > MAX_FILE_BYTES) return { ok: false, code: 'too_large' };
  const kind = detectFileKind(head);
  if (!kind) return { ok: false, code: 'unsupported_type' };
  return { ok: true, kind };
}

const countChars = (text) => text.replace(/\s/g, '').length;

// pdf.js getTextContent()의 items를 줄 단위 텍스트로 만든다. 줄 끝(hasEOL)을 줄바꿈으로 보존한다.
export function pageTextFromItems(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue; // 표시용 구간 정보 등은 건너뜀
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return tidyText(text);
}

export function needsOcr(pageText) {
  return countChars(pageText) < MIN_PAGE_TEXT_CHARS;
}

// OCR이 칸 사이 넓은 빈 곳·버튼 테두리에서 만들어 내는 기호 조각('_', '|', '、')만 지운다.
// 글자·숫자·'~'·'-' 같은 내용 기호는 건드리지 않으며, 다른 글자에 붙은 기호도 그대로 둔다.
const OCR_JUNK_TOKEN = /(^|[ \t])[_|¦、]+(?=[ \t]|$)/g;
export function stripOcrJunk(text) {
  return text.split('\n').map((line) => line.replace(OCR_JUNK_TOKEN, '$1').replace(/[ \t]{2,}/g, ' ')).join('\n');
}

// 줄 끝 공백 제거, 3줄 이상 연속 빈 줄은 1줄로. 줄 순서와 내용은 바꾸지 않는다.
export function tidyText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+$/g, '').replace(/^[ \t ]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function joinPages(pageTexts) {
  return pageTexts.map(tidyText).filter((t) => t).join('\n\n');
}

export function hasText(text) {
  return countChars(text) > 0;
}

// 긴 변이 MAX_IMAGE_SIDE를 넘으면 줄일 크기를 계산한다.
export function fitSize(width, height, maxSide = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

// 새로 고른 파일들을 이미지 목록에 넣을지, PDF 1개로 처리할지 정한다.
// checked: [{ name, check: checkFile() 결과 }], queuedCount: 이미 목록에 있는 이미지 수
// 반환: { pdf } | { images, overflow } | { error }, 그리고 형식·크기 검사에서 빠진 파일(rejected)
export function planSelection(checked, queuedCount) {
  const rejected = checked.filter((c) => !c.check.ok).map((c) => ({ name: c.name, code: c.check.code }));
  const pdfs = checked.filter((c) => c.check.ok && c.check.kind === 'pdf');
  const images = checked.filter((c) => c.check.ok && c.check.kind !== 'pdf');
  if (pdfs.length > 1) return { error: 'multiple_pdfs', rejected };
  if (pdfs.length === 1) {
    if (images.length || queuedCount) return { error: 'pdf_with_images', rejected };
    return { pdf: pdfs[0], rejected };
  }
  const room = Math.max(0, MAX_IMAGES - queuedCount);
  return { images: images.slice(0, room), overflow: Math.max(0, images.length - room), rejected };
}

// 목록에서 index 항목을 delta(-1 위로, +1 아래로)만큼 옮긴 새 배열
export function moveItem(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list.slice();
  const next = list.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// 이미지 1장의 OCR 결과를 평가한다. 인식한 글자는 고치지 않고, 사용자가 원본과 비교해 확인할 곳만 알려 준다.
//   words: [{ text, confidence }], confidence: 평균 신뢰도, lines: 인식한 줄 수, inkLines: 이미지에서 찾은 글자 줄 수
// 반환: { quality: 'good' | 'check'(확인할 숫자·글자 있음) | 'low'(신뢰도 낮음·일부만 인식), uncertain: [단어, 안내용 최대 6개], uncertainAll: [단어 전체], partial }
// uncertain: 신뢰도가 낮거나 형태가 이상한 숫자, 한글 문서에서 신뢰도 낮게 영문으로 읽힌 단어 (인식한 그대로)
const MIXED_NUMBER = /\d[OoIlS|]|[OoIlS|]\d/; // 숫자 사이에 섞인 비슷한 모양의 글자 (예: 2O27, 1l:00)
// 날짜·시간에 없는 형태 (예: 2027.12.31에서 점이 빠진 202712.31, 18:300)
const ODD_NUMBER = /\d{5,}[.:/]\d|\d[.:/]\d{5,}|\d:\d{3}/;
const UNSURE_WORD_BELOW = 50; // 한글 문서에서 영문처럼 읽힌 단어의 신뢰도가 이보다 낮으면 알린다 (예: '스낵바' → 'Addl')
export function reviewOcr({ words = [], confidence = 0, lines = 0, inkLines = 0 }) {
  const hangulDoc = words.filter((w) => /[가-힣]/.test(w.text)).length > words.length / 2;
  // S-03 저신뢰 구간 추적에는 전체 목록(uncertainAll)을 쓰고, 안내 문구에만 앞의 6개(uncertain)를 쓴다
  const uncertainAll = [...new Set(words
    .filter((w) => (/\d/.test(w.text) && (w.confidence < UNCERTAIN_NUMBER_BELOW || MIXED_NUMBER.test(w.text) || ODD_NUMBER.test(w.text)))
      || (hangulDoc && /^[A-Za-z]{2,}$/.test(w.text.replace(/[^\w]/g, '')) && w.confidence < UNSURE_WORD_BELOW))
    .map((w) => w.text.trim()))];
  const uncertain = uncertainAll.slice(0, 6);
  const partial = inkLines >= 3 && lines < inkLines * 0.6;
  const quality = confidence < LOW_CONFIDENCE || partial ? 'low' : uncertain.length ? 'check' : 'good';
  return { quality, uncertain, uncertainAll, partial };
}

// 이미지별 OCR 결과를 사용자가 정한 순서대로 하나의 문서로 합친다.
// results: [{ ok: true, text, confidence, quality, uncertain } | { ok: false, code }] (목록 순서)
// review: 확인이 필요한 이미지 [{ index, quality, uncertain }]
export function combineImageResults(results) {
  const okTexts = [];
  const failed = [];
  const review = [];
  const uncertainAll = [];
  results.forEach((r, index) => {
    if (r.ok && hasText(r.text)) {
      okTexts.push(r.text);
      uncertainAll.push(...(r.uncertainAll ?? r.uncertain ?? []));
      const quality = r.quality ?? (r.confidence < LOW_CONFIDENCE ? 'low' : 'good');
      if (quality !== 'good') review.push({ index, quality, uncertain: r.uncertain ?? [] });
    } else {
      failed.push({ index, code: r.ok ? 'no_text_found' : r.code });
    }
  });
  return {
    text: joinPages(okTexts),
    okCount: okTexts.length,
    failed,
    review,
    lowConfidence: review.some((r) => r.quality === 'low'),
    uncertainAll: [...new Set(uncertainAll)],
  };
}
