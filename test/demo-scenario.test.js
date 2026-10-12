// 시연 문서(주식회사 파란스텝)로 '안내가 어떻게 구체화되는지' 확인 질문 선정을 검사한다. 모의 AI 응답(test/demo-docs.js), 실제 Gemini 호출 없음.
// 사례: 범위 내 금액 / 범위 밖 금액 / 협의 예정 / 후속 문서에서 구체화 / 최종 계약서의 불명확한 기재 / 오퍼↔계약서 다른 금액
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildFollowUps } from '../public/followups.js';
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
const NO_SETTLED = /(협의\s*완료|확정된\s*합의|합의가\s*끝|협의가\s*끝났)/;

test('시연 문서: 모의 응답이 원문 검증을 통과한다 (분석 확인 불가 없음)', async () => {
  for (const [t, x, s] of [['job_posting', DEMO_POSTING, DEMO_POSTING_SPECS], ['offer', DEMO_OFFER, DEMO_OFFER_SPECS], ['contract', DEMO_CONTRACT, DEMO_CONTRACT_SPECS]]) {
    const d = await doc(t, x, s);
    assert.ok(!d.analysis.topics.some((tp) => tp.status === 'MAIN_UNAVAILABLE'), t);
  }
});

test('협의 예정: 채용공고 하나(연봉 범위·경력에 따라 협의, 수습 급여 별도 안내) → 질문 없이 상태로 안내', async () => {
  const posting = await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS);
  const f = buildFollowUps({ documents: [posting] });
  assert.deepEqual(qsAbout(f, '01'), [], '연봉 범위(협의)만으로 질문하지 않는다');
  assert.deepEqual(qsAbout(f, '08'), [], '수습 급여 별도 안내만으로 질문하지 않는다');
  const p01 = f.summary.pending.find((x) => x.topicId === '01');
  const p08 = f.summary.pending.find((x) => x.topicId === '08');
  assert.equal(p01.line, '채용공고에는 협의 가능한 연봉 범위(3,400만~3,800만원)가 적혀 있어요. 다음 안내에서 구체적인 조건이 적히는지 이어서 확인해요.');
  assert.equal(p08.kind, 'later');
  assert.match(p08.line, /'수습 급여: 최종 합격 시 별도 안내'라고 적혀 있어요\(추후 안내 예정\)/);
  assert.equal(posting.analysis.topics.find((t) => t.id === '01').status, 'MAIN_PARTIAL', '기준표 판정은 그대로 (상태 표시만 구분)');
});

test('범위 내 금액: 공고 연봉 3,400만~3,800만(협의) → 오퍼·계약서 3,600만 → 다른 안내가 아니라 범위 안에서 구체화', async () => {
  const f = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS)] });
  assert.ok(!f.summary.different.some((x) => x.topicId === '01'));
  const s01 = f.summary.specified.find((x) => x.topicId === '01');
  assert.equal(s01.line, '채용공고에는 협의 가능한 연봉 범위(3,400만~3,800만원)가 적혀 있고, 오퍼·합격 안내에는 연봉 3,600만 원으로 기재되어 있어요.');
  assert.deepEqual(qsAbout(f, '01'), []);
  const f3 = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS), await doc('contract', DEMO_CONTRACT, DEMO_CONTRACT_SPECS)] });
  const s3 = f3.summary.specified.find((x) => x.topicId === '01');
  assert.equal(s3.line, '채용공고에는 협의 가능한 연봉 범위(3,400만~3,800만원)가 적혀 있고, 오퍼·합격 안내와 근로계약서에는 연봉 3,600만 원으로 기재되어 있어요.');
  assert.doesNotMatch(JSON.stringify(f3.summary), NO_SETTLED);
});

