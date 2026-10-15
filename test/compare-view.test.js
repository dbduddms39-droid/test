import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStatus, evidenceFor, documentTitle, STATUS_ORDER, COMPARE_STATUS } from '../public/compare-view.js';

const F = { status: 'MAIN_FOUND' };
const M = { status: 'MAIN_MISSING' };
const U = { status: 'MAIN_UNAVAILABLE' };

test('5 statuses, fixed order, each with label and badge', () => {
  assert.deepEqual(STATUS_ORDER, ['different', 'review', 'onesided', 'unavailable', 'same']);
  for (const k of STATUS_ORDER) assert.ok(COMPARE_STATUS[k].label && COMPARE_STATUS[k].badge);
});

test('different wording → 서로 다른 조건', () => {
  assert.equal(compareStatus({ relation: 'different_stated' }, [F, F]), 'different');
});

test('written on one side only is never shown as a change', () => {
  assert.equal(compareStatus({ relation: 'newly_specified' }, [F, F]), 'review'); // 범위·협의 ↔ 확정 금액: 두 문서 모두 적힘
  for (const relation of ['newly_stated', 'not_mentioned_later', 'newly_specified']) {
    assert.equal(compareStatus({ relation }, [F, M]), 'onesided');
  }
  assert.equal(compareStatus({ relation: null }, [M, F]), 'onesided');
});

test('unavailable is separate from not written', () => {
  assert.equal(compareStatus({ relation: 'same' }, [F, U]), 'unavailable');
  assert.equal(compareStatus({ relation: 'unavailable' }, [F, F]), 'unavailable');
  assert.equal(compareStatus({ relation: 'not_mentioned_later' }, [F, M]), 'onesided');
});

test('same only when nothing is left to confirm', () => {
  assert.equal(compareStatus({ relation: 'same' }, [F, F]), 'same');
  assert.equal(compareStatus({ relation: 'same' }, [F, F], { hasQuestion: true }), 'review');
  assert.equal(compareStatus({ relation: 'same' }, [F, F], { pending: true }), 'review');
  assert.equal(compareStatus({ relation: 'incomparable' }, [F, F]), 'review');
});

test('missing in both documents is not a compared card', () => {
  assert.equal(compareStatus({ relation: null }, [M, M]), null);
  assert.equal(compareStatus({ relation: null }, [null, null]), null);
});

test('every item lands in exactly one status (summary count = cards)', () => {
  const cases = [['different_stated', [F, F]], ['same', [F, F]], ['newly_stated', [M, F]], ['incomparable', [F, F]], ['same', [U, F]], [null, [M, M]]];
  const rows = cases.map(([relation, s]) => compareStatus({ relation }, s)).filter(Boolean);
  const counts = STATUS_ORDER.map((st) => rows.filter((r) => r === st).length);
  assert.equal(counts.reduce((a, b) => a + b, 0), rows.length);
});

const side = (docId, evidence, value = null, kind = 'present') => ({ docId, kind, value, evidence });
test('evidence: quotes kept verbatim, deduped, labelled with the conditions they support', () => {
  const rel = { facets: [
    { label: '소정근로시간', sides: [side('A', [{ line: 5, text: '근무시간: 09:00~18:00 (휴게 12:00~13:00)' }], '09:00~18:00')] },
    { label: '출퇴근 시각', sides: [side('A', [{ line: 5, text: '09:00~18:00' }], '09:00~18:00')] },
    { label: '휴게시간', sides: [side('A', [{ line: 5, text: '근무시간: 09:00~18:00 (휴게 12:00~13:00)' }], '12:00~13:00'), side('B', [{ line: 2, text: '휴게 1시간' }], null)] },
  ] };
  const a = evidenceFor(rel, 'A');
  assert.equal(a.length, 1);
  assert.equal(a[0].text, '근무시간: 09:00~18:00 (휴게 12:00~13:00)');
  assert.deepEqual(a[0].facets.sort(), ['소정근로시간', '출퇴근 시각', '휴게시간'].sort());
  assert.deepEqual(a[0].highlight.sort(), ['09:00~18:00', '12:00~13:00'].sort());
  const b = evidenceFor(rel, 'B');
  assert.deepEqual(b.map((r) => [r.line, r.text, r.highlight]), [[2, '휴게 1시간', []]]);
});

test('evidence: multi-line quotes stay separate, sorted by line; missing side gives none', () => {
  const rel = { facets: [{ label: '업무 내용', sides: [side('A', [{ line: 9, text: '콘텐츠 기획' }, { line: 8, text: 'SNS 채널 운영' }]), side('B', [], null, 'missing')] }] };
  assert.deepEqual(evidenceFor(rel, 'A').map((r) => r.line), [8, 9]);
  assert.deepEqual(evidenceFor(rel, 'B'), []);
});

test('evidence: highlight only when the exact value is in the quote', () => {
  const rel = { facets: [{ label: '임금 금액', sides: [side('A', [{ line: 1, text: '연봉 36,000,000원(세전)' }], '연봉 36,000,000원(세전) · 월 지급 기준액')] }] };
  assert.deepEqual(evidenceFor(rel, 'A')[0].highlight, []);
});

