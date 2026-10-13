// 실제 Gemini QA(v3.2 Preview) 결과에서 발견한 표현·질문 생성 문제의 회귀 테스트.
// 모의 AI 응답(test/gemini-qa-docs.js, 사람이 작성)이며 실제 Gemini 재검증이 아니다. 동결 기준표·인용 검증·F01~F11은 바꾸지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildFollowUps, detailOnly } from '../public/followups.js';
import { relateRecord } from '../public/relate.js';
import { textScope } from '../public/compare-core.js';
import { buildExtraction } from './v22-fixtures.js';
import { GQ_POSTING, GQ_CONTRACT, GQ_POSTING_SPECS, GQ_CONTRACT_SPECS } from './gemini-qa-docs.js';

const ai = (text, specs) => ({
  name: 'scripted',
  async analyze({ criterionIds }) {
    const all = buildExtraction(segmentText(text), specs, CRITERION_IDS);
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
});
let n = 0;
const doc = async (docType, text, specs) => ({ id: `g${n += 1}`, docType, analysis: await analyzeDocument({ text, docType, ai: ai(text, specs), withCriteria: true }) });
const swap = (text, specs, from, to) => [text.split(from).join(to), JSON.parse(JSON.stringify(specs).split(from).join(to))];
const all = (f) => [...f.primary, ...f.more];
const qsAbout = (f, id) => all(f).filter((x) => x.topicIds.includes(id)).flatMap((x) => [x.question, ...x.extraQuestions]).filter(Boolean);
const pair = async (p = [GQ_POSTING, GQ_POSTING_SPECS], c = [GQ_CONTRACT, GQ_CONTRACT_SPECS]) => [await doc('job_posting', ...p), await doc('contract', ...c)];

test('실제 QA 결과 재현: 유지해야 할 판정 (연봉·출퇴근 다름, 수습기간 같음, 수습 급여 구체화, 계약기간 처음 적힘)', async () => {
  const [p, c] = await pair();
  const f = buildFollowUps({ documents: [p, c] });
  assert.deepEqual(f.summary.different.map((x) => x.topicId).sort(), ['01', '02']);
  assert.equal(f.relation.items.find((i) => i.id === '07').relation, 'same');
  assert.ok(f.summary.specified.some((x) => x.topicId === '08'));
  assert.equal(f.relation.items.find((i) => i.id === '06').relation, 'newly_stated');
});

test('1) 업무 표현만 다를 때(띄어쓰기·접속어·\'업무\' 같은 말 차이) 같은 내용으로 보고 질문하지 않는다', async () => {
  assert.equal(textScope('브랜드 공식 SNS 채널 운영', '브랜드 공식 SNS채널 운영 업무').kind, 'same');
  assert.equal(textScope('콘텐츠 기획, SNS 채널 운영', 'SNS 채널 운영 및 콘텐츠 기획').kind, 'same');
  const [p, c] = await pair(undefined, swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '브랜드 공식 SNS 채널 운영 및 SNS 콘텐츠 기획·제작 일정 관리', '브랜드 공식 SNS채널 운영 업무'));
  const f = buildFollowUps({ documents: [p, c] });
  assert.equal(f.relation.items.find((i) => i.id === '04').relation, 'same');
  assert.deepEqual(qsAbout(f, '04'), []);
});

test('1-1) 실제 사례: 계약서에 업무가 더 적힘 → \'같은 조건인지\' 대신 원문 조각으로 구체적인 질문 (추가됐다고 단정하지 않음)', async () => {
  const [p, c] = await pair();
  const f = buildFollowUps({ documents: [p, c] });
  const q = qsAbout(f, '04');
  assert.equal(q.length, 1);
  assert.equal(q[0], "채용공고에는 '브랜드 공식 SNS 채널 운영'이, 근로계약서에는 'SNS 콘텐츠 기획·제작 일정 관리'도 적혀 있습니다. 근로계약서에 적힌 업무 범위를 담당하는 것으로 이해하면 될까요?");
  assert.doesNotMatch(q[0], /같은 조건인지|추가되었|늘어났|변경/);
  // 질문 속 원문 조각은 검증된 원문에 글자 그대로 있다
  for (const frag of q[0].match(/'([^']+)'/g).map((x) => x.slice(1, -1))) assert.ok(GQ_POSTING.includes(frag) || GQ_CONTRACT.includes(frag), frag);
  const note = f.relation.items.find((i) => i.id === '04').facets[0].notes.join(' ');
  assert.match(note, /바뀌었는지는 판단하지 않아요/);
});

