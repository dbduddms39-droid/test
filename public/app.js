import { moveItem, planSelection, UPLOAD_MESSAGES, MAX_IMAGES } from './upload-rules.js';
import { copyText, josa } from './questions.js';
import { el, fill, statusBadge, CONTRACT_STATUS_LABEL, sourcePanelLines, highlightText } from './components.js';
import { compareStatus, evidenceFor, topicEvidence, documentTitle, singleStatus, COMPARE_STATUS, STATUS_ORDER, SINGLE_STATUS } from './compare-view.js';
import { ROUTES, checkText, editRouteFor, inputRouteFor, resolveRoute, classifyAnalyzeFailure, formatDateTime } from './flow.js';
import { createTracker, applyEdit, confirmSpan, pendingRanges, unlocatedPending, summary as ocrSummary, remapTracker } from './ocr-spans.js';
import {
  buildIssues, resolveIssue, unresolve, blockingIssues, resetTextDependent, resultNotes, isResolved, setSupplement, shiftAnchors, assembleText, remapAnchors } from './extract-issues.js';
import { createStore, userAlias, StoreError, DEFAULT_ALIAS, NOTE_MAX, newId } from './store.js';
import { buildFollowUps, BOUNDARY_TEXT, deferral, detailOnly, weeklyCalc } from './followups.js';
import { summaryEvidence, externallyReferencedLeave } from './result-presentation.js';
import { comparisonPair, comparisonView, replaceComparedDocument } from './comparison-selection.js';
import { initSampleDownloads } from './samples.js';
import { alignLayout, headingHasMarker, layoutText, positionMap } from './text-layout.js';
import { reportText, questionsText, sideText, REPORT_NOTICES } from './compare-report.js';
import { DOC_TYPE_LABEL, RELATION_LABEL, docLabels } from './relate.js';

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
  deleted: '기록을 삭제했어요. 자료·확인 텍스트·분석 결과·원문 근거·원본 PDF·메모가 함께 지워졌어요.',
  deleted_files_left: '기록은 삭제했지만 이 기록의 원본 PDF 일부를 지우지 못했어요. \'이 브라우저의 모든 기록 삭제\'로 정리할 수 있어요.',
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
    '[가상 예시] 주식회사 파란스텝 콘텐츠 마케터 채용',
    '회사명: 주식회사 파란스텝',
    '모집 직무: 콘텐츠 마케터 (경력 2~4년)',
    '담당업무: 브랜드 SNS 콘텐츠 기획·제작, 캠페인 성과 분석',
    '고용형태: 정규직',
    '근무지: 서울 성동구 성수이로 00, 4층',
    '근무시간: 주 5일(월~금), 09:00~18:00',
    '휴게시간: 12:00~13:00',
    '급여: 연봉 3,400만~3,800만 원, 경력에 따라 협의',
    '수습기간: 3개월',
    '수습 급여: 최종 합격 시 별도 안내',
  ],
  offer: [
    '[가상 예시] 주식회사 파란스텝 최종 합격 안내',
    '콘텐츠 마케터 포지션에 최종 합격하신 것을 축하드립니다. 처우 조건을 아래와 같이 안내드립니다.',
    '- 연봉: 3,600만 원',
    '- 근무시간: 10:00~19:00 (휴게시간 13:00~14:00), 주 5일',
    '- 근무지: 서울 성동구 성수이로 00, 4층',
    '- 고용형태: 정규직',
    '- 수습기간: 3개월',
    '- 수습기간 급여 조건은 근로계약서에 기재될 예정입니다.',
  ],
  contract: [
    '[가상 예시] 근로계약서 (주식회사 파란스텝)',
    '1. 근로계약기간: 2026년 11월 2일부터 기간의 정함이 없음',
    '2. 근무장소: 서울 성동구 성수이로 00, 4층',
    '3. 업무내용: 브랜드 SNS 콘텐츠 기획·제작 및 캠페인 성과 분석',
    '4. 소정근로시간: 10:00~19:00 (휴게시간 13:00~14:00), 주 5일, 주 40시간',
    '5. 임금: 연봉 3,600만 원(세전), 매월 25일 지급',
    '6. 고용형태: 정규직',
    '7. 수습기간: 2026년 11월 2일부터 2027년 2월 1일까지(3개월)',
    '8. 수습기간 중 임금: 월 270만 원(세전, 정규 급여의 90%)',
    '9. 휴일: 주휴일 매주 일요일',
    '10. 연차 유급휴가: 근로기준법에 따라 부여',
  ],
};
const exampleText = (type) => EXAMPLES[type].join('\n');
const EXAMPLE_TEXTS = Object.keys(EXAMPLES).map(exampleText);

// 입력 맥락: 새 기록('new')과 기존 기록마다(기록 ID) 입력란 내용·문서 유형·파일 추출 상태·이미지 목록을 따로 둔다.
// 다른 기록으로 옮겨 가도 입력하던 내용이 다른 기록에 섞이지 않게 한다.
const blankContext = () => ({ docType: null, text: '', tab: 'paste', file: null, images: [], imagesVersion: 0 });
const contexts = { new: blankContext() };
const pairByRecord = new Map();

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
// 체험용 가상 문서 다운로드 (시작 화면 전용, public/samples/의 파일이 모두 있을 때만 표시)
// 파일이 있을 때만 히어로의 '체험용 가상문서 받기 ↓'를 보여 준다
initSampleDownloads({ root: $('#sample-download'), list: $('#sample-dl-list'), zipButton: $('#sample-zip'), status: $('#sample-status'), el })
  .then((ok) => { $('#landing-how').hidden = !ok; });
