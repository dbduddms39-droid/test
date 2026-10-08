import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResponse } from '../src/validate.js';
import { ITEM_IDS } from '../src/items.js';

const nf = (id) => ({ id, presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [], probation_status: null, employment_category: null });
const allNotFound = () => ({ items: ITEM_IDS.map(nf) });
const withItem = (item) => ({ items: [...allNotFound().items.filter((i) => i.id !== item.id), item] });

test('정상 응답은 모두 통과', () => {
  const { valid, errors } = validateResponse(allNotFound(), ITEM_IDS, 5);
  assert.deepEqual(errors, {});
  assert.equal(Object.keys(valid).length, 8);
});

test('누락된 항목은 오류', () => {
  const raw = allNotFound();
  raw.items = raw.items.filter((i) => i.id !== 'duties');
  assert.deepEqual(validateResponse(raw, ITEM_IDS, 5).errors, { duties: ['missing_item'] });
});

test('중복된 항목은 오류', () => {
  const raw = allNotFound();
  raw.items.push(nf('salary'));
  const { valid, errors } = validateResponse(raw, ITEM_IDS, 5);
  assert.deepEqual(errors, { salary: ['duplicate_item'] });
  assert.equal(valid.salary, undefined);
});

test('found인데 근거 번호가 없으면 오류', () => {
  const r = validateResponse(withItem({ ...nf('salary'), presence: 'found', specificity: 'specific' }), ITEM_IDS, 5);
  assert.ok(r.errors.salary.includes('found_without_evidence'));
});

test('not_found인데 근거 번호가 있으면 오류', () => {
  const r = validateResponse(withItem({ ...nf('salary'), evidence_ids: [2] }), ITEM_IDS, 5);
  assert.ok(r.errors.salary.includes('not_found_with_evidence'));
});

test('존재하지 않는 근거 번호는 오류', () => {
  const item = { ...nf('salary'), presence: 'found', specificity: 'specific', evidence_ids: [6] };
  assert.ok(validateResponse(withItem(item), ITEM_IDS, 5).errors.salary.includes('unknown_evidence_id'));
  assert.ok(validateResponse(withItem({ ...item, evidence_ids: [0] }), ITEM_IDS, 5).errors.salary.includes('unknown_evidence_id'));
});

test('vague이면 reason_code가 필요하고 specific이면 없어야 한다', () => {
  const base = { ...nf('salary'), presence: 'found', evidence_ids: [1] };
  assert.ok(validateResponse(withItem({ ...base, specificity: 'vague' }), ITEM_IDS, 5).errors.salary.includes('missing_reason_code'));
  assert.ok(validateResponse(withItem({ ...base, specificity: 'specific', reason_code: 'vague_expression' }), ITEM_IDS, 5).errors.salary.includes('reason_on_specific'));
  assert.deepEqual(validateResponse(withItem({ ...base, specificity: 'vague', reason_code: 'conflicting_values', evidence_ids: [1, 3] }), ITEM_IDS, 5).errors, {});
});

test('수습기간 found에는 probation_status가, 고용형태 found에는 employment_category가 필요', () => {
  const p = { ...nf('probation_period'), presence: 'found', specificity: 'specific', evidence_ids: [1] };
  assert.ok(validateResponse(withItem(p), ITEM_IDS, 5).errors.probation_period.includes('missing_probation_status'));
  assert.deepEqual(validateResponse(withItem({ ...p, probation_status: 'none' }), ITEM_IDS, 5).errors, {});
  const e = { ...nf('employment_type'), presence: 'found', specificity: 'specific', evidence_ids: [1] };
  assert.ok(validateResponse(withItem(e), ITEM_IDS, 5).errors.employment_type.includes('missing_employment_category'));
});

test('형식이 깨진 응답은 요청한 모든 항목의 오류', () => {
  const { errors } = validateResponse({ foo: 1 }, ['salary', 'duties'], 5);
  assert.deepEqual(errors, { salary: ['malformed_response'], duties: ['malformed_response'] });
});

test('요청하지 않은 항목은 무시하고 요청한 항목만 검증', () => {
  const { valid, errors } = validateResponse(allNotFound(), ['salary'], 5);
  assert.deepEqual(Object.keys(valid), ['salary']);
  assert.deepEqual(errors, {});
});