test('2) 실제로 다른 업무가 적힌 경우: 양쪽에만 있는 업무를 원문 그대로 짚어 묻는다', async () => {
  const [c2, s2] = swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '브랜드 공식 SNS 채널 운영 및 SNS 콘텐츠 기획·제작 일정 관리', '오프라인 행사 기획 및 협력사 관리');
  const [p, c] = await pair(undefined, [c2, s2]);
  const q = qsAbout(buildFollowUps({ documents: [p, c] }), '04');
  assert.equal(q[0], "채용공고에는 '브랜드 공식 SNS 채널 운영', 근로계약서에는 '오프라인 행사 기획', '협력사 관리'가 적혀 있습니다. 실제로 담당하게 될 업무 범위를 확인 부탁드립니다.");
  // 계약서에 업무가 빠진 경우
  const [c3, s3] = swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '브랜드 공식 SNS 채널 운영 및 SNS 콘텐츠 기획·제작 일정 관리', '브랜드 공식 SNS 채널 운영');
  const [p3, s3doc] = await pair(swap(GQ_POSTING, GQ_POSTING_SPECS, '브랜드 공식 SNS 채널 운영', '브랜드 공식 SNS 채널 운영, 광고 성과 분석'), [c3, s3]);
  assert.equal(qsAbout(buildFollowUps({ documents: [p3, s3doc] }), '04')[0], "채용공고에 적힌 '광고 성과 분석'은 근로계약서에 따로 적혀 있지 않습니다. 이 업무도 담당하게 되는지 확인 부탁드립니다.");
  // 차이를 안전하게 특정할 수 없으면(너무 긴 조각) 질문하지 않고 원문 비교 안내만
  const long = '브랜드 공식 SNS 채널의 연간 운영 계획을 수립하고 주간 게시물 일정을 조율하며 대행사와 협업하는 일';
  assert.equal(textScope('브랜드 공식 SNS 채널 운영', long), null);
  const [cl, sl] = swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '브랜드 공식 SNS 채널 운영 및 SNS 콘텐츠 기획·제작 일정 관리', long);
  const [pl, clDoc] = await pair(undefined, [cl, sl]);
  const fl = buildFollowUps({ documents: [pl, clDoc] });
  assert.deepEqual(qsAbout(fl, '04'), [], '특정할 수 없으면 억지로 질문하지 않는다');
  assert.equal(fl.relation.items.find((i) => i.id === '04').relation, 'incomparable', '원문을 비교해 보도록 안내 (비교하기 어려움)');
});

test('3) 출퇴근 시각은 명확하고 주 소정근로시간만 직접 적혀 있지 않음: 판정은 일부 확인 그대로, 화면에는 두 사실을 나눠 표시', async () => {
  const c = await doc('contract', GQ_CONTRACT, GQ_CONTRACT_SPECS);
  const t02 = c.analysis.topics.find((t) => t.id === '02');
  assert.equal(t02.status, 'MAIN_PARTIAL', '동결 기준표 판정은 바꾸지 않는다');
  assert.equal(t02.criteria.find((x) => x.id === '02-a').boundary, 'hours_not_quoted');
  assert.deepEqual(detailOnly(t02), { written: ['출퇴근 시각', '휴게시간'], lacking: ['소정근로시간'] });
  // 근로계약서 단독: 세부 정보 질문은 추가 질문(접힘)으로, '내용이 모호함' 계열 사유를 쓰지 않는다
  const f = buildFollowUps({ documents: [c] });
  const w = all(f).find((x) => x.topicIds.includes('02'));
  assert.equal(w.kind, 'partial_detail');
  assert.equal(w.tier, 'more');
  assert.ok(!f.summary.needsCheck.some((x) => x.topicId === '02'));
  // 모호하다고 적힌 경우(시각이 없음)는 세부 정보만 빠진 경우가 아니다
  const [cv, sv] = swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '4. 근무시간: 10:00~19:00 (휴게시간 13:00~14:00)', '4. 근무시간: 업무 상황에 따라 조정');
  const vague = await doc('contract', cv, { ...sv, '02-a': { f: 'coarse', q: ['4. 근무시간: 업무 상황에 따라 조정'] }, '02-b': { f: 'absent', q: [] }, '02-c': { f: 'absent', q: [] } });
  assert.equal(detailOnly(vague.analysis.topics.find((t) => t.id === '02')), null);
});

