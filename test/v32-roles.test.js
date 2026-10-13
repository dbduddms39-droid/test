// v3.2 문서별 역할과 원본 PDF 저장 (docs/spec/v3.2_변경명세.md).
// - 채용공고·처우 안내 단독: 적힌 조건만 기록, 미기재·불명확 질문 없음 / 근로계약서 단독: 10개 기준 점검 그대로
// - 문서 간 비교: 모든 조합, 순서 강제 없음 / 범위·협의 예정 처리 유지
// - 저장소 files: 원본 PDF 저장·바이트 동일·중복 방지·쓰기 실패·예전 기록·기록 삭제 정리
// AI 응답은 사람이 작성한 모의 응답(test/demo-docs.js)이며 실제 Gemini 결과가 아니다. 외부 AI를 호출하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildFollowUps } from '../public/followups.js';
import { createStore, memoryAdapter, StoreError, FILE_MAX_BYTES } from '../public/store.js';
import { buildExtraction } from './v22-fixtures.js';
import { DEMO_POSTING, DEMO_OFFER, DEMO_CONTRACT, DEMO_POSTING_SPECS, DEMO_OFFER_SPECS, DEMO_CONTRACT_SPECS, variant } from './demo-docs.js';

const ai = (text, specs) => ({
  name: 'scripted',
  async analyze({ criterionIds }) {
    const all = buildExtraction(segmentText(text), specs, CRITERION_IDS);
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
});
let n = 0;
const doc = async (docType, text, specs) => ({ id: `d${n += 1}`, docType, analysis: await analyzeDocument({ text, docType, ai: ai(text, specs), withCriteria: true }) });
const all = (f) => [...f.primary, ...f.more];
const qsAbout = (f, topic) => all(f).filter((x) => x.topicIds.includes(topic)).flatMap((x) => [x.question, ...x.extraQuestions]).filter(Boolean);
const posting = () => doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS);
const offer = () => doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS);
const contract = () => doc('contract', DEMO_CONTRACT, DEMO_CONTRACT_SPECS);

// ---------- 문서별 역할 ----------
test('TC01(판정) 채용공고 단독: 10개 기준의 미기재·불명확 질문·확인 필요 없음, 적힌 조건은 그대로 분석 결과에 남음', async () => {
  const p = await posting();
  const f = buildFollowUps({ documents: [p] });
  assert.deepEqual(all(f), []);
  assert.deepEqual(f.summary.needsCheck, []);
  assert.deepEqual(f.summary.different, []);
  // 기준표 판정·근거는 서버 분석 그대로 (화면 노출만 바뀜)
  assert.equal(p.analysis.topics.find((t) => t.id === '02').criteria.find((c) => c.id === '02-b').status, 'CONFIRMED');
  assert.ok(p.analysis.topics.filter((t) => t.status === 'MAIN_MISSING').length > 0, '공고에 없는 항목(휴일·연차 등)은 기준표상 MISSING으로 남되 질문하지 않는다');
});

test('TC02 공고 09:00~18:00 → 계약서 10:00~19:00 (처우 안내 없이 바로): 서로 다른 안내 + 확인 질문', async () => {
  const f = buildFollowUps({ documents: [await posting(), await contract()] });
  assert.ok(f.summary.different.some((x) => x.topicId === '02'));
  assert.equal(qsAbout(f, '02')[0], '채용공고에는 근무시간이 09:00~18:00, 근로계약서에는 10:00~19:00으로 기재되어 있습니다. 실제 적용되는 근무시간을 확인 부탁드립니다.');
});

test('TC03 공고 연봉 3,400만~3,800만(협의) → 계약서 3,600만: 범위 안에서 구체화, 질문 없음', async () => {
  const f = buildFollowUps({ documents: [await posting(), await contract()] });
  assert.ok(!f.summary.different.some((x) => x.topicId === '01'));
  assert.equal(f.summary.specified.find((x) => x.topicId === '01')?.line, '채용공고에는 협의 가능한 연봉 범위(3,400만~3,800만원)가 적혀 있고, 근로계약서에는 연봉 3,600만 원(세전)으로 기재되어 있어요.');
  assert.deepEqual(qsAbout(f, '01'), []);
  // 범위 밖이면 서로 다른 안내
  const [cText, cSpecs] = variant(DEMO_CONTRACT, DEMO_CONTRACT_SPECS, '3,600만 원', '4,000만 원');
  const g = buildFollowUps({ documents: [await posting(), await doc('contract', cText, cSpecs)] });
  assert.ok(g.summary.different.some((x) => x.topicId === '01'));
});

