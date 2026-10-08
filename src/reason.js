// '분명하지 않음' 항목의 상세 설명을 만든다.
// - 문서에 적힌 사실(fact)과 추가 확인이 필요한 부분(pending)을 나눠서 쓴다.
// - 문장에 인용하는 말은 AI가 고른 문구를 그대로 쓰지 않고, 근거 줄에서 글자 그대로 찾은 원문만 쓴다.
//   근거 줄에 없는 문구는 버리고, 인용할 문구가 없으면 특정 사유('협의', '서로 다른 값' 등)를 말하지 않는 중립 문장을 쓴다.

// 근거 줄에서 인용할 문구를 공백 차이만 무시하고 찾는다. 찾으면 원문 그대로의 문자열, 없으면 null.
const EDGE = /^[\s()[\]{}<>·•*,.:;'"「」『』-]+|[\s()[\]{}<>·•*,.:;'"「」『』-]+$/g;
const MAX_QUOTE = 60;
export function findVerbatim(phrase, texts) {
  if (typeof phrase !== 'string') return null;
  const needle = phrase.replace(/\s+/g, '');
  if (needle.length < 2 || needle.length > MAX_QUOTE) return null;
  for (const text of texts) {
    const pos = []; // 공백을 뺀 글자 → 원문 위치
    let squeezed = '';
    for (let i = 0; i < text.length; i += 1) if (!/\s/.test(text[i])) { pos.push(i); squeezed += text[i]; }
    const at = squeezed.indexOf(needle);
    if (at >= 0) {
      const quote = text.slice(pos[at], pos[at + needle.length - 1] + 1).replace(EDGE, '');
      return quote.replace(/\s+/g, '').length >= 2 ? quote : null;
    }
  }
  return null;
}

// 받침 유무에 따라 조사를 고른다. 판단할 수 없는 글자면 '(이)라고'처럼 함께 적는다.
const DIGIT_BATCHIM = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
export function josa(word, withBatchim, without) {
  const last = word.trim().at(-1) ?? '';
  const code = last.charCodeAt(0);
  let has = null;
  if (code >= 0xac00 && code <= 0xd7a3) has = (code - 0xac00) % 28 !== 0;
  else if (/\d/.test(last)) has = DIGIT_BATCHIM[last];
  if (has === null) return `(${withBatchim.slice(0, withBatchim.length - without.length) || withBatchim})${without}`;
  return has ? withBatchim : without;
}

// 범위로 적힌 값인지 (예: 3000만원 ~ 5,000만원, 2025.3.1 ~ 2025.8.31, 3개월부터 6개월까지)
const isRange = (s) => /\d[^~∼〜]*\s*[~∼〜]\s*\d/.test(s) || /\d\s+-\s+\d/.test(s) || /부터.*까지/.test(s);

// 문서에 적힌 급여 단위를 그대로 쓴다 (없으면 '급여')
export function payNoun(texts) {
  const all = texts.join(' ');
  if (/연봉/.test(all)) return '연봉';
  if (/시급|시간급/.test(all)) return '시급';
  if (/일급/.test(all)) return '일급';
  if (/월급|월\s*\d|월\s*급여/.test(all)) return '월급';
  return '급여';
}

const TOPIC = {
  salary: (texts) => payNoun(texts),
  work_hours: () => '근무시간',
  workplace: () => '근무장소',
  duties: () => '담당업무',
  employment_type: () => '고용형태',
  contract_period: () => '계약기간',
  probation_period: () => '수습기간',
  probation_pay: () => '수습 기간 중 급여',
};

// '추가로 확인해 보세요' 맨 앞에 둘 핵심 확인 사항
const KEY_FOLLOW_UP = {
  salary: (topic) => `실제 적용될 ${topic} 금액`,
  work_hours: () => '실제 적용될 근무시간',
  workplace: () => '실제 근무하게 될 장소',
  duties: () => '실제로 맡게 될 업무 범위',
  employment_type: () => '실제 적용될 고용형태',
  contract_period: () => '실제 적용될 계약기간(시작일과 종료일)',
  probation_period: () => '실제 적용될 수습기간',
  probation_pay: () => '실제 적용될 수습 기간 중 급여 금액',
};

const DOC_LOC = {
  job_posting: '채용공고에',
  offer: '입력한 안내 내용에',
  contract: '근로계약서에',
};

const quoteList = (list) => list.map((q) => `'${q}'`).join(', ');

// result: 검증된 AI 결과 (reason_code, stated_text, unclear_texts), texts: 근거 줄 원문
// 반환: { kind, fact, pending, keyFollowUp }
//   kind: partial(구체 값 + 미확정 부분) | vague | conflicting | candidate | unspecified(인용할 원문 없음)
export function describeUnclear({ itemId, docType, result, texts }) {
  const topic = TOPIC[itemId](texts);
  const loc = DOC_LOC[docType];
  const eun = `${topic}${josa(topic, '은', '는')}`;
  const unresolved = `실제 적용될 ${eun} 이 문서만으로 확인하기 어려워요.`;
  const keyFollowUp = KEY_FOLLOW_UP[itemId](topic);

  const unclear = [...new Set((result.unclear_texts ?? []).map((p) => findVerbatim(p, texts)).filter(Boolean))].slice(0, 3);
  let stated = findVerbatim(result.stated_text, texts);
  if (stated && unclear.some((u) => u.includes(stated) || stated.includes(u))) stated = null; // 같은 문구를 사실과 미확정 양쪽에 쓰지 않음
  const reason = result.reason_code;

  if (reason === 'vague_expression' && stated) {
    const fact = `${loc} '${stated}'${isRange(stated) ? '의 범위가' : josa(stated, '이라고', '라고')} 적혀 있어요.`;
    const pending = unclear.length
      ? `다만 ${quoteList(unclear)}${josa(unclear.at(-1), '이라고', '라고')} 안내되어 있어, ${unresolved}`
      : `다만 ${unresolved}`;
    return { kind: 'partial', fact, pending, keyFollowUp };
  }
  if (reason === 'vague_expression' && unclear.length) {
    return {
      kind: 'vague',
      fact: `${loc} ${topic}에 관한 내용은 있지만, ${quoteList(unclear)}처럼 구체적인 값 대신 정해지지 않은 표현으로 적혀 있어요.`,
      pending: unresolved,
      keyFollowUp,
    };
  }
  if (reason === 'conflicting_values' && unclear.length >= 2) {
    return {
      kind: 'conflicting',
      fact: `${loc} ${quoteList(unclear)}처럼 ${topic}에 관한 서로 다른 내용이 함께 적혀 있어요.`,
      pending: '어느 내용이 실제로 적용되는지 이 문서만으로 확인하기 어려워요.',
      keyFollowUp,
    };
  }
  if (reason === 'candidate_unclear' && unclear.length) {
    return {
      kind: 'candidate',
      fact: `${loc} ${quoteList(unclear)} 같은 내용이 있지만, ${topic}에 관한 내용인지 분명하지 않아요.`,
      pending: unresolved,
      keyFollowUp,
    };
  }
  // 인용할 원문을 확인하지 못한 경우: 특정 사유를 단정하지 않는다
  return {
    kind: 'unspecified',
    fact: `${loc} ${topic}에 관한 내용이 있어요. 아래 원문 근거를 함께 확인해 주세요.`,
    pending: unresolved,
    keyFollowUp,
  };
}
