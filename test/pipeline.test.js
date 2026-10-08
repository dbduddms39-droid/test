import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { scoreSample, summarize } from '../src/eval/score.js';
import { NOT_FOUND_TEMPLATES } from '../src/items.js';
import { SAMPLES } from './samples.js';
import { idealResponse, idealItem, scriptedAI } from './helpers.js';

const byKey = (k) => SAMPLES.find((s) => s.key === k);
const itemOf = (result, id) => result.items.find((i) => i.id === id);

for (const sample of SAMPLES) {
  test(`정답 AI 응답 → 기대 화면 상태와 근거 (${sample.key}: ${sample.title})`, async () => {
    const ai = scriptedAI(idealResponse(sample));
    const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
    const rows = scoreSample(sample, result);
    for (const r of rows) {
      assert.equal(r.actualStatus, r.expectedStatus, `${r.item}: 기대 ${r.expectedStatus}, 실제 ${r.actualStatus}`);
      assert.ok(['exact', 'n/a'].includes(r.evidence), `${r.item}: 근거 ${r.evidence}`);
    }
    assert.equal(ai.calls.length, 1, '검증 통과 시 재분석하지 않는다');
  });
}

test('화면 원문은 AI 문장이 아니라 보존된 원문에서 가져온다', async () => {
  const sample = byKey('S5_pdf');
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(idealResponse(sample)) });
  const salary = itemOf(result, 'salary');
  assert.deepEqual(salary.evidence.map((s) => s.text), ['임금', '시간급', '10,500원']);
  for (const s of salary.evidence) assert.equal(sample.text.slice(s.start, s.end), s.text);
});

test('잘못된 근거 번호 → 해당 항목만 재분석 → 통과하면 정상 표시', async () => {
  const sample = byKey('S1_clear');
  const bad = idealResponse(sample);
  bad.items.find((i) => i.id === 'salary').evidence_ids = [99];
  const ai = scriptedAI(bad, (args) => idealResponse(sample, args.itemIds));
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  assert.equal(ai.calls.length, 2);
  assert.deepEqual(ai.calls[1].itemIds, ['salary']);
  assert.deepEqual(ai.calls[1].feedback, { salary: ['unknown_evidence_id'] });
  assert.equal(itemOf(result, 'salary').status, 'stated');
});

test('재분석 후에도 실패하면 해당 항목만 분석 확인 불가 (찾지 못함으로 바꾸지 않음)', async () => {
  const sample = byKey('S1_clear');
  const bad = idealResponse(sample);
  bad.items.find((i) => i.id === 'salary').evidence_ids = [99];
  const ai = scriptedAI(bad, { items: [{ ...idealItem(sample, 'salary'), evidence_ids: [] }] });
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  const salary = itemOf(result, 'salary');
  assert.equal(salary.status, 'unavailable');
  assert.equal(salary.statusLabel, '분석 확인 불가');
  assert.equal(salary.notFoundMessage, null);
  assert.deepEqual(salary.errorCodes, ['found_without_evidence']);
  assert.equal(itemOf(result, 'duties').status, 'stated');
  assert.equal(result.summary.unavailable, 1);
});

test('누락·중복 항목은 재분석 대상', async () => {
  const sample = byKey('S3_missing');
  const bad = idealResponse(sample);
  bad.items = bad.items.filter((i) => i.id !== 'workplace');
  bad.items.push(idealItem(sample, 'duties'));
  const ai = scriptedAI(bad, (args) => idealResponse(sample, args.itemIds));
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  assert.deepEqual(ai.calls[1].itemIds.sort(), ['duties', 'workplace']);
  assert.equal(itemOf(result, 'workplace').status, 'not_found');
  assert.equal(itemOf(result, 'duties').status, 'stated');
});

test('AI 호출 실패 → 1회 재시도 → 또 실패하면 모든 항목 분석 확인 불가', async () => {
  const sample = byKey('S1_clear');
  const err = Object.assign(new Error('x'), { code: 'connection_failed' });
  const ai = scriptedAI(err, err);
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai });
  assert.equal(ai.calls.length, 2);
  for (const it of result.items) {
    assert.equal(it.status, 'unavailable');
    assert.equal(it.visible, true, '검증 실패한 선택 항목도 숨기지 않는다');
  }
});

test('AI의 잘못된 not_found는 구조 검증으로는 걸러지지 않으며, 정확도 채점에서 잡힌다', async () => {
  const sample = byKey('S1_clear');
  const wrong = idealResponse(sample);
  Object.assign(wrong.items.find((i) => i.id === 'salary'), { presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [] });
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(wrong) });
  assert.equal(itemOf(result, 'salary').status, 'not_found');
  const s = summarize(scoreSample(sample, result));
  assert.equal(s.falseNotFound, 1);
});

test('계약직인데 계약기간 미기재 → 계약기간을 찾지 못함으로 표시', async () => {
  const sample = byKey('X2_fixed_term_no_period');
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(idealResponse(sample)) });
  const cp = itemOf(result, 'contract_period');
  assert.equal(cp.visible, true);
  assert.equal(cp.status, 'not_found');
  assert.equal(cp.notFoundMessage, '이 채용공고에는 계약기간에 관한 안내가 확인되지 않아요.');
});

test("'수습 없음' → 수습기간은 명시됨, 수습 중 급여는 숨김", async () => {
  const sample = byKey('X1_no_probation');
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(idealResponse(sample)) });
  assert.equal(itemOf(result, 'probation_period').status, 'stated');
  assert.equal(itemOf(result, 'probation_period').probationNone, true);
  assert.equal(itemOf(result, 'probation_pay').visible, false);
});

test('수습 언급이 있고 수습 중 급여 정보가 없으면 찾지 못함', async () => {
  const sample = byKey('S1_clear');
  const r = idealResponse(sample);
  Object.assign(r.items.find((i) => i.id === 'probation_pay'), { presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [] });
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(r) });
  const pay = itemOf(result, 'probation_pay');
  assert.equal(pay.visible, true);
  assert.equal(pay.status, 'not_found');
});

test('문서 유형별 찾지 못함 안내 문구', () => {
  assert.equal(NOT_FOUND_TEMPLATES.job_posting('임금'), '이 채용공고에는 임금에 관한 안내가 확인되지 않아요.');
  assert.equal(NOT_FOUND_TEMPLATES.offer('임금'), '입력한 안내 내용에서 임금에 관한 내용을 확인하지 못했어요.');
  assert.equal(NOT_FOUND_TEMPLATES.contract('임금'), '입력한 계약서에서 임금에 관한 내용을 확인하지 못했어요.');
});

test('상단 요약은 표시되는 항목만 센다', async () => {
  const sample = byKey('S3_missing');
  const result = await analyzeDocument({ text: sample.text, docType: sample.docType, ai: scriptedAI(idealResponse(sample)) });
  assert.deepEqual(result.summary, { stated: 2, unclear: 0, not_found: 3, unavailable: 0 });
});
