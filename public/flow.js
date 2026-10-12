// 화면 이동·입력 확인 규칙. DOM에 의존하지 않아 node 테스트에서 그대로 검사한다.
// 라우트(해시)에는 화면 이름, 기록 ID(무작위 값), 항목 번호만 들어간다. 문서 내용·회사명·파일 이름은 넣지 않는다.

export const MAX_CHARS = 20_000;  // 서버 제한과 같음
export const SHORT_CHARS = 30;    // 이보다 짧으면 안내만 한다 (분석은 막지 않음)

export const ROUTES = {
  landing: '#/',
  new: '#/new',                  // S02 자료 등록 (새 기록)
  records: '#/records',          // S06 내 기록 목록
  review: '#/review',            // S03 추출 텍스트 확인
  analyzing: '#/analyzing',
  error: '#/error',
  unsaved: '#/unsaved',          // 분석은 됐지만 저장하지 못한 결과 (다시 저장)
  record: (id) => `#/records/${id}`,                     // S04 입사조건 기록
  add: (id) => `#/records/${id}/add`,                    // S07 새 안내 추가
  item: (id, itemId) => `#/records/${id}/item/${itemId}`, // S05 항목 상세
};
// 예전 화면 주소 → 지금 화면
const LEGACY = { '#/input': '#/new', '#/compare': '#/new', '#/result': '#/records', '#/compare/result': '#/records' };
const RECORD_ID = /^rec_[A-Za-z0-9]{1,40}$/;
const ITEM_ID = /^(0[1-9]|10)$/;

// 입력 텍스트 상태: 분석 버튼 활성 여부와 안내 문구.
// 서버와 같은 정책: 빈 입력·공백만 있는 입력과 2만 자 초과만 막는다. 최소 글자 수로 분석을 막지 않는다.
export function checkText(text) {
  const len = (text ?? '').trim().length;
  if (len === 0) return { ok: false, code: 'empty' };
  if ((text ?? '').length > MAX_CHARS) return { ok: false, code: 'too_long' };
  return { ok: true, code: len < SHORT_CHARS ? 'short' : null };
}

// 입력 대상: 새 기록({ kind: 'new' }) 또는 기존 기록에 추가({ kind: 'add', recordId })
export const inputRouteFor = (target) => (target?.kind === 'add' ? ROUTES.add(target.recordId) : ROUTES.new);
// 입력 출처 → 내용을 고치는 화면. 직접 입력은 입력 화면, 파일 추출(PDF·OCR)은 S03.
export const editRouteFor = (inputSource, target) => (inputSource === 'paste' ? inputRouteFor(target) : ROUTES.review);

// 해시 → 보여 줄 화면. 필요한 데이터가 없으면 다른 화면으로 보낸다(redirect).
// 기록이 실제로 있는지는 저장소를 읽어야 알 수 있어 app.js가 확인한다.
// state: { hasReview, analyzing, hasError, hasUnsaved, lastTarget }
export function resolveRoute(hash, state) {
  const h = hash || '#/';
  if (h === '#/' || h === '#') return { view: 'landing' };
  if (LEGACY[h]) return { redirect: LEGACY[h] };
  if (h.startsWith('#/detail/')) return { redirect: ROUTES.records };
  if (h === ROUTES.new) return { view: 'input', target: { kind: 'new' } };
  if (h === ROUTES.records) return { view: 'records' };
  if (h === ROUTES.review) return state.hasReview ? { view: 'review' } : { redirect: inputRouteFor(state.lastTarget), notice: 'no_review' };
  if (h === ROUTES.analyzing) {
    if (state.analyzing) return { view: 'analyzing' };
    return { redirect: state.hasUnsaved ? ROUTES.unsaved : inputRouteFor(state.lastTarget) };
  }
  if (h === ROUTES.error) return state.hasError ? { view: 'error' } : { redirect: inputRouteFor(state.lastTarget) };
  if (h === ROUTES.unsaved) return state.hasUnsaved ? { view: 'record', unsaved: true } : { redirect: ROUTES.records };
  const m = h.match(/^#\/records\/([^/]+)(?:\/(add|item)(?:\/([^/]+))?)?$/);
  if (m && RECORD_ID.test(m[1])) {
    const [, recordId, sub, itemId] = m;
    if (!sub) return { view: 'record', recordId };
    if (sub === 'add' && !itemId) return { view: 'input', target: { kind: 'add', recordId } };
    if (sub === 'item' && ITEM_ID.test(itemId ?? '')) return { view: 'item', recordId, itemId };
    return { redirect: ROUTES.record(recordId) };
  }
  return { redirect: ROUTES.landing };
}

// 분석 응답 → 다음 화면. 입력 형식 오류(400·413)는 입력 화면으로 돌아가 바로 고치게 하고,
// AI·서버·네트워크·요청 제한 오류는 오류 화면으로 보낸다. 분석 실패를 '찾지 못함' 결과로 바꾸지 않는다.
export function classifyAnalyzeFailure(httpStatus) {
  if (httpStatus === 400 || httpStatus === 413) return 'input';
  return 'error';
}

// 날짜 표시 (등록일·수정일·메모 작성일). 기기 시간대 기준
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
