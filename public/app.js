import { moveItem, planSelection, UPLOAD_MESSAGES, MAX_IMAGES } from './upload-rules.js';
import { buildQuestion, copyText } from './questions.js';
import { el, statusBadge } from './components.js';
import { ROUTES, checkText, editRouteFor, resolveRoute, classifyAnalyzeFailure } from './flow.js';

// 일단확인 클라이언트.
// 입력 원문·추출 텍스트·분석 결과는 이 창의 메모리에만 둔다(브라우저 저장소·URL에 남기지 않음).
// 앱 안에서 화면을 옮기거나 뒤로 가기를 해도 유지되지만, 새로고침하거나 창을 닫으면 사라진다.
const STATUS_ORDER = ['stated', 'unclear', 'not_found', 'unavailable'];
const STATUS_LABEL = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가' };
const EXTRACTED_NOTE = {
  ocr: '이미지·스캔 문서에서 글자를 인식(OCR)한 뒤 확인·수정한 텍스트 기준의 결과예요. 글자 인식은 원본과 완전히 같다고 보장할 수 없으니, 중요한 내용은 원본 파일에서 다시 확인해 주세요.',
  pdf: 'PDF에서 추출한 뒤 확인·수정한 텍스트 기준의 결과예요. 추출 과정에서 줄 순서나 표 내용이 원본과 다를 수 있으니, 중요한 내용은 원본 파일에서 다시 확인해 주세요.',
};
const ROUTE_NOTICE = {
  no_result: '확인할 분석 결과가 없어요. 새로고침하거나 창을 닫으면 입력 내용과 결과가 사라져요. 문서를 다시 입력해 주세요.',
  no_review: '확인할 추출 텍스트가 없어요. 파일을 다시 올려 텍스트를 추출해 주세요.',
  aborted: '분석을 중단했어요. 입력한 내용은 그대로 있어요.',
};
const SUBMIT_HINT = {
  empty: '20자 이상 입력해 주세요.',
  too_short: '20자 이상 입력해 주세요.',
  too_long: '20,000자 이하로 줄여 주세요.',
  ok: '입력한 문서의 근로조건을 항목별 확인 결과로 정리해 드려요.',
};
// '가상 예시 넣어보기'에 쓰는 가상 문서 (실제 회사·인물 정보 없음)
const EXAMPLE_TEXT = [
  '[가상 예시] 최종합격을 축하드립니다.',
  '고용형태: 정규직',
  '연봉: 3,600만원',
  '근무시간: 주 5일, 09:00~18:00',
  '근무장소: 서울 소재 사업장',
  '담당업무: 콘텐츠 기획 및 SNS 채널 운영',
  '수습기간: 3개월',
  '수습 중 급여: 별도 협의',
  '연차 유급휴가: 회사 내규에 따름',
  '상세 근로조건은 입사 시 안내드립니다.',
].join('\n');

const state = {
  tab: 'paste',     // S-02에서 고른 입력 방식
  file: null,       // 파일 추출 결과 { source: 'ocr'|'pdf', original, previews: [{ url, name }], imagesVersion, ownUrls }
  last: null,       // 마지막으로 분석을 요청한 { docType, text, inputSource } — S-07 재시도·수정에 사용
  inflight: null,   // 진행 중인 분석 { controller }
  error: null,      // S-07에 보여 줄 { message }
};
let result = null;

const $ = (sel) => document.querySelector(sel);
const badge = (status) => statusBadge(status, STATUS_LABEL[status]);
const docType = () => document.querySelector('input[name=docType]:checked').value;
const go = (hash, replace = false) => { if (replace) location.replace(hash); else location.hash = hash; };
const showMsg = (node, text) => { node.textContent = text; node.hidden = !text; };

// 탭: 클릭과 방향키(←→, Home, End)로 이동하고, 선택된 탭만 Tab 키 순서에 둔다.
function initTabs(tabs, onSelect) {
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    if (focus) tab.focus();
    onSelect(tab);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });
  });
  return select;
}

// ---------- S-01 시작 ----------
$('#landing-how').addEventListener('click', () => {
  const target = $('#landing-workflow');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
});

