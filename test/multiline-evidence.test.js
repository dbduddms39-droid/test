import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTextEvidence, compareFacet } from '../public/compare-core.js';

const quote = (text, line) => ({ text, line });
const duties = (quotes, sourceValue = quotes[0]?.text ?? null) => ({
  '04-a': { status: 'CONFIRMED', sourceValue, evidence: quotes.map((t, i) => quote(t, i + 1)) },
});
const doc = (quotes, sourceValue) => ({ docType: 'job_posting', criteria: duties(quotes, sourceValue) });
const facet = { id: '04-a', label: '업무 내용', kind: 'text' };
const labels = { A: '채용공고', B: '처우 안내' };

test('same verified quotes in different order are equal', () => {
  const a = [quote('SNS 채널 운영', 1), quote('콘텐츠 기획', 2)];
  const b = [quote('콘텐츠 기획', 1), quote('SNS 채널 운영', 2)];
  assert.equal(compareTextEvidence(a, b)?.kind, 'same');
  assert.equal(compareFacet(facet, doc(a.map(x => x.text)), doc(b.map(x => x.text)), labels).state, 'same');
});

test('matching first extracted value does not mask an additional duty', () => {
  const a = doc(['SNS 채널 운영', '콘텐츠 기획'], 'SNS 채널 운영');
  const b = doc(['SNS 채널 운영'], 'SNS 채널 운영');
  const r = compareFacet(facet, a, b, labels);
  assert.equal(r.state, 'unclear');
  assert.match(r.note, /동일한 원문 문구 1곳/);
  assert.match(r.note, /콘텐츠 기획/);
});

test('partially shared evidence reports both unmatched sides without calling a change', () => {
  const a = doc(['SNS 채널 운영', '콘텐츠 기획']);
  const b = doc(['SNS 채널 운영', '데이터 분석']);
  const r = compareFacet(facet, a, b, labels);
  assert.equal(r.state, 'unclear');
  assert.match(r.note, /콘텐츠 기획/);
  assert.match(r.note, /데이터 분석/);
});

test('no evidence does not invent equivalence', () => {
  assert.equal(compareTextEvidence([], [quote('SNS 운영', 1)]), null);
});
