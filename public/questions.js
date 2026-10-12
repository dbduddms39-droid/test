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
// 문서에서 이미 명확하게 확인되는 조건(동일, 뒤 문서에 구체적으로 새로 적힘)에는 질문하지 않는다.

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
// A: 앞 단계 문서, B: 뒤 단계 문서. 뒤 문서가 실제로 적용될 조건에 더 가깝다고 보고, 뒤 문서가 명확하면 묻지 않는다.
function compareSentence(f, L, isCoreFacet, item) {
  // 원문 기재값이 없으면 첫 인용 줄을 짧게 보여 준다 (문서에 없는 값을 만들지 않음)
  const a = clip(f.a.value ?? f.a.evidence?.[0]?.text); const b = clip(f.b.value ?? f.b.evidence?.[0]?.text);
  const subj = josa(f.label, '이/가');
  switch (f.state) {
    case 'changed':
      return `${subj} 문서마다 다르게 적혀 있습니다(${L.A}: ${a || '해당 없음'} / ${L.B}: ${b || '해당 없음'}). 최종적으로 적용되는 ${josa(f.label, '을/를')} 확인 부탁드립니다.`;
    case 'missing_one':
      return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
    case 'not_comparable':
      // 간략한 오퍼에 없는 경우: 뒤 문서(B)가 비어 있을 때만 묻는다. 앞 문서만 비어 있고 뒤 문서에 적혀 있으면 묻지 않는다.
      if (f.b.status === 'MISSING' && a) return `${L.B}에서 ${f.label}에 관한 내용을 찾지 못했습니다. ${L.A}에 적힌 조건(${a})이 그대로 적용되는지 확인 부탁드립니다.`;
      return null;
    case 'unclear':
      if (f.b.status === 'PARTIAL' || f.b.status === 'UNCLEAR') return `${L.B}의 ${subj} 구체적으로 정해지지 않은 것으로 보여 여쭤봅니다(${L.B}: ${b}). 구체적인 ${josa(f.label, '을/를')} 알려 주실 수 있을까요?`;
      if (f.a.status === 'CONFIRMED' && f.b.status === 'CONFIRMED') return `${subj} 문서마다 다르게 표현되어 있습니다(${L.A}: ${a} / ${L.B}: ${b}). 같은 조건인지 확인 부탁드립니다.`;
      return null; // 앞 문서만 모호하고 뒤 문서에 구체적으로 적힌 경우
    case 'both_missing':
      return isCoreFacet ? `두 문서 모두에서 ${item.label}에 관한 내용을 찾지 못했습니다. ${TOPIC_ASK[item.id]?.ask ?? ''}`.trim() : null;
    default:
      return null; // 동일·새로 추가·해당 없음·분석 확인 불가(분석 문제이지 문서 내용이 아님)
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

// 근로계약서 단독 확인 결과 → 질문 목록 (기존 주제별 질문 템플릿을 그대로 쓰고 중복 제거)
export function buildContractQuestions(result) {
  const out = (result?.topics ?? []).map((t) => {
    const text = buildQuestion(t, result.docType);
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
