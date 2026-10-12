// '담당자에게 이렇게 물어보세요' 질문 템플릿 (브라우저와 Node 테스트에서 함께 사용, 점검 기준 v2.2 주제)
// - 화면에 표시되는 주제 중 '일부 내용만 기재됨' 또는 '관련 내용 찾지 못함'에만 질문을 만든다.
//   '분석 확인 불가'는 문서 내용이 아니라 분석·검증 실패이므로 질문을 만들지 않는다.
// - 문서에 적힌 금액·날짜·조건을 질문에 넣거나 추측하지 않는다. 템플릿 문장만 쓴다.
// - AI를 호출하지 않는다.

// 문서 유형별로 문서를 가리키는 말 (조사 포함)
const DOC_REF = {
  job_posting: '채용공고에서',
  offer: '안내해 주신 내용에서',
  contract: '근로계약서에서',
};

// 주제별: 담당자에게 익숙한 이름(topic), 주격 조사 형태(subj), 무엇을 물을지(ask)
const TOPIC_ASK = {
  '01': { topic: '급여', subj: '급여가', ask: '급여 금액과 산정 단위(시급·월급·연봉), 세전·세후 기준, 지급일과 지급방법을 알려 주실 수 있을까요?' },
  '02': { topic: '근무시간', subj: '근무시간이', ask: '근무일과 출퇴근 시각, 휴게시간, 주당 소정근로시간을 알려 주실 수 있을까요?' },
  '03': { topic: '근무장소', subj: '근무장소가', ask: '실제로 근무하게 될 장소(주소)와 재택·출장 여부를 알려 주실 수 있을까요?' },
  '04': { topic: '담당업무', subj: '담당업무가', ask: '입사 후 맡게 될 업무 내용과 범위를 구체적으로 알려 주실 수 있을까요?' },
  '05': { topic: '고용형태', subj: '고용형태가', ask: '정규직·기간제 등 어떤 형태의 근로계약으로 채용되는지 알려 주실 수 있을까요?' },
  '06': { topic: '계약기간', subj: '계약기간이', ask: '근로계약에 기간이 정해져 있는지, 있다면 시작일과 종료일을 알려 주실 수 있을까요?' },
  '07': { topic: '수습기간', subj: '수습기간이', ask: '수습기간이 있는지, 있다면 기간이 어떻게 되는지 알려 주실 수 있을까요?' },
  '08': { topic: '수습 기간 중 급여', subj: '수습 기간 중 급여가', ask: '수습 기간 중 급여가 어떻게 지급되는지(정규 급여와 같은지, 다르다면 어떻게 정해지는지) 알려 주실 수 있을까요?' },
  '09': { topic: '휴일', subj: '휴일이', ask: '주휴일 등 쉬는 날이 어떻게 정해지는지와 유급 여부를 알려 주실 수 있을까요?' },
  '10': { topic: '연차 유급휴가', subj: '연차 유급휴가가', ask: '연차 유급휴가가 어떻게 부여되는지(대상, 일수, 산정방법)를 알려 주실 수 있을까요?' },
};

export const QUESTION_STATUSES = ['MAIN_PARTIAL', 'MAIN_MISSING'];

// topic: 분석 결과의 주제 ({ id, visible, status }), docType: 문서 유형
// 반환: 질문 문장 또는 null(질문을 만들지 않는 경우)
export function buildQuestion(topic, docType) {
  if (!topic?.visible || !QUESTION_STATUSES.includes(topic.status)) return null;
  const spec = TOPIC_ASK[topic.id];
  const ref = DOC_REF[docType];
  if (!spec || !ref) return null;
  const lead = topic.status === 'MAIN_MISSING'
    ? `${ref} ${spec.topic}에 관한 내용을 찾지 못해 여쭤봅니다.`
    : `${ref} ${spec.topic}에 관한 내용 중 정해지지 않았거나 일부만 적힌 부분이 있어 여쭤봅니다.`;
  return `안녕하세요. ${lead} ${spec.ask} 감사합니다.`;
}

// ---------- 확인 질문 목록 (결과 화면 '회사에 확인할 질문') ----------
// 질문은 템플릿으로만 만든다 (AI가 쓰지 않음). 사용자는 고치거나 골라서 직접 회사에 보낸다.
// 동일한 조건에는 질문하지 않는다. 앞 문서에 없고 뒤 문서에 처음 등장한 조건은 변경으로 단정하지 않고 적용 여부를 확인한다.

