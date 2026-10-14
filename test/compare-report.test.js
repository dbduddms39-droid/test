import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportText, questionsText, sideText, REPORT_NOTICES } from '../public/compare-report.js';
import { resolveRoute, ROUTES } from '../public/flow.js';

// 가상 문서로 만든 정리본 모델 (실제 회사·개인 정보 아님)
const model = {
  title: '비교 결과 정리본', recordName: '이름 없는 기록 (근로계약서·채용공고)', createdAt: '2026.10.14 10:00',
  docs: [{ side: 'A', type: '근로계약서', name: '[가상] 근로계약서', registered: '2026.10.14 09:00' }, { side: 'B', type: '채용공고', name: '[가상] 채용공고', registered: '2026.10.14 09:05' }],
  summary: [{ key: 'different', label: '서로 다른 조건', count: 1, items: ['임금'] }, { key: 'review', label: '추가 대조가 필요한 조건', count: 0, items: [] }],
  skipped: 1,
  groups: [
    { key: 'different', label: '서로 다른 조건', rows: [{ label: '임금', badge: '서로 다른 조건',
      a: { state: 'present', value: '연봉 36,000,000원(세전)' }, b: { state: 'present', value: '연봉 3,400만 원' },
      line: '자료마다 임금 금액이 다르게 안내되었어요.', detail: null,
      evidence: { a: [{ line: 10, text: '연봉 36,000,000원(세전)', facets: ['임금 금액'] }], b: [{ line: 6, text: '급여: 연봉 3,400만 원', facets: ['임금 금액'] }] }, questionNo: 1 }] },
    { key: 'onesided', label: '한쪽에만 기재된 조건', rows: [{ label: '계약기간', badge: '한쪽에만 기재',
      a: { state: 'present', value: '기간의 정함 없음' }, b: { state: 'missing', value: '원문에 언급 없음' }, line: null, detail: null, evidence: { a: [], b: [] }, questionNo: null }] },
    { key: 'unavailable', label: '분석 확인 불가', rows: [{ label: '근무시간', badge: '분석 확인 불가',
      a: { state: 'present', value: '10:00~19:00', calc: '주 40시간' }, b: { state: 'unavailable', value: '분석 확인 불가', cause: '근거를 원문에서 확인하지 못했어요' }, line: null, detail: null, evidence: { a: [], b: [] }, questionNo: null }] },
  ],
  questions: [{ no: 1, label: '임금', text: '실제 적용되는 임금을 확인 부탁드립니다.' }],
};

test('정리본 텍스트: 제목·비교한 문서·요약·묶음별 A/B 값·원문 근거·질문·안내가 구분된다', () => {
  const t = reportText(model);
  for (const s of ['비교 결과 정리본', '[비교한 문서]', '- 문서 A: 근로계약서 · [가상] 근로계약서', '[전체 비교 요약]', '[서로 다른 조건] 1건', '문서 A(근로계약서): 연봉 36,000,000원(세전)', '문서 B(채용공고): 연봉 3,400만 원',
    '- 문서 A 10번째 줄(임금 금액): "연봉 36,000,000원(세전)"', '→ 회사에 확인할 질문 1번', '[회사에 확인할 질문]', '1. (임금) 실제 적용되는 임금을 확인 부탁드립니다.', '[안내]', '두 문서 모두에 적혀 있지 않은 조건 1개']) {
    assert.ok(t.includes(s), s);
  }
  assert.ok(REPORT_NOTICES.every((n) => t.includes(n)));
});

test('정리본: 한쪽에만 적힌 조건은 삭제·변경으로 쓰지 않고, 확인 불가는 조건 없음으로 쓰지 않으며, 계산값은 구분', () => {
  const t = reportText(model);
  assert.ok(t.includes('원문에 언급 없음 (없어지거나 바뀐 것으로 보지 않음)'));
  assert.ok(t.includes('분석 확인 불가 — 근거를 원문에서 확인하지 못했어요 (적혀 있지 않다는 뜻은 아님)'));
  assert.ok(t.includes('10:00~19:00 · 주 40시간 (계산값)'));
  assert.ok(!/삭제됐|삭제되었|변경됐|변경되었|위반입니다|적법합니다/.test(t));
  assert.equal(sideText({ state: 'present', value: '월 300만원', badgeText: '협의 예정' }), '월 300만원 · [협의 예정]');
});

test('정리본: 질문이 없으면 없다고 쓰고, 질문만 복사는 질문 문장만', () => {
  assert.ok(reportText({ ...model, questions: [] }).includes('이번 비교에서 만든 확인 질문은 없어요.'));
  assert.equal(questionsText(model), '실제 적용되는 임금을 확인 부탁드립니다.');
  assert.equal(questionsText({ ...model, questions: [] }), '');
});

test('정리본 화면 주소', () => {
  assert.equal(ROUTES.report('rec_abc'), '#/records/rec_abc/report');
  assert.deepEqual(resolveRoute('#/records/rec_abc/report', {}), { view: 'report', recordId: 'rec_abc' });
  assert.deepEqual(resolveRoute('#/records/rec_abc/report/x', {}), { redirect: '#/records/rec_abc' });
});
