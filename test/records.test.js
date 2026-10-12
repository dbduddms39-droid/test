// 입사 기록 (기능정의서 v3.1): 자료 사이 관계(public/relate.js), '지금 확인할 내용' 선별(public/followups.js),
// 기록 저장소(public/store.js, 메모리 어댑터).
// AI 응답은 사람이 작성한 고정 응답(모의)이며 실제 Gemini 결과가 아니다. 외부 AI를 호출하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { relateRecord, docLabels, RELATION_LABEL } from '../public/relate.js';
import { buildFollowUps, PRIMARY_LIMIT } from '../public/followups.js';
import { createStore, memoryAdapter, suggestAlias, StoreError, DEFAULT_ALIAS } from '../public/store.js';
import { buildExtraction } from './v22-fixtures.js';

// 고정 응답 AI: 요청한 세부기준만 돌려준다. mutate로 응답을 바꿀 수 있다(예: 원문에 없는 인용)
const fixedAI = (text, specs, mutate = (x) => x) => ({
  name: 'scripted',
  async analyze({ criterionIds }) {
    const all = mutate(buildExtraction(segmentText(text), specs, CRITERION_IDS));
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
});
let seq = 0;
async function entry(docType, lines, specs, mutate) {
  const text = lines.join('\n');
  const analysis = await analyzeDocument({ text, docType, ai: fixedAI(text, specs, mutate), withCriteria: true });
  seq += 1;
  return { id: `doc${seq}`, docType, confirmedText: text, analysis };
}
const item = (rel, id) => rel.items.find((i) => i.id === id);
const allFollowUps = (f) => [...f.primary, ...f.more];
const fu = (f, topic) => allFollowUps(f).find((x) => x.topicIds.includes(topic));

// ---- 가상 문서 (실제 회사·인물과 무관) ----
const POSTING_3400 = ['[가상] 채용공고 — 바른데이터(주)', '고용형태: 정규직', '연봉: 3,400만원', '근무지: 서울 마포구', '담당업무: 데이터 품질 점검'];
const POSTING_3400_SPECS = {
  '01-a': { f: 'specific', q: ['연봉: 3,400만원'], sv: '3,400만원' },
  '01-b': { f: 'specific', q: ['연봉: 3,400만원'], sv: '연봉' },
  '03-a': { f: 'specific', q: ['근무지: 서울 마포구'], sv: '서울 마포구' },
  '04-a': { f: 'specific', q: ['담당업무: 데이터 품질 점검'], sv: '데이터 품질 점검' },
  '05-a': { f: 'specific', q: ['고용형태: 정규직'], sv: '정규직' },
};
const OFFER_3600 = ['[가상] 최종합격 안내', '제안 연봉은 3,600만원입니다.', '수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'];
const OFFER_3600_SPECS = {
  '01-a': { f: 'specific', q: ['제안 연봉은 3,600만원입니다.'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['제안 연봉은 3,600만원입니다.'], sv: '연봉' },
  '07-a': { f: 'specific', q: ['수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'], sv: '수습 3개월' },
  '07-b': { f: 'specific', q: ['수습 3개월, 수습 중 급여는 별도 협의드리겠습니다.'], sv: '3개월' },
  '08-a': { f: 'undecided', q: ['수습 중 급여는 별도 협의드리겠습니다.'] },
};
const POSTING_NO_WAGE = ['[가상] 채용공고', '고용형태: 정규직', '근무지: 서울 마포구', '담당업무: 데이터 품질 점검'];
const POSTING_NO_WAGE_SPECS = {
  '03-a': { f: 'specific', q: ['근무지: 서울 마포구'], sv: '서울 마포구' },
  '04-a': { f: 'specific', q: ['담당업무: 데이터 품질 점검'], sv: '데이터 품질 점검' },
  '05-a': { f: 'specific', q: ['고용형태: 정규직'], sv: '정규직' },
};
const CONTRACT = ['[가상] 근로계약서', '1. 근무장소: 서울 마포구', '2. 업무내용: 데이터 품질 점검', '3. 임금: 연봉 3,600만원', '4. 근로시간: 추후 협의', '5. 수습: 없음', '6. 고용형태: 정규직(기간의 정함 없음)'];
const CONTRACT_SPECS = {
  '01-a': { f: 'specific', q: ['3. 임금: 연봉 3,600만원'], sv: '3,600만원' },
  '01-b': { f: 'specific', q: ['3. 임금: 연봉 3,600만원'], sv: '연봉' },
  '02-a': { f: 'undecided', q: ['4. 근로시간: 추후 협의'] },
  '03-a': { f: 'specific', q: ['1. 근무장소: 서울 마포구'], sv: '서울 마포구' },
  '04-a': { f: 'specific', q: ['2. 업무내용: 데이터 품질 점검'], sv: '데이터 품질 점검' },
  '05-a': { f: 'specific', q: ['6. 고용형태: 정규직(기간의 정함 없음)'], sv: '정규직' },
  '06-a': { f: 'specific', q: ['6. 고용형태: 정규직(기간의 정함 없음)'], sv: '기간의 정함 없음', term: 'indefinite' },
  '07-a': { f: 'negated', q: ['5. 수습: 없음'], sv: '없음' },
};

test('자료 이름: 같은 유형이 둘 이상이면 번호를 붙인다', () => {
  const labels = docLabels([{ id: 'a', docType: 'offer' }, { id: 'b', docType: 'job_posting' }, { id: 'c', docType: 'offer' }]);
  assert.deepEqual(labels, { a: '오퍼·합격 안내 1', b: '채용공고', c: '오퍼·합격 안내 2' });
});

test('T01 채용공고 하나: 결과가 완결되고, 공고에서 찾지 못한 항목을 질문으로 쏟아내지 않는다', async () => {
  const posting = await entry('job_posting', POSTING_3400, POSTING_3400_SPECS);
  const f = buildFollowUps({ documents: [posting] });
  assert.equal(f.primary.length, 0, '공고의 미기재 항목은 주요 질문이 아니다');
  assert.ok(!allFollowUps(f).some((x) => ['02', '06', '09', '10'].some((t) => x.topicIds.includes(t))), '공고에서 찾지 못한 근무시간·휴일·연차 등은 질문 후보가 아니다');
  assert.ok(relateRecord([posting]).items.every((i) => i.relation === null), '자료가 하나면 자료 사이 관계를 만들지 않는다');
});

test('T02 짧은 오퍼 하나: 모호한 수습 중 급여만 우선 확인, 빠진 항목은 접힌 추가 확인으로', async () => {
  const offer = await entry('offer', OFFER_3600, OFFER_3600_SPECS);
  const f = buildFollowUps({ documents: [offer] });
  assert.ok(f.primary.length <= PRIMARY_LIMIT);
  const probation = f.primary.find((x) => x.topicIds.includes('08'));
  assert.ok(probation, '수습 중 급여(별도 협의)는 우선 확인 후보');
  assert.deepEqual(probation.topicIds, ['07', '08'].filter((t) => probation.topicIds.includes(t)));
  assert.ok(!f.primary.some((x) => x.kind === 'missing'), '오퍼에 빠진 조건은 우선 확인으로 올리지 않는다');
  assert.ok(f.more.some((x) => x.topicIds.includes('02') && x.kind === 'missing'), '근무시간 미기재는 접힌 추가 확인');
  assert.ok(!allFollowUps(f).some((x) => x.topicIds.includes('09') || x.topicIds.includes('10')), '오퍼의 휴일·연차 미기재는 질문하지 않는다');
});

test('T03·T15 근로계약서 하나: 모호한 근로시간은 우선 확인, 수습 없음이면 수습 중 급여 질문 없음, 법 판단 문구 없음', async () => {
  const contract = await entry('contract', CONTRACT, CONTRACT_SPECS);
  const t08 = contract.analysis.topics.find((t) => t.id === '08');
  assert.equal(t08.visible, false, '수습 없음이면 수습 중 급여 항목을 표시하지 않는다');
  const f = buildFollowUps({ documents: [contract] });
  const hours = f.primary.find((x) => x.topicIds.includes('02'));
  assert.equal(hours?.kind, 'contract_unclear');
  assert.deepEqual(hours.sources[0].quotes, ['4. 근로시간: 추후 협의']);
  assert.ok(!allFollowUps(f).some((x) => x.topicIds.includes('08')), '수습 중 급여 질문을 만들지 않는다');
  for (const x of allFollowUps(f)) assert.doesNotMatch(`${x.question} ${x.reasons.join(' ')}`, /(위반|불법|합법|무효|위험)/);
});

test('T05 공고 3,400만원 → 오퍼 3,600만원: 서로 다른 안내, 두 출처·원문을 모두 보존하고 질문 하나로', async () => {
  const posting = await entry('job_posting', POSTING_3400, POSTING_3400_SPECS);
  const offer = await entry('offer', OFFER_3600, OFFER_3600_SPECS);
  const rel = relateRecord([posting, offer]);
  const wage = item(rel, '01');
  assert.equal(wage.relation, 'different_stated');
  assert.equal(wage.relationLabel, RELATION_LABEL.different_stated);
  const money = wage.facets.find((x) => x.id === '01-a');
  assert.deepEqual(money.sides.map((s) => s.value), ['3,400만원', '3,600만원']);
  assert.deepEqual(money.sides.map((s) => s.evidence[0].text), ['연봉: 3,400만원', '제안 연봉은 3,600만원입니다.']);
  const f = buildFollowUps({ documents: [posting, offer] });
  const q = f.primary.filter((x) => x.topicIds.includes('01'));
  assert.equal(q.length, 1, '급여 질문은 하나');
  assert.equal(q[0].kind, 'different_stated');
  assert.deepEqual(q[0].sources.map((s) => s.docLabel), ['채용공고', '오퍼·합격 안내']);
  assert.equal(q[0].question, '채용공고에는 급여가 3,400만원, 오퍼·합격 안내에는 3,600만원으로 기재되어 있습니다. 실제 적용되는 급여를 확인 부탁드립니다.');
  assert.doesNotMatch(q[0].question, /변경/);
  // 이전 자료의 값은 그대로 (덮어쓰지 않음)
  assert.equal(posting.analysis.criteria['01-a'].sourceValue, '3,400만원');
});

test('T06 공고에 급여 없음 → 오퍼에 처음 등장: 새롭게 적힘, 바뀜으로 보지 않음', async () => {
  const posting = await entry('job_posting', POSTING_NO_WAGE, POSTING_NO_WAGE_SPECS);
  const offer = await entry('offer', OFFER_3600, OFFER_3600_SPECS);
  const rel = relateRecord([posting, offer]);
  assert.equal(item(rel, '01').relation, 'newly_stated');
  assert.equal(item(rel, '01').relationLabel, '이번 안내에 새롭게 적혔어요');
  const f = buildFollowUps({ documents: [posting, offer] });
  assert.ok(!allFollowUps(f).some((x) => x.topicIds.includes('01') && x.kind === 'different_stated'));
  assert.ok(!allFollowUps(f).some((x) => /변경/.test(x.question ?? '')));
  // 계약기간·수습처럼 뒤 자료에 처음 적힌 조건은 확정 여부를 묻는 추가 확인 후보
  assert.equal(item(rel, '07').relation, 'newly_stated');
  assert.ok(allFollowUps(f).some((x) => x.topicIds.includes('07') && x.kinds.includes('newly_stated')));
});

test('T07 단위가 불분명한 월 300과 연 3,600만원은 같다고 추측하지 않는다 (비교하기 어려움)', async () => {
  const posting = await entry('job_posting', ['[가상] 채용공고', '연봉 3,600만원'], {
    '01-a': { f: 'specific', q: ['연봉 3,600만원'], sv: '3,600만원' }, '01-b': { f: 'specific', q: ['연봉 3,600만원'], sv: '연봉' },
  });
  const offer = await entry('offer', ['[가상] 안내', '월 300 지급 예정'], {
    '01-a': { f: 'specific', q: ['월 300 지급 예정'], sv: '월 300' }, '01-b': { f: 'specific', q: ['월 300 지급 예정'], sv: '월' },
  });
  const rel = relateRecord([posting, offer]);
  assert.equal(item(rel, '01').relation, 'incomparable');
  assert.notEqual(item(rel, '01').relation, 'same');
  const f = buildFollowUps({ documents: [posting, offer] });
  assert.equal(fu(f, '01').kind, 'incomparable');
  assert.equal(fu(f, '01').tier, 'more');
});

test('같은 값은 같은 내용으로, 뒤 자료에서 빠진 값은 삭제로 보지 않고 확인되지 않음으로', async () => {
  const a = await entry('job_posting', POSTING_3400, POSTING_3400_SPECS);
  const b = await entry('offer', ['[가상] 안내', '연봉: 3,400만원'], { '01-a': { f: 'specific', q: ['연봉: 3,400만원'], sv: '3,400만원' }, '01-b': { f: 'specific', q: ['연봉: 3,400만원'], sv: '연봉' } });
  const rel = relateRecord([a, b]);
  assert.equal(item(rel, '01').relation, 'same');
  assert.equal(item(rel, '04').relation, 'not_mentioned_later');
  assert.match(item(rel, '04').facets[0].notes.join(' '), /없어지거나 취소됐다는 뜻은 아니에요/);
});

test('T08 원문에 없는 인용(근거 위조)은 분석 확인 불가: 원문으로 보이지 않고, 찾지 못함·회사 질문이 아니라 재분석 안내', async () => {
  const forged = (x) => { x.criteria.find((c) => c.id === '01-a').quotes[0].text = '연봉: 9,999만원'; return x; };
  const contract = await entry('contract', CONTRACT, CONTRACT_SPECS, forged);
  const wage = contract.analysis.topics.find((t) => t.id === '01');
  assert.equal(wage.status, 'MAIN_UNAVAILABLE');
  assert.ok(!JSON.stringify(contract.analysis).includes('9,999'), '검증되지 않은 인용은 결과에 남지 않는다');
  const f = buildFollowUps({ documents: [contract] });
  assert.ok(f.reanalyze.some((x) => x.topicId === '01'));
  assert.ok(!allFollowUps(f).some((x) => x.topicIds.includes('01')), '분석 확인 불가는 회사 질문을 만들지 않는다');
  // 다른 자료와의 관계도 '분석 확인 불가'로 (다르다/같다고 단정하지 않음)
  const offer = await entry('offer', OFFER_3600, OFFER_3600_SPECS);
  assert.equal(item(relateRecord([contract, offer]), '01').relation, 'unavailable');
});

test('한 자료 안의 서로 다른 값은 우선 확인 후보 (채용공고라도)', async () => {
  const posting = await entry('job_posting', ['[가상] 공고', '연봉 3,400만원', '연봉 3,800만원(경력)'], {
    '01-a': { f: 'conflict', q: ['연봉 3,400만원', '연봉 3,800만원(경력)'] },
  });
  const f = buildFollowUps({ documents: [posting] });
  const w = f.primary.find((x) => x.topicIds.includes('01'));
  assert.equal(w?.kind, 'conflict');
  assert.match(w.question, /서로 다르게 적힌/);
});

test('우선 확인은 최대 3건이고 나머지는 추가 확인으로 접는다', async () => {
  const lines = ['[가상] 근로계약서', '임금: 추후 협의', '근로시간: 추후 협의', '근무장소: 추후 안내', '업무: 추후 안내', '고용형태: 추후 결정'];
  const specs = {
    '01-a': { f: 'undecided', q: ['임금: 추후 협의'] }, '02-a': { f: 'undecided', q: ['근로시간: 추후 협의'] },
    '03-a': { f: 'undecided', q: ['근무장소: 추후 안내'] }, '04-a': { f: 'undecided', q: ['업무: 추후 안내'] },
    '05-a': { f: 'undecided', q: ['고용형태: 추후 결정'] },
  };
  const f = buildFollowUps({ documents: [await entry('contract', lines, specs)] });
  assert.equal(f.primary.length, PRIMARY_LIMIT);
  assert.ok(f.more.length >= 2);
});

// ---------- 저장소 ----------
const fakeAnalysis = { version: 'v2.2', topics: [], criteria: {}, lines: [] };
const docIn = (over = {}) => ({ docType: 'job_posting', confirmedText: '[가상] 공고', inputSource: 'paste', analysis: fakeAnalysis, mode: 'demo', ...over });

test('기록 저장: 첫 자료로 만들고 다시 읽을 수 있다. 회사명 없이도 만든다', async () => {
  const store = createStore(memoryAdapter());
  const r = await store.create({ document: docIn() });
  assert.equal(r.alias, DEFAULT_ALIAS);
  assert.equal(r.documents.length, 1);
  assert.ok(r.documents[0].registeredAt);
  const back = await store.get(r.id);
  assert.equal(back.documents[0].confirmedText, '[가상] 공고');
  assert.deepEqual((await store.list()).map((x) => x.id), [r.id]);
});

test('T11 같은 회사의 다른 채용 건은 별도 기록 (자동으로 합치지 않음)', async () => {
  const store = createStore(memoryAdapter());
  const a = await store.create({ alias: '바른데이터(주)', aliasSource: 'suggested', document: docIn({ confirmedText: '[가상] 바른데이터(주) 데이터 직무' }) });
  const b = await store.create({ alias: '바른데이터(주)', aliasSource: 'suggested', document: docIn({ confirmedText: '[가상] 바른데이터(주) 디자인 직무' }) });
  assert.notEqual(a.id, b.id);
  await store.addDocument(a.id, docIn({ docType: 'offer', confirmedText: '[가상] 데이터 직무 오퍼' }));
  assert.equal((await store.get(a.id)).documents.length, 2);
  assert.equal((await store.get(b.id)).documents.length, 1, '다른 기록에 섞이지 않는다');
});

test('새 자료 추가: 이전 자료의 텍스트·분석·등록일을 그대로 두고 덧붙인다', async () => {
  const store = createStore(memoryAdapter());
  const r = await store.create({ document: docIn({ confirmedText: '첫 자료' }) });
  const before = structuredClone(r.documents[0]);
  const after = await store.addDocument(r.id, docIn({ docType: 'offer', confirmedText: '둘째 자료' }));
  assert.deepEqual(after.documents[0], before);
  assert.equal(after.documents[1].confirmedText, '둘째 자료');
});

test('T12 저장 실패는 성공으로 돌려주지 않고, 이전 기록은 훼손되지 않으며, 다시 저장하면 복구된다', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const r = await store.create({ document: docIn({ confirmedText: '첫 자료' }) });
  const realPut = adapter.put;
  adapter.put = async () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store.addDocument(r.id, docIn({ confirmedText: '둘째' })), (e) => e instanceof StoreError && e.code === 'save_failed');
  await assert.rejects(store.create({ document: docIn() }), (e) => e.code === 'save_failed');
  assert.equal((await store.get(r.id)).documents.length, 1, '이전 기록은 그대로');
  adapter.put = realPut;
  const again = await store.addDocument(r.id, docIn({ confirmedText: '둘째' }));
  assert.equal(again.documents.length, 2, '같은 세션에서 다시 저장하면 정상 저장');
});

