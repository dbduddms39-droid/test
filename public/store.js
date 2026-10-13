// 입사 기록 저장소 (기능정의서 v3.1 F05·F08·F09, D01: 같은 브라우저의 IndexedDB 로컬 저장).
//
// - 기록 하나(ApplicationRecord)에 자료(DocumentEntry)·분석 결과·원문 근거·답변 메모(AnswerNote)를 함께 담아 한 번에 저장한다.
//   그래서 기록을 지우면 연관 자료·메모가 함께 지워지고, 새 자료 저장이 실패해도 이전 기록은 그대로 남는다(트랜잭션 단위).
// - 쓰기마다 다시 읽어 내용이 저장됐는지 확인한 뒤에만 성공으로 돌려준다. 실패하면 StoreError를 던진다(성공으로 표시 금지).
// - 서버로 보내지 않는다. 다른 기기·다른 브라우저와 동기화하지 않는다.
// - 원본 PDF(v3.2)는 같은 DB의 'files' 저장소에 따로 둔다(DB 버전 2). 문서에는 원본 메타데이터(original)만 둔다.
//   예전(버전 1) DB는 'files' 저장소만 추가하는 방식으로 올리며, 'records'는 건드리지 않는다. 이미지 원본은 저장하지 않는다.
// - 브라우저(IndexedDB)와 Node 테스트(메모리 저장소)에서 같은 코드를 쓴다.

export const DEFAULT_ALIAS = '새 입사 기록';
export const ALIAS_MAX = 40;
export const NOTE_MAX = 2000;

export class StoreError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code; // 'unavailable' | 'save_failed' | 'not_found' | 'verify_failed'
    this.cause = cause;
  }
}

const DB_NAME = 'ildan-hwagin';
const DB_VERSION = 2;
const STORE = 'records';
const FILES = 'files';
export const FILE_MAX_BYTES = 10 * 1024 * 1024; // 업로드 제한과 같음

// ---------- 저장소 어댑터 ----------
const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function idbAdapter(indexedDB = globalThis.indexedDB) {
  let dbp = null;
  const open = () => {
    if (!indexedDB) return Promise.reject(new StoreError('unavailable'));
    dbp ??= new Promise((resolve, reject) => {
      let r;
      try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(new StoreError('unavailable', e)); return; }
      // 버전 1 → 2: 'files'만 추가 (기존 'records'·데이터는 그대로)
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' }).createIndex('recordId', 'recordId');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new StoreError('unavailable', r.error));
      r.onblocked = () => reject(new StoreError('unavailable'));
    }).catch((e) => { dbp = null; throw e; });
    return dbp;
  };
  const tx = async (mode, fn, store = STORE) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let out;
      let t;
      try {
        t = db.transaction(store, mode);
        out = fn(t.objectStore(store));
      } catch (e) { reject(e); return; }
      t.oncomplete = async () => resolve(out instanceof Promise ? await out : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('aborted'));
    });
  };
  return {
    get: (id) => tx('readonly', (s) => req(s.get(id))),
    getAll: () => tx('readonly', (s) => req(s.getAll())),
    put: (value) => tx('readwrite', (s) => { s.put(value); }),
    delete: (id) => tx('readwrite', (s) => { s.delete(id); }),
    clear: () => tx('readwrite', (s) => { s.clear(); }),
    files: {
      get: (id) => tx('readonly', (s) => req(s.get(id)), FILES),
      put: (value) => tx('readwrite', (s) => { s.put(value); }, FILES),
      delete: (id) => tx('readwrite', (s) => { s.delete(id); }, FILES),
      byRecord: (recordId) => tx('readonly', (s) => req(s.index('recordId').getAll(recordId)), FILES),
      deleteByRecord: (recordId) => tx('readwrite', (s) => {
        const c = s.index('recordId').openKeyCursor(recordId);
        c.onsuccess = () => { if (c.result) { s.delete(c.result.primaryKey); c.result.continue(); } };
      }, FILES),
      clear: () => tx('readwrite', (s) => { s.clear(); }, FILES),
    },
  };
}

