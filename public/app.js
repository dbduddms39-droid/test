import { moveItem, planSelection, UPLOAD_MESSAGES, MAX_IMAGES } from './upload-rules.js';
import { buildQuestion, copyText } from './questions.js';
import { el, statusBadge, V22_STATUS_LABEL, sourcePanelLines } from './components.js';
import { ROUTES, checkText, editRouteFor, resolveRoute, classifyAnalyzeFailure } from './flow.js';
import { createTracker, applyEdit, confirmSpan, pendingRanges, summary as ocrSummary } from './ocr-spans.js';
import { buildIssues, resolveIssue, unresolve, blockingIssues, resetTextDependent, resultNotes, isResolved } from './extract-issues.js';

// 일단확인 클라이언트.
// 입력 원문·추출 텍스트·분석 결과는 이 창의 메모리에만 둔다(브라우저 저장소·URL에 남기지 않음).
// 앱 안에서 화면을 옮기거나 뒤로 가기를 해도 유지되지만, 새로고침하거나 창을 닫으면 사라진다.
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
  empty: '문서 내용을 입력해 주세요.',
  short: '짧은 내용도 확인할 수 있어요. 문서에 적히지 않은 조건은 결과에서 \'관련 내용 찾지 못함\'으로 표시돼요.',
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
  file: null,       // 파일 추출 결과 { source: 'ocr'|'pdf', original, previews: [{ url, name }], imagesVersion, ownUrls, words, tracker, lastText, issues }
  last: null,       // 마지막으로 분석을 요청한 { docType, text, inputSource } — S-07 재시도·수정에 사용
  inflight: null,   // 진행 중인 분석 { controller }
  error: null,      // S-07에 보여 줄 { message }
};
let result = null;

