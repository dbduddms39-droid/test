import { moveItem, planSelection, UPLOAD_MESSAGES, MAX_IMAGES } from './upload-rules.js';
import { buildQuestion, copyText } from './questions.js';

// 일단확인 클라이언트. 입력 원문과 결과는 메모리에만 두고 브라우저 저장소에 남기지 않는다.
const STATUS_ORDER = ['stated', 'unclear', 'not_found', 'unavailable'];
const STATUS_LABEL = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가' };

let result = null;
const EXTRACTED_NOTE = {
  ocr: '이미지·스캔 문서에서 글자를 인식(OCR)한 뒤 확인·수정한 텍스트 기준의 결과예요. 글자 인식은 원본과 완전히 같다고 보장할 수 없으니, 중요한 내용은 원본 파일에서 다시 확인해 주세요.',
  pdf: 'PDF에서 추출한 뒤 확인·수정한 텍스트 기준의 결과예요. 추출 과정에서 줄 순서나 표 내용이 원본과 다를 수 있으니, 중요한 내용은 원본 파일에서 다시 확인해 주세요.',
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};
const badge = (status) => el('span', { class: `badge badge-${status}` }, STATUS_LABEL[status]);

// ---------- 화면 01 ----------
const textarea = $('#doc-text');
const updateCount = () => { $('#char-count').textContent = textarea.value.length.toLocaleString(); };
textarea.addEventListener('input', updateCount);

// 파일 업로드 → 브라우저 안에서 텍스트 추출 → 입력란에 채움 (자동 분석하지 않음)
// - 이미지: 최대 5장을 같은 문서의 연속 캡처로 보고, 사용자가 정한 순서대로 OCR해 하나로 합친다.
// - PDF: 1개씩 처리한다.
// - 실패하면 입력란과 이미지 목록을 그대로 둔다. 파일은 서버로 보내지 않는다.
const fileInput = $('#file-input');
const uploadStatus = $('#upload-status');
const imagePanel = $('#image-panel');
const imageList = $('#image-list');
const extractBtn = $('#extract-btn');
const confirmRow = $('#confirm-row');
const confirmBox = $('#confirm-extracted');
const ITEM_FAIL_TEXT = {
  no_text_found: '글자를 찾지 못했어요',
  image_decode_failed: '이미지를 열지 못했어요',
  unsupported_type: '지원하지 않는 형식이에요',
  extract_failed: '글자를 읽지 못했어요',
};
const PROGRESS_TEXT = {
  image: '이미지를 여는 중…',
  'pdf-load': 'PDF를 여는 중…',
  'pdf-text': (p) => `PDF ${p.page}/${p.pages}쪽 텍스트를 읽는 중…`,
  'ocr-load': '글자 인식 도구를 준비하는 중… (처음 한 번은 몇 MB를 내려받아 시간이 걸려요)',
  ocr: (p) => `글자를 인식하는 중… ${p.page}/${p.pages}`,
};
const onProgress = (p) => {
  const t = PROGRESS_TEXT[p.stage];
  if (t) showUploadStatus(typeof t === 'function' ? t(p) : t);
};
const showUploadStatus = (text, kind = 'info') => {
  uploadStatus.textContent = text;
  uploadStatus.className = `upload-status upload-status-${kind}`;
  uploadStatus.hidden = false;
};
const loadExtractor = () => import('./extract.js');

let images = []; // { id, file, url, fail }
let nextImageId = 1;
let inputSource = 'paste'; // 'paste' | 'pdf' | 'ocr' — 분석 결과 화면 안내에 사용
let busy = false;

function setBusy(on) {
  busy = on;
  $('#submit-btn').disabled = on;
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
    return el('li', { class: `image-item${img.fail ? ' image-item-failed' : ''}` },
      el('img', { src: img.url, alt: `${i + 1}번째 이미지 미리보기`, class: 'image-thumb' }),
      el('div', { class: 'image-meta' },
        el('span', { class: 'image-order' }, `${i + 1}`),
        el('span', { class: 'image-name' }, img.file.name),
        img.fail ? el('span', { class: 'image-fail' }, ITEM_FAIL_TEXT[img.fail] ?? ITEM_FAIL_TEXT.extract_failed) : null),
      el('div', { class: 'image-buttons' },
        btn('위로', 'up', i === 0),
        btn('아래로', 'down', i === images.length - 1),
        btn('삭제', 'remove', false)));
  }));
}