// 한글 받침에 맞춘 조사 ('급여 금액이', '지급일이', '근무장소가')
export function josa(word, pair) {
  const [withBatchim, without] = pair.split('/');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  return `${word}${has ? withBatchim : without}`;
}
const clip = (t, n = 60) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const normalizeQ = (t) => t.replace(/\s+/g, ' ').trim();

// 같은 내용의 질문을 하나로 (공백 차이 무시, 처음 나온 순서 유지)
export function dedupeQuestions(list) {
  const seen = new Set();
  return list.filter((q) => {
    const key = normalizeQ(q.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 비교 결과의 세부 항목 하나 → 질문 문장 (질문이 필요 없으면 null)
// 새로 기재된 조건은 '핵심 조건'에만 기본 질문을 만든다.
// 새로 기재된 지급일·휴게시간 등 세부 정보는 결과에서 보여 주되, 이미 구체적으로 적혔다면 재질문하지 않는다.
// 이는 법적 중요도 순위가 아니라 사용자에게 반복 질문을 줄이려는 제품 정책이다.
const NEW_CORE_FACETS = new Set(['01-a', '02-a', '03-a', '04-a', '05-a', '06-a', '06-b', '07-a', '07-b', '08-a']);
const INCOMPLETE_STATUSES = new Set(['PARTIAL', 'UNCLEAR']);

// 처음 등장한 핵심 조건: 이미 구체적으로 기재됐다면 적용 여부, '별도 협의'라면 구체적인 내용을 질문한다.
function newlyStatedCoreQuestion(f, L, b) {
  if (!NEW_CORE_FACETS.has(f.id) || f.a.status !== 'MISSING' || !b) return null;
  if (INCOMPLETE_STATUSES.has(f.b.status))
    return `${L.A}에는 ${f.label}에 관한 내용이 없고 ${L.B}에는 ‘${b}’라고 적혀 있습니다. 구체적인 ${josa(f.label, '을/를')} 알려 주실 수 있을까요?`;
  if (f.b.status === 'CONFIRMED')
    return `${L.A}에서는 ${f.label}에 관한 내용을 찾지 못했지만 ${L.B}에는 ‘${b}’라고 적혀 있습니다. 이 조건이 실제로 적용되는지 확인 부탁드립니다.`;
  return null; // 분석 확인 불가 등은 회사에 확인할 문제로 단정하지 않음
}

// A: 앞 단계 문서, B: 뒤 단계 문서. 같은 조건은 질문하지 않되, 새롭게 기재된 핵심 조건의 구체성을 확인한다.
function compareSentence(f, L, isCoreFacet, item) {
  // 원문 기재값이 없으면 첫 인용 줄을 짧게 보여 준다 (문서에 없는 값을 만들지 않음)
  const a = clip(f.a.value ?? f.a.evidence?.[0]?.text); const b = clip(f.b.value ?? f.b.evidence?.[0]?.text);
  const subj = josa(f.label, '이/가');
  switch (f.state) {
    case 'changed':
      return `${subj} 문서마다 다르게 적혀 있습니다(${L.A}: ${a || '해당 없음'} / ${L.B}: ${b || '해당 없음'}). 최종적으로 적용되는 ${josa(f.label, '을/를')} 확인 부탁드립니다.`;
    case 'missing_one':
      if (INCOMPLETE_STATUSES.has(f.a.status) && a)
        return `${L.A}에는 ${f.label}이 ‘${a}’라고 적혀 있지만 구체적으로 정해졌는지 확인하기 어렵고, ${L.B}에서는 관련 내용을 찾지 못했습니다. 현재 적용되는 ${josa(f.label, '을/를')} 구체적으로 알려 주실 수 있을까요?`;
      return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
    case 'added':
      // 새로 기재된 내용은 변경이나 위반이라고 단정하지 않는다. 세부 정보가 확정되지 않았으면 구체적으로 묻는다.
      return newlyStatedCoreQuestion(f, L, b);
    case 'not_comparable':
      // 간략한 오퍼에 없다는 이유만으로 조건이 삭제·변경됐다고 단정하지 않는다.
      if (f.b.status === 'MISSING' && a) {
        if (INCOMPLETE_STATUSES.has(f.a.status))
          return `${L.A}에는 ${f.label}이 ‘${a}’라고 적혀 있지만 구체적으로 정해졌는지 확인하기 어렵고, ${L.B}에서는 관련 내용을 찾지 못했습니다. 현재 적용되는 ${josa(f.label, '을/를')} 구체적으로 알려 주실 수 있을까요?`;
        return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
      }
      return newlyStatedCoreQuestion(f, L, b);
    case 'unclear':
      if (f.b.status === 'PARTIAL' || f.b.status === 'UNCLEAR') return `${L.B}의 ${subj} 구체적으로 정해지지 않은 것으로 보여 여쭤봅니다(${L.B}: ${b}). 구체적인 ${josa(f.label, '을/를')} 알려 주실 수 있을까요?`;
      if (f.a.status === 'CONFIRMED' && f.b.status === 'CONFIRMED') return `${subj} 문서마다 다르게 표현되어 있습니다(${L.A}: ${a} / ${L.B}: ${b}). 같은 조건인지 확인 부탁드립니다.`;
      return null; // 앞 문서만 모호하고 뒤 문서에 구체적으로 적힌 경우
    case 'both_missing':
      return isCoreFacet ? `두 문서 모두에서 ${item.label}에 관한 내용을 찾지 못했습니다. ${TOPIC_ASK[item.id]?.ask ?? ''}`.trim() : null;
    default:
      return null; // 동일·해당 없음·분석 확인 불가(분석 문제이지 문서 내용이 아님)
  }
}

// comparison: /api/compare 결과. 반환: [{ id, itemId, label, text }] (항목마다 하나, 중복 제거)
export function buildCompareQuestions(comparison) {
  const L = { A: comparison.docs[0].docTypeLabel, B: comparison.docs[1].docTypeLabel };
  const out = comparison.items.map((item) => {
    const sentences = [...new Set(item.facets.map((f, i) => compareSentence(f, L, i === 0, item)).filter(Boolean))];
    if (!sentences.length) return null;
    return { id: `q-${item.id}`, itemId: item.id, label: item.label, text: `안녕하세요. ${item.label} 관련해 여쭤봅니다. ${sentences.join(' ')} 감사합니다.` };
  }).filter(Boolean);
  return dedupeQuestions(out);
}

// 근로계약서 핵심 기준이 확인돼도, 일부 세부 조건에 대한 확인 질문은 유용할 수 있다.
// 먼저 지급방법(법령 관련 기재항목)·지급일(공식 서식)·휴게시간(계약 유형에 따라 법령/공식서식 참고)만 적용한다.
// 모든 누락된 추가 기준을 자동 질문하면 사용자에게 불필요한 질문이 쌓일 수 있어 제한한다.
const DETAIL_FOLLOWUPS = {
  '01': { '01-e': '급여 지급방법', '01-f': '급여 지급일' },
  '02': { '02-c': '휴게시간' },
};
const DETAIL_NEEDS_CHECK = new Set(['MISSING', 'PARTIAL', 'UNCLEAR']);

function buildContractDetailQuestion(topic, docType) {
  if (docType !== 'contract' || !topic?.visible || topic.status !== 'MAIN_FOUND') return null;
  const candidates = DETAIL_FOLLOWUPS[topic.id];
  if (!candidates || !Array.isArray(topic.criteria)) return null;
  const names = topic.criteria
    .filter((c) => c.role === 'D' && DETAIL_NEEDS_CHECK.has(c.status) && candidates[c.id])
    .map((c) => candidates[c.id]);
  if (!names.length) return null;
  return `안녕하세요. 근로계약서의 ${names.join('·')}에 대해 추가로 확인하고 싶습니다. 해당 조건을 구체적으로 알려 주실 수 있을까요? 감사합니다.`;
}

// 근로계약서 단독 확인 결과 → 질문 목록 (핵심 상태 우선, 기재됨 중 선택적 세부기준만 후속 질문)
export function buildContractQuestions(result) {
  const out = (result?.topics ?? []).map((t) => {
    const text = buildQuestion(t, result.docType) ?? buildContractDetailQuestion(t, result.docType);
    return text ? { id: `q-${t.id}`, itemId: t.id, label: t.label, text } : null;
  }).filter(Boolean);
  return dedupeQuestions(out);
}

// 클립보드 복사: Clipboard API를 먼저 쓰고, 안 되면 임시 입력란 선택 후 복사 명령을 쓴다.
// 성공하면 true, 둘 다 실패하면 false (브라우저 전용)
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 권한·보안 컨텍스트 문제면 아래 방법으로 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