const $ = (sel) => document.querySelector(sel);
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
  $('#submit-hint').textContent = SUBMIT_HINT[c.code ?? 'ok'];
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
  if (!c.ok) return showMsg(inputError, c.code === 'too_long' ? '문서는 20,000자 이하로 입력해 주세요.' : '문서 내용을 입력해 주세요.');
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
  low: '일부만 인식됐을 수 있어요(자동 추정). 원본과 꼭 비교해 주세요',
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
// issues: 추출 실패·일부 누락 의심 (extract-issues.js). 처리하기 전에는 S-03에서 분석할 수 없다.
function applyExtracted(text, source, previews, ownUrls = [], words = [], issues = []) {
  const reviewText = $('#review-text');
  if (state.file && reviewText.value.trim() && reviewText.value !== state.file.original
    && !confirm('확인·수정하던 추출 텍스트를 새로 추출한 내용으로 바꿀까요?')) {
    ownUrls.forEach((u) => URL.revokeObjectURL(u));
    return false;
  }
  const old = state.file;
  // OCR이 알려 준 불확실한 글자의 위치를 추적한다 (사용자가 고치거나 원본과 대조해 확인한 곳만 해제)
  state.file = { source, original: text, previews, imagesVersion, ownUrls, words, tracker: createTracker(text, words), lastText: text, issues };
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
    const issues = buildIssues({ failed: out.failedPages ?? [], suspect: out.suspectPages ?? [], unit: 'pdf' });
    if (!applyExtracted(out.text, out.method === 'pdf-text' ? 'pdf' : 'ocr', previews, urls, out.uncertainAll ?? [], issues)) {
      return showUploadStatus('확인·수정하던 추출 텍스트를 그대로 두었어요. 새로 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    }
    const what = out.method === 'pdf-text' ? `PDF ${out.pages}쪽에서 텍스트를 추출했어요.`
      : `PDF ${out.pages}쪽에서 텍스트를 추출했어요 (스캔된 ${out.ocrPages}쪽은 글자 인식).`;
    const msg = [what, reviewNote, ...notes];
    if (out.method !== 'pdf-text') msg.push('글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    if (out.failedPages?.length) msg.push(`${out.failedPages.map((p) => `${p.page}쪽`).join(', ')}에서는 글자를 읽지 못했어요. 그 쪽을 복구하기 전에는 분석할 수 없어요.`);
    if (out.suspectPages?.length) msg.push(`${out.suspectPages.map((p) => `${p.page}쪽`).join(', ')}은 일부만 인식됐을 수 있어요(자동 추정). 원본과 비교해 주세요.`);
    else if (out.lowConfidence) msg.push('인식 정확도가 낮아 보여요. 숫자(금액·날짜·시간)를 특히 꼼꼼히 확인해 주세요.');
    if (out.uncertain?.length) msg.push(uncertainNote(out.uncertain));
    if (out.text.length > 20000) msg.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    finishExtraction(msg.join(' '), out.lowConfidence || out.uncertain?.length || notes.length || issues.length ? 'warn' : 'done');
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
    const issues = buildIssues({
      failed: out.failed,
      suspect: out.review.filter((r) => r.quality === 'low').map((r) => ({ index: r.index, reason: r.partial ? 'partial' : 'low_confidence' })),
      unit: 'image',
    });
    if (!applyExtracted(out.text, 'ocr', previews, [], out.uncertainAll ?? [], issues)) return showUploadStatus('확인·수정하던 추출 텍스트를 그대로 두었어요. 새로 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    const msg = [`이미지 ${images.length}장 중 ${out.okCount}장에서 글자를 인식해 순서대로 합쳤어요.`];
    if (out.failed.length) {
      msg.push(`${out.failed.map((f) => `${f.index + 1}번째`).join(', ')} 이미지는 ${out.failed.length === 1 ? ITEM_FAIL_TEXT[out.failed[0].code] ?? '읽지 못했어요' : '읽지 못했어요'}. 그 부분을 복구하기 전에는 분석할 수 없어요. 직접 입력하거나 다른 이미지로 바꿔 다시 추출해 주세요.`);
    }
    msg.push(reviewNote, '글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    const low = out.review.filter((r) => r.quality === 'low');
    if (low.length) msg.push(`${low.map((r) => `${r.index + 1}번째`).join(', ')} 이미지는 일부만 인식됐을 수 있어요(자동 추정). 원본과 비교해 확인해 주세요.`);
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
  const blocking = reviewBlocking();
  reviewSubmit.disabled = !state.file || !checkText(v).ok || Boolean(state.inflight) || blocking.length > 0;
  $('#review-restore').disabled = !state.file || v === state.file.original;
  showMsg($('#review-blocked'), blocking.length ? `분석 전에 확인할 추출 문제 ${blocking.length}건을 먼저 처리해 주세요. 위의 '분석 전에 확인할 추출 문제'에서 처리할 수 있어요.` : '');
}
function textEdited() { return Boolean(state.file) && reviewText.value !== state.file.original; }
function reviewBlocking() { return state.file ? blockingIssues(state.file.issues ?? [], { textEdited: textEdited() }) : []; }
// 텍스트가 바뀔 때마다 저신뢰 구간의 위치·상태를 갱신한다
function trackReviewText() {
  if (!state.file) return;
  state.file.tracker = applyEdit(state.file.tracker, state.file.lastText, reviewText.value);
  state.file.lastText = reviewText.value;
  renderOcrCheck();
  renderExtractIssues();
}
reviewText.addEventListener('input', () => { reviewError.hidden = true; trackReviewText(); updateReviewState(); });

// ---------- S-03 확인이 필요한 글자 (OCR 저신뢰 구간) ----------
const OCR_KIND_TEXT = {
  ocr: '인식이 불확실한 글자',
  untracked: '크게 바뀌어 원래 위치와 대응할 수 없는 구간',
  lost: '수정 중 위치를 추적할 수 없게 된 불확실한 글자',
  unlocated: '추출 텍스트에서 위치를 찾지 못한 불확실한 글자',
};
const OCR_STATE_TEXT = { pending: '확인 필요', edited: '수정함', confirmed: '원본과 대조함' };
const clip = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}…` : t);

function renderOcrCheck() {
  const box = $('#ocr-check');
  const tracker = state.file?.tracker;
  const items = tracker ? [...tracker.spans, ...tracker.lost] : [];
  box.hidden = !items.length;
  if (!items.length) return;
  const sum = ocrSummary(tracker);
  $('#ocr-check-count').textContent = sum.pending ? `${sum.total}곳 중 ${sum.pending}곳 확인 필요` : `${sum.total}곳 모두 확인함`;
  $('#ocr-check-list').replaceChildren(...items.map((x) => el('li', { class: `ocr-item is-${x.state}`, 'data-ocr-id': String(x.id) },
    el('div', { class: 'ocr-item-main' },
      el('q', { class: 'ocr-text' }, clip(x.state === 'edited' ? x.editedTo || '(삭제함)' : x.text)),
      el('span', { class: 'ocr-kind' }, OCR_KIND_TEXT[x.kind]),
      el('span', { class: 'ocr-state' }, OCR_STATE_TEXT[x.state])),
    x.state === 'pending' ? el('div', { class: 'ocr-item-actions' },
      x.start != null ? el('button', { type: 'button', class: 'btn-text', 'data-ocr-action': 'locate' }, '위치 보기') : null,
      el('button', { type: 'button', class: 'icon-btn', 'data-ocr-action': 'confirm' }, '원본과 대조해 확인했어요')) : null)));
}
$('#ocr-check-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ocr-action]');
  if (!b || !state.file) return;
  const id = Number(b.closest('[data-ocr-id]').dataset.ocrId);
  const span = state.file.tracker.spans.find((s) => s.id === id);
  if (b.dataset.ocrAction === 'confirm') {
    state.file.tracker = confirmSpan(state.file.tracker, id); // 이 구간 하나만 해제
    renderOcrCheck();
  } else if (span?.start != null) {
    $('#rtab-text').click();
    reviewText.focus();
    reviewText.setSelectionRange(span.start, span.end);
  }
});

// ---------- S-03 분석 전에 확인할 추출 문제 (OCR 처리 정책 2·3) ----------
// 추출 실패: 다시 추출(S-02)하거나 원본을 보고 직접 입력한 뒤 표시해야 분석할 수 있다.
// 일부 누락 의심: 품질 추정일 뿐 실제 누락을 확정하지 않는다. 직접 보완하거나 원본과 비교해 범위를 확인했다고 표시해야 한다.
const ISSUE_REASON_TEXT = {
  partial: '인식한 줄 수가 이미지에서 찾은 글자 줄보다 적어요.',
  low_confidence: '전체 글자 인식 신뢰도가 낮아요.',
};
const ISSUE_STATE_TEXT = {
  manual_input: '원본을 보고 직접 입력함',
  supplemented: '빠진 내용을 직접 보완함',
  range_checked: '원본과 비교해 추출 범위를 확인함',
};
const ISSUE_REFUSED_TEXT = {
  text_not_edited: '추출 텍스트가 처음 추출한 내용 그대로예요. 원본을 보고 내용을 직접 입력·보완한 뒤 눌러 주세요.',
};
let issueError = null; // { id, code }

function issueItem(x) {
  const resolved = isResolved(x, { textEdited: textEdited() });
  const failed = x.kind === 'failed';
  const title = failed ? `${x.label}: 글자를 읽지 못했어요` : `${x.label}: 일부가 빠졌을 수 있어요`;
  const desc = failed
    ? (x.unit === 'pdf'
      ? '이 쪽의 내용은 지금 추출 텍스트에 없어요. 그대로는 분석할 수 없어요. 파일을 다시 올려 추출하거나, 원본을 보고 그 내용을 추출 텍스트에 직접 입력해 주세요.'
      : '이 이미지의 내용은 지금 추출 텍스트에 없어요. 그대로는 분석할 수 없어요. 더 선명한 이미지로 바꿔 다시 추출하거나, 원본을 보고 그 내용을 추출 텍스트에 직접 입력해 주세요.')
    : `${ISSUE_REASON_TEXT[x.reason] ?? ''} 자동으로 추정한 것이라 실제로 빠졌는지는 확정할 수 없어요. 원본과 추출 텍스트를 비교해 주세요.`;
  const actions = [];
  if (!resolved) {
    if (state.file?.previews?.length) actions.push(el('button', { type: 'button', class: 'btn-text', 'data-issue-action': 'view' }, '원본 보기'));
    if (failed) {
      actions.push(el('a', { href: ROUTES.input, class: 'btn-text', 'data-issue-action': 'reextract' }, x.unit === 'pdf' ? '파일 다시 올려 추출하기' : '이미지 바꾸고 다시 추출하기'));
      actions.push(el('button', { type: 'button', class: 'icon-btn', 'data-issue-resolve': 'manual_input' }, '원본을 보고 직접 입력했어요'));
    } else {
      actions.push(el('button', { type: 'button', class: 'icon-btn', 'data-issue-resolve': 'supplemented' }, '빠진 내용을 직접 보완했어요'));
      actions.push(el('button', { type: 'button', class: 'icon-btn', 'data-issue-resolve': 'range_checked' }, '원본과 비교해 추출 범위를 확인했어요'));
    }
  } else {
    actions.push(el('span', { class: 'issue-state' }, ISSUE_STATE_TEXT[x.resolution]));
    actions.push(el('button', { type: 'button', class: 'btn-text', 'data-issue-action': 'undo' }, '표시 취소'));
  }
  return el('li', { class: `issue-item is-${x.kind}${resolved ? ' is-resolved' : ''}`, 'data-issue-id': x.id },
    el('p', { class: 'issue-title' }, title, el('span', { class: 'issue-kind' }, resolved ? '처리함' : '처리 필요')),
    el('p', { class: 'issue-desc' }, desc),
    el('div', { class: 'issue-actions' }, ...actions),
    issueError?.id === x.id ? el('p', { class: 'issue-error', role: 'alert' }, ISSUE_REFUSED_TEXT[issueError.code] ?? '처리하지 못했어요.') : null);
}

function renderExtractIssues() {
  const issues = state.file?.issues ?? [];
  const box = $('#extract-issues');
  box.hidden = !issues.length;
  if (!issues.length) return;
  const open = reviewBlocking().length;
  $('#extract-issues-count').textContent = open ? `${issues.length}건 중 ${open}건 처리 필요` : `${issues.length}건 모두 처리함`;
  $('#extract-issues-list').replaceChildren(...issues.map(issueItem));
}
$('#extract-issues-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-issue-id]');
  if (!item || !state.file) return;
  const id = item.dataset.issueId;
  const resolveBtn = e.target.closest('button[data-issue-resolve]');
  const action = e.target.closest('[data-issue-action]')?.dataset.issueAction;
  issueError = null;
  if (resolveBtn) {
    const r = resolveIssue(state.file.issues, id, resolveBtn.dataset.issueResolve, { textEdited: textEdited() });
    if (r.ok) state.file.issues = r.issues;
    else issueError = { id, code: r.code };
  } else if (action === 'undo') {
    state.file.issues = unresolve(state.file.issues, id);
  } else if (action === 'view') {
    const issue = state.file.issues.find((x) => x.id === id);
    preview.page = issue.position - 1;
    renderPreview();
    $('#rtab-source').click();
    $('#review-source').scrollIntoView({ block: 'nearest' });
    return;
  } else {
    return; // 다시 추출하기는 링크로 S-02에 간다 (추출 텍스트와 문제 목록은 새로 추출할 때까지 그대로)
  }
  renderExtractIssues();
  updateReviewState();
});

$('#review-select').addEventListener('click', () => { reviewText.focus(); reviewText.select(); });
$('#review-clear').addEventListener('click', () => {
  // 사용자가 고친 내용이 있으면 지우기 전에 묻는다 (처음 추출한 내용은 '원래 내용으로'로 되돌릴 수 있음)
  const edited = state.file && reviewText.value.trim() && reviewText.value !== state.file.original;
  if (edited && !confirm('수정한 내용을 모두 지울까요? 처음 추출한 내용은 \'원래 내용으로\'로 되돌릴 수 있어요.')) return;
  reviewText.value = '';
  trackReviewText();
  updateReviewState();
  reviewText.focus();
});
$('#review-restore').addEventListener('click', () => {
  if (!state.file) return;
  if (reviewText.value.trim() && !confirm('수정한 내용을 지우고 처음 추출한 내용으로 되돌릴까요?')) return;
  reviewText.value = state.file.original;
  // 처음 추출한 상태로 되돌리면 불확실한 글자 표시도 처음 상태(모두 확인 필요)로 돌아간다
  state.file.tracker = createTracker(state.file.original, state.file.words);
  state.file.lastText = state.file.original;
  // 직접 입력·보완했다는 표시도 다시 '처리 필요'로 (원본과 비교해 범위를 확인한 표시는 텍스트와 무관해 유지)
  state.file.issues = resetTextDependent(state.file.issues ?? []);
  renderOcrCheck();
  renderExtractIssues();
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

// 파일 추출: S-03 → S-04. 이 버튼은 불확실한 글자 표시를 해제하지 않는다.
// 사용자가 고치거나 원본과 대조해 확인하지 않은 구간은 위치만 함께 보내고, 서버는 그 구간이 든 기준을 확정하지 않는다.
reviewSubmit.addEventListener('click', () => {
  const text = reviewText.value;
  const c = checkText(text);
  if (!c.ok) return showMsg(reviewError, c.code === 'too_long' ? '문서는 20,000자 이하로 줄여 주세요.' : '분석할 문서 내용을 입력해 주세요.');
  trackReviewText();
  // 추출 실패·일부 누락 의심을 처리하지 않았으면 분석하지 않는다 (이 버튼은 어떤 문제도 처리한 것으로 보지 않음)
  if (reviewBlocking().length) return updateReviewState();
  const lowConfidence = pendingRanges(state.file.tracker, text);
  startAnalysis({ docType: docType(), text, inputSource: state.file.source, lowConfidence, extractNotes: resultNotes(state.file.issues ?? []) });
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
      body: JSON.stringify({ docType: payload.docType, text: payload.text, ...(payload.lowConfidence?.length ? { lowConfidence: payload.lowConfidence } : {}) }),
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

  // 점검 기준 v2.2 형식이 아닌 응답(예: 이전 버전 서버)은 결과로 보여 주지 않는다 (8개·10개 형식 혼용 방지)
  if (res?.ok && isV22(data)) {
    result = { ...data, inputSource: payload.inputSource, extractNotes: payload.extractNotes ?? [] };
    return go(ROUTES.result, true);
  }
  if (res?.ok) {
    state.error = { message: '분석 결과 형식을 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
    return go(ROUTES.error, true);
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

// ---------- S-05 점검 결과 (점검 기준 v2.2: 10개 주제, 08은 조건부) ----------
// 세부기준 ID·핵심/추가 구분 코드·출처 코드는 화면에 그대로 보여 주지 않는다 (사용자용 이름만).
const MAIN_ORDER = ['MAIN_FOUND', 'MAIN_PARTIAL', 'MAIN_MISSING', 'MAIN_UNAVAILABLE'];
const isV22 = (r) => r?.version === 'v2.2' && Array.isArray(r.topics);
const SOURCE_LABEL = { 'L-M': '법령상 근로조건 명시 사항', 'L-W': '법령상 서면 명시 사항', F: '공식 서식 참고', S: '일단확인 확인 기준' };
const CONDITION_TEXT = {
  fixed_term: '기간을 정한 계약일 때 확인하는 기준이에요.',
  probation_applies: '수습이 적용될 때 확인하는 기준이에요.',
  leave_granted: '연차를 부여한다고 적혀 있을 때 확인하는 기준이에요.',
};
const NA_TEXT = {
  indefinite_term: '기간의 정함이 없는 계약으로 적혀 있어 이 기준은 해당하지 않아요.',
  no_probation: '수습을 적용하지 않는다고 적혀 있어 이 기준은 해당하지 않아요.',
  no_leave: '연차를 부여하지 않는다고 적혀 있어 이 기준은 해당하지 않아요. 법적 적용 여부를 판단한 것은 아니에요.',
};
const UNAVAILABLE_TEXT = {
  ocr_low_confidence: '근거에 글자 인식(OCR)이 불확실한 곳이 있어 확정하지 않았어요. 원본과 대조해 고치거나 확인한 뒤 다시 분석해 주세요. 문서에 적혀 있지 않다는 뜻이 아니에요.',
  ocr_low_confidence_related: '이 항목과 관련된 내용 근처에 글자 인식(OCR)이 불확실한 곳이 있어 확정하지 않았어요. 원본과 대조해 고치거나 확인한 뒤 다시 분석해 주세요. 문서에 적혀 있지 않다는 뜻이 아니에요.',
  evidence_verification_failed: 'AI가 제시한 근거를 원문에서 확인하지 못해 확정하지 않았어요. 문서에 적혀 있지 않다는 뜻이 아니에요.',
};
const PROVISIONAL_TEXT = '이 상태는 점검 기준표에 정해진 규칙이 없어 잠정적으로 표시했어요.';
const labelsOf = (list) => list.map((c) => c.label).join(', ');

function criterionText(c) {
  if (c.status === 'UNAVAILABLE') return UNAVAILABLE_TEXT[c.basis] ?? UNAVAILABLE_TEXT.evidence_verification_failed;
  if (c.status === 'NOT_APPLICABLE') return NA_TEXT[c.basis] ?? '문서에 적힌 내용 때문에 이 기준은 해당하지 않아요.';
  if (c.basis === 'negated') return c.status === 'CONFIRMED'
    ? '적용·부여하지 않는다고 적혀 있어요. 적힌 내용만 확인했고 법적 효력은 판단하지 않아요.'
    : '지급·부여·적용하지 않는다는 내용이 적혀 있어요. 적힌 내용만 확인했고 법적 효력은 판단하지 않아요.';
  if (c.status === 'CONFIRMED') return c.valueKind === 'calculated' ? '원문에 적힌 숫자로 계산해 확인했어요.' : '문서에 적혀 있어요.';
  if (c.status === 'PARTIAL') return '관련 내용은 있지만 일부만 적혀 있어요.';
  if (c.status === 'UNCLEAR') return c.basis === 'conflict' ? '서로 다른 값이 함께 적혀 있어요. 어느 값인지 정하지 않았어요.' : '정해지지 않았거나 나중에 정한다고 적혀 있어요.';
  return '문서에서 확인되지 않아요.';
}

function topicSummary(t) {
  const core = t.criteria.filter((c) => c.required);
  const extraMissing = t.criteria.filter((c) => c.role === 'D' && (c.status === 'MISSING' || c.status === 'UNCLEAR')).length;
  const extra = extraMissing ? ` 추가 기준 ${extraMissing}개는 문서에서 확인되지 않거나 정해지지 않았어요.` : '';
  if (t.status === 'MAIN_FOUND') {
    const ok = core.filter((c) => c.status === 'CONFIRMED');
    return `핵심 기준(${labelsOf(ok)})이 문서에서 확인돼요.${extra}`;
  }
  if (t.status === 'MAIN_PARTIAL') {
    const lacking = core.filter((c) => c.status !== 'CONFIRMED' && c.status !== 'NOT_APPLICABLE');
    const conflict = lacking.filter((c) => c.basis === 'conflict');
    const rest = lacking.filter((c) => c.basis !== 'conflict');
    return [
      conflict.length ? `핵심 기준(${labelsOf(conflict)})에 서로 다른 값이 함께 적혀 있어요.` : '',
      rest.length ? `관련 내용은 있지만 핵심 기준(${labelsOf(rest)})이 정해지지 않았거나 일부만 적혀 있어요.` : '',
    ].filter(Boolean).join(' ');
  }
  if (t.status === 'MAIN_UNAVAILABLE') {
    return `핵심 기준(${labelsOf(core.filter((c) => c.status === 'UNAVAILABLE'))})의 근거를 확인하지 못해 확정하지 않았어요. 문서에 적혀 있지 않다는 뜻이 아니에요.`;
  }
  return '이 항목과 관련된 내용을 문서에서 찾지 못했어요.';
}

// 주제의 원문 근거: 줄 번호 → 인용 구절 목록 (확인 불가 기준의 인용은 서버가 이미 비워 보냄)
function topicMarks(t) {
  const marks = new Map();
  for (const c of t.criteria) for (const e of c.evidence) marks.set(e.line, [...(marks.get(e.line) ?? []), e.text]);
  return marks;
}
const firstEvidence = (t) => (t.criteria.find((c) => c.required && c.evidence.length) ?? t.criteria.find((c) => c.evidence.length))?.evidence[0] ?? null;
const wideScreen = () => matchMedia('(min-width: 1024px)').matches;
let selectedTopic = null;

function renderSourcePanel() {
  const t = result.topics.find((x) => x.id === selectedTopic);
  $('#source-panel-focus').textContent = t ? `§ ${t.id} ${t.label} 대조 중` : '항목을 고르면 원문 근거를 표시해요';
  const marks = t ? topicMarks(t) : new Map();
  $('#source-panel-body').replaceChildren(sourcePanelLines(result.lines, marks));
  $('#source-panel-foot').textContent = t && !marks.size
    ? '이 항목은 표시할 원문 근거가 없어요.'
    : `입력한 문서 ${result.lines.length}줄 중 표시한 줄이 이 항목의 원문 근거예요.`;
  document.querySelectorAll('.topic-card').forEach((card) => card.classList.toggle('is-selected', card.dataset.topic === selectedTopic));
  $('#source-panel-body').querySelector('.is-marked')?.scrollIntoView({ block: 'nearest' });
}

function topicCard(t) {
  const ev = firstEvidence(t);
  const marks = topicMarks(t);
  const toggle = el('button', { type: 'button', class: 'btn-text compare-btn', 'aria-expanded': 'false' },
    marks.size ? '원문 근거 보기' : '원문 대조');
  const inline = el('div', { class: 'card-source', hidden: true },
    marks.size ? sourcePanelLines(result.lines, marks, { onlyMarked: true }) : el('p', { class: 'muted small' }, t.status === 'MAIN_UNAVAILABLE' ? '근거를 확인하지 못해 원문을 표시하지 않아요.' : '이 항목과 관련된 원문을 찾지 못했어요.'));
  toggle.addEventListener('click', () => {
    if (wideScreen()) { selectedTopic = t.id; renderSourcePanel(); return; } // 데스크톱: 오른쪽 원문 대조 패널
    const open = inline.hidden;
    inline.hidden = !open; // 모바일: 카드 안에서 원문 근거 줄을 펼침
    toggle.setAttribute('aria-expanded', String(open));
  });
  const excerpt = t.status === 'MAIN_UNAVAILABLE' && !ev ? '원문 대조: 근거 확인 불가'
    : ev ? `발췌: ${ev.text}` : '원문 대조: 기재 구절 없음';
  return el('li', { class: `topic-card status-${t.status.toLowerCase()}`, 'data-topic': t.id },
    el('a', { href: `#/detail/${t.id}`, class: 'item-row' },
      el('span', { class: 'topic-index' }, `§ ${t.id}`),
      el('span', { class: 'item-label' }, t.label),
      statusBadge(t.status, t.statusLabel)),
    el('p', { class: 'topic-summary' }, topicSummary(t)),
    el('div', { class: 'topic-foot' },
      el('span', { class: 'excerpt' }, excerpt),
      el('span', { class: 'topic-actions' }, toggle, el('a', { href: `#/detail/${t.id}`, class: 'btn-text' }, '자세히 보기 →'))),
    inline);
}

function renderResult() {
  $('#result-doc-type').textContent = result.docTypeLabel;
  $('#result-title').textContent = `${result.docTypeLabel} 점검 결과`;
  $('#result-back').setAttribute('href', editRouteFor(result.inputSource));
  const source = $('#analysis-source');
  source.textContent = result.mode === 'demo'
    ? '데모 결과예요. AI 분석이 아니라 개발용 키워드 규칙으로 만든 결과라서 실제 판단에 쓰면 안 돼요.'
    : 'AI 분석을 바탕으로 서버가 원문 근거를 확인하고 점검 기준에 따라 정리한 결과예요.';
  source.classList.toggle('analysis-source-demo', result.mode === 'demo');
  // 파일에서 추출한 텍스트로 분석한 경우: 원본 파일이 아니라 추출·확인한 텍스트 기준임을 밝힌다.
  const sourceNote = $('#input-source-note');
  sourceNote.hidden = result.inputSource === 'paste';
  sourceNote.textContent = [EXTRACTED_NOTE[result.inputSource] ?? '', ...(result.extractNotes ?? [])].filter(Boolean).join(' ');
  $('#result-notice').textContent = `${result.sourceGuide} ${result.notice}`;
  $('#result-count').textContent = `점검한 항목 ${result.counts.shown}개`;
  $('#result-tally').textContent = MAIN_ORDER.filter((s) => result.counts.byStatus[s] > 0)
    .map((s) => `${V22_STATUS_LABEL[s]} ${result.counts.byStatus[s]}`).join(' · ');
  $('#source-panel-doc').textContent = result.docTypeLabel;
  const visible = result.topics.filter((t) => t.visible);
  $('#item-list').replaceChildren(...visible.map(topicCard));
  if (!visible.some((t) => t.id === selectedTopic)) selectedTopic = (visible.find((t) => topicMarks(t).size) ?? visible[0])?.id ?? null;
  renderSourcePanel();
}

// ---------- S-06 항목 상세 ----------
function evidenceChips(c) {
  return c.evidence.map((e) => el('button', { type: 'button', class: 'evidence-chip', 'data-line': String(e.line) },
    el('span', { class: 'chip-label' }, '원문 근거'), el('q', { class: 'evidence-text' }, e.text)));
}

function criterionCard(c) {
  const values = [];
  if (c.sourceValue) values.push(el('div', { class: 'value-row' }, el('span', { class: 'value-label' }, '확인한 값'), el('span', { class: 'value' }, c.sourceValue)));
  for (const d of c.derived ?? []) {
    values.push(el('div', { class: 'value-row is-calculated' },
      el('span', { class: 'value-label' }, '계산한 값'),
      el('span', { class: 'value' }, d.label ? `${d.label}: ${d.value}` : d.value),
      el('span', { class: 'derivation' }, `${d.derivation} · 원문에 적힌 값이 아니라 원문의 숫자로 계산한 값이에요.`)));
  }
  if ((c.derived ?? []).length > 1) values.push(el('p', { class: 'muted small' }, '주마다 다른 값을 그대로 보여 줘요(평균하지 않음).'));
  const chips = evidenceChips(c);
  return el('article', { class: `criterion criterion-card${c.role === 'C' ? ' is-core' : ''}`, 'data-criterion': c.id },
    el('div', { class: 'card-head' }, el('span', { class: 'criterion-name' }, c.label), statusBadge(c.status, c.statusLabel)),
    values.length || chips.length ? el('div', { class: 'card-detail' }, ...values, chips.length ? el('div', { class: 'chips' }, chips) : null) : null,
    el('p', { class: 'item-desc' }, criterionText(c)),
    c.provisional ? el('p', { class: 'provisional muted small' }, PROVISIONAL_TEXT) : null,
    c.condition && !c.required && c.status !== 'NOT_APPLICABLE' ? el('p', { class: 'muted small' }, CONDITION_TEXT[c.condition]) : null);
}

function linkList(links) {
  return el('ul', { class: 'link-list' }, links.map((l) => el('li', {}, el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'link-external' }, `${l.label} ↗`))));
}