imageList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b || busy) return;
  const i = Number(b.dataset.index);
  if (b.dataset.action === 'up') images = moveItem(images, i, -1);
  if (b.dataset.action === 'down') images = moveItem(images, i, 1);
  if (b.dataset.action === 'remove') {
    URL.revokeObjectURL(images[i].url);
    images = images.filter((_, k) => k !== i);
  }
  renderImages();
  showQueueStatus();
});

function showQueueStatus() {
  if (!images.length) { uploadStatus.hidden = true; return; }
  showUploadStatus(`이미지 ${images.length}장 (최대 ${MAX_IMAGES}장). 순서를 확인한 뒤 '텍스트 추출'을 눌러 주세요.`);
}

$('#clear-images').addEventListener('click', () => {
  if (busy) return;
  images.forEach((img) => URL.revokeObjectURL(img.url));
  images = [];
  renderImages();
  uploadStatus.hidden = true;
});

// 추출한 텍스트를 입력란에 넣는다. 기존 내용이 있으면 바꿀지 먼저 묻는다(취소하면 아무것도 바꾸지 않음).
function applyExtractedText(text, source) {
  if (textarea.value.trim() && !confirm('입력란의 내용을 파일에서 추출한 텍스트로 바꿀까요?')) return false;
  textarea.value = text;
  updateCount();
  inputSource = source;
  confirmBox.checked = false;
  confirmRow.hidden = false;
  textarea.focus();
  return true;
}

textarea.addEventListener('input', () => {
  if (!textarea.value.trim()) { inputSource = 'paste'; confirmRow.hidden = true; confirmBox.checked = false; }
});