$('#landing-how').addEventListener('click', () => {
  const target = $('#sample-download');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  flashTarget(target);
});
// 이동한 위치를 잠깐 강조한다 (모바일에서도 지금 어디를 보는지 알 수 있게)
function flashTarget(node) {
  if (!node) return;
  node.classList.remove('is-arrived');
  void node.offsetWidth; // 같은 곳으로 다시 이동해도 강조가 다시 보이게
  node.classList.add('is-arrived');
  setTimeout(() => node.classList.remove('is-arrived'), 2400);
}

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
    lead: '채용공고, 근로계약서, 처우·근로조건 안내(문자·메일 등) 중 받은 자료 하나부터 등록할 수 있어요. 회사명이나 지원일은 적지 않아도 돼요.',
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
    $('#target-alias').textContent = recordLabel(r);
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
  fill(imageList, ...images.map((img, i) => {
    const btn = (label, action, disabled) => {
      const b = el('button', { type: 'button', class: 'btn-small', 'aria-label': `${i + 1}번째 이미지 ${label}`, 'data-action': action, 'data-index': String(i) }, label);
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
// pdfFile: 올린 PDF 원본 (기록에 원본으로 저장한다. 이미지는 원본을 저장하지 않음)
function applyExtracted(text, source, previews, ownUrls = [], words = [], issues = [], pdfFile = null) {
  const reviewText = $('#review-text');
  if (state.file && reviewText.value.trim() && reviewText.value !== state.file.original && reviewText.value !== state.file.formatted
    && !confirm('확인·수정하던 추출 텍스트를 새로 추출한 내용으로 바꿀까요?')) {
    ownUrls.forEach((u) => URL.revokeObjectURL(u));
    return false;
  }
  const old = state.file;
  // OCR이 알려 준 불확실한 글자의 위치를 추적한다 (사용자가 고치거나 원본과 대조해 확인한 곳만 해제)
  state.file = { source, original: text, previews, imagesVersion, ownUrls, words, tracker: createTracker(text, words), lastText: text, issues, pdfFile };
  if (old) {
    old.ownUrls.forEach((u) => URL.revokeObjectURL(u));
    // 목록에서 이미 지운 이미지의 URL은 이제 해제한다
    old.previews.filter((p) => !images.some((img) => img.url === p.url) && !old.ownUrls.includes(p.url)).forEach((p) => URL.revokeObjectURL(p.url));
  }
  reviewText.value = text;
  preview.page = 0;
  preview.zoom = 100;
  $('#original-text-body').textContent = text;
  $('#original-text').open = false;
  setReviewEditing(false);
  // 업로드 화면에서 'Gemini 줄바꿈 정리'를 켠 경우에만 (끄면 AI로 보내지 않고 추출 텍스트 그대로)
  state.file.layoutStatus = $('#ai-layout').checked && text.trim() ? 'pending' : 'off';
  showLayoutStatus();
  if (state.file.layoutStatus === 'pending') runAutoLayout(state.file);
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
    if (!applyExtracted(out.text, out.method === 'pdf-text' ? 'pdf' : 'ocr', previews, urls, out.uncertainAll ?? [], issues, file)) {
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
  if (!reviewEditing) renderReadView();
}

// ---------- S-03 읽기 화면 · 자동 줄바꿈 정리 ----------
// 추출이 끝나면(업로드 화면에서 'Gemini 줄바꿈 정리'를 켠 경우만) 추출 텍스트를 /api/layout으로 보내
// 제목·항목·문장 단위로 줄을 나눈 결과를 받는다. 서버와 브라우저가 모두 원문과 글자 단위로 대조해 같을 때만 적용한다.
// 적용은 공백·줄바꿈만 바꾸는 편집이라 불확실한 글자·직접 입력 위치를 글자 단위로 옮긴다 (확인 상태는 그대로).
// 원래 추출 텍스트(state.file.original)는 그대로 두고 '원래 추출 텍스트로'로 되돌릴 수 있다.
let reviewEditing = false;
const LAYOUT_STATUS = {
  off: 'AI 줄바꿈 정리 없이 추출한 텍스트를 그대로 보여 드려요. 원본과 비교해 확인해 주세요.',
  pending: 'Gemini로 제목·항목별 줄바꿈을 정리하는 중이에요… 잠시 추출한 텍스트를 그대로 보여 드려요.',
  done: 'Gemini가 제목·항목별로 줄만 나눴어요. 글자·숫자·금액은 원문과 같은지 확인했어요. 원본과 비교해 확인해 주세요.',
  failed: '줄바꿈 정리를 적용하지 못해 추출한 텍스트를 그대로 보여 드려요. 필요한 곳은 직접 고쳐 주세요.',
  skipped: '텍스트를 먼저 고쳐서 줄바꿈 정리 결과는 적용하지 않았어요.',
  restored: '정리 전 추출 텍스트로 되돌렸어요.',
};
function showLayoutStatus() {
  const f = state.file;
  $('#layout-status').textContent = f ? `${LAYOUT_STATUS[f.layoutStatus ?? 'off']}${f.layoutStatus === 'failed' && f.layoutError ? ` (${f.layoutError})` : ''}` : '';
}
function renderReadView() {
  const lay = state.file?.layout;
  const heads = new Set(lay?.headings ?? []);
  const items = new Set(lay?.items ?? []);
  const lines = reviewText.value.split('\n');
  const nodes = [];
  let gap = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (nodes.length && !gap) { nodes.push(el('div', { class: 'rv-gap', 'aria-hidden': 'true' })); gap = true; } continue; }
    gap = false;
    if (heads.has(t)) nodes.push(el('h3', { class: `rv-heading${headingHasMarker(t) ? '' : ' with-marker'}` }, t));
    else nodes.push(el('p', { class: items.has(t) ? 'rv-item' : 'rv-text' }, t));
  }
  fill($('#read-view'), ...(nodes.length ? nodes : [el('p', { class: 'muted' }, "추출된 텍스트가 없어요. '텍스트 수정하기'를 눌러 직접 입력해 주세요.")]));
}
function setReviewEditing(on) {
  reviewEditing = on;
  reviewText.hidden = !on;
  $('#read-view').hidden = on;
  $('#review-select').hidden = !on;
  $('#review-clear').hidden = !on;
  $('#review-edit').textContent = on ? '수정 완료 · 읽기 화면으로' : '텍스트 수정하기';
  $('#review-mode-tag').textContent = on ? '수정 중' : '읽기 화면';
  if (on) reviewText.focus({ preventScroll: true });
  else renderReadView();
}
$('#review-edit').addEventListener('click', () => setReviewEditing(!reviewEditing));
async function runAutoLayout(file) {
  const source = file.original;
  file.layoutStatus = 'pending';
  if (state.file === file) showLayoutStatus();
  let blocks = null;
  try {
    const res = await fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: source }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) blocks = alignLayout(source, data.blocks); // 서버 검증과 별도로 다시 대조
    else file.layoutError = data.error ?? null;
  } catch { file.layoutError = '서버에 연결하지 못했어요'; }
  if (state.file !== file) return; // 그사이 다른 파일을 추출함
  const text = blocks ? layoutText(blocks) : null;
  const map = text ? positionMap(source, text) : null;
  if (!map) {
    file.layoutStatus = 'failed';
    if (blocks && !file.layoutError) file.layoutError = '정리 결과가 원문과 일치하지 않음';
  } else if (reviewText.value !== source || file.lastText !== source) {
    file.layoutStatus = 'skipped'; // 사용자가 이미 고친 텍스트는 덮어쓰지 않는다
  } else {
    file.tracker = remapTracker(file.tracker, map, text);
    file.issues = remapAnchors(file.issues ?? [], map);
    reviewText.value = text;
    file.lastText = text;
    file.formatted = text;
    file.layout = { headings: blocks.filter((b) => b.kind === 'heading').map((b) => b.text), items: blocks.filter((b) => b.kind === 'item').map((b) => b.text) };
    file.layoutStatus = 'done';
    renderOcrCheck();
    renderExtractIssues();
  }
  showLayoutStatus();
  updateReviewState();
}
$('#ai-layout').addEventListener('change', () => {
  $('#extract-btn').textContent = $('#ai-layout').checked ? '텍스트 추출 + Gemini 줄바꿈 정리' : '텍스트만 추출 (AI 전송 없음)';
});
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
  fill($('#ocr-check-list'), ...items.map((x) => el('li', { class: `ocr-item is-${x.state}`, 'data-ocr-id': String(x.id) },
    el('div', { class: 'ocr-item-main' },
      el('q', { class: 'ocr-text' }, clip(x.state === 'edited' ? x.editedTo || '(삭제함)' : x.text)),
      el('span', { class: 'ocr-kind' }, OCR_KIND_TEXT[x.kind]),
      el('span', { class: 'ocr-state' }, OCR_STATE_TEXT[x.state])),
    unlocated.has(x.id) ? el('p', { class: 'issue-desc ocr-unlocated' }, '지금 텍스트에서 위치를 찾을 수 없어 어느 조건에 영향을 주는지 알 수 없어요. 원본에서 이 글자가 있던 곳을 찾아 확인한 뒤 눌러 주세요. 확인하기 전에는 분석하지 않아요.') : null,
    x.state === 'pending' ? el('div', { class: 'ocr-item-actions' },
      x.start != null ? el('button', { type: 'button', class: 'btn-small', 'data-ocr-action': 'locate' }, '위치 보기') : null,
      el('button', { type: 'button', class: 'btn-small', 'data-ocr-action': 'confirm' }, '원본과 대조해 확인했어요')) : null)));
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
    setReviewEditing(true); // 글자 위치는 입력칸에서 보여 준다
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
    if (state.file?.previews?.length) actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-action': 'view' }, '원본 보기'));
    if (failed) {
      actions.push(el('a', { href: inputRoute(), class: 'btn-small', 'data-issue-action': 'reextract' }, x.unit === 'pdf' ? '파일 다시 올려 추출하기' : '이미지 바꾸고 다시 추출하기'));
      actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-resolve': 'manual_input' }, '원본을 보고 직접 입력했어요'));
      // 글자를 찾지 못했고 원본 미리보기로 대조할 수 있는 경우에만. 시스템이 빈 쪽이라고 정한 것이 아님을 밝힌다.
      if (x.canConfirmBlank) {
        actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-resolve': 'blank_confirmed' }, `원본에서 빈 ${blankName}임을 확인했어요`));
        blankNote = el('p', { class: 'issue-desc' }, `글자를 찾지 못했다는 것만으로 빈 ${blankName}로 보지 않아요. 원본에 정말 아무 내용이 없을 때만 '빈 ${blankName}임을 확인했어요'를 눌러 주세요. 그러면 이 ${josa(unitName, '은/는')} 분석에서 빠져요.`);
      } else {
        blankNote = el('p', { class: 'issue-desc' }, x.code === 'no_text_found'
          ? `원본 미리보기를 만들지 못해 빈 ${blankName}인지 이 화면에서 확인할 수 없어요. 다시 추출하거나 원본을 보고 직접 입력해 주세요.`
          : '파일을 열거나 그리지 못해 원본을 확인하기 어려워요. 다시 추출하거나 원본을 보고 직접 입력해 주세요.');
      }
    } else {
      actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-resolve': 'supplemented' }, '빠진 내용을 직접 보완했어요'));
      actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-resolve': 'range_checked' }, '원본과 비교해 추출 범위를 확인했어요'));
    }
  } else {
    actions.push(el('span', { class: 'issue-state' }, ISSUE_STATE_TEXT[x.resolution]));
    actions.push(el('button', { type: 'button', class: 'btn-small', 'data-issue-action': 'undo' }, '표시 취소'));
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
  fill($('#extract-issues-list'), ...issues.map(issueItem));
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
  const edited = state.file && reviewText.value.trim() && reviewText.value !== state.file.original && reviewText.value !== state.file.formatted;
  if (edited && !confirm('수정한 내용을 모두 지울까요? 처음 추출한 내용은 \'원래 내용으로\'로 되돌릴 수 있어요.')) return;
  reviewText.value = '';
  trackReviewText();
  updateReviewState();
  reviewText.focus();
});
$('#review-restore').addEventListener('click', () => {
  if (!state.file) return;
  const hasSupplement = (state.file.issues ?? []).some((x) => x.supplement?.trim());
  const untouched = reviewText.value === state.file.original || reviewText.value === state.file.formatted;
  if ((!untouched || hasSupplement) && !confirm('수정한 내용과 직접 입력한 내용을 지우고 처음 추출한 내용(줄바꿈 정리 전)으로 되돌릴까요?')) return;
  reviewText.value = state.file.original;
  state.file.layout = null;
  state.file.layoutStatus = state.file.formatted ? 'restored' : state.file.layoutStatus;
  showLayoutStatus();
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
  startAnalysis({ target: state.target, ctxKey: state.ctxKey, docType: state.docType, text, inputSource: state.file.source, lowConfidence: ranges, extractNotes: resultNotes(state.file.issues ?? []), originalFile: state.file.pdfFile ?? null });
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

// 등록 순서 (v3.2): ① 원본 PDF 저장 → ② 기록·확인 텍스트 저장 → ③ AI 분석 → ④ 분석 결과 저장.
// 분석에 실패해도 ①②는 남기고 문서 상태를 '분석 실패'로 둔다(같은 텍스트로 재분석, 원본은 다시 저장하지 않음).
// 기록 저장 자체가 실패하면 예전처럼 분석 결과를 '저장되지 않았어요' 화면에서 보여 주고 다시 저장할 수 있다.
// 분석은 사용자가 버튼을 눌렀을 때만 시작한다. 라우트 변경·화면 다시 그리기로는 요청하지 않는다.
async function startAnalysis(payload, { replace = false } = {}) {
  if (state.inflight) return; // 중복 요청 방지
  const controller = new AbortController();
  state.inflight = { controller };
  state.last = payload;
  state.error = null;
  // 다시 시도해도 같은 자료·기록 ID를 쓴다 (같은 자료를 두 번 만들지 않음)
  payload.docId ??= newId('doc');
  if (payload.target.kind === 'new') payload.recordId ??= newId('rec');
  // 문서 종류와 관계없이 같은 문구 (조사 표기 '을(를)' 없이). 진행률처럼 보이는 표현은 쓰지 않는다
  $('#analyzing-title').textContent = '근로조건을 확인하고 있어요.';
  setAnalyzing();
  go(ROUTES.analyzing, replace);

  const entry = {
    id: payload.docId,
    docType: payload.docType,
    confirmedText: payload.text,
    inputSource: payload.inputSource,
    extractNotes: payload.extractNotes ?? [],
    lowConfidence: payload.lowConfidence ?? [],
    status: 'pending',
  };
  const naming = {}; // 기록 이름은 사용자가 직접 정한다 (문서의 회사명을 자동으로 쓰지 않음)
  const saved = await saveDocument(payload, entry, naming);
  const r = await requestAnalysis(payload, controller.signal);
  state.inflight = null;
  setAnalyzing();

  if (saved.record) {
    if (controller.signal.aborted || r.aborted) {
      // 사용자가 분석을 중단함: 등록을 취소한 것으로 보고 방금 저장한 자료를 되돌린다 (입력은 그대로)
      await store.removeDocument(saved.record.id, entry.id).catch(() => {});
      delete entry.original;
      return;
    }
    if (!r.ok && classifyAnalyzeFailure(r.status) === 'input') {
      // 입력 형식 오류: 같은 텍스트로는 다시 분석할 수 없으므로 방금 저장한 자료를 되돌리고 입력 화면에서 안내 (입력 유지)
      await store.removeDocument(saved.record.id, entry.id).catch(() => {});
      delete entry.original;
      showMsg(payload.inputSource === 'paste' ? inputError : reviewError, r.message);
      return go(editRouteFor(payload.inputSource, payload.target), true);
    }
    // 저장은 끝났다: 입력란은 비우고(같은 자료 중복 등록 방지) 기록 화면으로
    resetContext(payload.ctxKey);
    if (state.file === null) $('#review-resume').hidden = true;
    const origText = originalNote(saved.original, entry.originalError);
    if (r.ok) {
      try {
        const record = await store.replaceAnalysis(saved.record.id, entry.id, { analysis: analysisOf(r.data), mode: r.data.mode ?? null });
        // 원본 PDF를 저장하지 못했으면 성공 안내에 함께 알린다 (저장된 것처럼 보이지 않게)
        state.flash = { kind: 'saved', text: `${payload.target.kind === 'add' ? '새 자료가 추가됐어요.' : '기록이 저장됐어요.'}${entry.originalError || saved.original?.reused ? origText : ''}` };
        return go(ROUTES.record(record.id), true);
      } catch (err) {
        // 자료는 저장됐지만 분석 결과를 저장하지 못함 → 분석 결과를 '저장되지 않았어요' 화면에서 다시 저장
        state.unsaved = { payload, document: { ...entry, analysis: analysisOf(r.data), mode: r.data.mode ?? null, status: 'analyzed' }, ...naming, recordId: payload.recordId, baseRecord: payload.target.kind === 'add' ? withoutDoc(saved.record, entry.id) : null, error: err instanceof StoreError ? err.code : 'save_failed' };
        return go(ROUTES.unsaved, true);
      }
    }
    await store.markAnalysisFailed(saved.record.id, entry.id, r.status === 0 ? 'network' : r.status).catch(() => {});
    state.flash = { kind: 'warn', text: `자료는 이 브라우저에 저장했어요.${origText} 분석은 완료하지 못했어요. ${r.message} 아래 '등록된 안내 자료'에서 같은 텍스트로 다시 분석할 수 있어요.` };
    return go(ROUTES.record(saved.record.id), true);
  }

  // 기록 저장 실패: 예전 흐름 (분석 결과를 보여 주고 다시 저장)
  if (controller.signal.aborted || r.aborted) return;
  if (!r.ok) {
    if (classifyAnalyzeFailure(r.status) === 'input') {
      showMsg(payload.inputSource === 'paste' ? inputError : reviewError, r.message);
      return go(editRouteFor(payload.inputSource, payload.target), true);
    }
    state.error = { message: `${r.message} 자료도 저장하지 못했어요(${saved.error === 'quota' ? '저장 공간 부족' : '브라우저 저장 실패'}).` };
    return go(ROUTES.error, true);
  }
  const pending = { payload, document: { ...entry, analysis: analysisOf(r.data), mode: r.data.mode ?? null, status: 'analyzed' }, ...naming, recordId: payload.recordId };
  let baseRecord = null;
  if (payload.target.kind === 'add') baseRecord = await store.get(payload.target.recordId).catch(() => null);
  state.unsaved = { ...pending, baseRecord, error: saved.error };
  go(ROUTES.unsaved, true);
}
const withoutDoc = (record, docId) => (record ? { ...record, documents: record.documents.filter((d) => d.id !== docId) } : null);
const ORIGINAL_ERROR_TEXT = {
  quota: '브라우저 저장 공간이 부족해',
  not_pdf: 'PDF 파일이 아니라서',
  too_large: '파일이 10MB를 넘어',
};
function originalNote(meta, error) {
  if (meta?.reused) return ' 같은 PDF 원본이 이미 이 기록에 있어 다시 저장하지 않고 연결했어요.';
  if (meta) return ' 원본 PDF도 이 브라우저에 저장했어요.';
  if (error) return ` 원본 PDF는 ${ORIGINAL_ERROR_TEXT[error] ?? '저장 중 문제가 생겨'} 저장하지 못했어요(확인한 텍스트는 저장했어요).`;
  return '';
}

// ①② 원본 PDF와 자료 저장. 반환: { record, original } 또는 { error }
async function saveDocument(payload, entry, naming = {}) {
  const recordId = payload.target.kind === 'add' ? payload.target.recordId : payload.recordId;
  let original = null;
  if (payload.originalFile && !entry.original) {
    try {
      original = await store.saveOriginal({ recordId, docId: entry.id, blob: payload.originalFile, name: payload.originalFile.name });
      const { reused, ...meta } = original;
      entry.original = meta;
      entry.originalError = null;
    } catch (e) {
      entry.originalError = e instanceof StoreError ? e.code : 'save_failed';
    }
  }
  try {
    const record = payload.target.kind === 'add'
      ? await store.addDocument(recordId, entry)
      : await store.create({ alias: naming.alias, aliasSource: naming.aliasSource, document: { ...entry, recordId } });
    return { record, original };
  } catch (err) {
    // 기록을 저장하지 못했으면 방금 저장한 원본도 남기지 않는다 (다시 저장할 때 새로 저장)
    if (original && !original.reused) await store.deleteOriginal(original.fileId).catch(() => {});
    entry.original = null;
    return { error: err instanceof StoreError ? err.code : 'save_failed' };
  }
}

// 저장하지 못한 결과를 다시 저장한다 (원본 PDF도 함께). 저장을 다시 읽어 확인한 뒤에만 '저장했어요'.
async function persist(pending, { replace = false } = {}) {
  const { payload, document: entry } = pending;
  let original = null;
  try {
    if (payload.originalFile && !entry.original) {
      const recordId = payload.target.kind === 'add' ? payload.target.recordId : pending.recordId;
      try {
        original = await store.saveOriginal({ recordId, docId: entry.id, blob: payload.originalFile, name: payload.originalFile.name });
        const { reused, ...meta } = original;
        entry.original = meta;
        entry.originalError = null;
      } catch (e) { entry.originalError = e instanceof StoreError ? e.code : 'save_failed'; }
    }
    const record = payload.target.kind === 'add'
      ? await store.addDocument(payload.target.recordId, entry)
      : await store.create({ alias: pending.alias, aliasSource: pending.aliasSource, document: { ...entry, recordId: pending.recordId } });
    state.unsaved = null;
    resetContext(payload.ctxKey);
    if (state.file === null) $('#review-resume').hidden = true;
    state.flash = { kind: 'saved', text: `${payload.target.kind === 'add' ? '새 자료가 추가됐어요.' : '기록이 저장됐어요.'}${entry.originalError || original?.reused ? originalNote(original, entry.originalError) : ''}` };
    go(ROUTES.record(record.id), replace);
  } catch (err) {
    // 기존 기록에 추가하다 실패하면, 이전 기록은 그대로이고 새 자료만 저장되지 않은 상태로 보여 준다
    // 이번에 새로 저장한 원본만 지운다 (이미 기록에 연결된 원본은 그대로)
    if (original && !original.reused) { await store.deleteOriginal(original.fileId).catch(() => {}); entry.original = null; }
    let baseRecord = null;
    if (payload.target.kind === 'add') baseRecord = await store.get(payload.target.recordId).then((r) => withoutDoc(r, entry.id)).catch(() => null);
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
  if (c.status === 'UNAVAILABLE') {
    const base = UNAVAILABLE_TEXT[c.basis] ?? UNAVAILABLE_TEXT.evidence_verification_failed;
    return c.unavailableCodes?.length ? `${base} (원인: ${unavailableCause(c.unavailableCodes)})` : base;
  }
  if (c.status === 'PARTIAL' && BOUNDARY_TEXT[c.boundary]) return `관련 내용은 있지만 ${BOUNDARY_TEXT[c.boundary]}.`;
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
  if (detailOnly(t)) return `${detailOnlyText(t)}${extra}`;
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
    // 인용 전문은 아래 '원문 근거'에서 한 번만 표시한다. 위 카드에는 건수만 알려 중복을 줄인다.
    values.length || chips.length ? el('div', { class: 'card-detail' }, ...values,
      chips.length ? el('p', { class: 'muted small' }, `관련 원문 근거 ${chips.length}곳 · 아래에서 확인할 수 있어요.`) : null) : null,
    el('p', { class: 'item-desc' }, criterionText(c)),
    c.provisional ? el('p', { class: 'provisional muted small' }, PROVISIONAL_TEXT) : null,
    c.condition && !c.required && c.status !== 'NOT_APPLICABLE' ? el('p', { class: 'muted small' }, CONDITION_TEXT[c.condition]) : null);
}

function linkList(links) {
  return el('ul', { class: 'link-list' }, links.map((l) => el('li', {}, el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn-small link-external' }, `${l.label} ↗`))));
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
// v3.2: 채용공고·처우 안내는 단독 점검을 하지 않으므로 '일부만'·'빠짐' 같은 기재 상태 대신 적혔는지만 보여 준다
const BRIEF_STATUS_LABEL = {
  MAIN_FOUND: '적혀 있어요', MAIN_PARTIAL: '적혀 있어요', MAIN_MISSING: '이 자료에는 없어요', MAIN_UNAVAILABLE: '분석 확인 불가',
};
const statusLabelFor = (docType, status) => (docType === 'contract' ? CONTRACT_STATUS_LABEL : BRIEF_STATUS_LABEL)[status];
// 항목 상태 배지: 채용공고·오퍼의 협의·추후 안내 예정은 문제처럼 보이지 않게 그 상태 그대로 (근로계약서는 기재 상태 라벨 유지)
function topicBadge(doc, t) {
  const def = doc.docType !== 'contract' ? deferral(t) : null;
  if (def) return el('span', { class: 'badge badge-missing badge-deferred', 'data-status': 'DEFERRED' }, def.label);
  if (doc.docType !== 'contract' && t.status === 'MAIN_PARTIAL') return statusBadge('MAIN_FOUND', BRIEF_STATUS_LABEL.MAIN_PARTIAL);
  // 근로계약서 근무시간: 원문 값으로 주 소정근로시간을 계산해 확인했으면 '계산으로 확인한 조건' (원문 기재값과 구분, 판정은 그대로)
  if (doc.docType === 'contract' && weeklyCalc(t)) return el('span', { class: 'badge badge-calculated', 'data-status': t.status }, '계산으로 확인한 조건');
  if (doc.docType === 'contract' && externallyReferencedLeave(t)) return el('span', { class: 'badge badge-calculated', 'data-status': t.status }, '기재됨 · 외부 기준 참조');
  // 근로계약서: 핵심 내용은 적혀 있고 세부 숫자(주 소정근로시간 등)만 직접 적혀 있지 않으면 '내용이 모호함' 대신 (판정은 그대로)
  if (detailOnly(t)) return statusBadge(t.status, '세부 확인 필요');
  return statusBadge(t.status, statusLabelFor(doc.docType, t.status));
}
const ITEM_IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
const topicOf = (doc, id) => doc.analysis?.topics?.find((t) => t.id === id) ?? null;
// 화면에 보이는 항목명: 같은 항목은 '임금'으로 통일 (기준표의 주제명은 바꾸지 않고 표시만)
const DISPLAY_LABEL = { '08': '수습 중 임금' };
const itemLabel = (record, id) => DISPLAY_LABEL[id] ?? record.documents.map((d) => topicOf(d, id)?.label).find(Boolean) ?? id;
const visibleIn = (record, id) => record.documents.some((d) => topicOf(d, id)?.visible);
const notesFor = (record, id) => (record.notes ?? []).filter((n) => n.conditionKey === id);

// '분석 확인 불가'의 원인 (검증 실패 코드 → 사용자 설명). 예전에 저장된 기록에는 코드가 없을 수 있다.
const UNAVAILABLE_CODE_TEXT = {
  source_value_not_in_quote: 'AI가 정리한 값이 인용한 원문 안에 글자 그대로 있지 않았어요',
  quote_not_in_line: 'AI가 제시한 인용 구절이 원문과 글자 그대로 일치하지 않았어요',
  unknown_line: 'AI가 없는 줄을 근거로 제시했어요',
  empty_quote: 'AI가 빈 근거를 제시했어요',
  conflict_needs_two: 'AI 응답 형식이 맞지 않았어요',
  no_quotes: 'AI가 근거 없이 응답했어요',
  absent_with_quotes: 'AI 응답 형식이 맞지 않았어요',
  missing_criterion: 'AI 응답에서 이 항목이 빠졌어요',
  ocr_low_confidence: '근거에 글자 인식(OCR)이 불확실한 곳이 있어요',
  ocr_low_confidence_related: '관련 내용 근처에 글자 인식(OCR)이 불확실한 곳이 있어요',
};
function unavailableCause(codes = []) {
  const list = codes.map((c) => (c.startsWith('ai_call_failed') ? 'AI 응답을 받지 못했어요' : UNAVAILABLE_CODE_TEXT[c])).filter(Boolean);
  return list.length ? [...new Set(list)].join(', ') : '근거를 원문에서 확인하지 못했어요';
}

// 상태 설명: '일부만 적혔어요'로 뭉뚱그리지 않고 무엇이 적혀 있고 무엇이 빠졌는지 말한다
// 세부 숫자만 빠진 '일부 확인': 적힌 내용과 따로 확인할 세부 항목을 나눠 말한다
// 예) '출퇴근 시각·휴게시간은 적혀 있어요. 주 소정근로시간은 별도로 확인이 필요해요.'
function detailOnlyText(t) {
  const d = detailOnly(t);
  if (!d) return null;
  const lacking = t.id === '02' ? '주 소정근로시간' : d.lacking.join('·');
  return `${d.written.length ? `${josa(d.written.join('·'), '은/는')} 적혀 있어요. ` : ''}${josa(lacking, '은/는')} 별도로 확인이 필요해요.`;
}
function topicExplain(t, docType = 'contract') {
  if (!t?.visible) return null;
  if (docType === 'contract' && weeklyCalc(t)) return `${weeklyCalc(t).text}(계산값): 문서에 적힌 근무일과 휴게시간을 기준으로 계산했어요. 주 소정근로시간이 직접 기재된 것은 아니에요.`;
  if (docType === 'contract' && externallyReferencedLeave(t)) return '연차 부여 기준으로 법령·취업규칙을 참조하고 있어요. 구체적인 일수와 운영 방식은 이 문장에 직접 적혀 있지 않아요.';
  if (docType === 'contract' && detailOnly(t)) return detailOnlyText(t);
  // 채용공고·처우 안내: 협의 예정·분석 확인 불가·한 문서 안의 서로 다른 값만 설명 (빠진 세부 정보는 말하지 않음)
  if (docType !== 'contract' && !deferral(t) && t.status !== 'MAIN_UNAVAILABLE') {
    const conflict = t.criteria.find((c) => c.required && c.basis === 'conflict');
    return conflict ? `${conflict.label}에 서로 다른 값이 함께 적혀 있어요.` : null;
  }
  if (t.status === 'MAIN_FOUND') return null;
  if (t.status === 'MAIN_MISSING') return '관련 내용을 찾지 못했어요.';
  const req = t.criteria.filter((c) => c.required && c.status !== 'CONFIRMED' && c.status !== 'NOT_APPLICABLE');
  const def = deferral(t);
  if (def) {
    // 협의·추후 안내 예정은 '빠짐'이 아니라 아직 정해지지 않았다고 적힌 상태
    return def.rangeText
      ? `협의 가능한 ${def.unitLabel ?? '임금'} 범위(${def.rangeText})가 적혀 있어요. 구체적인 금액은 이후 안내에서 확인해요.`
      : `'${clipText(def.quote, 40)}'라고 적혀 있어요(${def.label}). 구체적인 조건은 이후 안내에서 확인해요.`;
  }
  if (t.status === 'MAIN_UNAVAILABLE') {
    const codes = req.filter((c) => c.status === 'UNAVAILABLE').flatMap((c) => [c.unavailableReason, ...(c.unavailableCodes ?? [])]);
    return `분석 확인 불가: ${unavailableCause(codes)}. 적혀 있지 않다는 뜻이 아니에요.`;
  }
  const written = t.criteria.filter((c) => c.status === 'CONFIRMED' && c.evidence.length).map((c) => c.label);
  const parts = req.map((c) => {
    // 예전 기록에는 이유 코드(boundary)가 없다: 근무시간 숫자 문제는 같은 설명으로
    const boundary = c.boundary ?? (c.id === '02-a' && c.status === 'PARTIAL' && !c.basis ? 'hours_not_quoted' : null);
    if (boundary && BOUNDARY_TEXT[boundary]) return BOUNDARY_TEXT[boundary];
    if (c.basis === 'conflict') return `${c.label}에 서로 다른 값이 함께 적혀 있어요`;
    if (c.basis === 'undecided') return `${josa(c.label, '이/가')} 정해지지 않았다고 적혀 있어요`;
    if (c.status === 'MISSING') return `${josa(c.label, '을/를')} 찾지 못했어요`;
    return `${josa(c.label, '이/가')} 구체적으로 적혀 있지 않아요`;
  });
  return `${written.length ? `${josa(written.join('·'), '은/는')} 적혀 있어요. ` : ''}${parts.join('. ')}.`;
}

const RELATION_KIND = { same: 'found', different_stated: 'review', newly_stated: 'found', newly_specified: 'found', not_mentioned_later: 'missing', incomparable: 'review', unavailable: 'unavailable' };
function relationBadge(relation) {
  if (!relation) return null;
  return el('span', { class: `badge badge-${RELATION_KIND[relation]} badge-relation`, 'data-relation': relation }, RELATION_LABEL[relation]);
}

let qSeq = 0;
function questionBox(text, label = '회사에 확인할 때 쓸 질문') {
  const id = `q-${qSeq += 1}`;
  const ta = el('textarea', { id, class: 'q-text', rows: '3' });
  ta.value = text;
  return el('div', { class: 'question' },
    el('label', { class: 'q-label', for: id }, `${label} (고쳐 쓸 수 있어요)`),
    ta,
    el('div', { class: 'q-actions' },
      el('button', { type: 'button', class: 'btn-secondary btn-copy', 'data-copy': id }, '질문 복사'),
      el('span', { class: 'q-status muted small', role: 'status', 'aria-live': 'polite' })));
}
// 대표 질문 + (접힌) 추가 질문
function questionBlock(f) {
  if (!f?.question) return null;
  return el('div', { class: 'q-block' },
    questionBox(f.question),
    f.extraQuestions?.length ? el('details', { class: 'extra-q' },
      el('summary', {}, `추가 질문 ${f.extraQuestions.length}개 (선택)`),
      f.extraQuestions.map((q) => questionBox(q, '추가 질문'))) : null);
}

// 더 확인할 수 있는 질문 (접힌 상세 영역)
function followupCard(f, record, saved) {
  return el('li', { class: `followup is-${f.tier}`, 'data-followup': f.key, 'data-kind': f.kind },
    el('div', { class: 'followup-head' }, el('h3', { class: 'followup-label' }, f.label)),
    el('p', { class: 'followup-reason small' }, f.reasons[0]),
    questionBlock(f),
    saved ? el('a', { href: ROUTES.item(record.id, f.topicIds[0]), class: 'btn-secondary' }, '자세히 보기 →') : null);
}

// ---------- 기록 이름 ----------
// 이름은 사용자가 정한 경우에만. 이름이 없으면 제목 자리에 안내 문구(저장하지 않음), 다른 곳에서는 문서 유형·등록일로 구별
const NAME_PLACEHOLDER = '기록 이름을 입력해 주세요';
const QUESTION_HINT = '질문을 상황에 맞게 고쳐서 복사한 뒤 회사에 직접 확인해 보세요. 일단확인은 회사에 보내지 않아요.';
const MEMO_HINT = '회사에서 받은 답변을 직접 기록해 두면 나중에 다시 확인할 수 있어요.';
const MAX_MARKS = 3; // 한 인용에서 강조하는 표현 수 (너무 많으면 읽기 어려움)
const firstRegistered = (r) => r.documents.map((d) => d.registeredAt).filter(Boolean).sort()[0] ?? r.updatedAt;
function recordLabel(r) {
  const name = userAlias(r);
  if (name) return name;
  const types = [...new Set((r?.documents ?? []).map((d) => DOC_TYPE_LABEL[d.docType]))].join('·');
  return `이름 없는 기록 (${types || '자료 없음'} · ${formatDateTime(firstRegistered(r))} 등록)`;
}

// ---------- S04 입사조건 기록 ----------
let currentRecord = null; // 지금 보고 있는 저장된 기록 (S04·S05)

function unsavedRecord() {
  const u = state.unsaved;
  const doc = { ...u.document, id: u.document.id ?? 'doc_unsaved', registeredAt: new Date().toISOString() };
  if (u.baseRecord) return { ...u.baseRecord, documents: [...u.baseRecord.documents, doc] };
  return { id: null, alias: u.alias ?? DEFAULT_ALIAS, documents: [doc], notes: [], updatedAt: doc.registeredAt };
}

// 핵심 조건 카드의 자료별 값: 대표 세부 항목의 짧은 값(검증된 원문만) + 휴게·지급일 같은 보조 값 하나
const CARD_EXTRA = { '02': '02-c', '01': '01-f' };
function cardValue(relItem, docId) {
  const side = (f) => f?.sides.find((s) => s.docId === docId);
  // 근무시간은 출퇴근 시각을, 수습기간은 기간(07-b)을 먼저 (주 N시간 인용·'수습 적용' 여부 줄보다 읽기 쉬움)
  const FIRST = { '02': '02-b', '07': '07-b' };
  const facets = FIRST[relItem.id] ? [...relItem.facets].sort((x, y) => (y.id === FIRST[relItem.id]) - (x.id === FIRST[relItem.id])) : relItem.facets;
  const sides = facets.map(side);
  const main = sides.find((s) => s?.display && s.concrete) ?? sides.find((s) => s?.display) ?? null;
  const extraFacet = relItem.facets.find((f) => f.id === CARD_EXTRA[relItem.id]);
  const extra = extraFacet && side(extraFacet)?.display && side(extraFacet) !== main ? `${extraFacet.id === '02-c' ? '휴게' : extraFacet.label} ${side(extraFacet).display}` : null;
  return main ? { text: [main.display, extra].filter(Boolean).join(' · '), vague: !main.concrete } : null;
}
// 카드 아래 한 줄: 자료 사이 관계가 있으면 그 이유, 없으면 (마지막 자료의) 기재 상태 설명
function cardInsight(record, relItem, labels, fus) {
  const multi = record.documents.length > 1;
  const rel = relItem.relation;
  if (multi && rel) {
    const f = relItem.facets.find((x) => x.relation === rel) ?? relItem.facets[0];
    if (rel === 'different_stated') return `자료마다 ${josa(f.label, '이/가')} 다르게 안내되었어요.`;
    if (rel === 'newly_specified') return fus.summary.specified.find((x) => x.topicId === relItem.id)?.line ?? f.notes.at(-1);
    if (rel === 'newly_stated') { const first = f.sides.find((s) => s.kind === 'present'); return first ? `${labels[first.docId]}에 처음 적혔어요. 바뀐 것으로 보지 않아요.` : null; }
    if (rel === 'same') return '등록한 자료에 같은 내용으로 적혀 있어요.';
    if (rel === 'not_mentioned_later') return `${labels[record.documents.at(-1).id]}에는 적혀 있지 않아요. 없어지거나 바뀐 것으로 보지 않아요.`;
    if (rel === 'unavailable') return '일부 자료의 근거를 확인하지 못해 비교하지 않았어요. 적혀 있지 않다는 뜻이 아니에요.';
    return f.notes[0] ?? '표기 방식이 달라 같은 조건인지 자동으로 판단하지 않았어요.';
  }
  const lastDoc = [...record.documents].reverse().find((d) => topicOf(d, relItem.id)?.visible);
  return lastDoc ? topicExplain(topicOf(lastDoc, relItem.id), lastDoc.docType) : null;
}

// 기록 화면의 문서 역할: 근로계약서가 있으면 기재 상태 점검, 채용공고·처우 안내만 있으면 적힌 조건의 기록
function recordMode(record) {
  const analyzed = record.documents.filter((d) => d.analysis);
  const types = new Set(analyzed.map((d) => d.docType));
  if (types.has('contract')) return { check: true, title: '핵심 조건 요약' };
  if (types.size === 1 && types.has('job_posting')) return { check: false, title: '저장된 채용조건' };
  if (types.size === 1 && types.has('offer')) return { check: false, title: '안내된 근로조건' };
  return { check: false, title: types.size ? '저장된 채용·근로조건' : '저장된 근로조건' };
}
const docStatusOf = (d) => d.status ?? (d.analysis ? 'analyzed' : 'pending');
const DOC_STATUS_TEXT = { pending: '분석 전', analysis_failed: '분석 실패' };

// 원본 PDF 보기·다운로드: 저장된 Blob 그대로 연결한다. 화면을 다시 그릴 때 이전 주소는 해제.
let originalUrls = [];
function releaseOriginalUrls() { for (const u of originalUrls) URL.revokeObjectURL(u); originalUrls = []; }
function originalLinks(d, label) {
  const o = d.original;
  return el('li', { class: 'original-item', 'data-file': o.fileId },
    el('span', { class: 'original-name' }, `${label} 원본 · ${o.name}`, el('span', { class: 'muted small' }, ` (${formatBytes(o.size)})`)),
    el('a', { class: 'btn-secondary original-view', target: '_blank', rel: 'noopener', 'aria-disabled': 'true' }, '원본 PDF 보기'),
    el('a', { class: 'btn-secondary original-download', download: o.name, 'aria-disabled': 'true' }, '다운로드'),
    el('span', { class: 'muted small original-status', role: 'status' }));
}
async function attachOriginalUrls(root) {
  for (const li of root.querySelectorAll('.original-item[data-file]')) {
    let blob = null;
    try { blob = (await store.getOriginal(li.dataset.file))?.blob ?? null; } catch { blob = null; }
    if (!li.isConnected) return;
    if (!blob) {
      li.querySelectorAll('a').forEach((a) => a.remove());
      li.querySelector('.original-status').textContent = '원본 파일을 이 브라우저에서 찾지 못했어요(브라우저 데이터가 지워졌을 수 있어요).';
      continue;
    }
    const url = URL.createObjectURL(blob);
    originalUrls.push(url);
    li.querySelectorAll('a').forEach((a) => { a.href = url; a.removeAttribute('aria-disabled'); });
  }
}
const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

// ---------- 두 문서 비교 (Stitch 26) ----------
// 비교 대상 A/B, 상태별 요약(한 항목 = 한 상태), 회사 질문 모아보기, 항목별 A/B 대조 카드.
// 값·관계·질문은 기존 비교 결과(relate.js·followups.js)를 그대로 쓰고, 화면에서 상태 5가지로만 나눈다.
const two = (n) => String(n).padStart(2, '0');
// ---------- 두 문서 비교: 화면 카드와 정리본이 같이 쓰는 계산 (분류·값·안내는 한 곳에서만) ----------
// 항목별 상태. 두 문서 모두에 없는 항목은 비교 대상이 아니므로 건너뛴다 (skipped)
function compareRowsFor(comparedRecord, fus, fuOf, pendingOf) {
  const docs = comparedRecord.documents.filter((d) => d.analysis).slice(0, 2);
  const rows = [];
  let skipped = 0;
  for (const id of ITEM_IDS) {
    if (!visibleIn(comparedRecord, id)) continue;
    const relItem = fus.relation.items.find((i) => i.id === id);
    const q = fuOf(id);
    const ts = docs.map((d) => { const t = topicOf(d, id); return t?.visible ? t : null; });
    const st = compareStatus(relItem, ts, { hasQuestion: Boolean(q?.question), pending: Boolean(pendingOf(id)) });
    if (!st) { skipped += 1; continue; }
    rows.push({ id, st, relItem, q, ts });
  }
  return { docs, rows, skipped };
}
// 한 문서 쪽 값: missing(원문에 언급 없음) / unavailable(분석 확인 불가, 원인) / present(검증된 원문 값, 계산값은 따로)
function sideInfo(row, d, k) {
  const t = row.ts[k];
  if (!t || t.status === 'MAIN_MISSING') return { state: 'missing', value: '원문에 언급 없음' };
  if (t.status === 'MAIN_UNAVAILABLE') {
    const codes = t.criteria.filter((c) => c.required && c.status === 'UNAVAILABLE').flatMap((c) => [c.unavailableReason, ...(c.unavailableCodes ?? [])]);
    return { state: 'unavailable', value: '분석 확인 불가', cause: unavailableCause(codes) };
  }
  const v = row.relItem ? cardValue(row.relItem, d.id) : null;
  const calc = d.docType === 'contract' ? weeklyCalc(t) : null;
  const def = d.docType !== 'contract' ? deferral(t) : null;
  const badge = def || (t.status !== 'MAIN_FOUND' && d.docType === 'contract' && !calc);
  return { state: 'present', value: v?.text ?? summaryEvidence(t)?.text ?? '원문에서 확인했어요', vague: Boolean(v?.vague), calc: calc?.text ?? null, badge: Boolean(badge), badgeText: badge ? topicBadge(d, t).textContent : null };
}
// 대조 요약 한 줄 + 근로계약서 세부 확인 안내
function rowNotes(row, docs, { comparedRecord, labels, fus, pendingOf }) {
  const line = row.relItem?.addedNote ?? cardInsight(comparedRecord, row.relItem, labels, fus) ?? pendingOf(row.id)?.line ?? null;
  const c = docs.map((d, k) => ({ d, t: row.ts[k] })).reverse().find((x) => x.d.docType === 'contract' && x.t);
  const detail = c && !weeklyCalc(c.t) ? detailOnlyText(c.t) : null;
  return { line, detail: detail ? `${labels[c.d.id]}: ${detail}` : null };
}

function renderCompare({ record, comparedRecord, fus, labels, saved, fuOf, pendingOf }) {
  const [A, B] = comparedRecord.documents.filter((d) => d.analysis);
  const docs = [A, B];
  const side = (k) => `문서 ${'AB'[k]}`;
  const docCard = (d, k) => el('div', { class: `cmp-doc is-${'ab'[k]}`, 'data-doc': d.id },
    el('p', { class: 'cmp-doc-label' }, `${side(k)} · ${labels[d.id]}`),
    el('p', { class: 'cmp-doc-name' }, documentTitle(d) || labels[d.id]),
    el('p', { class: 'cmp-doc-meta' }, `등록 ${formatDateTime(d.registeredAt)} · 원문 ${d.analysis?.lines?.length ?? 0}줄`));
  fill($('#cmp-docs'), docCard(A, 0), el('span', { class: 'cmp-vs', 'aria-hidden': 'true' }, '↔'), docCard(B, 1));
  $('#cmp-summary-title').textContent = '비교 결과 요약';
  $('#cmp-questions-desc').textContent = `다르게 적혔거나 추가로 대조할 조건의 질문이에요. ${QUESTION_HINT}`;
  $('#cmp-tiles').style.setProperty('--tiles', String(STATUS_ORDER.length));

  const { rows, skipped } = compareRowsFor(comparedRecord, fus, fuOf, pendingOf);
  const count = (st) => rows.filter((r) => r.st === st).length;
  $('#cmp-summary-total').textContent = `비교한 조건 ${rows.length}개${skipped ? ` · 두 문서 모두에 없는 조건 ${skipped}개는 '전체 근로조건 목록'에서 볼 수 있어요` : ''}`;
  // 요약 칸: 상태 표시 + 해당 묶음으로 이동(버튼). 0건이면 누를 수 없다
  fill($('#cmp-tiles'), ...STATUS_ORDER.map((st) => {
    const n = count(st);
    return el('button', { type: 'button', class: `cmp-tile is-${st}`, 'data-jump': st, disabled: n === 0, 'aria-label': `${COMPARE_STATUS[st].label} ${n}건${n ? ', 해당 항목으로 이동' : ''}` },
      el('span', { class: 'cmp-tile-label' }, COMPARE_STATUS[st].label),
      el('span', { class: 'cmp-tile-count' }, el('strong', {}, String(n)), '건'),
      el('span', { class: 'cmp-tile-items' }, rows.filter((r) => r.st === st).map((r) => itemLabel(record, r.id)).join(', ') || '없음'));
  }));

  // 회사에 확인할 질문 모아보기
  const qCount = rows.filter((r) => r.q?.question).length;
  $('#cmp-questions').hidden = !qCount;
  $('#cmp-q-count').textContent = `${qCount}건`;
  $('#copy-all-top-status').textContent = '';

  const panel = (row, d, k) => {
    const info = sideInfo(row, d, k);
    const head = el('p', { class: 'cmp-panel-label' }, `${side(k)} · ${labels[d.id]}`);
    if (info.state === 'missing') {
      return el('div', { class: `cmp-panel is-${'ab'[k]} is-empty` }, head,
        el('p', { class: 'cmp-value' }, info.value),
        el('p', { class: 'cmp-sub' }, '이 문서에서는 이 조건을 찾지 못했어요. 없어지거나 바뀐 것으로 보지 않아요.'));
    }
    if (info.state === 'unavailable') {
      return el('div', { class: `cmp-panel is-${'ab'[k]} is-unavailable` }, head,
        el('p', { class: 'cmp-value' }, info.value),
        el('p', { class: 'cmp-sub' }, `${info.cause}. 적혀 있지 않다는 뜻은 아니에요.`));
    }
    return el('div', { class: `cmp-panel is-${'ab'[k]}` }, head,
      el('p', { class: `cmp-value${info.vague ? ' is-vague' : ''}` }, info.value),
      info.calc ? el('p', { class: 'cmp-sub cmp-calc' }, el('span', { class: 'calc-value' }, `${info.calc} (계산값)`), ' 원문에 적힌 근무일·출퇴근 시각·휴게시간으로 계산했어요.') : null,
      info.badge ? el('p', { class: 'cmp-sub' }, topicBadge(d, row.ts[k])) : null);
  };
  const evidenceCol = (row, d, k) => {
    const t = row.ts[k];
    const list = t?.status === 'MAIN_UNAVAILABLE' ? [] : evidenceFor(row.relItem, d.id);
    return el('div', { class: `cmp-evidence-doc is-${'ab'[k]}` },
      el('p', { class: 'cmp-evidence-label' }, `${side(k)} · ${labels[d.id]}`),
      list.length ? evidenceItems(list, d, labels[d.id], row.id) : el('p', { class: 'cmp-sub' }, noEvidenceText(t)));
  };
  let no = 0;
  const card = (row) => {
    no += 1;
    const { id, st, relItem, q } = row;
    const memo = notesFor(record, id).length;
    const { line, detail } = rowNotes(row, docs, { comparedRecord, labels, fus, pendingOf });
    const badgeText = st === 'same' && relItem?.addedNote ? '같은 조건 · 세부 조건 추가' : COMPARE_STATUS[st].badge;
    const unavailDocs = st === 'unavailable' ? docs.filter((d, k) => row.ts[k]?.status === 'MAIN_UNAVAILABLE') : [];
    return el('li', { class: `cmp-card is-${st}`, id: `cmp-item-${id}`, 'data-item': id, 'data-topic': id, 'data-status': st },
      el('div', { class: 'cmp-card-head' },
        el('span', { class: 'cmp-no' }, two(no)),
        el('h3', {}, itemLabel(record, id)),
        memo ? el('span', { class: 'memo-flag' }, '내 메모 있음') : null,
        el('span', { class: `badge badge-relation status-${st}`, 'data-status': st }, badgeText)),
      el('div', { class: 'cmp-panels' }, docs.map((d, k) => panel(row, d, k))),
      line || detail ? el('div', { class: 'cmp-note' },
        el('p', { class: 'cmp-note-title' }, '대조 요약'),
        line ? el('p', {}, line) : null,
        detail ? el('p', { class: 'small' }, detail) : null) : null,
      el('details', { class: 'cmp-evidence' },
        el('summary', {}, '원문 근거 보기'),
        el('div', { class: 'cmp-evidence-cols' }, docs.map((d, k) => evidenceCol(row, d, k))),
        el('p', { class: 'cmp-sub' }, '노란 강조는 비교에 쓴 원문 표현이에요. \'원문 전체에서 위치 보기\'를 누르면 아래 원문에서 그 줄을 펼쳐 보여 드려요.')),
      q?.question ? el('div', { class: 'cmp-question' }, el('p', { class: 'cmp-question-title' }, `회사에 확인할 질문 · ${itemLabel(record, id)}`), questionBlock(q)) : null,
      saved && unavailDocs.length ? el('div', { class: 'reanalyze' },
        unavailDocs.map((d) => el('button', { type: 'button', class: 'btn-secondary', 'data-reanalyze': d.id }, `${labels[d.id]} 같은 텍스트로 다시 분석하기`)),
        el('p', { class: 'muted small reanalyze-status', role: 'status', 'aria-live': 'polite' })) : null,
      saved ? el('a', { href: ROUTES.item(record.id, id), class: 'btn-secondary cmp-detail-link' }, '조건 상세·답변 메모 →') : null);
  };
  const groups = STATUS_ORDER.map((st) => {
    const list = rows.filter((r) => r.st === st);
    if (!list.length) return null;
    const head = [COMPARE_STATUS[st].label, el('span', { class: 'sum-count' }, String(list.length))];
    const cards = el('ol', { class: 'cmp-cards' }, list.map(card));
    // 같은 조건은 덜 강조: 접어 둔다
    if (st === 'same') return el('details', { class: `cgroup cmp-group is-${st}`, 'data-group': st, id: `cmp-group-${st}` }, el('summary', { class: 'cgroup-title' }, ...head), cards);
    return el('section', { class: `cgroup cmp-group is-${st}`, 'data-group': st, id: `cmp-group-${st}` }, el('h3', { class: 'cgroup-title' }, ...head), cards);
  });
  fill($('#condition-list'), ...groups);
  return rows;
}

// 원문 근거 목록: 어떤 조건의 근거인지 · 어느 문서 · 몇 번째 줄 · 원문 구절(검증된 인용 그대로, 강조는 원문에 그대로 있는 값만).
// '원문 전체에서 위치 보기'는 같은 화면 아래의 원문 전체를 펼쳐 그 줄로 이동한다 (상세 화면 이동과 목적이 다름).
function evidenceItems(list, d, docLabel, itemId) {
  return el('ul', { class: 'cmp-evidence-list' }, list.map((r) => {
    const marks = r.highlight.slice(0, MAX_MARKS);
    return el('li', {},
      el('p', { class: 'cmp-evidence-for' }, `${r.facets.join('·')}의 근거`, el('span', { class: 'line-ref' }, ` · ${docLabel}${r.line != null ? ` ${r.line}번째 줄` : ''}`)),
      el('blockquote', { class: 'cmp-quote' }, marks.length ? highlightText(r.text, marks) : r.text),
      r.line != null && d.analysis?.lines?.length ? el('button', {
        type: 'button', class: 'btn-small cmp-goto', 'data-goto-doc': d.id, 'data-goto-line': String(r.line), 'data-goto-item': itemId,
        'data-goto-text': r.text, 'data-goto-marks': JSON.stringify(marks),
      }, '원문 전체에서 위치 보기') : null);
  }));
}
// 근거 인용이 없을 때: '문서에서 확인되지 않음'과 '분석 확인 불가'의 뜻을 그대로 (임의 구절을 강조하지 않음)
function noEvidenceText(t) {
  if (!t || t.status === 'MAIN_MISSING') return '이 문서에서는 이 조건을 찾지 못했어요 (문서에서 확인되지 않음). 없어지거나 바뀐 것으로 보지 않아요.';
  if (t.status === 'MAIN_UNAVAILABLE') return '근거를 원문에서 확인하지 못해 인용을 보여 드리지 않아요 (분석 확인 불가). 적혀 있지 않다는 뜻은 아니에요.';
  return '관련 원문 줄을 특정하지 못했어요.';
}

// 결과 활용 안내: 문서 개수와 실제 결과에 맞춰 다음 행동만 짧게. 버튼은 새로 만들지 않고 기존 요소(카드의 원문 근거·질문·메모, 문서 추가)를 가리킨다.
// 질문이 없으면 질문 복사 단계를 넣지 않는다. 비교 결과 정리본(두 문서 비교)은 여기 한 곳에서만 연다.
function renderGuide(layout, rows, { record, saved }) {
  const box = $('#result-guide');
  box.hidden = !['brief', 'contract', 'compare'].includes(layout) || !rows.length;
  if (box.hidden) return;
  const n = (...st) => rows.filter((r) => st.includes(r.st)).length;
  const hasQ = rows.some((r) => r.q?.question);
  const memo = saved ? "회사에서 받은 답변은 카드의 '조건 상세·답변 메모'에 직접 기록해 두면 나중에 다시 확인할 수 있어요." : null;
  const steps = {
    brief: [
      `문서에 적힌 주요 조건 ${rows.length}개와 '원문 근거 보기'를 확인하세요.`,
      saved ? "필요하면 다른 문서를 추가해 두 문서를 나란히 비교해 보세요 (맨 아래 '비교할 두 번째 문서 추가하기')." : null,
    ],
    contract: n('needs')
      ? [`추가 확인이 필요한 조건 ${n('needs')}개부터 확인하세요.`, "카드의 '원문 근거 보기'로 문서에 적힌 문장과 위치를 확인하세요.", hasQ ? QUESTION_HINT : null, memo]
      : ['추가 확인이 필요한 조건으로 분류된 항목은 없어요. 기재된 조건과 원문 근거를 확인해 보세요. 법률 위반 여부를 판단한 결과는 아니에요.', memo],
    compare: n('different', 'review')
      ? [`서로 다른 조건 ${n('different')}개와 추가 대조가 필요한 조건 ${n('review')}개를 먼저 확인하세요.`, "카드의 '원문 근거 보기'로 두 문서에 실제로 적힌 문장과 위치를 확인하세요.", hasQ ? QUESTION_HINT : null, memo]
      : ['서로 다르거나 추가 대조가 필요한 조건은 없어요. 한쪽에만 적힌 조건과 원문 근거를 확인해 보세요.', memo],
  }[layout].filter(Boolean);
  fill($('#result-guide-steps'), ...steps.map((t) => el('li', {}, t)));
  fill($('#result-guide-actions'), layout === 'compare' && saved
    ? el('a', { href: ROUTES.report(record.id), class: 'btn-secondary', id: 'open-report' }, '비교 결과 정리본 보기 (복사·인쇄)') : null);
}

// 문서 1개 결과 (채용공고·처우 안내 미리보기 / 근로계약서 확인): 비교 화면과 같은 카드·요약 구조, 한 줄 단일 컬럼.
// 판정·질문 생성은 그대로이고, 채용공고·처우 안내에는 질문이나 미기재 판정을 새로 만들지 않는다. 반환: 카드 행 (요약 숫자 = 카드 수)
function renderSingle({ record, comparedRecord, fus, labels, saved, fuOf, layout }) {
  const d = comparedRecord.documents.find((x) => x.analysis);
  const kind = layout === 'contract' ? 'contract' : 'brief';
  const S = SINGLE_STATUS[kind];
  fill($('#cmp-docs'), el('div', { class: 'cmp-doc is-a is-single', 'data-doc': d.id },
    el('p', { class: 'cmp-doc-label' }, labels[d.id], el('span', { class: 'tag tag-done' }, saved ? '등록 완료' : '저장 전')),
    el('p', { class: 'cmp-doc-name' }, documentTitle(d) || labels[d.id]),
    el('p', { class: 'cmp-doc-meta' }, `등록 ${formatDateTime(d.registeredAt)} · 원문 ${d.analysis.lines?.length ?? 0}줄`)));

  const rows = [];
  for (const id of ITEM_IDS) {
    const t = topicOf(d, id);
    const q = kind === 'contract' ? fuOf(id) : null; // 공고·처우 안내 1개에는 회사 질문을 만들지 않는다
    const st = singleStatus(d.docType, t, { hasQuestion: Boolean(q?.question) });
    if (st) rows.push({ id, st, t, q: q?.question ? q : null, relItem: fus.relation.items.find((i) => i.id === id) });
  }
  const count = (st) => rows.filter((r) => r.st === st).length;
  $('#cmp-summary-title').textContent = kind === 'contract' ? '확인 결과 요약' : '주요 조건 요약';
  const skipped = kind === 'contract' ? ITEM_IDS.length - rows.length : 0;
  $('#cmp-summary-total').textContent = kind === 'contract'
    ? `주요 근로조건 ${ITEM_IDS.length}개 기준${skipped ? ` · 수습이 적용된다고 적혀 있지 않은 등 해당하지 않는 기준 ${skipped}개 제외` : ''} · 법률 위반 여부는 판단하지 않아요`
    : `문서에 적힌 근로조건 ${rows.length}개 · 적혀 있지 않은 조건은 따로 표시하지 않아요`;
  const tiles = S.order.filter((st) => st !== 'unavailable' || count(st)); // 확인 불가는 있을 때만 칸을 만든다
  $('#cmp-tiles').style.setProperty('--tiles', String(tiles.length));
  fill($('#cmp-tiles'), ...tiles.map((st) => {
    const n = count(st);
    return el('button', { type: 'button', class: `cmp-tile is-${S[st].tone}`, 'data-jump': st, disabled: n === 0, 'aria-label': `${S[st].label} ${n}건${n ? ', 해당 항목으로 이동' : ''}` },
      el('span', { class: 'cmp-tile-label' }, S[st].label),
      el('span', { class: 'cmp-tile-count' }, el('strong', {}, String(n)), '건'),
      el('span', { class: 'cmp-tile-items' }, rows.filter((r) => r.st === st).map((r) => itemLabel(record, r.id)).join(', ') || '없음'));
  }));
  const qCount = rows.filter((r) => r.q).length;
  $('#cmp-questions').hidden = !qCount;
  $('#cmp-q-count').textContent = `${qCount}건`;
  $('#copy-all-top-status').textContent = '';
  $('#cmp-questions-desc').textContent = `추가 확인이 필요한 조건의 질문이에요. ${QUESTION_HINT}`;

  let no = 0;
  const card = (row) => {
    no += 1;
    const { id, st, t, q } = row;
    const tone = S[st].tone;
    const unavailable = st === 'unavailable';
    const calc = kind === 'contract' && !unavailable ? weeklyCalc(t) : null;
    const extLeave = kind === 'contract' && externallyReferencedLeave(t);
    const v = !unavailable && row.relItem ? cardValue(row.relItem, d.id) : null;
    const missing = t.status === 'MAIN_MISSING';
    const value = unavailable ? '분석 확인 불가' : missing ? '문서에서 확인되지 않음' : v?.text ?? summaryEvidence(t)?.text ?? '원문에서 확인했어요';
    const badgeText = unavailable ? '분석 확인 불가' : topicBadge(d, t).textContent;
    const explain = unavailable ? null : topicExplain(t, d.docType);
    const codes = unavailable ? t.criteria.filter((c) => c.required && c.status === 'UNAVAILABLE').flatMap((c) => [c.unavailableReason, ...(c.unavailableCodes ?? [])]) : [];
    const evidence = unavailable ? [] : topicEvidence(t, d.analysis.criteria ?? {});
    const memo = notesFor(record, id).length;
    return el('li', { class: `cmp-card is-${tone} is-single`, id: `cmp-item-${id}`, 'data-item': id, 'data-topic': id, 'data-status': st },
      el('div', { class: 'cmp-card-head' },
        el('span', { class: 'cmp-no' }, two(no)),
        el('h3', {}, itemLabel(record, id)),
        memo ? el('span', { class: 'memo-flag' }, '내 메모 있음') : null,
        el('span', { class: `badge badge-relation status-${tone}`, 'data-status': st }, badgeText)),
      el('div', { class: 'cmp-panels is-single' },
        el('div', { class: `cmp-panel is-a${missing || unavailable ? ' is-empty' : ''}` },
          el('p', { class: 'cmp-panel-label' }, calc ? `${labels[d.id]} · 원문 기재값` : labels[d.id]),
          el('p', { class: `cmp-value${v?.vague ? ' is-vague' : ''}` }, value),
          calc ? el('p', { class: 'cmp-sub cmp-calc' }, el('span', { class: 'calc-value' }, `${calc.text} (계산값)`), ' 원문에 적힌 근무일·출퇴근 시각·휴게시간으로 계산했어요. 주 소정근로시간이 직접 기재된 것은 아니에요.') : null,
          unavailable ? el('p', { class: 'cmp-sub' }, `${unavailableCause(codes)}. 적혀 있지 않다는 뜻은 아니에요.`) : null)),
      explain || extLeave ? el('div', { class: 'cmp-note' },
        el('p', { class: 'cmp-note-title' }, kind === 'contract' ? '기재 상태·구체성' : '확인 내용'),
        explain ? el('p', {}, explain) : null,
        extLeave ? el('p', {}, '법령·취업규칙을 참조하는 기준이 기재돼 있어요. 구체적인 부여 일수와 운영 방식은 해당 기준에서 별도 확인할 수 있어요. 미기재나 위반으로 보지 않아요.') : null) : null,
      evidence.length ? el('details', { class: 'cmp-evidence' },
        el('summary', {}, '원문 근거 보기'),
        el('div', { class: 'cmp-evidence-doc is-a' }, evidenceItems(evidence, d, labels[d.id], id)),
        el('p', { class: 'cmp-sub' }, '노란 강조는 원문에 적힌 값이에요. \'원문 전체에서 위치 보기\'를 누르면 아래 원문에서 그 줄을 펼쳐 보여 드려요.')) : null,
      q ? el('div', { class: 'cmp-question' }, el('p', { class: 'cmp-question-title' }, `회사에 확인할 질문 · ${itemLabel(record, id)}`), questionBlock(q)) : null,
      saved ? el('a', { href: ROUTES.item(record.id, id), class: 'btn-secondary cmp-detail-link' }, '조건 상세·답변 메모 →') : null);
  };
  fill($('#condition-list'), ...S.order.map((st) => {
    const list = rows.filter((r) => r.st === st);
    if (!list.length) return null;
    return el('section', { class: `cgroup cmp-group is-${S[st].tone}`, 'data-group': st, id: `cmp-group-${st}` },
      el('h3', { class: 'cgroup-title' }, S[st].label, el('span', { class: 'sum-count' }, String(list.length))),
      // 분석 확인 불가: 같은 텍스트로 다시 분석 (문서가 하나라 버튼도 묶음에 하나)
      st === 'unavailable' ? el('div', { class: 'reanalyze cmp-group-note' },
        el('p', { class: 'small' }, '근거를 원문에서 확인하지 못해 확정하지 않은 항목이에요. 적혀 있지 않다는 뜻이 아니어서 회사 질문을 만들지 않았어요.'),
        saved ? el('button', { type: 'button', class: 'btn-secondary', 'data-reanalyze': d.id }, `${labels[d.id]} 같은 텍스트로 다시 분석하기`) : null,
        el('p', { class: 'muted small reanalyze-status', role: 'status', 'aria-live': 'polite' })) : null,
      el('ol', { class: 'cmp-cards' }, list.map(card)));
  }));
  return rows;
}

function renderRecord(record, { unsaved = false } = {}) {
  const saved = !unsaved;
  const availableDocs = record.documents.filter((d) => d.analysis);
  const pair = comparisonPair(record.documents, pairByRecord.get(record.id));
  if (availableDocs.length >= 2 && record.id) pairByRecord.set(record.id, pair);
  const comparedRecord = availableDocs.length > 2 ? comparisonView(record, pair) : record;
  const fus = buildFollowUps(comparedRecord);
  const labels = docLabels(record.documents);
  const analyzedDocs = comparedRecord.documents.filter((d) => d.analysis);
  const multi = analyzedDocs.length > 1;
  const mode = recordMode(comparedRecord);
  const allFus = [...fus.primary, ...fus.more];
  const fuOf = (topicId) => allFus.find((x) => x.topicIds.includes(topicId));
  const detailLink = (topicId) => (saved ? el('a', { href: ROUTES.item(record.id, topicId), class: 'btn-secondary sum-more' }, '자세히 →') : null);

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
        el('button', { type: 'button', class: 'btn-small', id: 'copy-confirmed' }, '확인한 텍스트 복사')));
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
  const named = userAlias(record);
  $('#record-title').textContent = named || NAME_PLACEHOLDER;
  $('#record-title').classList.toggle('is-placeholder', !named);
  $('#rename-open-text').textContent = named ? '수정' : '이름 입력';
  $('#rename-open').setAttribute('aria-label', named ? '기록 이름 수정' : '기록 이름 입력');
  $('#record-meta').textContent = `등록 문서 ${record.documents.length}건${saved ? '' : ' · 저장 전'}`;
  fill($('#record-doc-chips'), ...record.documents.map((d) => el('span', { class: 'record-doc-chip' }, labels[d.id])));
  $('#rename-form').hidden = true;
  $('#record-title-row').hidden = false;
  $('#rename-open').hidden = unsaved;

  // 기록 상단: 원본 PDF 보기·다운로드 · 새 안내 추가
  releaseOriginalUrls();
  const withOriginal = saved ? record.documents.filter((d) => d.original?.fileId) : [];
  fill($('#original-list'), ...withOriginal.map((d) => originalLinks(d, labels[d.id])));
  $('#original-dropdown').hidden = !withOriginal.length;
  $('#original-dropdown').open = false;
  $('#record-tools').hidden = unsaved;
  if (saved) $('#add-doc-top').setAttribute('href', ROUTES.add(record.id));
  if (withOriginal.length) attachOriginalUrls($('#original-list'));

  const demo = record.documents.some((d) => d.mode === 'demo');
  const source = $('#analysis-source');
  source.textContent = demo
    ? '데모 결과가 포함돼 있어요. AI 분석이 아니라 개발용 키워드 규칙으로 만든 결과라서 실제 판단에 쓰면 안 돼요.'
    : 'AI가 찾은 내용을 서버가 원문과 대조해 실제로 적힌 문구인지 확인한 뒤 정리했어요. 해석이 맞는지는 원문과 함께 확인해 주세요.';
  source.classList.toggle('analysis-source-demo', demo);
  $('#demo-warning').hidden = !demo;
  $('#demo-warning').textContent = demo ? source.textContent : '';
  source.hidden = demo;

  // 분석 확인 불가: 같은 텍스트로 다시 분석 (해당 항목이 있을 때만, 맨 위)
  const sum = fus.summary;
  const unavailableDocs = [...new Set(fus.reanalyze.map((x) => x.docId))];
  const reBox = sum.unavailable.length ? el('div', { class: 'sum-group is-unavailable', 'data-group': 'unavailable', id: 'reanalyze-box' },
    el('h3', { class: 'sum-title' }, '분석 확인 불가', el('span', { class: 'sum-count' }, `${sum.unavailable.length}`)),
    el('p', { class: 'small' }, '근거를 원문에서 확인하지 못해 확정하지 않은 항목이에요. 적혀 있지 않다는 뜻이 아니어서 회사 질문을 만들지 않았어요. 같은 텍스트로 다시 분석할 수 있어요.'),
    el('ul', { class: 'sum-list' }, sum.unavailable.map((x) => el('li', { class: 'sum-item', 'data-topic': x.topicId },
      el('p', { class: 'sum-head' }, el('strong', {}, x.label), detailLink(x.topicId)),
      el('p', { class: 'sum-line' }, `${unavailableCause(x.codes)}.`)))),
    saved ? el('div', { class: 'reanalyze' }, unavailableDocs.map((docId) => el('button', { type: 'button', class: 'btn-secondary', 'data-reanalyze': docId }, `${labels[docId]} 같은 텍스트로 다시 분석하기`)),
      el('p', { class: 'muted small reanalyze-status', role: 'status', 'aria-live': 'polite' })) : null) : null;
  fill($('#summary-groups'), reBox);
  $('#now-section').hidden = !reBox;

  const pairBox = $('#compare-pair');
  pairBox.hidden = availableDocs.length < 3;
  if (!pairBox.hidden) {
    for (const [selector, selected] of [['#compare-doc-a', pair[0]], ['#compare-doc-b', pair[1]]]) {
      const input = $(selector);
      fill(input, ...availableDocs.map((d) => {
        const opt = el('option', { value: d.id }, labels[d.id]);
        opt.selected = d.id === selected;
        return opt;
      }));
      input.value = selected;
    }
  }

  // 주요 결과 (화면 종류: brief = 채용공고·처우 안내 1개 / contract = 근로계약서 1개 / compare = 자료 2개 이상)
  const hasContract = mode.check;
  // none = 아직 분석된 자료가 없음(분석 전·분석 실패) → 안내만, 아래 '등록된 안내 자료'에서 다시 분석
  const layout = multi ? 'compare' : !analyzedDocs.length ? 'none' : analyzedDocs[0].docType === 'contract' ? 'contract' : 'brief';
  $('#conditions-title').textContent = { compare: '두 문서의 근로조건을 비교했어요', contract: '근로계약서 확인 결과', brief: '주요 조건 미리보기', none: '분석 결과' }[layout];
  $('#conditions-help').textContent = {
    compare: '두 문서에 적힌 근로조건을 항목별로 대조했어요. 어느 쪽이 최종 조건인지, 회사가 조건을 바꿨는지, 법적으로 문제가 있는지는 판단하지 않아요.',
    contract: '주요 근로조건 10개 기준으로 적혀 있는지, 내용이 구체적인지 확인했어요. 추가 확인이 필요한 조건을 먼저 보여 드려요. 법률 위반 여부나 계약의 적법성은 판단하지 않아요.',
    brief: '문서에 적힌 근로조건과 원문 근거예요. 적혀 있지 않은 조건을 지적하거나 회사 질문을 만들지 않아요. 두 번째 문서를 추가하면 조건을 비교할 수 있어요.',
    none: '',
  }[layout];
  const pendingOf = (id) => (sum.pending ?? []).find((x) => x.topicId === id);
  // 비교(문서 2개)와 문서 1개 결과는 같은 구조: 문서 정보 카드 → 상태별 요약 → (질문 모아보기) → 조건 카드
  const cardRows = layout === 'compare' ? renderCompare({ record, comparedRecord, fus, labels, saved, fuOf, pendingOf })
    : layout === 'brief' || layout === 'contract' ? renderSingle({ record, comparedRecord, fus, labels, saved, fuOf, layout })
      : [];
  const hasCards = layout !== 'none';
  for (const id of ['#cmp-docs', '#cmp-summary']) $(id).hidden = !hasCards;
  $('#cmp-order-note').hidden = layout !== 'compare';
  $('#record-doc-chips').hidden = hasCards; // 아래 문서 정보 카드가 같은 정보를 보여 준다
  if (!hasCards) { $('#cmp-questions').hidden = true; fill($('#condition-list')); }
  // 분석 확인 불가는 조건 카드 안에서 (다시 분석 버튼 포함, 요약 숫자 = 카드 수)
  if (hasCards) { $('#now-section').hidden = true; fill($('#summary-groups')); }
  const cardCount = cardRows.length;
  renderGuide(layout, cardRows, { record, saved });
  // 적힌 근로조건이 하나도 없으면 (예: 근로조건 없이 합격만 알린 안내) 오류가 아니라 그 사실만 알린다
  const condEmpty = $('#conditions-empty');
  condEmpty.hidden = cardCount > 0;
  condEmpty.textContent = !analyzedDocs.length
    ? '아직 분석된 자료가 없어요. 아래 \'등록된 안내 자료와 원문\'에서 같은 텍스트로 다시 분석할 수 있어요.'
    : hasContract ? '요약할 근로조건 항목이 없어요.' : '근로조건이 발견되지 않았어요. 등록한 자료에 임금·근무시간 같은 조건이 적혀 있지 않았어요. 원문은 아래에서 볼 수 있어요.';
  // 문서 1개(채용공고·처우 안내): 다음 행동 = 비교할 두 번째 문서 추가
  $('#next-step').hidden = !(saved && layout === 'brief');
  if (saved) $('#add-second').setAttribute('href', ROUTES.add(record.id));
  $('#add-doc-top').hidden = layout === 'brief';

  // 상세 확인 (접힘): 카드에 붙지 않은 질문만 (예: 요약 카드가 없는 항목), 전체 근로조건, 등록 자료와 원문
  const onCard = new Set(layout === 'brief' ? [] : cardRows.map((r) => r.id));
  const extraFus = layout === 'brief' ? [] : allFus.filter((f) => f.question && !f.topicIds.some((t) => onCard.has(t)));
  $('#more-box').hidden = !extraFus.length;
  $('#more-count').textContent = `${extraFus.length}건`;
  fill($('#more-list'), ...extraFus.map((f) => followupCard(f, record, saved)));
  $('#more-box').open = false;

  const writtenIn = (id) => comparedRecord.documents.some((d) => { const t = topicOf(d, id); return t?.visible && t.status !== 'MAIN_MISSING'; });
  const allRows = ITEM_IDS.filter((id) => visibleIn(comparedRecord, id) && (hasContract || writtenIn(id))).map((id) => {
    const per = comparedRecord.documents.map((d) => ({ d, t: topicOf(d, id) })).filter((x) => x.t?.visible && (hasContract || multi || x.t.status !== 'MAIN_MISSING'));
    return el('li', { class: 'condition', 'data-item': id },
      el('div', { class: 'condition-head' }, el('h3', {}, itemLabel(record, id))),
      el('ul', { class: 'condition-docs' }, per.map(({ d, t }) => {
        const ev = t.status === 'MAIN_UNAVAILABLE' ? null : summaryEvidence(t);
        return el('li', { class: 'condition-doc' },
          el('span', { class: 'cd-doc' }, labels[d.id]),
          topicBadge(d, t),
          ev ? el('q', { class: 'cd-quote' }, clipText(ev.text)) : null,
          (() => { const x = topicExplain(t, d.docType); return x ? el('span', { class: 'cd-explain small' }, x) : null; })());
      })),
      saved ? el('a', { href: ROUTES.item(record.id, id), class: 'btn-secondary' }, '자세히 보기 →') : null);
  });
  fill($('#all-condition-list'), ...allRows);
  $('#all-count').textContent = `${allRows.length}개 항목`;
  $('#all-conditions').open = false;
  // 문서 1개는 조건 카드가 곧 전체 목록(계약서 10개 기준 / 공고·처우 안내에 적힌 조건 전체)이라 같은 조건을 다시 늘어놓지 않는다
  $('#all-conditions').hidden = layout !== 'compare' || !allRows.length;

  $('#docs-count').textContent = `${record.documents.length}건`;
  fill($('#doc-list'), ...record.documents.map((d, i) => {
    const pendingDoc = unsaved && i === record.documents.length - 1;
    const st = docStatusOf(d);
    const lines = d.analysis?.lines ?? (d.confirmedText ?? '').split('\n').map((text, k) => ({ id: k + 1, text }));
    return el('li', { class: 'doc-entry', 'data-doc': d.id, 'data-status': st },
      el('p', { class: 'doc-entry-head' }, el('span', { class: 'mono-index' }, `자료 ${i + 1}`), el('strong', {}, labels[d.id]),
        pendingDoc ? el('span', { class: 'tag' }, '저장 안 됨') : null,
        !pendingDoc && DOC_STATUS_TEXT[st] ? el('span', { class: 'tag tag-warn doc-status' }, DOC_STATUS_TEXT[st]) : null),
      // 원본 PDF 상태: 저장 완료 / 저장하지 못함 / 예전 기록(원본 없음)
      d.original ? el('p', { class: 'small doc-original' }, `원본 저장 완료 · ${d.original.name}${st === 'analysis_failed' ? ' · 분석 실패' : ''}`)
        : d.originalError ? el('p', { class: 'small doc-original is-error' }, `원본 PDF는 ${ORIGINAL_ERROR_TEXT[d.originalError] ?? '저장 중 문제가 생겨'} 저장하지 못했어요. 확인한 텍스트는 저장돼 있어요.`)
          : d.inputSource === 'pdf' && !pendingDoc ? el('p', { class: 'muted small doc-original is-legacy' }, '이전에 등록한 자료는 원본 파일이 보관되어 있지 않아요.') : null,
      saved && st !== 'analyzed' ? el('div', { class: 'reanalyze' },
        el('p', { class: 'small' }, st === 'analysis_failed' ? `분석을 완료하지 못했어요. 저장된 텍스트${d.original ? '와 원본' : ''}은 그대로예요.` : '아직 분석하지 않은 자료예요.'),
        el('button', { type: 'button', class: 'btn-secondary', 'data-reanalyze': d.id }, st === 'analysis_failed' ? '같은 텍스트로 다시 분석하기' : '분석하기'),
        el('p', { class: 'muted small reanalyze-status', role: 'status', 'aria-live': 'polite' })) : null,
      el('p', { class: 'muted small' }, [
        INPUT_SOURCE_LABEL[d.inputSource] ?? '확인한 텍스트',
        pendingDoc ? null : `등록 ${formatDateTime(d.registeredAt)}`,
        // v3.2부터 분석 결과는 등록 직후 저장되므로, 1분 넘게 지난 뒤의 분석만 '다시 분석'으로 표시
        d.analyzedAt && d.registeredAt && Date.parse(d.analyzedAt) - Date.parse(d.registeredAt) > 60_000 && !pendingDoc && st === 'analyzed' ? `다시 분석 ${formatDateTime(d.analyzedAt)}` : null,
      ].filter(Boolean).join(' · ')),
      d.inputSource !== 'paste' ? el('p', { class: 'small input-source-note' }, [EXTRACTED_NOTE[d.inputSource] ?? '', ...(d.extractNotes ?? [])].join(' ')) : null,
      el('details', { class: 'doc-text' },
        el('summary', {}, `확인한 텍스트 보기 (${lines.length}줄)`),
        sourcePanelLines(lines, new Map())));
  }));
  $('#original-notice').hidden = !record.documents.some((d) => d.original || d.inputSource === 'pdf');
  // 저장하지 못한 결과·분석이 끝나지 않은 자료·채용공고/처우 안내만 있는 기록은 자료와 원문을 펼쳐 둔다
  $('#docs-box').open = unsaved || record.documents.some((d) => docStatusOf(d) !== 'analyzed');

  // D. 필요할 때 하기
  $('#view-record .record-actions').hidden = unsaved;
  // 문서 1개(채용공고·처우 안내): 두 번째 문서 추가는 위 '다음 행동'에서, 여기는 기록 관리만
  $('#actions-title').textContent = layout === 'brief' ? '기록 관리' : '필요할 때 하기';
  // 같은 기능 버튼은 한 곳에만: 문서 추가는 기록 상단(문서 1개면 '다음 행동'), 비교 화면의 질문 전체 복사는 위쪽 질문 모아보기
  $('#copy-all-questions').hidden = layout === 'compare' || layout === 'contract' || !allFus.some((f) => f.question); // 위쪽 '질문 전체 복사'와 중복되지 않게
  $('#actions-status').textContent = '';
  $('#record-notice').textContent = `${analyzedDocs[0]?.analysis?.notice ?? ''} 이 기록은 이 브라우저에만 저장돼요. 다른 기기에서는 보이지 않아요.`.trim();
}

// 원문 근거 → 같은 화면의 원문 전체에서 그 줄로 이동: 접힌 '등록된 안내 자료와 원문'과 그 문서의 텍스트를 펼치고,
// 그 줄을 강조하고 검증된 인용 구절만 표시한다. 줄 바로 아래 '보던 카드로 돌아가기'로 원래 맥락에 돌아갈 수 있다.
function clearGoto() {
  for (const li of document.querySelectorAll('#doc-list .doc-line.is-goto')) {
    li.classList.remove('is-goto', 'is-arrived');
    const span = li.querySelector('.doc-line-text');
    if (span && li.dataset.plain != null) span.textContent = li.dataset.plain;
  }
  for (const b of document.querySelectorAll('#doc-list .goto-return')) b.remove();
}
$('#view-record').addEventListener('click', (e) => {
  const go = e.target.closest('button[data-goto-line]');
  const back = e.target.closest('button[data-return-card]');
  if (back) {
    const card = document.getElementById(back.dataset.returnCard);
    clearGoto();
    if (card) { card.scrollIntoView({ block: 'center' }); flashTarget(card); card.querySelector('.cmp-goto, summary')?.focus({ preventScroll: true }); }
    return;
  }
  if (!go) return;
  const entry = document.querySelector(`#doc-list > li[data-doc="${go.dataset.gotoDoc}"]`);
  const li = entry?.querySelector(`.doc-text .doc-line[data-line="${go.dataset.gotoLine}"]`);
  if (!li) return;
  clearGoto();
  $('#docs-box').open = true;
  entry.querySelector('details.doc-text').open = true;
  const span = li.querySelector('.doc-line-text');
  li.dataset.plain = span.textContent;
  // 인용 구절과 비교에 쓴 값이 그 줄에 그대로 있을 때만 강조 (없으면 줄 강조만)
  const phrases = [go.dataset.gotoText, ...JSON.parse(go.dataset.gotoMarks || '[]')].filter((p) => p && span.textContent.includes(p));
  if (phrases.length) fill(span, highlightText(span.textContent, phrases.slice(0, 1)));
  li.classList.add('is-goto');
  const label = itemLabel(currentRecord ?? { documents: [] }, go.dataset.gotoItem);
  li.after(el('li', { class: 'goto-return' },
    el('span', { class: 'small' }, `${label} 근거 · ${go.dataset.gotoLine}번째 줄`),
    el('button', { type: 'button', class: 'btn-small', 'data-return-card': go.closest('.cmp-card')?.id ?? '' }, `← ${label} 카드로 돌아가기`)));
  li.scrollIntoView({ block: 'center' });
  flashTarget(li);
});
$('#view-record').addEventListener('change', (e) => {
  if (!currentRecord) return;
  const input = e.target.closest('#compare-doc-a, #compare-doc-b');
  if (!input) return;
  const side = input.id === 'compare-doc-a' ? 0 : 1;
  const next = replaceComparedDocument(pairByRecord.get(currentRecord.id), side, input.value, currentRecord.documents);
  pairByRecord.set(currentRecord.id, next);
  renderRecord(currentRecord);
});
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
  const select = e.target.closest('#compare-doc-a, #compare-doc-b');
  if (select) return;
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
    status.textContent = doc.analysis ? `다시 분석하지 못했어요. ${r.message} 이전 결과는 그대로예요.` : `분석하지 못했어요. ${r.message} 저장된 자료는 그대로예요.`;
    if (!doc.analysis) await store.markAnalysisFailed(record.id, docId, r.status === 0 ? 'network' : r.status).catch(() => {});
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
// 제목 옆 '이름 바꾸기' → 제목 자리에서 바로 고치고 Enter로 저장, Esc로 취소
$('#rename-open').addEventListener('click', () => {
  $('#rename-form').hidden = false;
  $('#record-title-row').hidden = true;
  $('#rename-input').value = userAlias(currentRecord);
  $('#rename-error').hidden = true;
  $('#rename-input').focus();
});
function closeRename() { $('#rename-form').hidden = true; $('#record-title-row').hidden = false; $('#rename-open').focus(); }
$('#rename-cancel').addEventListener('click', closeRename);
$('#rename-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeRename(); } });
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
// 질문 전체 복사 (비교 화면 위쪽 모아보기): 아래 '질문 모두 복사'와 같은 방식
$('#copy-all-top').addEventListener('click', async () => {
  const texts = [...new Set([...document.querySelectorAll('#view-record .q-block > .question .q-text')].map((t) => t.value.trim()).filter(Boolean))];
  const ok = texts.length > 0 && await copyText(texts.join('\n\n'));
  $('#copy-all-top-status').textContent = ok ? `질문 ${texts.length}개를 복사했어요. 고친 내용이 그대로 복사돼요.` : '복사하지 못했어요. 질문을 직접 선택해 복사해 주세요.';
});
// 요약 칸 → 해당 상태 묶음으로 이동 (같은 조건은 펼쳐서)
$('#cmp-tiles').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-jump]');
  if (!b) return;
  const g = document.getElementById(`cmp-group-${b.dataset.jump}`);
  if (!g) return;
  if (g.tagName === 'DETAILS') g.open = true;
  g.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#copy-all-questions').addEventListener('click', async () => {
  // 항목마다 대표 질문만 (추가 질문은 각자 복사)
  const texts = [...new Set([...document.querySelectorAll('#view-record .q-block > .question .q-text')].map((t) => t.value.trim()).filter(Boolean))];
  const ok = texts.length > 0 && await copyText(texts.join('\n\n'));
  $('#actions-status').textContent = ok ? `질문 ${texts.length}개를 복사했어요. 필요한 것만 골라 직접 보내 주세요.` : '복사하지 못했어요. 질문을 직접 선택해 복사해 주세요.';
});
$('#delete-record').addEventListener('click', async () => {
  if (!currentRecord) return;
  if (!confirm(`'${recordLabel(currentRecord)}' 기록을 삭제할까요? 등록한 자료·확인한 텍스트·분석 결과·원문 근거·원본 PDF·답변 메모가 모두 지워지고 되돌릴 수 없어요.`)) return;
  try {
    pendingNotice = 'deleted';
    try { await store.remove(currentRecord.id); } catch (err) { if (err?.code !== 'files_cleanup_failed') throw err; pendingNotice = 'deleted_files_left'; }
    delete contexts[currentRecord.id];
    currentRecord = null;
    go(ROUTES.records);
  } catch {
    pendingNotice = null;
    $('#actions-status').textContent = '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
});

// ---------- 비교 결과 정리본 ----------
// 결과 화면에서 고른 두 문서(세 문서 이상이면 선택한 두 문서)를 화면 카드와 같은 계산으로 정리한다. AI를 다시 부르지 않는다.
let reportModel = null;
function buildReportModel(record) {
  const comparedRecord = comparisonView(record, pairByRecord.get(record.id));
  const fus = buildFollowUps(comparedRecord);
  const labels = docLabels(record.documents);
  const allFus = [...fus.primary, ...fus.more];
  const fuOf = (topicId) => allFus.find((x) => x.topicIds.includes(topicId));
  const pendingOf = (id) => (fus.summary.pending ?? []).find((x) => x.topicId === id);
  const { docs, rows, skipped } = compareRowsFor(comparedRecord, fus, fuOf, pendingOf);
  if (docs.length < 2) return null;
  const questions = [];
  const groups = STATUS_ORDER.map((st) => ({
    key: st,
    label: COMPARE_STATUS[st].label,
    rows: rows.filter((r) => r.st === st).map((row) => {
      const label = itemLabel(record, row.id);
      const { line, detail } = rowNotes(row, docs, { comparedRecord, labels, fus, pendingOf });
      const ev = (k) => (row.ts[k]?.status === 'MAIN_UNAVAILABLE' ? [] : evidenceFor(row.relItem, docs[k].id));
      let questionNo = null;
      if (row.q?.question) { questionNo = questions.length + 1; questions.push({ no: questionNo, label, text: row.q.question }); }
      return {
        id: row.id, label, badge: st === 'same' && row.relItem?.addedNote ? '같은 조건 · 세부 조건 추가' : COMPARE_STATUS[st].badge,
        a: sideInfo(row, docs[0], 0), b: sideInfo(row, docs[1], 1), line, detail, evidence: { a: ev(0), b: ev(1) }, questionNo,
      };
    }),
  })).filter((g) => g.rows.length);
  return {
    title: '비교 결과 정리본',
    recordName: recordLabel(record),
    createdAt: formatDateTime(new Date().toISOString()),
    docs: docs.map((d, k) => ({ side: 'AB'[k], type: labels[d.id], name: documentTitle(d) || labels[d.id], registered: formatDateTime(d.registeredAt) })),
    summary: STATUS_ORDER.map((st) => ({ key: st, label: COMPARE_STATUS[st].label, count: rows.filter((r) => r.st === st).length, items: rows.filter((r) => r.st === st).map((r) => itemLabel(record, r.id)) })),
    skipped, groups, questions,
  };
}
function renderReport(record) {
  $('#report-back').setAttribute('href', ROUTES.record(record.id));
  $('#report-status').textContent = '';
  reportModel = buildReportModel(record);
  const m = reportModel;
  for (const id of ['#report-copy', '#report-copy-q', '#report-print']) $(id).hidden = !m;
  if (!m) { fill($('#report'), el('p', {}, '두 문서를 비교한 기록에서만 정리본을 볼 수 있어요. 다른 문서를 추가해 비교해 주세요.')); return; }
  $('#report-copy-q').hidden = !m.questions.length;
  const quote = (e, side) => el('li', {},
    el('span', { class: 'report-ev-ref' }, `문서 ${side}${e.line != null ? ` ${e.line}번째 줄` : ''} · ${e.facets.join('·')}`),
    el('q', {}, e.text));
  const sideCell = (s, k) => el('div', { class: `report-side is-${'ab'[k]}${s.state !== 'present' ? ' is-empty' : ''}` },
    el('p', { class: 'report-side-label' }, `문서 ${'AB'[k]} · ${m.docs[k].type}`),
    el('p', { class: 'report-side-value' }, sideText(s)));
  fill($('#report'),
    el('header', { class: 'report-head' },
      el('p', { class: 'report-kicker' }, '일단확인'),
      el('h1', {}, m.title),
      el('p', { class: 'report-meta' }, `${m.recordName} · 정리한 때 ${m.createdAt}`)),
    el('section', { class: 'report-sec' }, el('h2', {}, '비교한 문서'),
      el('ul', { class: 'report-docs' }, m.docs.map((d) => el('li', { class: `is-${d.side.toLowerCase()}` }, el('strong', {}, `문서 ${d.side} · ${d.type}`), ` ${d.name} (등록 ${d.registered})`))),
      el('p', { class: 'report-note' }, REPORT_NOTICES[0])),
    el('section', { class: 'report-sec' }, el('h2', {}, '전체 비교 요약'),
      el('table', { class: 'report-summary' }, el('tbody', {}, m.summary.map((g) => el('tr', { class: `is-${g.key}` },
        el('th', { scope: 'row' }, g.label), el('td', { class: 'num' }, `${g.count}건`), el('td', {}, g.items.join(', ') || '—'))))),
      m.skipped ? el('p', { class: 'report-note' }, `두 문서 모두에 적혀 있지 않은 조건 ${m.skipped}개는 정리본에 넣지 않았어요.`) : null),
    ...m.groups.map((g) => el('section', { class: `report-sec report-group is-${g.key}`, 'data-group': g.key },
      el('h2', {}, `${g.label} `, el('span', { class: 'report-count' }, `${g.rows.length}건`)),
      g.rows.map((r) => el('article', { class: 'report-item', 'data-item': r.id },
        el('h3', {}, r.label, el('span', { class: `badge badge-relation status-${g.key}` }, r.badge)),
        el('div', { class: 'report-sides' }, sideCell(r.a, 0), sideCell(r.b, 1)),
        r.line ? el('p', { class: 'report-line' }, el('strong', {}, '대조 요약 '), r.line) : null,
        r.detail ? el('p', { class: 'report-line' }, el('strong', {}, '참고 '), r.detail) : null,
        r.evidence.a.length || r.evidence.b.length ? el('div', { class: 'report-ev' },
          el('p', { class: 'report-ev-title' }, '원문 근거'),
          el('ul', {}, [...r.evidence.a.map((e) => quote(e, 'A')), ...r.evidence.b.map((e) => quote(e, 'B'))])) : null,
        r.questionNo ? el('p', { class: 'report-qref' }, `→ 회사에 확인할 질문 ${r.questionNo}번`) : null)))),
    el('section', { class: 'report-sec report-questions' }, el('h2', {}, '회사에 확인할 질문'),
      m.questions.length ? el('ol', {}, m.questions.map((q) => el('li', {}, el('strong', {}, `${q.label} `), q.text)))
        : el('p', {}, '이번 비교에서 만든 확인 질문은 없어요.'),
      m.questions.length ? el('p', { class: 'report-note' }, '질문은 결과 화면에서 상황에 맞게 고쳐 쓸 수 있어요. 정리본에는 처음 만든 문장이 들어가요.') : null),
    el('section', { class: 'report-sec report-notices' }, el('h2', {}, '원문 근거와 서비스 안내'),
      el('ul', {}, REPORT_NOTICES.map((n) => el('li', {}, n)))));
}
$('#report-copy').addEventListener('click', async () => {
  const ok = reportModel && await copyText(reportText(reportModel));
  $('#report-status').textContent = ok ? '정리본 전체를 복사했어요. 메모장이나 메일에 붙여 넣을 수 있어요.' : '복사하지 못했어요. 정리본을 직접 선택해 복사해 주세요.';
});
$('#report-copy-q').addEventListener('click', async () => {
  const ok = reportModel?.questions.length && await copyText(questionsText(reportModel));
  $('#report-status').textContent = ok ? `질문 ${reportModel.questions.length}개만 복사했어요.` : '복사하지 못했어요. 질문을 직접 선택해 복사해 주세요.';
});
$('#report-print').addEventListener('click', () => window.print());

// ---------- S05 항목 상세 ----------
let memoEditing = null; // 편집 중인 메모 ID 또는 'new'

function renderItem(record, itemId) {
  const comparedRecord = comparisonView(record, pairByRecord.get(record.id));
  const fus = buildFollowUps(comparedRecord);
  const labels = docLabels(record.documents);
  const rel = fus.relation.items.find((i) => i.id === itemId);
  const label = itemLabel(record, itemId);
  const multi = comparedRecord.documents.filter((d) => d.analysis).length > 1;
  const mode = recordMode(comparedRecord);
  $('#item-back').setAttribute('href', ROUTES.record(record.id));

  const head = el('header', { class: 'detail-head' },
    el('p', { class: 'crumb' }, recordLabel(record)),
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
    questionBlock(f),
    el('p', { class: 'muted small' }, QUESTION_HINT)) : null;
  const reSec = fus.reanalyze.some((x) => x.topicId === itemId) ? el('p', { class: 'note note-hold' },
    '분석 확인 불가: 근거를 원문에서 확인하지 못했거나 글자 인식이 불확실해 확정하지 않았어요. 적혀 있지 않다는 뜻이 아니에요. 기록 화면의 \'등록된 안내 자료\'에서 같은 텍스트로 다시 분석할 수 있어요.') : null;

  // 자료별 내용과 원문
  const docSecs = comparedRecord.documents.map((d) => {
    const t = topicOf(d, itemId);
    const title = el('h2', {}, `${labels[d.id]} `, el('span', { class: 'muted small' }, `등록 ${formatDateTime(d.registeredAt)}`));
    if (!d.analysis) {
      return el('section', { class: 'doc-block', 'data-doc': d.id }, title,
        el('p', { class: 'muted' }, `${DOC_STATUS_TEXT[docStatusOf(d)] ?? '분석 전'}: 이 자료는 아직 분석 결과가 없어요. 기록 화면의 '등록된 안내 자료'에서 분석할 수 있어요.`));
    }
    if (!t?.visible) {
      return el('section', { class: 'doc-block', 'data-doc': d.id }, title,
        el('p', { class: 'muted' }, itemId === '08' ? '이 자료에는 수습이 적용된다고 적혀 있지 않아 수습 중 임금을 따로 확인하지 않았어요.' : '이 자료에서는 이 항목을 확인하지 않았어요.'));
    }
    const marks = topicMarks(t);
    // 채용공고·처우 안내: 원문 근거가 있는 세부 기준만 (적히지 않은 기준을 '미기재'로 늘어놓지 않음)
    const brief = d.docType !== 'contract';
    const shown = (c) => !brief || c.evidence.length > 0 || c.status === 'UNAVAILABLE';
    const core = t.criteria.filter((c) => c.role === 'C' && shown(c));
    const extra = t.criteria.filter((c) => c.role === 'D' && shown(c));
    if (brief && t.status === 'MAIN_MISSING') {
      return el('section', { class: 'doc-block', 'data-doc': d.id }, title,
        el('p', { class: 'muted' }, '이 자료에는 이 조건이 적혀 있지 않아요.'));
    }
    const notes = [];
    if (t.notes.neutral) notes.push(el('div', { class: 'note note-neutral' }, el('p', { class: 'note-title' }, '적힌 내용에 대한 안내'), el('p', {}, t.notes.neutral)));
    if (t.notes.applicability) notes.push(el('div', { class: 'note note-applicability' }, el('p', { class: 'note-title' }, '법령 적용 범위 안내'), el('p', {}, t.notes.applicability), linkList(t.applicabilityLinks)));
    if (t.notes.probationHold) notes.push(el('div', { class: 'note note-hold' }, el('p', { class: 'note-title' }, '수습 중 임금 항목을 판정하지 않은 이유'), el('p', {}, t.notes.probationHold)));
    return el('section', { class: 'doc-block', 'data-doc': d.id },
      title,
      el('p', { class: 'doc-block-status' }, topicBadge(d, t), el('span', { class: 'small' }, brief ? (topicExplain(t, d.docType) ?? '') : topicSummary(t))),
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
    el('h2', { id: 'memo-title' }, '회사 답변 메모 (선택)'),
    el('p', { class: 'muted small' }, `${MEMO_HINT} 내가 쓴 메모일 뿐 공식 근로조건이나 확인된 사실로 표시되지 않고, 분석 결과와 원문은 바뀌지 않아요.`),
    el('ul', { class: 'memo-list' }, memos.map((n) => (memoEditing === n.id ? memoForm(n) : el('li', { class: 'memo-item', 'data-note': n.id },
      el('p', { class: 'memo-label' }, '내가 기록한 답변'),
      el('p', { class: 'memo-text' }, n.text),
      el('p', { class: 'muted small' }, `메모 작성 ${formatDateTime(n.createdAt)}${n.updatedAt !== n.createdAt ? ` · 수정 ${formatDateTime(n.updatedAt)}` : ''}`),
      el('div', { class: 'memo-actions' },
        el('button', { type: 'button', class: 'btn-small', 'data-memo-edit': n.id }, '수정'),
        el('button', { type: 'button', class: 'btn-small danger', 'data-memo-delete': n.id }, '삭제')))))),
    memoEditing === 'new' ? memoForm(null) : el('button', { type: 'button', class: 'btn-secondary', id: 'memo-add' }, '답변 메모 추가'),
    el('p', { class: 'muted small', id: 'memo-status', role: 'status', 'aria-live': 'polite' }));

  // 점검 기준 출처는 근로계약서 점검에만 (채용공고·처우 안내는 기록만 하므로 숨김)
  const t0 = comparedRecord.documents.filter((d) => d.docType === 'contract').map((d) => topicOf(d, itemId)).find((t) => t?.visible);
  const sourceSec = t0 && mode.check ? el('details', { class: 'source-accordion' },
    el('summary', {}, el('span', { class: 'source-title' }, '이 기준은 어디에서 왔나요?'), el('span', { class: 'toggle-text' }, '자세히 보기')),
    el('div', { class: 'source-body' },
      el('p', {}, '일단확인의 점검 기준은 관련 법령과 공식 서식을 참고해 설계한 자체 확인 기준이며, 법률 자문이나 유권해석이 아니에요.'),
      el('table', { class: 'source-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '세부 기준'), el('th', { scope: 'col' }, '기준 출처 유형'))),
        el('tbody', {}, t0.criteria.map((c) => el('tr', {}, el('td', {}, c.label), el('td', {}, c.sources.map((k) => el('span', { class: 'source-badge' }, SOURCE_LABEL[k]))))))),
      t0.links.length ? linkList(t0.links) : null)) : null;

  // 질문 → 답변 메모 → 문서별 원문 순서 (메모가 긴 원문 아래에 묻히지 않게)
  fill($('#item'), head, relSec, fuSec, reSec, memoSec, ...docSecs, sourceSec,
    el('div', { class: 'detail-actions' }, el('a', { href: ROUTES.record(record.id), class: 'btn-secondary' }, '← 기록으로 돌아가기')));
}

function memoForm(note) {
  const ta = el('textarea', { id: 'memo-text', rows: '4', maxlength: String(NOTE_MAX) });
  ta.value = note?.text ?? '';
  return el('li', { class: 'memo-form' },
    el('label', { for: 'memo-text' }, note ? '메모 고치기' : '새 메모'),
    ta,
    el('div', { class: 'memo-actions' },
      el('button', { type: 'button', class: 'btn-small is-strong', id: 'memo-save', 'data-note': note?.id ?? '' }, '메모 저장'),
      el('button', { type: 'button', class: 'btn-small', id: 'memo-cancel' }, '취소')));
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
  fill($('#record-list'), ...list.map((r) => el('li', { class: 'record-card', 'data-record': r.id },
    el('a', { href: ROUTES.record(r.id), class: 'record-link' },
      el('span', { class: `record-name${userAlias(r) ? '' : ' is-unnamed'}` }, userAlias(r) || '이름 없는 기록'),
      // 이름이 없어도 문서 유형·등록일로 서로 구별할 수 있게
      el('span', { class: 'record-types' }, `${r.documents.map((d) => DOC_TYPE_LABEL[d.docType]).join(' · ')} (자료 ${r.documents.length}건)`),
      el('span', { class: 'muted small' }, `첫 등록 ${formatDateTime(firstRegistered(r))} · 마지막 저장 ${formatDateTime(r.updatedAt)}${r.notes?.length ? ` · 내 메모 ${r.notes.length}개` : ''}`)),
    el('button', { type: 'button', class: 'btn-small danger', 'data-delete': r.id }, '삭제'))));
}
$('#record-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-delete]');
  if (!b) return;
  const name = b.closest('.record-card').querySelector('.record-name').textContent;
  if (!confirm(`'${name}' 기록을 삭제할까요? 등록한 자료·확인한 텍스트·분석 결과·원문 근거·원본 PDF·답변 메모가 모두 지워지고 되돌릴 수 없어요.`)) return;
  try {
    let notice = ROUTE_NOTICE.deleted;
    try { await store.remove(b.dataset.delete); } catch (err) { if (err?.code !== 'files_cleanup_failed') throw err; notice = ROUTE_NOTICE.deleted_files_left; }
    delete contexts[b.dataset.delete];
    await renderRecords();
    showMsg($('#records-notice'), notice);
  } catch {
    $('#records-status').textContent = '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
});
$('#delete-all').addEventListener('click', async () => {
  if (!confirm('이 브라우저에 저장된 모든 입사 기록을 삭제할까요? 자료·확인 텍스트·분석 결과·원문 근거·원본 PDF·메모가 모두 지워지고 되돌릴 수 없어요.')) return;
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
const VIEWS = ['landing', 'input', 'review', 'analyzing', 'error', 'record', 'item', 'records', 'report'];
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
  else if (r.view === 'report') renderReport(record);
  else if (r.view === 'records') await renderRecords();
  else if (r.view === 'review') {
    $('#review-back').setAttribute('href', inputRoute());
    reviewSubmit.textContent = state.target.kind === 'add' ? '이 내용으로 계속하기 (기록에 추가) →' : '이 내용으로 계속하기 →';
    $('#review-stale').hidden = state.file.source !== 'ocr' || state.file.imagesVersion === imagesVersion;
    $('#original-text-body').textContent = state.file.original;
    showLayoutStatus();
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

  // 조건 상세·정리본 → 결과 화면으로 돌아오면(앱 안 링크·브라우저 뒤로 가기 모두) 보던 카드 위치로
  const returnItem = r.view === 'record' && prevRoute?.recordId === r.recordId ? (prevRoute.view === 'item' ? prevRoute.itemId : null) : null;
  prevRoute = { view: r.view, recordId: r.recordId ?? null, itemId: r.itemId ?? null };
  const card = returnItem ? document.getElementById(`cmp-item-${returnItem}`) : null;
  if (card) { card.scrollIntoView({ block: 'center' }); flashTarget(card); } else window.scrollTo(0, 0);
  if (r.view === 'analyzing' || r.view === 'error') $(`#${r.view}-title`).focus({ preventScroll: true });
}
let prevRoute = null;
window.addEventListener('hashchange', route);
route();
updatePasteState();

fetch('/api/config').then((r) => r.json()).then((c) => { $('#mode-badge').hidden = c.mode !== 'demo'; }).catch(() => {});