test('범위 밖 금액: 공고 범위 3,400만~3,800만 → 오퍼 4,000만 → 서로 다른 안내 + 확인 질문', async () => {
  const [offerText, offerSpecs] = variant(DEMO_OFFER, DEMO_OFFER_SPECS, '3,600만 원', '4,000만 원');
  const f = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', offerText, offerSpecs)] });
  const d01 = f.summary.different.find((x) => x.topicId === '01');
  assert.ok(d01, '범위 밖 금액은 서로 다른 안내');
  const q = qsAbout(f, '01')[0];
  assert.equal(q, '채용공고에는 급여가 연봉 3,400만~3,800만원 범위, 오퍼·합격 안내에는 4,000만 원으로 기재되어 있습니다. 실제 적용되는 급여를 확인 부탁드립니다.');
});

test('오퍼 3,600만 ↔ 계약서 3,400만: 범위 안이어도 구체적인 두 금액이 다르면 서로 다른 안내 + 확인 질문 (기존 탐지 유지)', async () => {
  const [cText, cSpecs] = variant(DEMO_CONTRACT, DEMO_CONTRACT_SPECS, '3,600만 원', '3,400만 원');
  const f = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS), await doc('contract', cText, cSpecs)] });
  assert.ok(f.summary.different.some((x) => x.topicId === '01'));
  assert.equal(qsAbout(f, '01')[0], '오퍼·합격 안내에는 급여가 3,600만 원, 근로계약서에는 연봉 3,400만 원(세전)으로 기재되어 있습니다. 실제 적용되는 급여를 확인 부탁드립니다.');
});

test('후속 문서에서 구체화: 수습 급여 별도 안내 → 계약서 기재 예정 → 월 270만 원(90%) → 새롭게 구체화, 다시 묻지 않음', async () => {
  const f = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS), await doc('contract', DEMO_CONTRACT, DEMO_CONTRACT_SPECS)] });
  const s08 = f.summary.specified.find((x) => x.topicId === '08');
  assert.equal(s08.line, '이전 자료에는 구체적인 수습 중 급여가 없었지만, 근로계약서에는 월 270만 원(세전, 정규 급여의 90%)으로 적혀 있어요.');
  assert.deepEqual(qsAbout(f, '08'), [], '이미 확인된 수습 급여를 다시 묻지 않는다');
  assert.ok(!f.summary.pending.some((x) => x.topicId === '08'), '구체화된 뒤에는 협의 예정으로 보이지 않는다');
  assert.ok(!f.summary.needsCheck.some((x) => x.topicId === '08'));
  // 차이 사례는 근무시간 하나만, 나머지 공통 조건은 그대로
  assert.deepEqual(f.summary.different.map((x) => x.topicId), ['02']);
  for (const id of ['03', '04', '05', '07']) assert.equal(f.relation.items.find((i) => i.id === id).relation, 'same', id);
  assert.deepEqual(qsAbout(f, '04'), [], "'및'과 쉼표 차이만 있는 담당업무는 같은 내용");
});

test('최종 계약서의 불명확한 기재: 계약서에도 수습 중 임금이 \'추후 협의\'면 확인 질문 제안', async () => {
  const [cText, cSpecs] = variant(DEMO_CONTRACT, DEMO_CONTRACT_SPECS, '수습기간 중 임금: 월 270만 원(세전, 정규 급여의 90%)', '수습기간 중 임금: 추후 협의',
    { '08-a': { f: 'undecided', q: ['수습기간 중 임금: 추후 협의'] } });
  const f = buildFollowUps({ documents: [await doc('job_posting', DEMO_POSTING, DEMO_POSTING_SPECS), await doc('offer', DEMO_OFFER, DEMO_OFFER_SPECS), await doc('contract', cText, cSpecs)] });
  const n08 = f.summary.needsCheck.find((x) => x.topicId === '07' || x.topicId === '08');
  assert.ok(n08, '최종 계약서에서도 정해지지 않으면 확인 필요');
  assert.ok(qsAbout(f, '08').length >= 1);
  assert.doesNotMatch(qsAbout(f, '08').join(' '), NO_SETTLED);
});
