// 일단확인 클라이언트. 입력 원문과 결과는 메모리에만 두고 브라우저 저장소에 남기지 않는다.
const STATUS_ORDER = ['stated', 'unclear', 'not_found', 'unavailable'];
const STATUS_LABEL = { stated: '명시됨', unclear: '분명하지 않음', not_found: '찾지 못함', unavailable: '분석 확인 불가' };

let result = null;

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
const fileInput = $('#file-input');
const uploadStatus = $('#upload-status');
const PROGRESS_TEXT = {
  image: '이미지를 여는 중…',
  'pdf-load': 'PDF를 여는 중…',
  'pdf-text': (p) => `PDF ${p.page}/${p.pages}쪽 텍스트를 읽는 중…`,
  'ocr-load': '글자 인식 도구를 준비하는 중… (처음 한 번은 몇 MB를 내려받아 시간이 걸려요)',
  ocr: (p) => `글자를 인식하는 중… ${p.page}/${p.pages}`,
};
const showUploadStatus = (text, kind = 'info') => {
  uploadStatus.textContent = text;
  uploadStatus.className = `upload-status upload-status-${kind}`;
  uploadStatus.hidden = false;
};

async function handleFile(file) {
  if (!file) return;
  if (textarea.value.trim() && !confirm('입력란의 내용을 파일에서 추출한 텍스트로 바꿀까요?')) return;
  const btn = $('#submit-btn');
  btn.disabled = true;
  fileInput.disabled = true;
  showUploadStatus('파일을 확인하는 중…');
  try {
    const { extractTextFromFile } = await import('./extract.js');
    const out = await extractTextFromFile(file, (p) => {
      const t = PROGRESS_TEXT[p.stage];
      if (t) showUploadStatus(typeof t === 'function' ? t(p) : t);
    });
    textarea.value = out.text;
    updateCount();
    const what = out.method === 'pdf-text' ? `PDF ${out.pages}쪽에서 텍스트를 추출했어요.`
      : out.kind === 'pdf' ? `PDF ${out.pages}쪽에서 텍스트를 추출했어요 (스캔된 ${out.ocrPages}쪽은 글자 인식).`
        : '이미지에서 글자를 인식했어요.';
    const notes = [what, '원문과 다른 부분이 있을 수 있으니 아래 내용을 확인·수정한 뒤 \'분석 시작\'을 눌러 주세요.'];
    if (out.method !== 'pdf-text') notes.push('글자 인식 결과에는 오타나 빠진 글자가 있을 수 있어요.');
    if (out.lowConfidence) notes.push('인식 정확도가 낮아 보여요. 숫자(금액·날짜·시간)를 특히 꼼꼼히 확인해 주세요.');
    if (out.text.length > 20000) notes.push('추출한 텍스트가 2만 자를 넘어요. 필요한 부분만 남겨 주세요.');
    showUploadStatus(notes.join(' '), out.lowConfidence ? 'warn' : 'done');
    textarea.focus();
  } catch (err) {
    showUploadStatus(err?.code ? err.message : '파일에서 텍스트를 추출하지 못했어요. 내용을 직접 붙여넣어 주세요.', 'error');
  } finally {
    btn.disabled = false;
    fileInput.disabled = false;
    fileInput.value = ''; // 같은 파일을 다시 고를 수 있게
  }
}
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
const drop = $('#upload-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });

$('#input-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const docType = new FormData(e.target).get('docType');
  const text = textarea.value;
  const errorBox = $('#input-error');
  errorBox.hidden = true;
  if (!text.trim()) return showError('문서 내용을 붙여넣어 주세요.');

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
    result = data;
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

  blocks.push(el('h2', {}, '문서 원문'));
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
