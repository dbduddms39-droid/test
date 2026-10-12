import { moveItem, planSelection, UPLOAD_MESSAGES, MAX_IMAGES } from './upload-rules.js';
import { copyText } from './questions.js';
import { el, statusBadge, CONTRACT_STATUS_LABEL, sourcePanelLines } from './components.js';
import { ROUTES, checkText, editRouteFor, inputRouteFor, resolveRoute, classifyAnalyzeFailure, formatDateTime } from './flow.js';
import { createTracker, applyEdit, confirmSpan, pendingRanges, unlocatedPending, summary as ocrSummary } from './ocr-spans.js';
import {
  buildIssues, resolveIssue, unresolve, blockingIssues, resetTextDependent, resultNotes, isResolved, setSupplement, shiftAnchors, assembleText,
} from './extract-issues.js';
import { createStore, suggestAlias, StoreError, DEFAULT_ALIAS, NOTE_MAX, newId } from './store.js';
import { buildFollowUps } from './followups.js';
import { DOC_TYPE_LABEL, RELATION_LABEL } from './relate.js';

// 일단확인 클라이언트 (PRD v3.1: 자료 한 건으로 시작 → 지금 확인할 내용 → 입사 건별 기록 → 새 안내 추가).
// - 입력 중인 원문·추출 텍스트는 분석이 끝나 기록으로 저장되기 전까지 이 창의 메모리에만 둔다.
// - 분석이 끝나면 확인한 텍스트·분석 결과·원문 근거를 이 브라우저의 IndexedDB에 기록으로 저장한다(store.js).
//   저장을 다시 읽어 확인한 뒤에만 '저장했어요'라고 표시한다. 서버에는 저장하지 않는다.
// - URL(해시)에는 화면 이름·무작위 기록 ID·항목 번호만 넣는다. 문서 내용·회사명은 넣지 않는다.
const EXTRACTED_NOTE = {
  ocr: '이미지·스캔 문서에서 글자를 인식(OCR)한 뒤 확인·수정한 텍스트예요. 원본과 완전히 같다고 보장할 수 없어요.',
  pdf: 'PDF에서 추출한 뒤 확인·수정한 텍스트예요. 줄 순서나 표 내용이 원본과 다를 수 있어요.',
};
const INPUT_SOURCE_LABEL = { paste: '직접 입력한 텍스트', ocr: '사진·스캔에서 인식해 확인한 텍스트', pdf: 'PDF에서 추출해 확인한 텍스트' };
const ROUTE_NOTICE = {
  no_review: '확인할 추출 텍스트가 없어요. 파일을 다시 올려 텍스트를 추출해 주세요.',
  aborted: '분석을 중단했어요. 입력한 내용은 그대로 있어요.',
  record_missing: '기록을 찾을 수 없어요. 삭제됐거나 다른 브라우저·기기에서 만든 기록일 수 있어요. 기록은 만든 브라우저에만 저장돼요.',
  store_unavailable: '이 브라우저에서는 기록 저장소를 열 수 없어요(시크릿 창이거나 저장이 막혀 있을 수 있어요). 분석은 할 수 있지만 기록이 저장되지 않아요.',
  deleted: '기록을 삭제했어요. 자료·확인 텍스트·분석 결과·원문 근거·메모가 함께 지워졌어요.',
  deleted_all: '이 브라우저의 모든 기록을 삭제했어요.',
};
const SUBMIT_HINT = {
  type: '어떤 자료인지 먼저 골라 주세요.',
  empty: '자료 내용을 입력해 주세요.',
  short: '짧은 내용도 확인할 수 있어요. 적히지 않은 조건은 결과에서 따로 구분해 보여 드려요.',
  too_long: '20,000자 이하로 줄여 주세요.',
  ok: '적힌 근로조건과 원문, 지금 확인할 내용을 정리해 드려요.',
};
// '가상 예시 넣어보기'에 쓰는 가상 문서 (실제 회사·인물 정보 없음). 문서 유형별로 하나씩
const EXAMPLES = {
  job_posting: [
    '[가상 예시] 콘텐츠 운영 담당자 채용',
    '회사명: 가상상사',
    '고용형태: 정규직',
    '연봉: 3,400만원',
    '근무시간: 주 5일, 09:00~18:00',
    '근무지: 서울 마포구 양화로 00',
    '담당업무: 콘텐츠 기획 및 SNS 채널 운영',
  ],
  offer: [
    '[가상 예시] 최종합격을 축하드립니다.',
    '고용형태: 정규직',
    '연봉: 3,600만원',
    '근무시간: 주 5일, 09:00~18:00',
    '근무장소: 서울 소재 사업장',
    '담당업무: 콘텐츠 기획 및 SNS 채널 운영',
    '수습기간: 3개월',
    '수습 중 급여: 별도 협의',
    '상세 근로조건은 입사 시 안내드립니다.',
  ],
  contract: [
    '[가상 예시] 근로계약서',
    '1. 근로계약기간: 기간의 정함이 없음',
    '2. 근무장소: 서울 마포구 양화로 00',
    '3. 업무내용: 콘텐츠 기획 및 SNS 채널 운영',
    '4. 소정근로시간: 09:00~18:00 (휴게 12:00~13:00), 주 40시간',
    '5. 임금: 연봉 3,600만원, 매월 25일 지급',
    '6. 고용형태: 정규직',
    '7. 수습: 입사일부터 3개월, 수습 기간 중 급여는 정규 급여의 90%',
    '8. 연차 유급휴가: 근로기준법에 따라 부여',
  ],
};
const exampleText = (type) => EXAMPLES[type].join('\n');
const EXAMPLE_TEXTS = Object.keys(EXAMPLES).map(exampleText);

// 입력 맥락: 새 기록('new')과 기존 기록마다(기록 ID) 입력란 내용·문서 유형·파일 추출 상태·이미지 목록을 따로 둔다.
// 다른 기록으로 옮겨 가도 입력하던 내용이 다른 기록에 섞이지 않게 한다.
const blankContext = () => ({ docType: null, text: '', tab: 'paste', file: null, images: [], imagesVersion: 0 });
const contexts = { new: blankContext() };

const state = {
  target: { kind: 'new' }, // 지금 입력 중인 대상: 새 기록 / 기존 기록에 추가 { kind: 'add', recordId }
  ctxKey: 'new',
  docType: null,    // 고른 문서 유형
  tab: 'paste',     // 입력 방식
  file: null,       // 파일 추출 결과 { source: 'ocr'|'pdf', original, previews: [{ url, name }], imagesVersion, ownUrls, words, tracker, lastText, issues }
  last: null,       // 마지막 분석 요청 (오류 화면의 재시도·수정에 사용)
  inflight: null,   // 진행 중인 분석 { controller }
  error: null,      // 오류 화면에 보여 줄 { message }
  unsaved: null,    // 분석은 끝났지만 저장하지 못한 결과 { payload, document, alias, aliasSource, baseRecord, error }
  flash: null,      // 기록 화면에 한 번 보여 줄 저장 상태 { kind, text }
  targetRecord: null, // S07에서 추가할 기록 (화면 표시용 사본)
};
const store = createStore();

const $ = (sel) => document.querySelector(sel);
const go = (hash, replace = false) => { if (replace) location.replace(hash); else location.hash = hash; };
const showMsg = (node, text) => { node.textContent = text; node.hidden = !text; };
const inputRoute = () => inputRouteFor(state.target);

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

// ---------- S01 시작 ----------
$('#landing-how').addEventListener('click', () => {
  const target = $('#landing-workflow');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
});

// ---------- S02 자료 등록 · S07 새 안내 추가 ----------
const textarea = $('#doc-text');
const submitBtn = $('#submit-btn');
const inputError = $('#input-error');
const typeRadios = [...document.querySelectorAll('input[name="doc-type"]')];

function updatePasteState() {
  $('#char-count').textContent = textarea.value.length.toLocaleString();
  const c = checkText(textarea.value);
  submitBtn.disabled = !state.docType || !c.ok || Boolean(state.inflight);
  $('#submit-hint').textContent = !state.docType ? SUBMIT_HINT.type : SUBMIT_HINT[c.code ?? 'ok'];
}
textarea.addEventListener('input', () => { inputError.hidden = true; updatePasteState(); });
for (const r of typeRadios) {
  r.addEventListener('change', () => {
    state.docType = r.value;
    contexts[state.ctxKey].docType = r.value;
    inputError.hidden = true;
    updatePasteState();
    if (state.file) updateReviewState();
  });
}
const setTypeRadios = () => { for (const r of typeRadios) r.checked = r.value === state.docType; };

