// 입사 기록 저장소 (기능정의서 v3.1 F05·F08·F09, D01: 같은 브라우저의 IndexedDB 로컬 저장).
//
// - 기록 하나(ApplicationRecord)에 자료(DocumentEntry)·분석 결과·원문 근거·답변 메모(AnswerNote)를 함께 담아 한 번에 저장한다.
//   그래서 기록을 지우면 연관 자료·메모가 함께 지워지고, 새 자료 저장이 실패해도 이전 기록은 그대로 남는다(트랜잭션 단위).
// - 쓰기마다 다시 읽어 내용이 저장됐는지 확인한 뒤에만 성공으로 돌려준다. 실패하면 StoreError를 던진다(성공으로 표시 금지).
// - 서버로 보내지 않는다. 다른 기기·다른 브라우저와 동기화하지 않는다. 원본 이미지·PDF 파일은 저장하지 않는다.
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
const DB_VERSION = 1;
const STORE = 'records';

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
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new StoreError('unavailable', r.error));
      r.onblocked = () => reject(new StoreError('unavailable'));
    }).catch((e) => { dbp = null; throw e; });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let out;
      let t;
      try {
        t = db.transaction(STORE, mode);
        out = fn(t.objectStore(STORE));
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
  };
}

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
    status: 'analyzed',
    analysis: d.analysis,
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
      const record = { ...cur, updatedAt: t, documents: cur.documents.map((d) => (d.id === docId ? { ...d, analysis, mode: mode ?? d.mode, analyzedAt: t } : d)) };
      return write(record, (b) => b.documents.find((d) => d.id === docId)?.analyzedAt === t);
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
    async remove(recordId) {
      try { await adapter.delete(recordId); } catch (e) { throw new StoreError('save_failed', e); }
      let back;
      try { back = await adapter.get(recordId); } catch (e) { throw new StoreError('verify_failed', e); }
      if (back) throw new StoreError('verify_failed');
    },
    async removeAll() {
      try { await adapter.clear(); } catch (e) { throw new StoreError('save_failed', e); }
      const rest = await adapter.getAll().catch((e) => { throw new StoreError('verify_failed', e); });
      if (rest.length) throw new StoreError('verify_failed');
    },
  };
}