test('TC04 공고 → 계약서 바로 (처우 안내 단계 강제 없음): 계약서 점검 + 공고와 비교, 수습 급여는 새롭게 구체화', async () => {
  const f = buildFollowUps({ documents: [await posting(), await contract()] });
  assert.ok(f.summary.specified.some((x) => x.topicId === '08'), '공고의 별도 안내 → 계약서 월 270만 원');
  assert.deepEqual(qsAbout(f, '08'), []);
  for (const id of ['03', '05']) assert.equal(f.relation.items.find((i) => i.id === id).relation, 'same', id);
  assert.ok(!f.summary.pending.some((x) => x.topicId === '01' || x.topicId === '08'), '뒤 자료에서 구체화된 항목은 협의 예정으로 남지 않는다');
});

test('TC05 조건 없는 단순 합격 안내: 오류·질문 없이 적힌 조건 없음 (화면은 \'근로조건이 발견되지 않았어요\')', async () => {
  const text = ['[가상] 주식회사 파란스텝 최종 합격 안내', '안녕하세요, 인사팀입니다.', '콘텐츠 마케터 포지션에 최종 합격하셨습니다. 축하드립니다.', '자세한 일정은 추후 연락드리겠습니다.'].join('\n');
  const d = await doc('offer', text, {});
  assert.ok(d.analysis.topics.filter((t) => t.visible).every((t) => t.status === 'MAIN_MISSING'), '적힌 근로조건이 없다');
  const f = buildFollowUps({ documents: [d] });
  assert.deepEqual(all(f), []);
  assert.deepEqual(f.summary, { different: [], specified: [], needsCheck: [], pending: [], unavailable: [] });
});

test('TC06 근로계약서 단독: 10개 기준 점검 그대로 (빠진 핵심 항목은 질문)', async () => {
  const [cText, cSpecs] = variant(DEMO_CONTRACT, DEMO_CONTRACT_SPECS, '5. 임금: 연봉 3,600만 원(세전), 매월 25일 지급', '5. 임금: 추후 협의',
    { '01-a': { f: 'undecided', q: ['5. 임금: 추후 협의'] }, '01-b': { f: 'absent', q: [] }, '01-f': { f: 'absent', q: [] }, '01-g': { f: 'absent', q: [] } });
  const c = await doc('contract', cText, cSpecs);
  const f = buildFollowUps({ documents: [c] });
  assert.ok(qsAbout(f, '01').length >= 1, '계약서의 정해지지 않은 임금은 (협의 예정이어도) 질문');
  assert.ok(f.summary.needsCheck.some((x) => x.topicId === '01'));
  // 같은 문구라도 채용공고면 질문하지 않는다
  const p = await doc('job_posting', cText, cSpecs);
  assert.deepEqual(qsAbout(buildFollowUps({ documents: [p] }), '01'), []);
});

test('TC12 다른 조합: 공고↔처우 안내, 처우 안내↔계약서, 처우 안내 → 공고(순서 반대), 3종 모두', async () => {
  const po = buildFollowUps({ documents: [await posting(), await offer()] });
  assert.ok(po.summary.different.some((x) => x.topicId === '02') && po.summary.specified.some((x) => x.topicId === '01'));
  const oc = buildFollowUps({ documents: [await offer(), await contract()] });
  assert.ok(!oc.summary.different.some((x) => x.topicId === '01' || x.topicId === '02'), '처우 안내와 계약서의 급여·근무시간은 같음');
  assert.ok(oc.summary.specified.some((x) => x.topicId === '08'));
  const op = buildFollowUps({ documents: [await offer(), await posting()] });
  assert.ok(op.summary.different.some((x) => x.topicId === '02'), '등록 순서와 관계없이 비교');
  const three = buildFollowUps({ documents: [await posting(), await offer(), await contract()] });
  assert.deepEqual(three.summary.different.map((x) => x.topicId), ['02']);
});

test('채용공고 한 문서 안에 서로 다른 값이 함께 적혀 있으면 그것만은 확인 질문 (예외)', async () => {
  const text = ['[가상] 채용공고', '급여: 연봉 3,400만원', '연봉 3,800만원(경력직)'].join('\n');
  const d = await doc('job_posting', text, { '01-a': { f: 'conflict', q: ['급여: 연봉 3,400만원', '연봉 3,800만원(경력직)'] } });
  const f = buildFollowUps({ documents: [d] });
  assert.equal(all(f).find((x) => x.topicIds.includes('01'))?.kind, 'conflict');
});

test('분석 전·분석 실패 자료는 비교·질문에서 빠지고 나머지 자료로만 정리', async () => {
  const f = buildFollowUps({ documents: [await posting(), { id: 'x', docType: 'contract', status: 'analysis_failed', analysis: null }] });
  assert.deepEqual(all(f), []);
  assert.deepEqual(f.summary.different, []);
});