test('4) 두 문서의 출퇴근 시각이 다름: 서로 다른 안내 + 근무시간 질문이 우선 (세부 숫자 안내보다 먼저)', async () => {
  const [p, c] = await pair();
  const f = buildFollowUps({ documents: [p, c] });
  assert.ok(f.summary.different.some((x) => x.topicId === '02'));
  const g = all(f).find((x) => x.topicIds.includes('02'));
  assert.equal(g.kind, 'different_stated');
  assert.equal(g.question, '채용공고에는 근무시간이 09:00~18:00, 근로계약서에는 10:00~19:00으로 기재되어 있습니다. 실제 적용되는 근무시간을 확인 부탁드립니다.');
});

test('5) 계약서에 처음 적힌 휴일: 질문을 만들지 않고, 질문 목록에도 넣지 않는다 (상태 안내만)', async () => {
  const [p, c] = await pair();
  const f = buildFollowUps({ documents: [p, c] });
  assert.equal(f.relation.items.find((i) => i.id === '09').relation, 'newly_stated');
  assert.deepEqual(qsAbout(f, '09'), []);
  assert.ok(!all(f).some((x) => x.topicIds.includes('09')), '질문 없는 항목은 \'추가로 확인할 수 있는 질문\'에 들어가지 않는다');
});

test('6) 근로계약서의 휴일 기재 자체가 불명확(휴무일만 적힘): 세부 기준 판정·근거에 따라 질문', async () => {
  const [c6, s6] = swap(GQ_CONTRACT, GQ_CONTRACT_SPECS, '9. 휴일: 주휴일 매주 일요일', '9. 휴무일: 토요일, 일요일');
  const [p, c] = await pair(undefined, [c6, { ...s6, '09-a': { f: 'specific', q: ['9. 휴무일: 토요일, 일요일'], sv: '토요일, 일요일' } }]);
  const t09 = c.analysis.topics.find((t) => t.id === '09');
  assert.equal(t09.criteria.find((x) => x.id === '09-a').boundary, 'rest_day_not_designated_holiday', '동결 기준: 휴무일만으로 지정된 휴일을 추론하지 않음');
  const f = buildFollowUps({ documents: [p, c] });
  const q = qsAbout(f, '09');
  assert.equal(q.length >= 1, true, '계약서의 휴일 기재가 구체적이지 않으면 질문 후보');
  assert.match(q[0], /휴일/);
});

test('7) 추가 질문 수 = 실제 질문 수: 질문 목록의 모든 항목에 질문 문장이 있다', async () => {
  for (const docs of [await pair(), [await doc('contract', GQ_CONTRACT, GQ_CONTRACT_SPECS)], [await doc('job_posting', GQ_POSTING, GQ_POSTING_SPECS)]]) {
    const f = buildFollowUps({ documents: docs });
    assert.ok(all(f).every((x) => typeof x.question === 'string' && x.question.length > 0));
  }
  // 관계 정보(처음 적힘·구체화)는 질문 목록과 별개로 요약에 남는다
  const [p, c] = await pair();
  const rel = relateRecord([p, c]);
  assert.equal(rel.items.find((i) => i.id === '06').relation, 'newly_stated');
});