// Node 테스트용 메모리 어댑터 (구조화 복제로 IndexedDB처럼 사본을 저장)
export function memoryAdapter() {
  const m = new Map();
  const copy = (v) => (v == null ? v : structuredClone(v));
  return {
    map: m,
    get: async (id) => copy(m.get(id)),
    getAll: async () => [...m.values()].map(copy),
    put: async (v) => { m.set(v.id, copy(v)); },
    delete: async (id) => { m.delete(id); },
    clear: async () => { m.clear(); },
    // 원본 파일: Blob은 복제하지 않고 그대로 둔다 (IndexedDB도 Blob을 그대로 저장)
    files: (() => {
      const f = new Map();
      return {
        map: f,
        get: async (id) => (f.has(id) ? { ...f.get(id) } : undefined),
        put: async (v) => { f.set(v.id, { ...v }); },
        delete: async (id) => { f.delete(id); },
        byRecord: async (recordId) => [...f.values()].filter((v) => v.recordId === recordId).map((v) => ({ ...v })),
        deleteByRecord: async (recordId) => { for (const [k, v] of f) if (v.recordId === recordId) f.delete(k); },
        clear: async () => { f.clear(); },
      };
    })(),
  };
}

// 원본 파일 확인: PDF만 (MIME 또는 확장자 + 파일 머리 '%PDF-')
export async function isPdfBlob(blob, name = '') {
  if (!blob || typeof blob.slice !== 'function') return false;
  if (blob.type && blob.type !== 'application/pdf' && !/\.pdf$/i.test(name)) return false;
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}
export async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const isQuota = (e) => e?.name === 'QuotaExceededError' || e?.cause?.name === 'QuotaExceededError' || /quota/i.test(String(e?.message ?? ''));

// ---------- 별칭 제안 ----------
// 회사명이 문서에 분명하게 하나만 보일 때만 제안한다. 없거나 여러 개면 '새 입사 기록'.
const NAME_FIELD = /(?:회사명|회사\s*이름|기업명|상호|사업체명|사업장명)\s*[:：]\s*([^\n,·|/]{2,30})/g;
const CORP = /((?:\(주\)|㈜|주식회사) ?[가-힣A-Za-z0-9&]{2,20}|[가-힣A-Za-z0-9&]{2,20} ?(?:\(주\)|㈜|주식회사))/g;
const clean = (s) => s.replace(/\s+/g, ' ').replace(/[.。]+$/, '').trim();
const normCorp = (s) => s.replace(/\(주\)|㈜|주식회사|\s/g, '');

export function suggestAlias(text) {
  const t = String(text ?? '');
  const fields = [...new Set([...t.matchAll(NAME_FIELD)].map((m) => clean(m[1])))].filter(Boolean);
  if (fields.length === 1) return { alias: fields[0].slice(0, ALIAS_MAX), source: 'suggested' };
  if (fields.length > 1) return { alias: DEFAULT_ALIAS, source: 'default' };
  const corps = [...t.matchAll(CORP)].map((m) => clean(m[1]));
  const distinct = [...new Map(corps.map((c) => [normCorp(c), c])).values()].filter((c) => normCorp(c).length >= 2);
  if (distinct.length === 1) return { alias: distinct[0].slice(0, ALIAS_MAX), source: 'suggested' };
  return { alias: DEFAULT_ALIAS, source: 'default' };
}

// ---------- 저장소 ----------
export const newId = (prefix) => `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20)}`;