$('#example-btn').addEventListener('click', () => {
  if (!state.docType) {
    state.docType = 'job_posting';
    contexts[state.ctxKey].docType = state.docType;
    setTypeRadios();
  }
  const example = exampleText(state.docType);
  if (textarea.value.trim() && !EXAMPLE_TEXTS.includes(textarea.value) && !confirm('입력란의 내용을 가상 예시로 바꿀까요?')) return;
  textarea.value = example;
  updatePasteState();
  textarea.focus();
});

// 입력 맥락 전환 (새 기록 / 기록별 새 안내)
function saveContext() {
  Object.assign(contexts[state.ctxKey], { docType: state.docType, text: textarea.value, tab: state.tab, file: state.file, images, imagesVersion });
}
function useContext(key) {
  if (key === state.ctxKey) return true;
  if (busy) return false; // 추출 중에는 바꾸지 않는다
  saveContext();
  contexts[key] ??= blankContext();
  const c = contexts[key];
  state.ctxKey = key;
  state.docType = c.docType;
  textarea.value = c.text;
  state.file = c.file;
  images = c.images;
  imagesVersion = c.imagesVersion;
  reviewText.value = state.file ? state.file.lastText : '';
  selectMethod(c.tab === 'upload' ? $('#tab-upload') : $('#tab-paste'));
  renderImages();
  uploadStatus.hidden = true;
  inputError.hidden = true;
  return true;
}
// 저장이 끝난 입력 맥락은 비운다 (같은 내용을 실수로 다시 등록하지 않게)
function resetContext(key) {
  const c = contexts[key];
  if (!c) return;
  if (key === state.ctxKey) {
    if (state.file) state.file.ownUrls.forEach((u) => URL.revokeObjectURL(u));
    images.forEach((img) => URL.revokeObjectURL(img.url));
    state.docType = null;
    state.file = null;
    images = [];
    imagesVersion += 1;
    textarea.value = '';
    reviewText.value = '';
    renderImages();
    uploadStatus.hidden = true;
  }
  contexts[key] = blankContext();
}

const INPUT_TEXT = {
  new: {
    crumb: '자료 등록', title: '어떤 자료로 시작할까요?', submit: '입사조건 정리하기 →',
    lead: '채용공고, 오퍼 문자·메일, 근로계약서 중 지금 가진 자료 하나면 충분해요. 회사명이나 지원일은 적지 않아도 돼요.',
  },
  add: {
    crumb: '새 안내 추가', title: '새로 받은 안내를 추가할까요?', submit: '이 기록에 추가하기 →',
    lead: '새로 받은 자료 한 건을 이 기록에 덧붙여요. 이전 자료와 서로 다르게 적힌 내용이 있으면 출처와 함께 보여 드려요.',
  },
};
async function applyTarget(target) {
  state.target = target;
  useContext(target.kind === 'add' ? target.recordId : 'new');
  const t = INPUT_TEXT[target.kind];
  $('#input-crumb').textContent = t.crumb;
  $('#input-title').textContent = t.title;
  $('#input-lead').textContent = t.lead;
  submitBtn.textContent = t.submit;
  $('#target-banner').hidden = target.kind !== 'add';
  if (target.kind === 'add') {
    const r = state.targetRecord;
    $('#target-alias').textContent = r.alias;
    $('#target-meta').textContent = `등록된 자료 ${r.documents.length}건: ${r.documents.map((d) => DOC_TYPE_LABEL[d.docType]).join(', ')}`;
  }
  setTypeRadios();
  $('#paste-submit-row').hidden = state.tab !== 'paste';
  $('#review-resume').hidden = !state.file;
  updatePasteState();
}
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

