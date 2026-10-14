// 비교 결과 정리본: 두 문서 비교 화면과 같은 분류·값·원문 근거·질문을 한 문서로 이어 읽고, 일반 텍스트로 복사한다.
// 새로 분석하거나 요약하지 않는다. 입력 모델은 app.js가 비교 화면과 같은 계산(compareRowsFor·sideInfo·rowNotes·evidenceFor)으로 만든다.
//
// model = {
//   title, recordName, createdAt,
//   docs: [{ side: 'A'|'B', type, name, registered }],
//   groups: [{ key, label, rows: [{ label, badge, a: Side, b: Side, line, detail, evidence: { a: Ev[], b: Ev[] }, questionNo }] }],
//   summary: [{ key, label, count, items: [이름] }], skipped,
//   questions: [{ no, label, text }],
// }
// Side = { state: 'present'|'missing'|'unavailable', value, calc, badgeText, cause }
// Ev = { line, text, facets: [세부 조건] }

export const REPORT_NOTICES = [
  '문서 A·B는 이 기록에 등록한 순서예요. 실제로 안내받은 순서나 조건이 바뀐 순서를 뜻하지 않아요.',
  '한쪽 문서에만 적힌 조건은 없어지거나 바뀐 것으로 보지 않아요.',
  '원문 근거는 서버가 원문과 대조해 실제로 적힌 문구인지 확인한 인용만 담았어요. 계산값은 원문에 적힌 값으로 계산한 것이며 원문 기재값과 구분했어요.',
  '분석 확인 불가는 근거를 확인하지 못했다는 뜻이며, 조건이 없다는 뜻이 아니에요.',
  '회사에 확인할 질문은 직접 확인할 때 참고하는 문장이에요. 일단확인은 회사에 보내지 않으며, 질문이 회사의 답변이나 확정된 조건은 아니에요.',
  '이 정리본은 문서에 적힌 내용을 정리한 것으로, 법률 위반 여부나 계약의 적법성, 실제 근로조건을 판단하지 않아요.',
];

export function sideText(s) {
  if (!s) return '원문에 언급 없음';
  if (s.state === 'missing') return '원문에 언급 없음 (없어지거나 바뀐 것으로 보지 않음)';
  if (s.state === 'unavailable') return `분석 확인 불가${s.cause ? ` — ${s.cause}` : ''} (적혀 있지 않다는 뜻은 아님)`;
  return [s.value, s.calc ? `${s.calc} (계산값)` : null, s.badgeText ? `[${s.badgeText}]` : null].filter(Boolean).join(' · ');
}

// 정리본 전체를 읽기 좋은 일반 텍스트로 (제목 · 비교한 문서 · 요약 · 묶음별 항목(A/B 값·원문 근거) · 질문 · 안내)
export function reportText(model) {
  const out = [];
  const hr = '────────────────────';
  out.push(model.title);
  if (model.recordName) out.push(`기록: ${model.recordName}`);
  out.push(`정리한 때: ${model.createdAt}`);
  out.push('', '[비교한 문서]');
  for (const d of model.docs) out.push(`- 문서 ${d.side}: ${d.type} · ${d.name} (등록 ${d.registered})`);
  out.push('', '[전체 비교 요약]');
  for (const g of model.summary) out.push(`- ${g.label} ${g.count}건${g.items.length ? `: ${g.items.join(', ')}` : ''}`);
  if (model.skipped) out.push(`- 두 문서 모두에 적혀 있지 않은 조건 ${model.skipped}개는 정리본에 넣지 않았어요.`);
  for (const g of model.groups) {
    out.push('', hr, `[${g.label}] ${g.rows.length}건`);
    g.rows.forEach((r, i) => {
      out.push('', `${i + 1}. ${r.label} — ${r.badge}`);
      out.push(`   문서 A(${model.docs[0].type}): ${sideText(r.a)}`);
      out.push(`   문서 B(${model.docs[1].type}): ${sideText(r.b)}`);
      if (r.line) out.push(`   대조 요약: ${r.line}`);
      if (r.detail) out.push(`   참고: ${r.detail}`);
      const ev = [['A', r.evidence.a], ['B', r.evidence.b]].filter(([, l]) => l.length);
      if (ev.length) {
        out.push('   원문 근거');
        for (const [side, list] of ev) for (const e of list) out.push(`   - 문서 ${side} ${e.line != null ? `${e.line}번째 줄` : ''}(${e.facets.join('·')}): "${e.text}"`);
      }
      if (r.questionNo) out.push(`   → 회사에 확인할 질문 ${r.questionNo}번`);
    });
  }
  out.push('', hr, '[회사에 확인할 질문]');
  if (model.questions.length) for (const q of model.questions) out.push(`${q.no}. (${q.label}${q.edited ? ' · 직접 고친 질문' : ''}) ${q.text}`);
  else out.push('이번 비교에서 만든 확인 질문은 없어요.');
  out.push('', '[안내]', ...REPORT_NOTICES.map((n) => `- ${n}`));
  return out.join('\n');
}

// 질문만 (결과 화면의 '질문 전체 복사'와 같은 형식: 질문 문장만, 빈 줄로 구분)
export const questionsText = (model) => model.questions.map((q) => q.text).join('\n\n');