export function createStore(adapter = idbAdapter(), { now = () => new Date().toISOString() } = {}) {
  // 쓰고 나서 다시 읽어 같은지 확인한다. 확인되지 않으면 실패.
  async function write(record, check) {
    try {
      await adapter.put(record);
    } catch (e) {
      throw e instanceof StoreError ? e : new StoreError('save_failed', e);
    }
    let back;
    try { back = await adapter.get(record.id); } catch (e) { throw new StoreError('verify_failed', e); }
    if (!back || back.updatedAt !== record.updatedAt || !check(back)) throw new StoreError('verify_failed');
    return back;
  }
  async function load(id) {
    let r;
    try { r = await adapter.get(id); } catch (e) { throw e instanceof StoreError ? e : new StoreError('unavailable', e); }
    if (!r) throw new StoreError('not_found');
    return r;
  }
  const docEntry = (recordId, d, registeredAt = d.registeredAt ?? now()) => ({
    id: d.id ?? newId('doc'),
    recordId,
    docType: d.docType,
    confirmedText: d.confirmedText,
    inputSource: d.inputSource ?? 'paste',
    extractNotes: d.extractNotes ?? [],
    lowConfidence: d.lowConfidence ?? [],
    registeredAt,
    analyzedAt: d.analyzedAt ?? registeredAt,
    mode: d.mode ?? null,
    // 문서 상태: 저장과 분석을 나눈다 (pending: 분석 전·중단, analyzed, analysis_failed)
    status: d.status ?? (d.analysis ? 'analyzed' : 'pending'),
    analysisError: d.analysisError ?? null,
    analysis: d.analysis ?? null,
    original: d.original ?? null, // { fileId, name, type, size, sha256, savedAt } — 원본 PDF가 있을 때만
    originalError: d.originalError ?? null,
  });

  return {
    async list() {
      let all;
      try { all = await adapter.getAll(); } catch (e) { throw e instanceof StoreError ? e : new StoreError('unavailable', e); }
      return all.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    },
    get: load,
    // 첫 자료의 분석 결과를 받은 뒤 기록을 만든다. 같은 회사라도 자동으로 합치지 않는다(항상 새 기록).
    async create({ alias, aliasSource, document }) {
      const id = document.recordId ?? newId('rec');
      const t = now();
      const record = {
        id,
        alias: (alias || DEFAULT_ALIAS).slice(0, ALIAS_MAX),
        aliasSource: aliasSource ?? (alias ? 'user' : 'default'),
        createdAt: t,
        updatedAt: t,
        documents: [docEntry(id, { ...document, registeredAt: document.registeredAt ?? t })],
        notes: [],
      };
      return write(record, (b) => b.documents.length === 1 && b.documents[0].id === record.documents[0].id);
    },
    // 기존 기록에 새 자료를 덧붙인다. 이전 자료·근거·메모는 그대로 둔다.
    async addDocument(recordId, document) {
      const cur = await load(recordId);
      const entry = docEntry(recordId, document);
      // 같은 자료를 다시 저장하는 경우(저장 확인 실패 후 재시도)에는 한 번만 남긴다
      const documents = [...cur.documents.filter((d) => d.id !== entry.id), entry];
      const record = { ...cur, updatedAt: now(), documents };
      return write(record, (b) => b.documents.length === documents.length && b.documents.at(-1).id === entry.id);
    },
    // 같은 확인 텍스트로 다시 분석한 결과로 그 자료의 분석만 바꾼다 (확인 텍스트·등록일은 그대로)
    async replaceAnalysis(recordId, docId, { analysis, mode }) {
      const cur = await load(recordId);
      if (!cur.documents.some((d) => d.id === docId)) throw new StoreError('not_found');
      const t = now();
      const record = { ...cur, updatedAt: t, documents: cur.documents.map((d) => (d.id === docId ? { ...d, analysis, mode: mode ?? d.mode, analyzedAt: t, status: 'analyzed', analysisError: null } : d)) };
      return write(record, (b) => b.documents.find((d) => d.id === docId)?.analyzedAt === t);
    },
    // 분석 실패: 저장된 자료(확인 텍스트·원본)는 그대로 두고 상태만 남긴다 (이전 분석 결과가 있으면 지우지 않음)
    async markAnalysisFailed(recordId, docId, code) {
      const cur = await load(recordId);
      if (!cur.documents.some((d) => d.id === docId)) throw new StoreError('not_found');
      const t = now();
      const record = { ...cur, updatedAt: t, documents: cur.documents.map((d) => (d.id === docId ? { ...d, status: d.analysis ? 'analyzed' : 'analysis_failed', analysisError: String(code ?? 'analysis_failed') } : d)) };
      return write(record, (b) => b.documents.find((d) => d.id === docId)?.analysisError === String(code ?? 'analysis_failed'));
    },
    // 방금 등록한 자료를 되돌린다 (서버가 입력 형식 오류로 분석을 거절한 경우). 자료가 하나뿐이면 기록째 지운다.
    // 그 자료의 원본은 같은 기록의 다른 자료가 쓰지 않을 때만 지운다.
    async removeDocument(recordId, docId) {
      const cur = await load(recordId);
      const doc = cur.documents.find((d) => d.id === docId);
      if (!doc) return cur;
      const rest = cur.documents.filter((d) => d.id !== docId);
      const fileId = doc.original?.fileId;
      if (!rest.length) {
        await this.remove(recordId);
        return null;
      }
      const record = { ...cur, updatedAt: now(), documents: rest };
      const back = await write(record, (b) => !b.documents.some((d) => d.id === docId));
      if (fileId && !rest.some((d) => d.original?.fileId === fileId)) await adapter.files.delete(fileId).catch(() => {});
      return back;
    },
    // ---------- 원본 PDF (브라우저에만 저장) ----------
    // 같은 기록에 같은 파일(SHA-256)이 이미 있으면 새로 저장하지 않고 그 원본을 돌려준다 (reused: true).
    // 저장 후 다시 읽어 크기·해시가 같을 때만 성공. 실패: StoreError('not_pdf' | 'too_large' | 'quota' | 'save_failed' | 'verify_failed')
    async saveOriginal({ recordId, docId, blob, name }) {
      if (!(await isPdfBlob(blob, name))) throw new StoreError('not_pdf');
      if (blob.size > FILE_MAX_BYTES) throw new StoreError('too_large');
      const sha256 = await sha256Hex(blob);
      let existing = [];
      try { existing = await adapter.files.byRecord(recordId); } catch (e) { throw new StoreError('unavailable', e); }
      const same = existing.find((f) => f.sha256 === sha256 && f.size === blob.size);
      const meta = (f) => ({ fileId: f.id, name: f.name, type: f.type, size: f.size, sha256: f.sha256, savedAt: f.savedAt });
      if (same) return { ...meta(same), reused: true };
      const value = { id: newId('file'), recordId, docId, name: String(name || 'document.pdf').slice(0, 200), type: 'application/pdf', size: blob.size, sha256, savedAt: now(), blob };
      try { await adapter.files.put(value); } catch (e) { throw new StoreError(isQuota(e) ? 'quota' : 'save_failed', e); }
      let back;
      try { back = await adapter.files.get(value.id); } catch (e) { throw new StoreError('verify_failed', e); }
      if (!back?.blob || back.size !== blob.size || back.sha256 !== sha256 || back.blob.size !== blob.size) {
        await adapter.files.delete(value.id).catch(() => {}); // 확인되지 않은 원본은 남기지 않는다
        throw new StoreError('verify_failed');
      }
      return { ...meta(value), reused: false };
    },
    // 저장된 원본 그대로 (추출 텍스트로 다시 만들지 않음). 없으면 null
    async getOriginal(fileId) {
      try { return (await adapter.files.get(fileId)) ?? null; } catch (e) { throw new StoreError('unavailable', e); }
    },
    async listOriginals(recordId) {
      try { return await adapter.files.byRecord(recordId); } catch (e) { throw new StoreError('unavailable', e); }
    },
    async deleteOriginal(fileId) {
      try { await adapter.files.delete(fileId); } catch (e) { throw new StoreError('save_failed', e); }
    },
    async rename(recordId, alias) {
      const cur = await load(recordId);
      const value = String(alias ?? '').trim().slice(0, ALIAS_MAX) || DEFAULT_ALIAS;
      const record = { ...cur, alias: value, aliasSource: 'user', updatedAt: now() };
      return write(record, (b) => b.alias === value);
    },
    // 답변 메모 작성·수정 (conditionKey: 항목 ID). 메모는 사용자가 직접 기록한 것이며 분석 결과를 바꾸지 않는다.
    async saveNote(recordId, { id, conditionKey, text }) {
      const cur = await load(recordId);
      const value = String(text ?? '').slice(0, NOTE_MAX);
      if (!value.trim()) throw new StoreError('empty_note');
      const t = now();
      const existing = id ? cur.notes.find((n) => n.id === id) : null;
      const note = existing ? { ...existing, text: value, updatedAt: t } : { id: newId('note'), conditionKey: conditionKey ?? null, text: value, createdAt: t, updatedAt: t };
      const notes = existing ? cur.notes.map((n) => (n.id === id ? note : n)) : [...cur.notes, note];
      const record = { ...cur, notes, updatedAt: t };
      await write(record, (b) => b.notes.some((n) => n.id === note.id && n.text === value));
      return note;
    },
    async deleteNote(recordId, noteId) {
      const cur = await load(recordId);
      const record = { ...cur, notes: cur.notes.filter((n) => n.id !== noteId), updatedAt: now() };
      return write(record, (b) => !b.notes.some((n) => n.id === noteId));
    },
    // 기록 전체 삭제: 자료·확인 텍스트·분석 결과·원문 근거·메모가 한 항목에 있어 함께 지워진다
    // 기록 삭제: 기록(자료·텍스트·분석·원문·메모)과 그 기록의 원본 파일을 함께 지운다. 다른 기록의 원본은 그대로.
    async remove(recordId) {
      try { await adapter.delete(recordId); } catch (e) { throw new StoreError('save_failed', e); }
      let back;
      try { back = await adapter.get(recordId); } catch (e) { throw new StoreError('verify_failed', e); }
      if (back) throw new StoreError('verify_failed');
      try { await adapter.files.deleteByRecord(recordId); } catch (e) { throw new StoreError('files_cleanup_failed', e); }
      const left = await adapter.files.byRecord(recordId).catch(() => []);
      if (left.length) throw new StoreError('files_cleanup_failed');
    },
    async removeAll() {
      try { await adapter.clear(); await adapter.files.clear(); } catch (e) { throw new StoreError('save_failed', e); }
      const rest = await adapter.getAll().catch((e) => { throw new StoreError('verify_failed', e); });
      if (rest.length) throw new StoreError('verify_failed');
    },
  };
}