// ---------- 원본 PDF 저장 ----------
const PDF = (body = 'fictional') => new Blob([`%PDF-1.4\n% ${body}\n%%EOF\n`], { type: 'application/pdf' });
const bytes = async (b) => [...new Uint8Array(await b.arrayBuffer())];
const docIn = (over = {}) => ({ docType: 'job_posting', confirmedText: '[가상] 공고', inputSource: 'pdf', ...over });

test('TC07(저장소) 원본 PDF 저장 → 다시 읽기: 바이트·이름·형식·크기·기록/자료 ID 그대로', async () => {
  const store = createStore(memoryAdapter());
  const blob = PDF();
  const meta = await store.saveOriginal({ recordId: 'rec_a', docId: 'doc_a', blob, name: '공고.pdf' });
  assert.equal(meta.reused, false);
  const back = await store.getOriginal(meta.fileId);
  assert.deepEqual(await bytes(back.blob), await bytes(blob));
  assert.equal(back.name, '공고.pdf');
  assert.equal(back.type, 'application/pdf');
  assert.equal(back.size, blob.size);
  assert.equal(back.recordId, 'rec_a');
  assert.equal(back.docId, 'doc_a');
  assert.match(back.sha256, /^[0-9a-f]{64}$/);
});

test('TC08(저장소) 분석 실패: 자료·원본은 남고 상태만 분석 실패, 재분석은 원본을 다시 저장하지 않음, 같은 파일은 중복 저장 안 함', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const meta = await store.saveOriginal({ recordId: 'rec_b', docId: 'doc_b', blob: PDF(), name: 'a.pdf' });
  const { reused, ...original } = meta;
  await store.create({ document: docIn({ id: 'doc_b', recordId: 'rec_b', status: 'pending', original }) });
  const failed = await store.markAnalysisFailed('rec_b', 'doc_b', 502);
  assert.equal(failed.documents[0].status, 'analysis_failed');
  assert.equal(failed.documents[0].original.fileId, meta.fileId);
  const ok = await store.replaceAnalysis('rec_b', 'doc_b', { analysis: { version: 'v2.2', topics: [], criteria: {}, lines: [] }, mode: 'demo' });
  assert.equal(ok.documents[0].status, 'analyzed');
  assert.equal(adapter.files.map.size, 1, '재분석은 원본 파일을 건드리지 않는다');
  const again = await store.saveOriginal({ recordId: 'rec_b', docId: 'doc_c', blob: PDF(), name: 'a-copy.pdf' });
  assert.equal(again.reused, true);
  assert.equal(again.fileId, meta.fileId);
  assert.equal(adapter.files.map.size, 1, '같은 기록의 같은 파일은 한 번만');
  // 다른 기록에는 따로 저장 (기록 삭제 시 서로 영향 없게)
  const other = await store.saveOriginal({ recordId: 'rec_other', docId: 'doc_d', blob: PDF(), name: 'a.pdf' });
  assert.equal(other.reused, false);
});

test('TC09(저장소) 쓰기 실패·공간 부족·확인 실패는 오류로 (성공으로 보고하지 않음), PDF가 아니거나 너무 크면 저장 안 함', async () => {
  const quota = memoryAdapter();
  quota.files.put = async () => { throw new DOMException('mock', 'QuotaExceededError'); };
  await assert.rejects(createStore(quota).saveOriginal({ recordId: 'r', docId: 'd', blob: PDF(), name: 'a.pdf' }), (e) => e instanceof StoreError && e.code === 'quota');
  const broken = memoryAdapter();
  broken.files.put = async () => { throw new Error('write failed'); };
  await assert.rejects(createStore(broken).saveOriginal({ recordId: 'r', docId: 'd', blob: PDF(), name: 'a.pdf' }), (e) => e.code === 'save_failed');
  const lossy = memoryAdapter();
  const put = lossy.files.put;
  lossy.files.put = async (v) => put({ ...v, blob: new Blob(['%PDF-short']) }); // 저장 내용이 달라짐
  await assert.rejects(createStore(lossy).saveOriginal({ recordId: 'r', docId: 'd', blob: PDF(), name: 'a.pdf' }), (e) => e.code === 'verify_failed');
  assert.equal(lossy.files.map.size, 0, '확인되지 않은 원본은 남기지 않는다');
  const store = createStore(memoryAdapter());
  await assert.rejects(store.saveOriginal({ recordId: 'r', docId: 'd', blob: new Blob(['hello'], { type: 'text/plain' }), name: 'a.txt' }), (e) => e.code === 'not_pdf');
  await assert.rejects(store.saveOriginal({ recordId: 'r', docId: 'd', blob: new Blob(['not a pdf'], { type: 'application/pdf' }), name: 'fake.pdf' }), (e) => e.code === 'not_pdf', '%PDF- 머리가 없으면 거절');
  const bigPdf = new Blob(['%PDF-1.4\n', new Uint8Array(FILE_MAX_BYTES + 1).fill(32)], { type: 'application/pdf' });
  await assert.rejects(store.saveOriginal({ recordId: 'r', docId: 'd', blob: bigPdf, name: 'big.pdf' }), (e) => e.code === 'too_large');
});