// ---------- S-02 문서 입력 ----------
const textarea = $('#doc-text');
const submitBtn = $('#submit-btn');
const inputError = $('#input-error');

function updatePasteState() {
  $('#char-count').textContent = textarea.value.length.toLocaleString();
  const c = checkText(textarea.value);
  submitBtn.disabled = !c.ok || Boolean(state.inflight);
  $('#submit-hint').textContent = SUBMIT_HINT[c.ok ? 'ok' : c.code];
}
textarea.addEventListener('input', () => { inputError.hidden = true; updatePasteState(); });

$('#example-btn').addEventListener('click', () => {
  if (textarea.value.trim() && textarea.value !== EXAMPLE_TEXT && !confirm('입력란의 내용을 가상 예시로 바꿀까요?')) return;
  textarea.value = EXAMPLE_TEXT;
  updatePasteState();
  textarea.focus();
});
$('#clear-text').addEventListener('click', () => {
  if (textarea.value.trim() && !confirm('입력란의 내용을 모두 지울까요?')) return;
  textarea.value = '';
  updatePasteState();
  textarea.focus();
});

const selectMethod = initTabs([$('#tab-paste'), $('#tab-upload')], (tab) => {
  state.tab = tab.id === 'tab-upload' ? 'upload' : 'paste';
  $('#panel-paste').hidden = state.tab !== 'paste';
  $('#panel-upload').hidden = state.tab !== 'upload';
  $('#paste-submit-row').hidden = state.tab !== 'paste';
  inputError.hidden = true;
});

// 직접 입력: S-02 → S-04
$('#input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.tab !== 'paste') return;
  const text = textarea.value;
  const c = checkText(text);
  if (!c.ok) return showMsg(inputError, c.code === 'too_long' ? '문서는 20,000자 이하로 입력해 주세요.' : '문서 내용을 20자 이상 입력해 주세요.');
  startAnalysis({ docType: docType(), text, inputSource: 'paste' });
});

// ---------- 파일 업로드 → 브라우저 안에서 텍스트 추출 → S-03 ----------
// - 이미지: 최대 5장을 같은 문서의 연속 캡처로 보고, 사용자가 정한 순서대로 OCR해 하나로 합친다.
// - PDF: 1개씩 처리한다.
// - 추출에 실패하면 S-02에 머물며 이유를 알린다(분석 실패와 구분). 파일은 서버로 보내지 않는다.
const fileInput = $('#file-input');
const uploadStatus = $('#upload-status');
const imagePanel = $('#image-panel');
const imageList = $('#image-list');
const extractBtn = $('#extract-btn');
const ITEM_FAIL_TEXT = {
  no_text_found: '글자를 찾지 못했어요',
  image_decode_failed: '이미지를 열지 못했어요',
  unsupported_type: '지원하지 않는 형식이에요',
  extract_failed: '글자를 읽지 못했어요',
};
// 인식은 됐지만 원본과 비교해 확인이 필요한 이미지 (글자를 고치지 않고 확인할 곳만 알림)
const ITEM_REVIEW_TEXT = {
  low: '일부만 읽혔거나 인식이 불확실해요. 원본과 꼭 비교해 주세요',
  check: '확인할 숫자·글자가 있어요',
};
const uncertainNote = (list) => (list.length ? `인식이 불확실한 부분: ${list.map((t) => `'${t}'`).join(', ')}. 원본 이미지와 비교해 고쳐 주세요.` : '');
const PROGRESS_TEXT = {
  image: '이미지를 여는 중…',
  'pdf-load': 'PDF를 여는 중…',
  'pdf-text': (p) => `PDF ${p.page}/${p.pages}쪽 텍스트를 읽는 중…`,
  'ocr-load': '글자 인식 도구를 준비하는 중… (처음 한 번은 몇 MB를 내려받아 시간이 걸려요)',
  ocr: (p) => `글자를 인식하는 중… ${p.page}/${p.pages}`,
};
const reviewNote = '원본 파일과 다른 부분이 있을 수 있으니 원본과 비교해 확인·수정한 뒤 분석해 주세요.';
const onProgress = (p) => {
  const t = PROGRESS_TEXT[p.stage];
  if (t) showUploadStatus(typeof t === 'function' ? t(p) : t);
};
const setStatus = (node, text, kind) => {
  node.textContent = text;
  node.className = `upload-status upload-status-${kind}`;
  node.hidden = false;
};
const showUploadStatus = (text, kind = 'info') => setStatus(uploadStatus, text, kind);
const loadExtractor = () => import('./extract.js');