test('document title: file name, else first line clipped', () => {
  assert.equal(documentTitle({ original: { name: 'a.pdf' }, confirmedText: 'x' }), 'a.pdf');
  assert.equal(documentTitle({ confirmedText: '\n  [가상] 근로계약서\n본문' }), '[가상] 근로계약서');
  assert.equal(documentTitle({ confirmedText: 'ㄱ'.repeat(50) }, 10), `${'ㄱ'.repeat(10)}…`);
});

// ---- 문서 1개 결과 ----
import { singleStatus, topicEvidence, SINGLE_STATUS } from '../public/compare-view.js';

const crit = (id, status, evidence = [], extra = {}) => ({ id, label: id, status, required: true, evidence, ...extra });
const topic = (status, criteria = [], extra = {}) => ({ id: '01', visible: true, status, criteria, notes: {}, ...extra });

test('문서 1개: 채용공고·처우 안내는 적힌 조건만 카드, 미기재는 카드 없음', () => {
  assert.equal(singleStatus('job_posting', topic('MAIN_FOUND')), 'stated');
  assert.equal(singleStatus('offer', topic('MAIN_MISSING')), null);
  assert.equal(singleStatus('offer', topic('MAIN_UNAVAILABLE')), 'unavailable');
  assert.equal(singleStatus('job_posting', { visible: false, status: 'MAIN_FOUND' }), null);
  const undecided = topic('MAIN_PARTIAL', [crit('01-a', 'PARTIAL', [{ line: 1, text: '연봉 협의' }], { basis: 'undecided' })]);
  assert.equal(singleStatus('job_posting', undecided), 'deferred');
});

test('문서 1개: 근로계약서는 10개 기준 모두 카드 (추가 확인 · 기재 · 계산값 · 확인 불가)', () => {
  assert.equal(singleStatus('contract', topic('MAIN_FOUND')), 'written');
  assert.equal(singleStatus('contract', topic('MAIN_MISSING')), 'needs');
  assert.equal(singleStatus('contract', topic('MAIN_FOUND'), { hasQuestion: true }), 'needs');
  assert.equal(singleStatus('contract', topic('MAIN_UNAVAILABLE')), 'unavailable');
  assert.deepEqual(SINGLE_STATUS.contract.order, ['needs', 'written', 'calculated', 'unavailable']);
  assert.deepEqual(SINGLE_STATUS.brief.order, ['stated', 'deferred', 'unavailable']);
});

test('문서 1개 원문 근거: 기준별 인용을 한 번만, 확인 불가 기준 인용은 빼고, 원문 기재값만 강조', () => {
  const t = topic('MAIN_FOUND', [
    crit('01-a', 'CONFIRMED', [{ line: 3, text: '임금: 연봉 3,600만 원(세전)' }]),
    crit('01-b', 'CONFIRMED', [{ line: 3, text: '임금: 연봉 3,600만 원(세전)' }]),
    crit('01-f', 'UNAVAILABLE', [{ line: 9, text: '지급일 매월 25일' }]),
  ]);
  const rows = topicEvidence(t, { '01-a': { sourceValue: '연봉 3,600만 원' }, '01-b': { sourceValue: '연봉' } });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].facets, ['01-a', '01-b']);
  assert.deepEqual(rows[0].highlight, ['연봉 3,600만 원', '연봉']);
  assert.equal(rows[0].text, '임금: 연봉 3,600만 원(세전)');
});

// ---- 문서 1개 결과: 목록형 표시 기준 (화면에 보이는 값·설명·중요 상태만, 접힌 원문 근거는 보지 않음) ----
import { listRowKind, COMPACT_GROUPS } from '../public/compare-view.js';

test('목록형: 값이 짧은 근무시간은 원문 근거가 길어도 목록형 (근거 길이·개수는 입력에 없음)', () => {
  assert.deepEqual(COMPACT_GROUPS, ['stated', 'written']);
  assert.equal(listRowKind({ group: 'stated', value: '09:00~18:00 · 휴게 12:00~13:00' }), 'compact');
  assert.equal(listRowKind({ group: 'written', value: '정규직', note: '' }), 'compact');
});

test('목록형 묶음 안에서도 값·설명이 길거나 중요한 상태면 전체 너비', () => {
  assert.equal(listRowKind({ group: 'stated', value: '가'.repeat(61) }), 'wide');
  assert.equal(listRowKind({ group: 'written', value: '정규직', note: '나'.repeat(71) }), 'wide');
  for (const flag of ['hasQuestion', 'calculated', 'externalRef', 'deferred', 'unavailable', 'missing']) {
    assert.equal(listRowKind({ group: 'written', value: '짧음', [flag]: true }), 'wide', flag);
  }
});

test('그 밖의 묶음(추가 확인 필요·협의 예정·계산값·확인 불가)은 넓은 카드', () => {
  for (const group of ['needs', 'calculated', 'unavailable', 'deferred']) assert.equal(listRowKind({ group, value: '짧음' }), 'card', group);
});