test('저장 후 다시 읽은 내용이 다르면(조용한 저장 실패) 실패로 본다', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  adapter.put = async () => {}; // 아무것도 저장하지 않고 성공한 척
  await assert.rejects(store.create({ document: docIn() }), (e) => e.code === 'verify_failed');
});

test('T09 답변 메모: 선택 입력이며 작성·수정·삭제 후 다시 읽을 수 있다. 분석 결과는 바뀌지 않는다', async () => {
  const store = createStore(memoryAdapter());
  const r = await store.create({ document: docIn() });
  assert.deepEqual(r.notes, [], '메모 없이도 기록이 만들어진다');
  const n = await store.saveNote(r.id, { conditionKey: '01', text: '담당자가 연봉은 3,600만원이라고 답함' });
  assert.equal((await store.get(r.id)).notes[0].text, '담당자가 연봉은 3,600만원이라고 답함');
  await store.saveNote(r.id, { id: n.id, text: '전화로 3,600만원이라고 들음' });
  const edited = await store.get(r.id);
  assert.equal(edited.notes.length, 1);
  assert.equal(edited.notes[0].text, '전화로 3,600만원이라고 들음');
  assert.deepEqual(edited.documents[0].analysis, fakeAnalysis);
  await assert.rejects(store.saveNote(r.id, { conditionKey: '01', text: '   ' }), (e) => e.code === 'empty_note');
  await store.deleteNote(r.id, n.id);
  assert.deepEqual((await store.get(r.id)).notes, []);
});