let images = []; // { id, file, url, fail, quality }
let nextImageId = 1;
let imagesVersion = 0; // 이미지 목록이 바뀔 때마다 증가 (추출 이후 목록이 바뀌었는지 S-03에서 알림)
let busy = false;

function setBusy(on) {
  busy = on;
  fileInput.disabled = on;
  renderImages();
}

function renderImages() {
  imagePanel.hidden = images.length === 0;
  extractBtn.textContent = `이미지 ${images.length}장에서 텍스트 추출`;
  extractBtn.disabled = busy || images.length === 0;
  $('#clear-images').disabled = busy;
  imageList.replaceChildren(...images.map((img, i) => {
    const btn = (label, action, disabled) => {
      const b = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${i + 1}번째 이미지 ${label}`, 'data-action': action, 'data-index': String(i) }, label);
      b.disabled = busy || disabled;
      return b;
    };
    const review = !img.fail && img.quality && img.quality !== 'good' ? ITEM_REVIEW_TEXT[img.quality] : null;
    return el('li', { class: `image-item${img.fail ? ' image-item-failed' : review ? ' image-item-review' : ''}` },
      el('img', { src: img.url, alt: `${i + 1}번째 이미지 미리보기`, class: 'image-thumb' }),
      el('div', { class: 'image-meta' },
        el('span', { class: 'image-order' }, `${i + 1}`),
        el('span', { class: 'image-name' }, img.file.name),
        img.fail ? el('span', { class: 'image-fail' }, ITEM_FAIL_TEXT[img.fail] ?? ITEM_FAIL_TEXT.extract_failed) : null,
        review ? el('span', { class: 'image-review' }, review) : null),
      el('div', { class: 'image-buttons' },
        btn('위로', 'up', i === 0),
        btn('아래로', 'down', i === images.length - 1),
        btn('삭제', 'remove', false)));
  }));
}

// S-03 미리보기가 쓰는 이미지 URL은 목록에서 지워도 추출 결과를 바꿀 때까지 해제하지 않는다.
const inPreview = (url) => Boolean(state.file?.previews.some((p) => p.url === url));
function releaseImage(img) { if (!inPreview(img.url)) URL.revokeObjectURL(img.url); }

imageList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b || busy) return;
  const i = Number(b.dataset.index);
  if (b.dataset.action === 'up') images = moveItem(images, i, -1);
  if (b.dataset.action === 'down') images = moveItem(images, i, 1);
  if (b.dataset.action === 'remove') {
    releaseImage(images[i]);
    images = images.filter((_, k) => k !== i);
  }
  imagesVersion += 1;
  renderImages();
  showQueueStatus();
});

function showQueueStatus() {
  if (!images.length) { uploadStatus.hidden = true; return; }
  showUploadStatus(`이미지 ${images.length}장 (최대 ${MAX_IMAGES}장). 순서를 확인한 뒤 '텍스트 추출'을 눌러 주세요.`);
}

$('#clear-images').addEventListener('click', () => {
  if (busy) return;
  images.forEach(releaseImage);
  images = [];
  imagesVersion += 1;
  renderImages();
  uploadStatus.hidden = true;
});

// 추출 결과를 S-03 확인 텍스트로 둔다. 확인·수정하던 텍스트가 있으면 바꿀지 먼저 묻는다(취소하면 그대로 둠).
// 직접 입력란(S-02)의 내용은 건드리지 않는다.
function applyExtracted(text, source, previews, ownUrls = []) {
  const reviewText = $('#review-text');
  if (state.file && reviewText.value.trim() && reviewText.value !== state.file.original
    && !confirm('확인·수정하던 추출 텍스트를 새로 추출한 내용으로 바꿀까요?')) {
    ownUrls.forEach((u) => URL.revokeObjectURL(u));
    return false;
  }
  const old = state.file;
  state.file = { source, original: text, previews, imagesVersion, ownUrls };
  if (old) {
    old.ownUrls.forEach((u) => URL.revokeObjectURL(u));
    // 목록에서 이미 지운 이미지의 URL은 이제 해제한다
    old.previews.filter((p) => !images.some((img) => img.url === p.url) && !old.ownUrls.includes(p.url)).forEach((p) => URL.revokeObjectURL(p.url));
  }
  reviewText.value = text;
  preview.page = 0;
  preview.zoom = 100;
  return true;
}

function finishExtraction(msg, kind) {
  showUploadStatus(msg, kind);
  setStatus($('#review-status'), msg, kind);
  $('#review-notice').hidden = true;
  go(ROUTES.review);
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length || busy) return;
  const { inspectFile } = await loadExtractor();
  const checked = await Promise.all(files.map(async (file) => ({ name: file.name, file, check: await inspectFile(file) })));
  const plan = planSelection(checked, images.length);
  const notes = plan.rejected.map((r) => `${r.name}: ${UPLOAD_MESSAGES[r.code]}`);

  if (plan.error) return showUploadStatus([UPLOAD_MESSAGES[plan.error], ...notes].join(' '), 'error');
  if (plan.pdf) return extractPdf(plan.pdf.file, notes);

  for (const c of plan.images) images.push({ id: nextImageId++, file: c.file, url: URL.createObjectURL(c.file), fail: null });
  if (plan.images.length) imagesVersion += 1;
  if (plan.overflow) notes.push(`${UPLOAD_MESSAGES.too_many_images} ${plan.overflow}장은 추가하지 않았어요.`);
  renderImages();
  if (plan.images.length) {
    showUploadStatus([`이미지 ${images.length}장 (최대 ${MAX_IMAGES}장). 순서를 확인한 뒤 '텍스트 추출'을 눌러 주세요.`, ...notes].join(' '), notes.length ? 'warn' : 'info');
  } else if (notes.length) {
    showUploadStatus(notes.join(' '), 'error');
  }
}

async function extractPdf(file, notes = []) {
  setBusy(true);
  showUploadStatus('PDF를 확인하는 중…');
  try {
    const { extractTextFromFile, renderPdfPreview } = await loadExtractor();
    const out = await extractTextFromFile(file, onProgress);
    const urls = await renderPdfPreview(file).catch(() => []); // 미리보기 실패는 추출 결과에 영향 없음
    const previews = urls.map((url) => ({ url, name: file.name }));
    if (!applyExtracted(out.text, out.method === 'pdf-text' ? 'pdf' : 'ocr', previews, urls)) {
      return showUploadStatus('확인·수정하던 추출 텍스트를 그대로 두었어요. 새로 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    }
    const what = out.method === 'pdf-text' ? `PDF ${out.pages}쪽에서 텍스트를 추출했어요.`
      : `PDF ${out.pages}쪽에서 텍스트를 추출했어요 (스캔된 ${out.ocrPages}쪽은 글자 인식).`;
    const msg = [what, reviewNote, ...notes];
    if (out.method !== 'pdf-text') msg.push('글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    if (out.lowConfidence) msg.push('인식 정확도가 낮아 보여요. 숫자(금액·날짜·시간)를 특히 꼼꼼히 확인해 주세요.');
    if (out.uncertain?.length) msg.push(uncertainNote(out.uncertain));
    if (out.text.length > 20000) msg.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    finishExtraction(msg.join(' '), out.lowConfidence || out.uncertain?.length || notes.length ? 'warn' : 'done');
  } catch (err) {
    showUploadStatus(err?.code ? err.message : '파일에서 텍스트를 추출하지 못했어요. 내용을 직접 붙여넣어 주세요.', 'error');
  } finally {
    setBusy(false);
  }
}

extractBtn.addEventListener('click', async () => {
  if (busy || !images.length) return;
  images.forEach((img) => { img.fail = null; img.quality = null; });
  setBusy(true);
  showUploadStatus('이미지를 확인하는 중…');
  try {
    const { extractTextFromImages } = await loadExtractor();
    const out = await extractTextFromImages(images.map((img) => img.file), onProgress, (i, r) => {
      images[i].fail = r.ok ? null : r.code;
      images[i].quality = r.ok ? r.quality : null;
    });
    if (!out.okCount) {
      return showUploadStatus('이미지에서 글자를 찾지 못했어요. 더 선명한 이미지로 바꾸거나 텍스트 직접 붙여넣기로 입력해 주세요.', 'error');
    }
    const previews = images.map((img) => ({ url: img.url, name: img.file.name }));
    if (!applyExtracted(out.text, 'ocr', previews)) return showUploadStatus('확인·수정하던 추출 텍스트를 그대로 두었어요. 새로 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    const msg = [`이미지 ${images.length}장 중 ${out.okCount}장에서 글자를 인식해 순서대로 합쳤어요.`];
    if (out.failed.length) {
      msg.push(`${out.failed.map((f) => `${f.index + 1}번째`).join(', ')} 이미지는 ${out.failed.length === 1 ? ITEM_FAIL_TEXT[out.failed[0].code] ?? '읽지 못했어요' : '읽지 못했어요'}. 그 부분은 직접 입력하거나 다른 이미지로 바꿔 주세요.`);
    }
    msg.push(reviewNote, '글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    const low = out.review.filter((r) => r.quality === 'low');
    if (low.length) msg.push(`${low.map((r) => `${r.index + 1}번째`).join(', ')} 이미지는 일부만 읽혔거나 인식이 불확실해요. 원본과 꼭 비교해 빠진 내용을 채워 주세요.`);
    const uncertain = [...new Set(out.review.flatMap((r) => r.uncertain))].slice(0, 6);
    if (uncertain.length) msg.push(uncertainNote(uncertain));
    if (out.text.length > 20000) msg.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    finishExtraction(msg.join(' '), out.failed.length || out.review.length ? 'warn' : 'done');
  } catch (err) {
    showUploadStatus(err?.code ? `${err.message} 입력한 내용은 그대로 두었어요.` : '텍스트를 추출하지 못했어요. 입력한 내용은 그대로 두었어요.', 'error');
  } finally {
    setBusy(false);
  }
});

fileInput.addEventListener('change', async () => {
  const files = fileInput.files;
  await addFiles(files);
  fileInput.value = ''; // 같은 파일을 다시 고를 수 있게
});
const drop = $('#upload-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); addFiles(e.dataTransfer.files); });

// ---------- S-03 추출본 확인 ----------
const reviewText = $('#review-text');
const reviewSubmit = $('#review-submit');
const reviewError = $('#review-error');
const preview = { page: 0, zoom: 100 };

function updateReviewState() {
  const v = reviewText.value;
  $('#review-chars').textContent = v.length.toLocaleString();
  $('#review-lines').textContent = String(v ? v.split('\n').length : 0);
  reviewSubmit.disabled = !state.file || !checkText(v).ok || Boolean(state.inflight);
  $('#review-restore').disabled = !state.file || v === state.file.original;
}
reviewText.addEventListener('input', () => { reviewError.hidden = true; updateReviewState(); });

$('#review-select').addEventListener('click', () => { reviewText.focus(); reviewText.select(); });
$('#review-clear').addEventListener('click', () => {
  reviewText.value = ''; // 처음 추출한 내용은 '원래 내용으로'로 되돌릴 수 있다
  updateReviewState();
  reviewText.focus();
});
$('#review-restore').addEventListener('click', () => {
  if (!state.file) return;
  if (reviewText.value.trim() && !confirm('수정한 내용을 지우고 처음 추출한 내용으로 되돌릴까요?')) return;
  reviewText.value = state.file.original;
  updateReviewState();
});

// 좁은 화면에서는 원본/추출 텍스트를 탭으로 바꿔 본다. 두 영역 모두 화면에 남아 있어 수정한 텍스트는 그대로다.
const reviewGrid = document.querySelector('.review-grid');
initTabs([$('#rtab-source'), $('#rtab-text')], (tab) => {
  reviewGrid.dataset.pane = tab.id === 'rtab-source' ? 'source' : 'text';
});
reviewGrid.dataset.pane = 'text';

function renderPreview() {
  const list = state.file?.previews ?? [];
  const img = $('#preview-img');
  const n = list.length;
  $('#preview-empty').hidden = n > 0;
  img.hidden = n === 0;
  preview.page = Math.min(Math.max(preview.page, 0), Math.max(n - 1, 0));
  $('#preview-page').textContent = `${n ? preview.page + 1 : 0} / ${n}`;
  $('#preview-prev').disabled = preview.page <= 0;
  $('#preview-next').disabled = preview.page >= n - 1;
  $('#zoom-out').disabled = n === 0 || preview.zoom <= 50;
  $('#zoom-in').disabled = n === 0 || preview.zoom >= 200;
  $('#zoom-level').textContent = `${preview.zoom}%`;
  if (!n) { img.removeAttribute('src'); $('#preview-name').textContent = ''; return; }
  const cur = list[preview.page];
  img.src = cur.url;
  img.alt = `원본 ${preview.page + 1}쪽 미리보기`;
  img.style.width = `${preview.zoom}%`;
  $('#preview-name').textContent = cur.name;
}
$('#preview-prev').addEventListener('click', () => { preview.page -= 1; renderPreview(); });
$('#preview-next').addEventListener('click', () => { preview.page += 1; renderPreview(); });
$('#zoom-out').addEventListener('click', () => { preview.zoom = Math.max(50, preview.zoom - 25); renderPreview(); });
$('#zoom-in').addEventListener('click', () => { preview.zoom = Math.min(200, preview.zoom + 25); renderPreview(); });

// 파일 추출: S-03 → S-04 (이 버튼을 누르는 것이 '원본과 비교해 확인했다'는 사용자 확인)
reviewSubmit.addEventListener('click', () => {
  const text = reviewText.value;
  const c = checkText(text);
  if (!c.ok) return showMsg(reviewError, c.code === 'too_long' ? '문서는 20,000자 이하로 줄여 주세요.' : '문서 내용을 20자 이상 남겨 주세요.');
  startAnalysis({ docType: docType(), text, inputSource: state.file.source });
});

// ---------- S-04 분석 중 · S-07 오류 ----------
function setAnalyzing(on) {
  updatePasteState();
  updateReviewState();
  $('#retry-btn').disabled = on;
}

// 분석은 사용자가 버튼을 눌렀을 때만 시작한다. 라우트 변경·화면 다시 그리기로는 요청하지 않는다.
async function startAnalysis(payload, { replace = false } = {}) {
  if (state.inflight) return; // 중복 요청 방지
  const controller = new AbortController();
  state.inflight = { controller };
  state.last = payload;
  state.error = null;
  result = null; // 이전 결과가 새 입력의 결과처럼 보이지 않게 한다
  setAnalyzing(true);
  go(ROUTES.analyzing, replace);

  let res = null;
  let data = {};
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: payload.docType, text: payload.text }),
      signal: controller.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch {
    res = null;
  } finally {
    state.inflight = null;
    setAnalyzing(false);
  }
  if (controller.signal.aborted) return; // 사용자가 분석 화면을 떠남

  if (res?.ok) {
    result = { ...data, inputSource: payload.inputSource };
    return go(ROUTES.result, true);
  }
  const message = res ? data.error || '분석에 실패했어요. 잠시 후 다시 시도해 주세요.' : '서버에 연결하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  if (res && classifyAnalyzeFailure(res.status) === 'input') {
    showMsg(payload.inputSource === 'paste' ? inputError : reviewError, message);
    return go(editRouteFor(payload.inputSource), true);
  }
  state.error = { message };
  go(ROUTES.error, true);
}

$('#retry-btn').addEventListener('click', () => {
  if (state.last) startAnalysis(state.last, { replace: true });
});

function renderError() {
  $('#error-message').textContent = state.error.message;
  $('#error-edit').setAttribute('href', editRouteFor(state.last?.inputSource ?? 'paste'));
  $('#retry-btn').disabled = !state.last || Boolean(state.inflight);
}

// ---------- S-05 결과 ----------
function renderResult() {
  $('#result-doc-type').textContent = result.docTypeLabel;
  $('#result-back').setAttribute('href', editRouteFor(result.inputSource));
  const source = $('#analysis-source');
  source.textContent = result.mode === 'demo'
    ? '데모 결과예요. AI 분석이 아니라 개발용 키워드 규칙으로 만든 결과라서 실제 판단에 쓰면 안 돼요.'
    : 'AI(Gemini)가 분석하고 서버가 근거 번호를 검증한 결과예요.';
  source.classList.toggle('analysis-source-demo', result.mode === 'demo');
  // 파일에서 추출한 텍스트로 분석한 경우: 원본 파일이 아니라 추출·확인한 텍스트 기준임을 밝힌다.
  const sourceNote = $('#input-source-note');
  sourceNote.hidden = result.inputSource === 'paste';
  sourceNote.textContent = EXTRACTED_NOTE[result.inputSource] ?? '';
  $('#result-notice').textContent = result.notice;

  $('#summary').replaceChildren(...STATUS_ORDER
    .filter((s) => s !== 'unavailable' || result.summary.unavailable > 0)
    .map((s) => el('li', { class: `summary-cell summary-${s}` },
      el('span', { class: 'summary-count' }, String(result.summary[s])),
      el('span', { class: 'summary-label' }, STATUS_LABEL[s]))));

  $('#item-list').replaceChildren(...result.items.filter((it) => it.visible).map((it) => el('li', {},
    el('a', { href: `#/detail/${it.id}`, class: 'item-row' },
      el('span', { class: 'item-label' }, it.label),
      badge(it.status),
      el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›')))));
}

// ---------- S-06 상세 ----------
function renderDetail(id) {
  const it = result.items.find((x) => x.id === id && x.visible);

  const blocks = [
    el('p', { class: 'doc-type-chip' }, result.docTypeLabel),
    el('h1', {}, it.label),
    el('div', { class: 'detail-status' }, badge(it.status)),
    el('h2', {}, '이 결과의 의미'),
    el('p', {}, it.probationNone ? '문서에 수습기간이 없다고 적혀 있어요.' : it.explanation),
  ];
  // 분명하지 않음: 문서에 적힌 내용과 이 문서만으로 확인하기 어려운 부분을 나눠 보여 준다
  if (it.reasonFact || it.reasonPending) {
    blocks.push(el('div', { class: 'reason' },
      el('p', { class: 'reason-fact' }, it.reasonFact ?? ''),
      el('p', { class: 'reason-pending' }, it.reasonPending ?? '')));
  }
  if (it.notFoundMessage) blocks.push(el('p', { class: 'reason' }, it.notFoundMessage));

  const extracted = result.inputSource !== 'paste';
  blocks.push(el('h2', {}, extracted ? '추출·확인한 텍스트' : '문서 원문'));
  if (extracted) blocks.push(el('p', { class: 'muted evidence-source' }, '파일에서 추출해 확인·수정한 텍스트에서 가져온 줄이에요. 원본 파일과 다를 수 있어요.'));
  if (it.evidence.length) {
    blocks.push(el('ol', { class: 'evidence' }, it.evidence.map((s) =>
      el('li', {}, el('span', { class: 'evidence-no' }, `${s.id}번 줄`), el('span', { class: 'evidence-text' }, s.text)))));
  } else {
    blocks.push(el('p', { class: 'muted' }, it.status === 'unavailable'
      ? '근거를 확인하지 못했어요. 입력한 문서를 직접 확인해 주세요.'
      : '이 항목에 해당하는 원문이 없어요.'));
  }

  // 문서에 이미 다 적혀 있어 더 확인할 것이 없으면 제목과 목록을 함께 숨긴다
  if (it.followUps.length) {
    blocks.push(el('h2', {}, '추가로 확인해 보세요'));
    blocks.push(el('ul', { class: 'follow-ups' }, it.followUps.map((f) => el('li', {}, f))));
  }

  // '분명하지 않음'·'찾지 못함'인 표시 항목에만 담당자 질문을 보여 준다 (템플릿 문장, 문서 내용·추측 값은 넣지 않음)
  const question = buildQuestion(it, result.docType);
  if (question) {
    const status = el('p', { class: 'ask-status', role: 'status', 'aria-live': 'polite' });
    const text = el('p', { class: 'ask-text', id: 'ask-text' }, question);
    const btn = el('button', { type: 'button', class: 'ask-copy', id: 'ask-copy' }, '질문 복사');
    btn.addEventListener('click', async () => {
      if (await copyText(question)) {
        status.textContent = '질문을 복사했어요. 문자·메일·메신저에 붙여넣어 보내세요.';
        status.className = 'ask-status ask-status-done';
      } else {
        // 복사가 막힌 환경: 문장을 선택해 두고 직접 복사하도록 안내
        const range = document.createRange();
        range.selectNodeContents(text);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        status.textContent = '자동 복사가 되지 않았어요. 선택된 문장을 길게 눌러 직접 복사해 주세요.';
        status.className = 'ask-status ask-status-error';
      }
    });
    blocks.push(el('section', { class: 'ask', 'aria-labelledby': 'ask-title' },
      el('h2', { id: 'ask-title' }, '담당자에게 이렇게 물어보세요'),
      text,
      btn,
      status,
      el('p', { class: 'ask-note' }, '보내기 전에 상황에 맞게 고쳐 쓰세요. 이름·연락처 등 개인정보는 필요한 만큼만 적어 주세요.')));
  }

  blocks.push(el('p', { class: 'notice' }, result.notice));
  $('#detail').replaceChildren(...blocks);
}

// ---------- 라우팅 ----------
const VIEWS = ['landing', 'input', 'review', 'analyzing', 'error', 'result', 'detail'];
const RENDER = {
  input: () => { $('#review-resume').hidden = !state.file; updatePasteState(); },
  review: () => {
    $('#review-stale').hidden = state.file.source !== 'ocr' || state.file.imagesVersion === imagesVersion;
    updateReviewState();
    renderPreview();
  },
  error: renderError,
  result: renderResult,
};
let pendingNotice = null;

function route() {
  const r = resolveRoute(location.hash, {
    hasResult: Boolean(result),
    hasReview: Boolean(state.file),
    analyzing: Boolean(state.inflight),
    hasError: Boolean(state.error),
    detailExists: (id) => Boolean(result?.items.some((x) => x.id === id && x.visible)),
  });
  // 분석 화면을 떠나면(뒤로 가기 등) 진행 중인 요청을 취소하고 결과를 쓰지 않는다
  if (state.inflight && r.view !== 'analyzing') {
    state.inflight.controller.abort();
    pendingNotice = 'aborted';
  }
  if (r.redirect) {
    if (r.notice) pendingNotice = r.notice;
    if (r.notice === 'no_review') selectMethod($('#tab-upload'));
    location.replace(r.redirect);
    return;
  }
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== r.view;
  document.body.dataset.view = r.view;
  $('#topbar-cta').hidden = r.view !== 'landing';
  if (r.view === 'detail') renderDetail(r.id);
  else RENDER[r.view]?.();

  // 한 번만 보여 줄 안내 (결과 없음, 분석 중단 등)
  const notice = { input: $('#route-notice'), review: $('#review-notice') }[r.view];
  $('#route-notice').hidden = true;
  $('#review-notice').hidden = true;
  if (notice && pendingNotice) showMsg(notice, ROUTE_NOTICE[pendingNotice]);
  if (r.view !== 'analyzing') pendingNotice = null;

  window.scrollTo(0, 0);
  if (r.view === 'analyzing' || r.view === 'error') $(`#${r.view}-title`).focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
updatePasteState();

fetch('/api/config').then((r) => r.json()).then((c) => { $('#mode-badge').hidden = c.mode !== 'demo'; }).catch(() => {});