test('TC10(저장소) 예전 기록(상태·원본 정보 없음)도 그대로 읽힌다: 분석 결과가 있으면 analyzed, 원본 없음', async () => {
  const adapter = memoryAdapter();
  const legacy = { id: 'rec_old', alias: '예전 기록', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', notes: [],
    documents: [{ id: 'doc_old', recordId: 'rec_old', docType: 'job_posting', confirmedText: '[가상] 공고', inputSource: 'pdf', extractNotes: [], lowConfidence: [], registeredAt: '2026-09-01T00:00:00.000Z', analyzedAt: '2026-09-01T00:00:00.000Z', mode: 'demo', analysis: { version: 'v2.2', topics: [], criteria: {}, lines: [] } }] };
  await adapter.put(legacy);
  const store = createStore(adapter);
  const r = await store.get('rec_old');
  assert.equal(r.documents[0].original, undefined, '예전 기록을 바꾸지 않는다 (읽기만)');
  assert.deepEqual(await store.listOriginals('rec_old'), []);
  // 예전 기록에 새 자료를 붙이면 새 자료만 새 형식, 예전 자료는 그대로
  const added = await store.addDocument('rec_old', { docType: 'contract', confirmedText: '[가상] 계약서', inputSource: 'paste', status: 'pending' });
  assert.equal(added.documents[0].analysis.version, 'v2.2');
  assert.equal(added.documents[1].status, 'pending');
  assert.equal(added.documents[1].original, null);
});

test('TC11(저장소) 기록 삭제: 그 기록의 원본만 지우고 다른 기록의 원본은 그대로, 전체 삭제는 모두', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  for (const id of ['rec_1', 'rec_2']) {
    const { reused, ...original } = await store.saveOriginal({ recordId: id, docId: `doc_${id}`, blob: PDF(id), name: `${id}.pdf` });
    await store.create({ document: docIn({ id: `doc_${id}`, recordId: id, original }) });
  }
  await store.remove('rec_1');
  assert.deepEqual(await store.listOriginals('rec_1'), []);
  assert.equal((await store.listOriginals('rec_2')).length, 1);
  // 원본 정리에 실패하면 기록 삭제와 구분해 알린다
  const sticky = memoryAdapter();
  const s2 = createStore(sticky);
  const { reused, ...o } = await s2.saveOriginal({ recordId: 'rec_s', docId: 'doc_s', blob: PDF(), name: 's.pdf' });
  await s2.create({ document: docIn({ id: 'doc_s', recordId: 'rec_s', original: o }) });
  sticky.files.deleteByRecord = async () => { throw new Error('locked'); };
  await assert.rejects(s2.remove('rec_s'), (e) => e.code === 'files_cleanup_failed');
  await assert.rejects(s2.get('rec_s'), (e) => e.code === 'not_found', '기록 자체는 삭제됨');
  await store.removeAll();
  assert.equal(adapter.files.map.size, 0);
});

test('입력 형식 오류·분석 중단 시 방금 등록한 자료 되돌리기: 자료만 빼고, 다른 자료가 쓰는 원본은 남김', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const { reused, ...o } = await store.saveOriginal({ recordId: 'rec_x', docId: 'doc_1', blob: PDF(), name: 'a.pdf' });
  await store.create({ document: docIn({ id: 'doc_1', recordId: 'rec_x', original: o }) });
  await store.addDocument('rec_x', docIn({ id: 'doc_2', original: o })); // 같은 파일을 연결한 자료
  const r = await store.removeDocument('rec_x', 'doc_2');
  assert.deepEqual(r.documents.map((d) => d.id), ['doc_1']);
  assert.equal(adapter.files.map.size, 1, '다른 자료가 쓰는 원본은 지우지 않는다');
  assert.equal(await store.removeDocument('rec_x', 'doc_1'), null, '마지막 자료면 기록째 삭제');
  assert.equal(adapter.files.map.size, 0);
});