test('T13 기록 전체 삭제: 자료·확인 텍스트·분석·원문·메모가 함께 지워지고, 다른 기록은 남는다', async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const a = await store.create({ document: docIn({ confirmedText: '[가상] 지울 자료' }) });
  await store.saveNote(a.id, { conditionKey: '01', text: '지울 메모' });
  const b = await store.create({ document: docIn({ confirmedText: '[가상] 남길 자료' }) });
  await store.remove(a.id);
  await assert.rejects(store.get(a.id), (e) => e.code === 'not_found');
  const dump = JSON.stringify([...adapter.map.values()]);
  assert.ok(!dump.includes('지울 자료') && !dump.includes('지울 메모'));
  assert.deepEqual((await store.list()).map((x) => x.id), [b.id]);
  await store.removeAll();
  assert.deepEqual(await store.list(), []);
});

test('기록 이름 바꾸기: 비우면 기본 이름으로', async () => {
  const store = createStore(memoryAdapter());
  const r = await store.create({ document: docIn() });
  assert.equal((await store.rename(r.id, '  가상상사 데이터 직무 ')).alias, '가상상사 데이터 직무');
  assert.equal((await store.rename(r.id, '')).alias, DEFAULT_ALIAS);
});

test('별칭 제안: 회사명이 분명히 하나일 때만', () => {
  assert.deepEqual(suggestAlias('회사명: 가상상사\n연봉 3,600만원'), { alias: '가상상사', source: 'suggested' });
  assert.deepEqual(suggestAlias('(주)바른데이터 채용\n(주)바른데이터 인사팀'), { alias: '(주)바른데이터', source: 'suggested' });
  assert.equal(suggestAlias('연봉 3,600만원, 서울 근무').alias, DEFAULT_ALIAS);
  assert.equal(suggestAlias('(주)가나다 와 (주)라마바 공동 채용').alias, DEFAULT_ALIAS, '여러 회사면 제안하지 않음');
});