const reviewNote = '원본 파일과 다른 부분이 있을 수 있으니 아래 내용을 확인·수정하고, 확인 체크 후 \'분석 시작\'을 눌러 주세요.';

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
    const { extractTextFromFile } = await loadExtractor();
    const out = await extractTextFromFile(file, onProgress);
    if (!applyExtractedText(out.text, out.method === 'pdf-text' ? 'pdf' : 'ocr')) {
      return showUploadStatus('입력란 내용을 그대로 두었어요. 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    }
    const what = out.method === 'pdf-text' ? `PDF ${out.pages}쪽에서 텍스트를 추출했어요.`
      : `PDF ${out.pages}쪽에서 텍스트를 추출했어요 (스캔된 ${out.ocrPages}쪽은 글자 인식).`;
    const msg = [what, reviewNote, ...notes];
    if (out.method !== 'pdf-text') msg.push('글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    if (out.lowConfidence) msg.push('인식 정확도가 낮아 보여요. 숫자(금액·날짜·시간)를 특히 꼼꼼히 확인해 주세요.');
    if (out.text.length > 20000) msg.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    showUploadStatus(msg.join(' '), out.lowConfidence || notes.length ? 'warn' : 'done');
  } catch (err) {
    showUploadStatus(err?.code ? err.message : '파일에서 텍스트를 추출하지 못했어요. 내용을 직접 붙여넣어 주세요.', 'error');
  } finally {
    setBusy(false);
  }
}

extractBtn.addEventListener('click', async () => {
  if (busy || !images.length) return;
  images.forEach((img) => { img.fail = null; });
  setBusy(true);
  showUploadStatus('이미지를 확인하는 중…');
  try {
    const { extractTextFromImages } = await loadExtractor();
    const out = await extractTextFromImages(images.map((img) => img.file), onProgress, (i, r) => {
      images[i].fail = r.ok ? null : r.code;
    });
    if (!out.okCount) {
      return showUploadStatus('이미지에서 글자를 찾지 못했어요. 더 선명한 이미지로 바꾸거나 내용을 직접 입력해 주세요. 입력란은 그대로 두었어요.', 'error');
    }
    if (!applyExtractedText(out.text, 'ocr')) return showUploadStatus('입력란 내용을 그대로 두었어요. 추출한 텍스트로 바꾸려면 다시 추출해 주세요.', 'warn');
    const msg = [`이미지 ${images.length}장 중 ${out.okCount}장에서 글자를 인식해 순서대로 합쳤어요.`];
    if (out.failed.length) {
      msg.push(`${out.failed.map((f) => `${f.index + 1}번째`).join(', ')} 이미지는 ${out.failed.length === 1 ? ITEM_FAIL_TEXT[out.failed[0].code] ?? '읽지 못했어요' : '읽지 못했어요'}. 그 부분은 직접 입력하거나 다른 이미지로 바꿔 주세요.`);
    }
    msg.push(reviewNote, '글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    if (out.lowConfidence) msg.push('인식 정확도가 낮아 보여요. 숫자(금액·날짜·시간)를 특히 꼼꼼히 확인해 주세요.');
    if (out.text.length > 20000) msg.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    showUploadStatus(msg.join(' '), out.failed.length || out.lowConfidence ? 'warn' : 'done');
  } catch (err) {
    showUploadStatus(err?.code ? `${err.message} 입력란은 그대로 두었어요.` : '텍스트를 추출하지 못했어요. 입력란은 그대로 두었어요.', 'error');
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

$('#input-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const docType = new FormData(e.target).get('docType');
  const text = textarea.value;
  const errorBox = $('#input-error');
  errorBox.hidden = true;
  if (!text.trim()) return showError('문서 내용을 붙여넣어 주세요.');
  if (inputSource !== 'paste' && !confirmBox.checked) {
    confirmBox.focus();
    return showError('파일에서 추출한 텍스트는 원본과 다를 수 있어요. 내용을 확인·수정한 뒤 확인 체크를 해 주세요.');
  }
  const source = inputSource;

  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = '분석하는 중…';
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showError(data.error || '분석에 실패했어요. 잠시 후 다시 시도해 주세요.');
    result = { ...data, inputSource: source };
    location.hash = '#/result';
  } catch {
    showError('서버에 연결하지 못했어요. 네트워크를 확인해 주세요.');
  } finally {
    btn.disabled = false;
    btn.textContent = '분석 시작';
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
});

// ---------- 화면 02 ----------
function renderResult() {
  $('#result-doc-type').textContent = result.docTypeLabel;
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

// ---------- 화면 03 ----------
function renderDetail(id) {
  const it = result.items.find((x) => x.id === id && x.visible);
  if (!it) return false;

  const blocks = [
    el('p', { class: 'doc-type-chip' }, result.docTypeLabel),
    el('h1', {}, it.label),
    el('div', { class: 'detail-status' }, badge(it.status)),
    el('h2', {}, '이 결과의 의미'),
    el('p', {}, it.probationNone ? '문서에 수습기간이 없다고 적혀 있어요.' : it.explanation),
  ];
  if (it.reasonText) blocks.push(el('p', { class: 'reason' }, it.reasonText));
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

  blocks.push(el('h2', {}, '추가로 확인해 보세요'));
  blocks.push(el('ul', { class: 'follow-ups' }, it.followUps.map((f) => el('li', {}, f))));

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
  return true;
}

// ---------- 라우팅 ----------
function route() {
  const hash = location.hash || '#/';
  const views = { input: $('#view-input'), result: $('#view-result'), detail: $('#view-detail') };
  let active = 'input';
  if (result && hash === '#/result') { renderResult(); active = 'result'; }
  else if (result && hash.startsWith('#/detail/') && renderDetail(hash.slice('#/detail/'.length))) active = 'detail';
  else if (hash !== '#/') { location.hash = '#/'; return; }
  for (const [k, v] of Object.entries(views)) v.hidden = k !== active;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

fetch('/api/config').then((r) => r.json()).then((c) => { $('#mode-badge').hidden = c.mode !== 'demo'; }).catch(() => {});
