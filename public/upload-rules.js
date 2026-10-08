// 파일 업로드 규칙과 텍스트 정리 함수 (브라우저와 Node 테스트에서 함께 사용, DOM·라이브러리 의존 없음)

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_PDF_PAGES = 10;
export const MAX_OCR_PAGES = 5; // 글자 인식(OCR)은 느려서 스캔 쪽수를 따로 제한
export const MIN_PAGE_TEXT_CHARS = 20; // 이보다 글자가 적은 PDF 쪽은 스캔 이미지로 보고 OCR
export const LOW_CONFIDENCE = 60; // OCR 평균 신뢰도(0~100)가 이보다 낮으면 주의 안내
export const MAX_IMAGE_SIDE = 3000; // OCR 전에 긴 변을 이 크기로 줄인다 (메모리·속도)

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