// 직접 입력: 입력 화면 → 분석 (붙여넣기에는 별도 확인 화면을 두지 않음)
$('#input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.tab !== 'paste') return;
  if (!state.docType) return showMsg(inputError, '어떤 자료인지 먼저 골라 주세요.');
  const text = textarea.value;
  const c = checkText(text);
  if (!c.ok) return showMsg(inputError, c.code === 'too_long' ? '문서는 20,000자 이하로 입력해 주세요.' : '문서 내용을 입력해 주세요.');
  startAnalysis({ target: state.target, ctxKey: state.ctxKey, docType: state.docType, text, inputSource: 'paste' });
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
const inPreview = (url) => [state.file, ...Object.values(contexts).map((c) => c.file)].some((f) => f?.previews.some((p) => p.url === url));
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
    // 원본 미리보기가 있는 쪽만 '빈 쪽 확인'을 할 수 있다 (미리보기를 못 그리면 원본 대조가 어려움)
    const issues = buildIssues({ failed: out.failedPages ?? [], suspect: out.suspectPages ?? [], unit: 'pdf', previewed: (page) => page <= urls.length });
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
      suspect: out.review.filter((r) => r.quality === 'low').map((r) => ({ index: r.index, reason: r.partial ? 'partial' : 'low_confidence', anchor: r.anchor })),
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
  const unlocated = state.file ? unlocatedPending(state.file.tracker, v) : [];
  // 빈 쪽으로 확인한 쪽은 빼고, 직접 입력한 쪽은 넣은 텍스트로 빈 입력·길이를 검사한다 (문서 전체가 비면 기존처럼 막음)
  const finalText = state.file ? assembleText(v, state.file.issues ?? []).text : v;
  reviewSubmit.disabled = !state.file || !checkText(finalText).ok || Boolean(state.inflight) || blocking.length > 0 || unlocated.length > 0;
  $('#review-restore').disabled = !state.file || (v === state.file.original && !(state.file.issues ?? []).some((x) => x.supplement));
  const blockedMsg = [];
  if (blocking.length) blockedMsg.push(`분석 전에 확인할 추출 문제 ${blocking.length}건을 먼저 처리해 주세요. 위의 '분석 전에 확인할 추출 문제'에서 처리할 수 있어요.`);
  if (unlocated.length) blockedMsg.push(`위치를 찾을 수 없는 불확실한 글자 ${unlocated.length}곳이 있어요. 어느 조건에 영향을 주는지 알 수 없어, '확인이 필요한 글자'에서 원본과 대조해 확인하기 전에는 분석할 수 없어요.`);
  showMsg($('#review-blocked'), blockedMsg.join(' '));
}
function reviewBlocking() { return state.file ? blockingIssues(state.file.issues ?? []) : []; }
// 텍스트가 바뀔 때마다 저신뢰 구간의 위치·상태를 갱신한다
function trackReviewText() {
  if (!state.file) return;
  state.file.tracker = applyEdit(state.file.tracker, state.file.lastText, reviewText.value);
  // 추출 실패한 쪽이 들어갈 자리도 함께 옮긴다 (직접 입력한 내용을 그 쪽 위치에 넣기 위해)
  state.file.issues = shiftAnchors(state.file.issues ?? [], state.file.lastText, reviewText.value);
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
  const unlocated = new Set(unlocatedPending(tracker, reviewText.value).map((x) => x.id));
  $('#ocr-check-count').textContent = sum.pending ? `${sum.total}곳 중 ${sum.pending}곳 확인 필요` : `${sum.total}곳 모두 확인함`;
  $('#ocr-check-list').replaceChildren(...items.map((x) => el('li', { class: `ocr-item is-${x.state}`, 'data-ocr-id': String(x.id) },
    el('div', { class: 'ocr-item-main' },
      el('q', { class: 'ocr-text' }, clip(x.state === 'edited' ? x.editedTo || '(삭제함)' : x.text)),
      el('span', { class: 'ocr-kind' }, OCR_KIND_TEXT[x.kind]),
      el('span', { class: 'ocr-state' }, OCR_STATE_TEXT[x.state])),
    unlocated.has(x.id) ? el('p', { class: 'issue-desc ocr-unlocated' }, '지금 텍스트에서 위치를 찾을 수 없어 어느 조건에 영향을 주는지 알 수 없어요. 원본에서 이 글자가 있던 곳을 찾아 확인한 뒤 눌러 주세요. 확인하기 전에는 분석하지 않아요.') : null,
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
    updateReviewState();
  } else if (span?.start != null) {
    $('#rtab-text').click();
    reviewText.focus();
    reviewText.setSelectionRange(span.start, span.end);
  }
});

// ---------- S-03 분석 전에 확인할 추출 문제 (OCR 처리 정책 2·3) ----------
// 추출 실패(쪽마다 따로): 다시 추출(S-02)하거나, 그 쪽의 입력 칸에 원본 내용을 직접 입력한 뒤 표시해야 분석할 수 있다.
//   글자를 찾지 못한 쪽은 원본 미리보기로 대조해 빈 쪽임을 확인하면 분석 대상에서 뺄 수 있다.
// 일부 누락 의심: 품질 추정일 뿐 실제 누락을 확정하지 않는다. 직접 보완하거나 원본과 비교해 범위를 확인했다고 표시해야 한다.
const ISSUE_REASON_TEXT = {
  partial: '인식한 줄 수가 이미지에서 찾은 글자 줄보다 적어요.',
  low_confidence: '전체 글자 인식 신뢰도가 낮아요.',
};
const ISSUE_STATE_TEXT = {
  manual_input: '원본을 보고 직접 입력함',
  supplemented: '빠진 내용을 직접 보완함',
  range_checked: '원본과 비교해 추출 범위를 확인함',
  blank_confirmed: '원본에서 빈 쪽임을 확인함 (분석에서 제외)',
};
const ISSUE_REFUSED_TEXT = {
  no_page_input: '이 쪽의 입력 칸에 원본 내용을 입력한 뒤 눌러 주세요. 추출 텍스트의 다른 부분을 고치거나 공백만 넣은 것으로는 처리되지 않아요.',
  blank_not_checkable: '원본을 확인하기 어려운 경우라 빈 쪽으로 표시할 수 없어요.',
};
const FAIL_CAUSE_TEXT = {
  no_text_found: '글자를 찾지 못했어요',
  image_decode_failed: '파일을 열지 못했어요(손상 가능)',
};
let issueError = null; // { id, code }

function issueItem(x) {
  const resolved = isResolved(x);
  const failed = x.kind === 'failed';
  const unitName = x.unit === 'pdf' ? '쪽' : '이미지';
  const blankName = x.unit === 'pdf' ? '페이지' : '이미지';
  const title = failed ? `${x.label}: ${FAIL_CAUSE_TEXT[x.code] ?? '글자를 읽지 못했어요'}` : `${x.label}: 일부가 빠졌을 수 있어요`;
  const desc = failed
    ? `이 ${unitName}의 내용은 지금 추출 텍스트에 없어요. 그대로는 분석할 수 없어요. ${x.unit === 'pdf' ? '파일을 다시 올려 추출하거나' : '더 선명한 이미지로 바꿔 다시 추출하거나'}, 원본을 보고 이 ${unitName}의 내용을 아래 칸에 직접 입력해 주세요. 추출 텍스트의 다른 부분을 고친 것으로는 복구한 것으로 보지 않아요.`
    : `${ISSUE_REASON_TEXT[x.reason] ?? ''} 자동으로 추정한 것이라 실제로 빠졌는지는 확정할 수 없어요. 원본과 추출 텍스트를 비교해, 빠진 내용이 있으면 아래 칸에 보완해 주세요. 추출 텍스트의 다른 부분을 고친 것으로는 보완한 것으로 보지 않아요.`;
  const actions = [];
  let input = null;
  let blankNote = null;
  // 쪽별 직접 입력(추출 실패)·직접 보완(일부 누락 의심) 칸. 원본과 비교해 범위만 확인했다면 칸은 쓰지 않아도 된다.
  if (x.resolution !== 'blank_confirmed' && x.resolution !== 'range_checked') {
    const inputId = `issue-input-${x.id}`;
    input = el('div', { class: 'issue-input' },
      el('label', { for: inputId }, failed ? `${x.label} 내용 직접 입력` : `${x.label}에서 빠진 내용 직접 보완`),
      el('textarea', { id: inputId, rows: '4', maxlength: '20000', 'data-issue-input': x.id }));
    input.querySelector('textarea').value = x.supplement ?? '';
  }
  if (!resolved) {
    if (state.file?.previews?.length) actions.push(el('button', { type: 'button', class: 'btn-text', 'data-issue-action': 'view' }, '원본 보기'));
    if (failed) {
      actions.push(el('a', { href: inputRoute(), class: 'btn-text', 'data-issue-action': 'reextract' }, x.unit === 'pdf' ? '파일 다시 올려 추출하기' : '이미지 바꾸고 다시 추출하기'));
      actions.push(el('button', { type: 'button', class: 'icon-btn', 'data-issue-resolve': 'manual_input' }, '원본을 보고 직접 입력했어요'));
      // 글자를 찾지 못했고 원본 미리보기로 대조할 수 있는 경우에만. 시스템이 빈 쪽이라고 정한 것이 아님을 밝힌다.
      if (x.canConfirmBlank) {
        actions.push(el('button', { type: 'button', class: 'icon-btn', 'data-issue-resolve': 'blank_confirmed' }, `원본에서 빈 ${blankName}임을 확인했어요`));
        blankNote = el('p', { class: 'issue-desc' }, `글자를 찾지 못했다는 것만으로 빈 ${blankName}로 보지 않아요. 원본에 정말 아무 내용이 없을 때만 '빈 ${blankName}임을 확인했어요'를 눌러 주세요. 그러면 이 ${unitName}은(는) 분석에서 빠져요.`);
      } else {
        blankNote = el('p', { class: 'issue-desc' }, x.code === 'no_text_found'
          ? `원본 미리보기를 만들지 못해 빈 ${blankName}인지 이 화면에서 확인할 수 없어요. 다시 추출하거나 원본을 보고 직접 입력해 주세요.`
          : '파일을 열거나 그리지 못해 원본을 확인하기 어려워요. 다시 추출하거나 원본을 보고 직접 입력해 주세요.');
      }
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
    input,
    blankNote,
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
    const r = resolveIssue(state.file.issues, id, resolveBtn.dataset.issueResolve);
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

// 쪽별 직접 입력 칸: 목록을 다시 그리지 않고(커서·버튼 클릭 유지) 그 항목의 처리 상태 표시만 바꾼다
$('#extract-issues-list').addEventListener('input', (e) => {
  const id = e.target.dataset?.issueInput;
  if (!id || !state.file) return;
  state.file.issues = setSupplement(state.file.issues, id, e.target.value);
  const issue = state.file.issues.find((x) => x.id === id);
  const item = e.target.closest('[data-issue-id]');
  if (issue.resolution && item) {
    const resolved = isResolved(issue);
    item.classList.toggle('is-resolved', resolved);
    item.querySelector('.issue-kind').textContent = resolved ? '처리함' : '처리 필요 (입력 칸이 비었어요)';
  }
  const open = reviewBlocking().length;
  const total = state.file.issues.length;
  $('#extract-issues-count').textContent = open ? `${total}건 중 ${open}건 처리 필요` : `${total}건 모두 처리함`;
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
  const hasSupplement = (state.file.issues ?? []).some((x) => x.supplement?.trim());
  if ((reviewText.value.trim() || hasSupplement) && !confirm('수정한 내용과 직접 입력한 내용을 지우고 처음 추출한 내용으로 되돌릴까요?')) return;
  reviewText.value = state.file.original;
  // 처음 추출한 상태로 되돌리면 불확실한 글자 표시도 처음 상태(모두 확인 필요)로 돌아간다
  state.file.tracker = createTracker(state.file.original, state.file.words);
  state.file.lastText = state.file.original;
  // 직접 입력·보완한 내용과 표시도 다시 '처리 필요'로 (범위 확인·빈 쪽 확인 표시는 텍스트와 무관해 유지)
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
  trackReviewText();
  // 추출 실패·일부 누락 의심을 처리하지 않았거나, 위치를 찾을 수 없는 불확실한 글자가 남아 있으면 분석하지 않는다
  // (이 버튼은 어떤 문제도 처리한 것으로 보지 않음)
  if (reviewBlocking().length || unlocatedPending(state.file.tracker, reviewText.value).length) return updateReviewState();
  if (!state.docType) return showMsg(reviewError, '어떤 자료인지 먼저 골라 주세요. 이전 화면에서 자료 종류를 고를 수 있어요.');
  // 직접 입력한 쪽은 그 쪽 자리에 넣고, 빈 쪽으로 확인한 쪽은 넣지 않는다. 저신뢰 구간 위치도 넣은 길이만큼 옮긴다.
  const { text, ranges } = assembleText(reviewText.value, state.file.issues ?? [], pendingRanges(state.file.tracker, reviewText.value));
  const c = checkText(text);
  if (!c.ok) return showMsg(reviewError, c.code === 'too_long' ? '문서는 20,000자 이하로 줄여 주세요.' : '분석할 문서 내용을 입력해 주세요.');
  // 사용자가 '이 내용으로 계속하기'를 누른 시점의 확인 텍스트(confirmed_text)만 분석·인용·저장에 쓴다
  startAnalysis({ target: state.target, ctxKey: state.ctxKey, docType: state.docType, text, inputSource: state.file.source, lowConfidence: ranges, extractNotes: resultNotes(state.file.issues ?? []) });
});

// ---------- 분석 → 기록 저장 ----------
function setAnalyzing() {
  updatePasteState();
  updateReviewState();
  $('#retry-btn').disabled = Boolean(state.inflight);
}
const isV22 = (r) => r?.version === 'v2.2' && Array.isArray(r.topics) && r.criteria && typeof r.criteria === 'object';

// /api/analyze 호출. 반환: { ok: true, data } | { ok: false, status, message }
async function requestAnalysis({ docType, text, lowConfidence }, signal) {
  let res = null;
  let data = {};
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType, text, includeCriteria: true, ...(lowConfidence?.length ? { lowConfidence } : {}) }),
      signal,
    });
    data = await res.json().catch(() => ({}));
  } catch {
    if (signal?.aborted) return { ok: false, aborted: true };
    return { ok: false, status: 0, message: '서버에 연결하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
  // 점검 기준 v2.2 형식이 아닌 응답은 결과로 쓰지 않는다
  if (res.ok && isV22(data)) return { ok: true, data };
  if (res.ok) return { ok: false, status: 200, message: '분석 결과 형식을 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  return { ok: false, status: res.status, message: data.error || '분석을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.' };
}
// 저장할 분석 결과 (서버 응답에서 화면·관계 계산에 필요한 것만)
const analysisOf = (data) => ({
  version: data.version, docType: data.docType, counts: data.counts, topics: data.topics, criteria: data.criteria,
  lines: data.lines, sourceGuide: data.sourceGuide, notice: data.notice,
});

// 분석은 사용자가 버튼을 눌렀을 때만 시작한다. 라우트 변경·화면 다시 그리기로는 요청하지 않는다.
async function startAnalysis(payload, { replace = false } = {}) {
  if (state.inflight) return; // 중복 요청 방지
  const controller = new AbortController();
  state.inflight = { controller };
  state.last = payload;
  state.error = null;
  $('#analyzing-title').textContent = `${DOC_TYPE_LABEL[payload.docType]}의 근로조건을 정리하고 있어요.`;
  setAnalyzing();
  go(ROUTES.analyzing, replace);

  const r = await requestAnalysis(payload, controller.signal);
  state.inflight = null;
  setAnalyzing();
  if (controller.signal.aborted || r.aborted) return; // 사용자가 분석 화면을 떠남

  if (!r.ok) {
    if (classifyAnalyzeFailure(r.status) === 'input') {
      showMsg(payload.inputSource === 'paste' ? inputError : reviewError, r.message);
      return go(editRouteFor(payload.inputSource, payload.target), true);
    }
    state.error = { message: r.message };
    return go(ROUTES.error, true);
  }
  const entry = {
    id: newId('doc'), // 다시 저장할 때 같은 자료로 보도록 처음에 정한다
    docType: payload.docType,
    confirmedText: payload.text,
    inputSource: payload.inputSource,
    extractNotes: payload.extractNotes ?? [],
    lowConfidence: payload.lowConfidence ?? [],
    mode: r.data.mode ?? null,
    analysis: analysisOf(r.data),
  };
  const pending = { payload, document: entry };
  if (payload.target.kind === 'new') Object.assign(pending, suggestAliasFor(payload.text), { recordId: newId('rec') });
  await persist(pending, { replace: true });
}
const suggestAliasFor = (text) => { const s = suggestAlias(text); return { alias: s.alias, aliasSource: s.source }; };

// 분석 결과를 기록으로 저장한다. 저장을 다시 읽어 확인한 뒤에만 '저장했어요'. 실패하면 저장하지 않은 결과 화면에서 다시 저장할 수 있다.
async function persist(pending, { replace = false } = {}) {
  const { payload, document: entry } = pending;
  try {
    const record = payload.target.kind === 'add'
      ? await store.addDocument(payload.target.recordId, entry)
      : await store.create({ alias: pending.alias, aliasSource: pending.aliasSource, document: { ...entry, recordId: pending.recordId } });
    state.unsaved = null;
    resetContext(payload.ctxKey);
    if (state.file === null) $('#review-resume').hidden = true;
    state.flash = { kind: 'saved', text: payload.target.kind === 'add'
      ? `새 자료를 이 기록에 추가해 저장했어요(이 브라우저). 이전 자료 ${record.documents.length - 1}건은 그대로 있어요.`
      : '기록을 이 브라우저에 저장했어요. 다음에 이 브라우저에서 \'내 기록\'으로 다시 열 수 있어요.' };
    go(ROUTES.record(record.id), replace);
  } catch (err) {
    // 기존 기록에 추가하다 실패하면, 이전 기록은 그대로이고 새 자료만 저장되지 않은 상태로 보여 준다
    let baseRecord = null;
    if (payload.target.kind === 'add') baseRecord = await store.get(payload.target.recordId).catch(() => null);
    state.unsaved = { ...pending, baseRecord, error: err instanceof StoreError ? err.code : 'save_failed' };
    go(ROUTES.unsaved, replace);
  }
}

$('#retry-btn').addEventListener('click', () => {
  if (state.last) startAnalysis(state.last, { replace: true });
});

function renderError() {
  $('#error-message').textContent = state.error.message;
  $('#error-edit').setAttribute('href', editRouteFor(state.last?.inputSource ?? 'paste', state.last?.target));
  $('#retry-btn').disabled = !state.last || Boolean(state.inflight);
}

// ---------- 항목 설명 (점검 기준 v2.2: 10개 주제, 08은 조건부) ----------
// 세부기준 ID·핵심/추가 구분 코드·출처 코드는 화면에 그대로 보여 주지 않는다 (사용자용 이름만).
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

// ---------- 세부 기준 카드 (S05) ----------
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


// ---------- 공통: 질문 카드 복사 ----------
// 질문은 템플릿으로 만든 초안이다. 사용자가 고쳐 쓴 내용을 그대로 복사한다. 일단확인은 질문을 보내지 않는다.
document.addEventListener('click', async (e) => {
  const one = e.target.closest('button[data-copy]');
  if (!one) return;
  const ok = await copyText(document.getElementById(one.dataset.copy).value);
  const status = one.parentElement.querySelector('.q-status');
  if (status) status.textContent = ok ? '복사했어요. 문자·메일·메신저에 붙여넣어 직접 보내 주세요.' : '복사하지 못했어요. 질문을 직접 선택해 복사해 주세요.';
});

const clipText = (t, n = 80) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
// 문서 유형별 상위 상태 라벨: 근로계약서는 기재 상태를, 채용공고·오퍼는 적힌 사실 중심으로 (판정 규칙은 v2.2 그대로)
const BRIEF_STATUS_LABEL = {
  MAIN_FOUND: '적혀 있어요', MAIN_PARTIAL: '일부만 적혀 있거나 정해지지 않았어요', MAIN_MISSING: '이 자료에서는 확인되지 않아요', MAIN_UNAVAILABLE: '분석 확인 불가',
};
const statusLabelFor = (docType, status) => (docType === 'contract' ? CONTRACT_STATUS_LABEL : BRIEF_STATUS_LABEL)[status];
const ITEM_IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
const topicOf = (doc, id) => doc.analysis?.topics?.find((t) => t.id === id) ?? null;
const itemLabel = (record, id) => record.documents.map((d) => topicOf(d, id)?.label).find(Boolean) ?? id;
const visibleIn = (record, id) => record.documents.some((d) => topicOf(d, id)?.visible);
// 항목의 기재값: 핵심 세부기준의 원문 기재값(검증된 것만). 없으면 null (화면은 인용 줄을 보여 줌)
function topicValue(t) {
  const vals = [...new Set(t.criteria.filter((c) => c.role === 'C' && c.sourceValue && c.status !== 'UNAVAILABLE' && c.status !== 'NOT_APPLICABLE').map((c) => c.sourceValue))];
  return vals.length ? vals.join(' · ') : null;
}
const firstEvidence = (t) => (t.criteria.find((c) => c.required && c.evidence.length) ?? t.criteria.find((c) => c.evidence.length))?.evidence[0] ?? null;
const notesFor = (record, id) => (record.notes ?? []).filter((n) => n.conditionKey === id);

function relationBadge(relation) {
  if (!relation) return null;
  const kind = { same: 'found', different_stated: 'review', newly_stated: 'found', not_mentioned_later: 'missing', incomparable: 'review', unavailable: 'unavailable' }[relation];
  return el('span', { class: `badge badge-${kind} badge-relation`, 'data-relation': relation }, RELATION_LABEL[relation]);
}

let qSeq = 0;
function questionBox(text, label = '회사에 확인할 때 쓸 질문') {
  const id = `q-${qSeq += 1}`;
  const ta = el('textarea', { id, class: 'q-text', rows: '4' });
  ta.value = text;
  return el('div', { class: 'question' },
    el('label', { class: 'q-label', for: id }, `${label} (고쳐 쓸 수 있어요)`),
    ta,
    el('div', { class: 'q-actions' },
      el('button', { type: 'button', class: 'icon-btn', 'data-copy': id }, '질문 복사'),
      el('span', { class: 'q-status muted small', role: 'status', 'aria-live': 'polite' })));
}

function followupCard(f, record, saved) {
  return el('li', { class: `followup is-${f.tier}`, 'data-followup': f.key, 'data-kind': f.kind },
    el('div', { class: 'followup-head' },
      el('h3', { class: 'followup-label' }, f.label),
      el('span', { class: 'tier-tag' }, f.tier === 'primary' ? '우선 확인' : '추가 확인')),
    el('ul', { class: 'followup-reasons' }, f.reasons.map((r) => el('li', {}, r))),
    f.sources.length ? el('div', { class: 'followup-sources' }, f.sources.map((s) => el('div', { class: 'followup-source' },
      el('p', { class: 'src-doc' }, s.docLabel),
      s.quotes.length ? el('ul', { class: 'src-quotes' }, s.quotes.slice(0, 3).map((q) => el('li', {}, el('q', {}, q))))
        : el('p', { class: 'muted small' }, '이 자료에서는 관련 원문을 찾지 못했어요.')))) : null,
    f.question ? questionBox(f.question) : null,
    saved ? el('a', { href: ROUTES.item(record.id, f.topicIds[0]), class: 'btn-text' }, '원문·자료별 내용 자세히 보기 →') : null);
}

// ---------- S04 입사조건 기록 ----------
let currentRecord = null; // 지금 보고 있는 저장된 기록 (S04·S05)

function unsavedRecord() {
  const u = state.unsaved;
  const doc = { ...u.document, id: u.document.id ?? 'doc_unsaved', registeredAt: new Date().toISOString() };
  if (u.baseRecord) return { ...u.baseRecord, documents: [...u.baseRecord.documents, doc] };
  return { id: null, alias: u.alias ?? DEFAULT_ALIAS, documents: [doc], notes: [], updatedAt: doc.registeredAt };
}

function renderRecord(record, { unsaved = false } = {}) {
  const saved = !unsaved;
  const fus = buildFollowUps(record);
  const labels = fus.relation.labels;
  const multi = record.documents.length > 1;

  // 저장 상태: 실제 저장을 확인했을 때만 '저장했어요'
  const status = $('#save-status');
  status.replaceChildren();
  status.className = 'save-status';
  if (unsaved) {
    const u = state.unsaved;
    status.classList.add('is-error');
    status.append(
      el('strong', {}, '저장되지 않았어요. '),
      u.baseRecord ? `새 자료를 기록에 추가하지 못했어요. 이전 기록(자료 ${u.baseRecord.documents.length}건)은 그대로예요. ` : '이 결과는 아직 기록으로 남지 않았어요. 창을 닫으면 사라져요. ',
      u.error === 'unavailable' ? '이 브라우저에서 저장소를 열 수 없어요(시크릿 창이거나 저장이 막혀 있을 수 있어요). ' : '저장 공간이 부족하거나 브라우저가 저장을 막았을 수 있어요. ',
      el('span', { class: 'save-actions' },
        el('button', { type: 'button', class: 'btn-primary btn-auto', id: 'save-retry' }, '다시 저장하기'),
        el('button', { type: 'button', class: 'btn-text', id: 'copy-confirmed' }, '확인한 텍스트 복사')));
    status.hidden = false;
  } else if (state.flash) {
    status.classList.add(`is-${state.flash.kind}`);
    status.textContent = state.flash.text;
    status.hidden = false;
    state.flash = null;
  } else {
    status.hidden = true;
  }

  $('#record-back').hidden = unsaved;
  $('#record-title').textContent = record.alias;
  $('#record-meta').textContent = [
    `등록된 자료 ${record.documents.length}건 (${record.documents.map((d) => labels[d.id]).join(', ')})`,
    saved ? `마지막 저장 ${formatDateTime(record.updatedAt)}` : '저장 전',
    record.aliasSource === 'suggested' ? '기록 이름은 문서에서 찾은 회사명이에요. 바꿀 수 있어요.' : null,
  ].filter(Boolean).join(' · ');
  $('#record-rename-box').hidden = unsaved;
  $('#rename-form').hidden = true;
  $('#rename-open').hidden = false;

  const demo = record.documents.some((d) => d.mode === 'demo');
  const source = $('#analysis-source');
  source.textContent = demo
    ? '데모 결과가 포함돼 있어요. AI 분석이 아니라 개발용 키워드 규칙으로 만든 결과라서 실제 판단에 쓰면 안 돼요.'
    : 'AI가 찾은 내용을 서버가 원문과 대조해 실제로 적힌 문구인지 확인한 뒤, 점검 기준에 따라 정리했어요. 문구가 원문에 있다는 것만 확인했으니, AI의 해석이 맞는지는 원문과 함께 확인해 주세요.';
  source.classList.toggle('analysis-source-demo', demo);

  // 1. 지금 확인할 내용
  $('#now-list').replaceChildren(...fus.primary.map((f) => followupCard(f, record, saved)));
  $('#now-empty').hidden = fus.primary.length > 0;
  $('#now-empty').textContent = fus.more.length
    ? '지금 바로 확인할 내용은 없어요. 필요하면 아래 \'추가로 확인할 내용\'을 살펴보세요.'
    : '이번 자료에서 별도로 제안할 확인 사항이 없어요. 아래 주요 근로조건과 원문을 함께 확인해 주세요.';
  $('#more-box').hidden = !fus.more.length;
  $('#more-count').textContent = `${fus.more.length}건`;
  $('#more-list').replaceChildren(...fus.more.map((f) => followupCard(f, record, saved)));
  $('#reanalyze-box').hidden = !fus.reanalyze.length;
  $('#reanalyze-list').replaceChildren(...fus.reanalyze.map((x) => el('li', {}, `${x.docLabel} · ${x.label}`)));

  // 2. 주요 근로조건
  const hasContract = record.documents.some((d) => d.docType === 'contract');
  $('#conditions-help').textContent = [
    hasContract ? '근로계약서는 주요 항목마다 기재 상태(기재됨·내용이 모호함·문서에서 확인되지 않음·분석 확인 불가)를 보여 드려요.' : null,
    record.documents.some((d) => d.docType !== 'contract') ? '채용공고·오퍼 안내는 적힌 내용을 중심으로 정리해요. 짧은 안내에 없는 조건을 문제로 보지 않아요.' : null,
    multi ? '자료가 여러 건이면 항목마다 자료 사이 관계를 함께 보여 드려요. 관계는 적힌 문구의 차이이며 회사가 조건을 바꿨다는 판단이 아니에요.' : null,
  ].filter(Boolean).join(' ');
  const rows = [];
  const missingOnly = [];
  for (const id of ITEM_IDS) {
    if (!visibleIn(record, id)) continue;
    const per = record.documents.map((d) => ({ d, t: topicOf(d, id) })).filter((x) => x.t?.visible);
    // 계약서가 없고 모든 자료에서 찾지 못한 항목은 한 줄로만 (결함처럼 보이지 않게)
    if (!hasContract && per.every((x) => x.t.status === 'MAIN_MISSING')) { missingOnly.push(itemLabel(record, id)); continue; }
    const rel = fus.relation.items.find((i) => i.id === id);
    const memo = notesFor(record, id).length;
    rows.push(el('li', { class: 'condition', 'data-item': id },
      el('div', { class: 'condition-head' },
        el('h3', {}, itemLabel(record, id)),
        multi ? relationBadge(rel?.relation) : null,
        memo ? el('span', { class: 'memo-flag' }, '내가 기록한 답변 있음') : null),
      el('ul', { class: 'condition-docs' }, per.map(({ d, t }) => {
        const value = t.status === 'MAIN_UNAVAILABLE' ? null : topicValue(t);
        const ev = t.status === 'MAIN_UNAVAILABLE' ? null : firstEvidence(t);
        return el('li', { class: 'condition-doc' },
          el('span', { class: 'cd-doc' }, labels[d.id]),
          statusBadge(t.status, statusLabelFor(d.docType, t.status)),
          value ? el('span', { class: 'cd-value' }, value) : null,
          ev ? el('q', { class: 'cd-quote' }, clipText(ev.text)) : null,
          t.status === 'MAIN_UNAVAILABLE' ? el('span', { class: 'muted small' }, '근거를 확인하지 못해 확정하지 않았어요. 적혀 있지 않다는 뜻이 아니에요.') : null);
      })),
      saved ? el('a', { href: ROUTES.item(record.id, id), class: 'btn-text' }, '자세히 보기 →') : null));
  }
  $('#condition-list').replaceChildren(...rows);
  $('#conditions-missing').hidden = !missingOnly.length;
  $('#conditions-missing').textContent = missingOnly.length ? `등록한 자료에서 찾지 못한 항목: ${missingOnly.join(', ')}. 짧은 안내에는 빠질 수 있어요.` : '';

  // 3. 등록된 안내 자료
  $('#doc-list').replaceChildren(...record.documents.map((d, i) => {
    const unavailable = (d.analysis?.topics ?? []).filter((t) => t.visible && t.status === 'MAIN_UNAVAILABLE');
    const pendingDoc = unsaved && i === record.documents.length - 1;
    return el('li', { class: 'doc-entry', 'data-doc': d.id },
      el('p', { class: 'doc-entry-head' }, el('span', { class: 'mono-index' }, `자료 ${i + 1}`), el('strong', {}, labels[d.id]), pendingDoc ? el('span', { class: 'tag' }, '저장 안 됨') : null),
      el('p', { class: 'muted small' }, [
        INPUT_SOURCE_LABEL[d.inputSource] ?? '확인한 텍스트',
        pendingDoc ? null : `등록 ${formatDateTime(d.registeredAt)}`,
        d.analyzedAt && d.registeredAt && d.analyzedAt > d.registeredAt && !pendingDoc ? `다시 분석 ${formatDateTime(d.analyzedAt)}` : null,
      ].filter(Boolean).join(' · ')),
      d.inputSource !== 'paste' ? el('p', { class: 'small input-source-note' }, [EXTRACTED_NOTE[d.inputSource] ?? '', ...(d.extractNotes ?? [])].join(' ')) : null,
      el('details', { class: 'doc-text' },
        el('summary', {}, `확인한 텍스트 보기 (${d.analysis?.lines?.length ?? 0}줄)`),
        sourcePanelLines(d.analysis?.lines ?? [], new Map())),
      unavailable.length && saved ? el('div', { class: 'reanalyze' },
        el('p', { class: 'small' }, `분석 확인 불가 항목 ${unavailable.length}개(${unavailable.map((t) => t.label).join(', ')})가 있어요. 확인한 텍스트는 그대로 두고 다시 분석할 수 있어요.`),
        el('button', { type: 'button', class: 'icon-btn', 'data-reanalyze': d.id }, '같은 텍스트로 다시 분석하기'),
        el('p', { class: 'muted small reanalyze-status', role: 'status', 'aria-live': 'polite' })) : null);
  }));

  // 4. 필요할 때 하기
  $('#view-record .record-actions').hidden = unsaved;
  if (saved) $('#add-doc').setAttribute('href', ROUTES.add(record.id));
  $('#copy-all-questions').hidden = ![...fus.primary, ...fus.more].some((f) => f.question);
  $('#actions-status').textContent = '';
  $('#record-notice').textContent = `${record.documents[0]?.analysis?.notice ?? ''} 이 기록은 이 브라우저에만 저장돼요. 다른 기기에서는 보이지 않아요.`;
}

$('#view-record').addEventListener('click', async (e) => {
  if (e.target.closest('#save-retry')) {
    e.target.closest('#save-retry').disabled = true;
    return persist(state.unsaved, { replace: true }).then(() => { if (location.hash === ROUTES.unsaved) route(); });
  }
  if (e.target.closest('#copy-confirmed')) {
    const ok = await copyText(state.unsaved.document.confirmedText);
    e.target.closest('#copy-confirmed').textContent = ok ? '복사했어요' : '복사하지 못했어요';
    return;
  }
  const re = e.target.closest('button[data-reanalyze]');
  if (re && currentRecord) return reanalyze(currentRecord, re.dataset.reanalyze, re);
});

// 같은 확인 텍스트로 다시 분석 (분석 확인 불가 복구). 성공했을 때만 그 자료의 분석 결과를 바꾸고, 실패하면 이전 결과를 그대로 둔다.
async function reanalyze(record, docId, btn) {
  const doc = record.documents.find((d) => d.id === docId);
  const status = btn.parentElement.querySelector('.reanalyze-status');
  btn.disabled = true;
  status.textContent = '다시 분석하는 중…';
  const r = await requestAnalysis({ docType: doc.docType, text: doc.confirmedText, lowConfidence: doc.lowConfidence });
  if (!r.ok) {
    btn.disabled = false;
    status.textContent = `다시 분석하지 못했어요. ${r.message} 이전 결과는 그대로예요.`;
    return;
  }
  try {
    await store.replaceAnalysis(record.id, docId, { analysis: analysisOf(r.data), mode: r.data.mode ?? null });
  } catch {
    btn.disabled = false;
    status.textContent = '다시 분석했지만 저장하지 못했어요. 이전 결과는 그대로예요. 잠시 후 다시 시도해 주세요.';
    return;
  }
  const still = r.data.topics.filter((t) => t.visible && t.status === 'MAIN_UNAVAILABLE').length;
  state.flash = { kind: 'saved', text: still ? `다시 분석한 결과를 저장했어요. 아직 분석 확인 불가 항목이 ${still}개 있어요.` : '다시 분석한 결과를 저장했어요. 확인한 텍스트와 등록일은 그대로예요.' };
  route();
}

// 기록 이름 바꾸기 (선택). 비우면 '새 입사 기록'
$('#rename-open').addEventListener('click', () => {
  $('#rename-form').hidden = false;
  $('#rename-open').hidden = true;
  $('#rename-input').value = currentRecord?.alias ?? '';
  $('#rename-error').hidden = true;
  $('#rename-input').focus();
});
$('#rename-cancel').addEventListener('click', () => { $('#rename-form').hidden = true; $('#rename-open').hidden = false; });
$('#rename-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRecord) return;
  try {
    currentRecord = await store.rename(currentRecord.id, $('#rename-input').value);
    state.flash = { kind: 'saved', text: '기록 이름을 저장했어요.' };
    route();
  } catch {
    showMsg($('#rename-error'), '이름을 저장하지 못했어요. 이전 이름은 그대로예요.');
  }
});
$('#copy-all-questions').addEventListener('click', async () => {
  const texts = [...document.querySelectorAll('#view-record .q-text')].map((t) => t.value.trim()).filter(Boolean);
  const ok = texts.length > 0 && await copyText(texts.join('\n\n'));
  $('#actions-status').textContent = ok ? `질문 ${texts.length}개를 복사했어요. 필요한 것만 골라 직접 보내 주세요.` : '복사하지 못했어요. 질문을 직접 선택해 복사해 주세요.';
});
$('#delete-record').addEventListener('click', async () => {
  if (!currentRecord) return;
  if (!confirm(`'${currentRecord.alias}' 기록을 삭제할까요? 등록한 자료·확인한 텍스트·분석 결과·원문 근거·답변 메모가 모두 지워지고 되돌릴 수 없어요.`)) return;
  try {
    await store.remove(currentRecord.id);
    delete contexts[currentRecord.id];
    currentRecord = null;
    pendingNotice = 'deleted';
    go(ROUTES.records);
  } catch {
    $('#actions-status').textContent = '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
});

// ---------- S05 항목 상세 ----------
let memoEditing = null; // 편집 중인 메모 ID 또는 'new'

function renderItem(record, itemId) {
  const fus = buildFollowUps(record);
  const labels = fus.relation.labels;
  const rel = fus.relation.items.find((i) => i.id === itemId);
  const label = itemLabel(record, itemId);
  const multi = record.documents.length > 1;
  $('#item-back').setAttribute('href', ROUTES.record(record.id));

  const head = el('header', { class: 'detail-head' },
    el('p', { class: 'crumb' }, record.alias),
    el('h1', {}, label),
    multi ? relationBadge(rel?.relation) : null);

  // 자료 사이 관계와 그 이유
  const relNotes = multi && rel ? [...new Set(rel.facets.flatMap((f) => f.notes.map((n) => `${f.label} — ${n}`)))] : [];
  const relSec = relNotes.length ? el('section', { class: 'note relation-note' },
    el('p', { class: 'note-title' }, '자료 사이 관계'),
    el('ul', {}, relNotes.map((n) => el('li', {}, n))),
    el('p', { class: 'muted small' }, '자료에 적힌 문구를 비교한 결과예요. 어느 자료가 최종 조건인지, 회사가 조건을 바꿨는지는 판단하지 않아요. 등록 순서가 실제 안내 순서를 보장하지 않아요.')) : null;

  const f = [...fus.primary, ...fus.more].find((x) => x.topicIds.includes(itemId));
  const fuSec = f ? el('section', { class: 'item-followup' },
    el('h2', {}, f.tier === 'primary' ? '지금 확인할 내용' : '추가로 확인할 내용'),
    el('ul', { class: 'followup-reasons' }, f.reasons.map((r) => el('li', {}, r))),
    f.question ? questionBox(f.question) : null) : null;
  const reSec = fus.reanalyze.some((x) => x.topicId === itemId) ? el('p', { class: 'note note-hold' },
    '분석 확인 불가: 근거를 원문에서 확인하지 못했거나 글자 인식이 불확실해 확정하지 않았어요. 적혀 있지 않다는 뜻이 아니에요. 기록 화면의 \'등록된 안내 자료\'에서 같은 텍스트로 다시 분석할 수 있어요.') : null;

  // 자료별 내용과 원문
  const docSecs = record.documents.map((d) => {
    const t = topicOf(d, itemId);
    const title = el('h2', {}, `${labels[d.id]} `, el('span', { class: 'muted small' }, `등록 ${formatDateTime(d.registeredAt)}`));
    if (!t?.visible) {
      return el('section', { class: 'doc-block', 'data-doc': d.id }, title,
        el('p', { class: 'muted' }, itemId === '08' ? '이 자료에는 수습이 적용된다고 적혀 있지 않아 수습 중 급여를 따로 확인하지 않았어요.' : '이 자료에서는 이 항목을 확인하지 않았어요.'));
    }
    const marks = topicMarks(t);
    const core = t.criteria.filter((c) => c.role === 'C');
    const extra = t.criteria.filter((c) => c.role === 'D');
    const notes = [];
    if (t.notes.neutral) notes.push(el('div', { class: 'note note-neutral' }, el('p', { class: 'note-title' }, '적힌 내용에 대한 안내'), el('p', {}, t.notes.neutral)));
    if (t.notes.applicability) notes.push(el('div', { class: 'note note-applicability' }, el('p', { class: 'note-title' }, '법령 적용 범위 안내'), el('p', {}, t.notes.applicability), linkList(t.applicabilityLinks)));
    if (t.notes.probationHold) notes.push(el('div', { class: 'note note-hold' }, el('p', { class: 'note-title' }, '수습 중 급여 항목을 판정하지 않은 이유'), el('p', {}, t.notes.probationHold)));
    return el('section', { class: 'doc-block', 'data-doc': d.id },
      title,
      el('p', { class: 'doc-block-status' }, statusBadge(t.status, statusLabelFor(d.docType, t.status)), el('span', { class: 'small' }, topicSummary(t))),
      el('div', { class: 'card-list' }, core.map(criterionCard)),
      extra.length ? el('details', { class: 'extra-criteria' }, el('summary', {}, `추가 세부 기준 ${extra.length}개`), el('div', { class: 'card-list is-compact' }, extra.map(criterionCard))) : null,
      ...notes,
      el('div', { class: 'paper-sheet' },
        el('p', { class: 'memo-title' }, d.inputSource === 'paste' ? '원문 근거' : '원문 근거 (추출·확인한 텍스트)'),
        marks.size ? sourcePanelLines(d.analysis.lines, marks, { onlyMarked: true })
          : el('p', { class: 'muted small' }, t.status === 'MAIN_UNAVAILABLE' ? '근거를 확인하지 못해 원문을 표시하지 않아요.' : '이 항목과 관련된 원문을 찾지 못했어요.'),
        el('details', {}, el('summary', {}, '확인한 텍스트 전체 보기'), sourcePanelLines(d.analysis.lines, marks))));
  });

  // 내가 기록한 답변 (선택 입력)
  const memos = notesFor(record, itemId);
  const memoSec = el('section', { class: 'memo', 'aria-labelledby': 'memo-title' },
    el('h2', { id: 'memo-title' }, '내가 기록한 답변 (선택)'),
    el('p', { class: 'muted small' }, '회사에서 들은 답변 등을 직접 적어 둘 수 있어요. 쓰지 않아도 돼요. 일단확인이 확인한 내용이 아니며, 회사 확인이나 최종 조건으로 표시되지 않아요. 분석 결과와 원문은 바뀌지 않아요.'),
    el('ul', { class: 'memo-list' }, memos.map((n) => (memoEditing === n.id ? memoForm(n) : el('li', { class: 'memo-item', 'data-note': n.id },
      el('p', { class: 'memo-label' }, '내가 기록한 답변'),
      el('p', { class: 'memo-text' }, n.text),
      el('p', { class: 'muted small' }, `메모 작성 ${formatDateTime(n.createdAt)}${n.updatedAt !== n.createdAt ? ` · 수정 ${formatDateTime(n.updatedAt)}` : ''} (메모를 쓴 날짜이며 회사 답변일이 아니에요)`),
      el('div', { class: 'memo-actions' },
        el('button', { type: 'button', class: 'btn-text', 'data-memo-edit': n.id }, '수정'),
        el('button', { type: 'button', class: 'btn-text danger', 'data-memo-delete': n.id }, '삭제')))))),
    memoEditing === 'new' ? memoForm(null) : el('button', { type: 'button', class: 'btn-editorial btn-auto', id: 'memo-add' }, '답변 메모 추가'),
    el('p', { class: 'muted small', id: 'memo-status', role: 'status', 'aria-live': 'polite' }));

  const t0 = record.documents.map((d) => topicOf(d, itemId)).find((t) => t?.visible);
  const sourceSec = t0 ? el('details', { class: 'source-accordion' },
    el('summary', {}, el('span', { class: 'source-title' }, '이 기준은 어디에서 왔나요?'), el('span', { class: 'toggle-text' }, '자세히 보기')),
    el('div', { class: 'source-body' },
      el('p', {}, '일단확인의 점검 기준은 관련 법령과 공식 서식을 참고해 설계한 자체 확인 기준이며, 법률 자문이나 유권해석이 아니에요.'),
      el('table', { class: 'source-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '세부 기준'), el('th', { scope: 'col' }, '기준 출처 유형'))),
        el('tbody', {}, t0.criteria.map((c) => el('tr', {}, el('td', {}, c.label), el('td', {}, c.sources.map((k) => el('span', { class: 'source-badge' }, SOURCE_LABEL[k]))))))),
      t0.links.length ? linkList(t0.links) : null)) : null;

  $('#item').replaceChildren(head, relSec, fuSec, reSec, ...docSecs, memoSec, sourceSec,
    el('div', { class: 'detail-actions' }, el('a', { href: ROUTES.record(record.id), class: 'btn-editorial btn-auto' }, '← 기록으로 돌아가기')));
}

function memoForm(note) {
  const ta = el('textarea', { id: 'memo-text', rows: '4', maxlength: String(NOTE_MAX) });
  ta.value = note?.text ?? '';
  return el('li', { class: 'memo-form' },
    el('label', { for: 'memo-text' }, note ? '메모 고치기' : '새 메모'),
    ta,
    el('div', { class: 'memo-actions' },
      el('button', { type: 'button', class: 'icon-btn', id: 'memo-save', 'data-note': note?.id ?? '' }, '메모 저장'),
      el('button', { type: 'button', class: 'btn-text', id: 'memo-cancel' }, '취소')));
}

$('#item').addEventListener('click', async (e) => {
  if (!currentRecord) return;
  const itemId = location.hash.split('/').pop();
  const status = () => $('#memo-status');
  if (e.target.closest('#memo-add')) { memoEditing = 'new'; renderItem(currentRecord, itemId); $('#memo-text').focus(); return; }
  const edit = e.target.closest('[data-memo-edit]');
  if (edit) { memoEditing = edit.dataset.memoEdit; renderItem(currentRecord, itemId); $('#memo-text').focus(); return; }
  if (e.target.closest('#memo-cancel')) { memoEditing = null; renderItem(currentRecord, itemId); return; }
  const save = e.target.closest('#memo-save');
  if (save) {
    const text = $('#memo-text').value;
    if (!text.trim()) { status().textContent = '메모 내용을 입력해 주세요. 메모를 남기지 않으려면 취소를 눌러 주세요.'; return; }
    try {
      await store.saveNote(currentRecord.id, { id: save.dataset.note || undefined, conditionKey: itemId, text });
      currentRecord = await store.get(currentRecord.id);
      memoEditing = null;
      renderItem(currentRecord, itemId);
      status().textContent = '메모를 이 브라우저에 저장했어요.';
    } catch {
      status().textContent = '메모를 저장하지 못했어요. 입력한 내용은 그대로 있어요. 잠시 후 다시 저장해 주세요.';
    }
    return;
  }
  const del = e.target.closest('[data-memo-delete]');
  if (del) {
    if (!confirm('이 메모를 삭제할까요?')) return;
    try {
      await store.deleteNote(currentRecord.id, del.dataset.memoDelete);
      currentRecord = await store.get(currentRecord.id);
      renderItem(currentRecord, itemId);
      status().textContent = '메모를 삭제했어요.';
    } catch {
      status().textContent = '메모를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
    }
    return;
  }
  // 원문 근거 칩 → 같은 자료의 원문 줄로 이동해 강조
  const chip = e.target.closest('.evidence-chip');
  if (chip) {
    const block = chip.closest('.doc-block');
    const line = block?.querySelector(`.paper-sheet > .doc-lines [data-line="${chip.dataset.line}"]`);
    if (!line) return;
    block.querySelectorAll('.doc-line.is-focused').forEach((x) => x.classList.remove('is-focused'));
    line.classList.add('is-focused');
    line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});

// ---------- S06 내 기록 목록 ----------
async function renderRecords() {
  let list = [];
  let failed = false;
  $('#records-notice').hidden = true;
  try { list = await store.list(); } catch { failed = true; }
  if (failed) showMsg($('#records-notice'), ROUTE_NOTICE.store_unavailable);
  $('#records-empty').hidden = list.length > 0 || failed;
  $('#records-new').hidden = list.length === 0;
  $('#delete-all').hidden = list.length === 0;
  $('#records-status').textContent = '';
  $('#record-list').replaceChildren(...list.map((r) => el('li', { class: 'record-card', 'data-record': r.id },
    el('a', { href: ROUTES.record(r.id), class: 'record-link' },
      el('span', { class: 'record-name' }, r.alias),
      el('span', { class: 'muted small' }, `자료 ${r.documents.length}건 · ${r.documents.map((d) => DOC_TYPE_LABEL[d.docType]).join(', ')}`),
      el('span', { class: 'muted small' }, `마지막 저장 ${formatDateTime(r.updatedAt)}${r.notes?.length ? ` · 내 메모 ${r.notes.length}개` : ''}`)),
    el('button', { type: 'button', class: 'btn-text danger', 'data-delete': r.id }, '삭제'))));
}
$('#record-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-delete]');
  if (!b) return;
  const name = b.closest('.record-card').querySelector('.record-name').textContent;
  if (!confirm(`'${name}' 기록을 삭제할까요? 등록한 자료·확인한 텍스트·분석 결과·원문 근거·답변 메모가 모두 지워지고 되돌릴 수 없어요.`)) return;
  try {
    await store.remove(b.dataset.delete);
    delete contexts[b.dataset.delete];
    await renderRecords();
    showMsg($('#records-notice'), ROUTE_NOTICE.deleted);
  } catch {
    $('#records-status').textContent = '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
});
$('#delete-all').addEventListener('click', async () => {
  if (!confirm('이 브라우저에 저장된 모든 입사 기록을 삭제할까요? 자료·확인 텍스트·분석 결과·원문 근거·메모가 모두 지워지고 되돌릴 수 없어요.')) return;
  try {
    await store.removeAll();
    for (const k of Object.keys(contexts)) if (k !== 'new') delete contexts[k];
    await renderRecords();
    showMsg($('#records-notice'), ROUTE_NOTICE.deleted_all);
  } catch {
    $('#records-status').textContent = '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
});

// ---------- 라우팅 ----------
const VIEWS = ['landing', 'input', 'review', 'analyzing', 'error', 'record', 'item', 'records'];
let pendingNotice = null;
let routeSeq = 0;

// 기록이 필요한 화면은 저장소에서 읽는다. 없으면(삭제·다른 브라우저) 목록으로 안내한다.
async function loadRecord(id) {
  try { return await store.get(id); } catch (e) {
    pendingNotice = e?.code === 'not_found' ? 'record_missing' : 'store_unavailable';
    return null;
  }
}

async function route() {
  const seq = (routeSeq += 1);
  const r = resolveRoute(location.hash, {
    hasReview: Boolean(state.file),
    analyzing: Boolean(state.inflight),
    hasError: Boolean(state.error),
    hasUnsaved: Boolean(state.unsaved),
    lastTarget: state.last?.target ?? state.target,
  });
  // 분석 화면을 떠나면(뒤로 가기 등) 진행 중인 요청을 취소하고 결과를 쓰지 않는다
  if (state.inflight && r.view !== 'analyzing') {
    state.inflight.controller.abort();
    state.inflight = null;
    pendingNotice = 'aborted';
  }
  if (r.redirect) {
    if (r.notice) pendingNotice = r.notice;
    if (r.notice === 'no_review') selectMethod($('#tab-upload'));
    location.replace(r.redirect);
    return;
  }
  let record = null;
  const recordId = r.recordId ?? r.target?.recordId;
  if (recordId) {
    record = await loadRecord(recordId);
    if (seq !== routeSeq) return; // 그사이 다른 화면으로 이동함
    if (!record) { location.replace(ROUTES.records); return; }
    if (r.view === 'item' && !visibleIn(record, r.itemId)) { location.replace(ROUTES.record(record.id)); return; }
  }
  if (r.view !== 'item') memoEditing = null;
  currentRecord = r.unsaved ? null : record;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== r.view;
  document.body.dataset.view = r.view;
  if (r.view === 'input') { state.targetRecord = record; await applyTarget(r.target); }
  else if (r.view === 'record') renderRecord(r.unsaved ? unsavedRecord() : record, { unsaved: Boolean(r.unsaved) });
  else if (r.view === 'item') renderItem(record, r.itemId);
  else if (r.view === 'records') await renderRecords();
  else if (r.view === 'review') {
    $('#review-back').setAttribute('href', inputRoute());
    $('#review-back-top').setAttribute('href', inputRoute());
    reviewSubmit.textContent = state.target.kind === 'add' ? '이 내용으로 계속하기 (기록에 추가) →' : '이 내용으로 계속하기 →';
    $('#review-stale').hidden = state.file.source !== 'ocr' || state.file.imagesVersion === imagesVersion;
    renderOcrCheck();
    renderExtractIssues();
    updateReviewState();
    renderPreview();
  } else if (r.view === 'error') renderError();

  // 한 번만 보여 줄 안내 (분석 중단, 기록 없음, 삭제 완료 등)
  const notice = { input: $('#route-notice'), review: $('#review-notice'), records: $('#records-notice') }[r.view];
  $('#route-notice').hidden = true;
  $('#review-notice').hidden = true;
  if (r.view !== 'records') $('#records-notice').hidden = true;
  if (notice && pendingNotice) showMsg(notice, ROUTE_NOTICE[pendingNotice]);
  if (r.view !== 'analyzing') pendingNotice = null;

  window.scrollTo(0, 0);
  if (r.view === 'analyzing' || r.view === 'error') $(`#${r.view}-title`).focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
updatePasteState();

fetch('/api/config').then((r) => r.json()).then((c) => { $('#mode-badge').hidden = c.mode !== 'demo'; }).catch(() => {});