function renderDetail(id) {
  const t = result.topics.find((x) => x.id === id && x.visible);
  const core = t.criteria.filter((c) => c.role === 'C');
  const extra = t.criteria.filter((c) => c.role === 'D');
  const marks = topicMarks(t);
  const extracted = result.inputSource !== 'paste';

  const head = el('header', { class: 'detail-head' },
    el('span', { class: 'index-chip' }, t.id), el('h1', {}, t.label), statusBadge(t.status, t.statusLabel));
  const summary = el('div', { class: 'summary-box' },
    el('p', { class: 'summary-text' }, topicSummary(t)),
    el('p', { class: 'muted small' }, 'ⓘ 이 상태는 핵심 정보의 기재 여부를 나타내며, 모든 세부 내용의 확인이나 법적 적합성을 뜻하지 않아요.'));
  // 안내는 서로 다른 영역에 둔다 (중립 안내 / 적용 범위 안내 / 수습 중 급여 보류)
  const notes = [];
  if (t.notes.neutral) notes.push(el('div', { class: 'note note-neutral' }, el('p', { class: 'note-title' }, '적힌 내용에 대한 안내'), el('p', {}, t.notes.neutral)));
  if (t.notes.applicability) notes.push(el('div', { class: 'note note-applicability' }, el('p', { class: 'note-title' }, '법령 적용 범위 안내'), el('p', {}, t.notes.applicability), linkList(t.applicabilityLinks)));
  if (t.notes.probationHold) notes.push(el('div', { class: 'note note-hold' }, el('p', { class: 'note-title' }, '수습 중 급여 항목을 판정하지 않은 이유'), el('p', {}, t.notes.probationHold)));

  const coreSec = el('section', { class: 'criteria-group group-core' },
    el('h2', {}, '핵심 확인 기준'), el('p', { class: 'group-desc' }, '이 항목의 주요 기재 상태를 결정하는 기준이에요.'),
    el('div', { class: 'card-list' }, core.map(criterionCard)));
  const docSec = el('aside', { class: 'doc-panel' },
    el('h2', {}, extracted ? '추출·확인한 텍스트' : '문서 원문'),
    el('p', { class: 'group-desc' }, '이 항목과 관련된 문장을 확인할 수 있어요.'),
    el('div', { class: 'paper-sheet' },
      sourcePanelLines(result.lines, marks),
      el('div', { class: 'doc-memo' }, el('p', { class: 'memo-title' }, '원문 대조 메모'),
        el('p', {}, marks.size ? '형광펜으로 표시한 구절이 이 항목의 원문 근거예요. 표시되지 않은 세부 기준은 원문에서 찾지 못했거나 확인하지 못했어요.' : '이 항목의 원문 근거로 표시할 구절이 없어요.'),
        extracted ? el('p', {}, '파일에서 추출해 확인·수정한 텍스트예요. 원본 파일과 다를 수 있어요.') : null)));
  const extraSec = extra.length ? el('section', { class: 'criteria-group group-extra' },
    el('h2', {}, '추가 확인 기준'),
    el('p', { class: 'group-desc' }, '핵심 내용 외에 함께 살펴볼 수 있는 세부 정보예요. 이 정보가 문서에 없더라도 핵심 항목의 기재 상태는 바뀌지 않아요.'),
    el('div', { class: 'card-list is-compact' }, extra.map(criterionCard))) : null;

  const unconfirmed = t.criteria.filter((c) => t.unconfirmed.includes(c.id));
  const question = buildQuestion(t, result.docType);
  let askSec = null;
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
    askSec = el('section', { class: 'ask', 'aria-labelledby': 'ask-title' },
      el('h3', { id: 'ask-title' }, '담당자에게 이렇게 물어보세요'), text, btn, status,
      el('p', { class: 'ask-note' }, '보내기 전에 상황에 맞게 고쳐 쓰세요. 이름·연락처 등 개인정보는 필요한 만큼만 적어 주세요.'));
  }
  const unconfSec = unconfirmed.length || askSec ? el('section', { class: 'criteria-group group-unconfirmed' },
    el('h2', {}, '이 문서에서 확인되지 않은 내용'),
    unconfirmed.length ? el('ul', { class: 'unconfirmed' }, unconfirmed.map((c) => el('li', {}, `${c.label} — ${c.statusLabel}`))) : null,
    askSec) : null;

  // 기준 출처: 세부기준별 출처 유형(사용자용 이름)과 공식 링크
  const sourceSec = el('details', { class: 'source-accordion' },
    el('summary', {}, el('span', { class: 'source-title' }, '이 기준은 어디에서 왔나요?'), el('span', { class: 'toggle-text' }, '자세히 보기')),
    el('div', { class: 'source-body' },
      el('p', {}, '일단확인의 점검 기준은 관련 법령과 공식 서식을 참고해 설계한 자체 확인 기준이며, 법률 자문이나 유권해석이 아니에요.'),
      el('p', { class: 'muted small' }, result.sourceGuide),
      el('table', { class: 'source-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '세부 기준'), el('th', { scope: 'col' }, '기준 출처 유형'))),
        el('tbody', {}, t.criteria.map((c) => el('tr', { 'data-criterion': c.id }, el('td', {}, c.label), el('td', {}, c.sources.map((k) => el('span', { class: 'source-badge' }, SOURCE_LABEL[k]))))))),
      t.links.length ? el('div', { class: 'source-links' }, el('p', { class: 'small' }, '공식 참고 서식 및 법령 원문'), linkList(t.links))
        : el('p', { class: 'muted small' }, '이 항목의 세부 기준은 일단확인이 정한 확인 기준이에요.')));

  const actions = el('div', { class: 'detail-actions' },
    el('a', { href: '#/result', class: 'btn-editorial btn-auto' }, '← 점검 결과로 돌아가기'),
    el('a', { href: editRouteFor(result.inputSource), class: 'btn-primary btn-auto', id: 'detail-edit' }, '원문 수정하고 다시 분석하기 ↻'));

  $('#detail').replaceChildren(head, summary, ...notes,
    el('div', { class: 'detail-grid' }, coreSec, docSec, extraSec, unconfSec, sourceSec), actions);

  // 원문 근거 칩 → 문서 원문의 해당 줄로 이동해 강조
  $('#detail').querySelectorAll('.evidence-chip').forEach((chip) => chip.addEventListener('click', () => {
    const line = $('#detail').querySelector(`.doc-panel [data-line="${chip.dataset.line}"]`);
    if (!line) return;
    $('#detail').querySelectorAll('.doc-line.is-focused').forEach((x) => x.classList.remove('is-focused'));
    line.classList.add('is-focused');
    line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
}

// ---------- 라우팅 ----------
const VIEWS = ['landing', 'input', 'review', 'analyzing', 'error', 'result', 'detail'];
const RENDER = {
  input: () => { $('#review-resume').hidden = !state.file; updatePasteState(); },
  review: () => {
    $('#review-stale').hidden = state.file.source !== 'ocr' || state.file.imagesVersion === imagesVersion;
    renderOcrCheck();
    renderExtractIssues();
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
    detailExists: (id) => Boolean(result?.topics.some((x) => x.id === id && x.visible)),
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
