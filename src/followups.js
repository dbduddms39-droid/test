// '추가로 확인해 보세요' 목록을 항목의 검증된 원문 근거에 맞춰 정한다.
// - 근거 원문에 이미 적힌 사실은 다시 묻지 않는다 (예: '10:00 ~ 19:00'이 있으면 출퇴근 시각을 묻지 않음).
// - 일부만 적혀 있으면 빠진 부분만 묻는다 (예: '기본급 및 고정수당 포함' → '기본급·고정수당 각각의 금액').
// - 근거가 없거나(찾지 못함·분석 확인 불가) 적혔는지 확실하지 않으면 기본 목록을 그대로 둔다.
// 판단에는 그 항목의 근거 줄만 쓴다 (다른 항목의 문장, 예를 들어 수습 중 급여의 '(세전)'을 연봉에 적용하지 않음).
// 새 조건을 만들지 않으며, 문구에 넣는 낱말도 근거 원문에 있는 것만 쓴다.

const TIME_RANGE = /\d{1,2}\s*[:시]\s*\d{0,2}\s*분?\s*(~|∼|〜|-|–|부터)\s*\d{1,2}\s*[:시]/;
const AMOUNT = /\d[\d,.]*\s*(만\s*)?원|\d+(\.\d+)?\s*%/;
const DATE = /\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/;

// 임금 구성 요소로 근거에 적힌 낱말 (적힌 그대로 문구에 쓴다)
const COMPONENT = /기본급|고정\s*수당|[가-힣]{1,6}수당|식대|상여금?|성과급/g;

// 항목별 기본 질문과 판단. 판단 함수는 근거 원문(t)을 보고 null(이미 적혀 있어 묻지 않음) 또는 보여 줄 문구를 돌려준다.
const RULES = {
  salary: [
    ['세전 금액인지 세후 금액인지', (t) => (/세전|세후|실수령|공제\s*전|공제\s*후/.test(t) ? null : undefined)],
    ['기본급과 각종 수당(식대·연장근로수당 등)의 구성', (t) => {
      const parts = [...new Set((t.match(COMPONENT) ?? []).map((p) => p.replace(/\s+/g, '')))];
      // 구성 요소마다 금액이 적혀 있으면 이미 확인된 것 (예: '기본급 2,400,000원, 식대 200,000원')
      const priced = parts.filter((p) => new RegExp(`${p.split('').join('\\s*')}\\s*[:：]?\\s*(월\\s*)?\\d`).test(t));
      if (parts.length >= 2 && priced.length === parts.length) return null;
      if (parts.length >= 2) return `${parts.join('·')} 각각의 금액`;
      return undefined;
    }],
    ['지급일과 지급 방법', (t) => {
      const day = /지급일|급여일|매월\s*\d{1,2}\s*일|\d{1,2}\s*일\s*(에\s*)?지급|말일/.test(t);
      const how = /계좌|이체|현금|통장/.test(t);
      if (day && how) return null;
      if (day) return '지급 방법';
      if (how) return '지급일';
      return undefined;
    }],
  ],
  work_hours: [
    ['출퇴근 시각과 휴게시간', (t) => {
      const times = TIME_RANGE.test(t);
      const rest = /휴게|휴식|점심\s*시간/.test(t);
      if (times && rest) return null;
      if (times) return '휴게시간';
      if (rest) return '출퇴근 시각';
      return undefined;
    }],
    ['주당 근무일수', (t) => (/주\s*\d\s*일|주\s*\d+\s*시간|월\s*[~∼〜\-–]\s*금|평일|격일|[월화수목금토일](\s*[,·]\s*[월화수목금토일]){2,}/.test(t) ? null : undefined)],
    // 연장·야간·휴일 근무는 있다는 말만으로는 처리 방식이 확인되지 않으므로, 처리(수당·가산·없음)까지 적혀 있을 때만 뺀다
    ['연장·야간·휴일 근무가 있는지와 그 처리 방식', (t) => (/(연장|야간|휴일|초과)\s*근무[^\n]*(수당|가산|지급|없음|없습니다)/.test(t) ? null : undefined)],
  ],
  workplace: [
    ['실제 출근할 사업장 주소', (t) => (/[가-힣\d]+(로|길)\s*\d+|\d+\s*번지|[가-힣]+동\s*\d+/.test(t) ? null : undefined)],
    ['재택·파견·출장 근무 여부', (t) => (/재택|원격|파견|출장/.test(t) ? null : undefined)],
    ['근무지가 바뀔 수 있는지', (t) => (/근무지\s*(변경|이동)|전보|순환\s*근무|발령/.test(t) ? null : undefined)],
  ],
  duties: [
    // 담당업무가 '명시됨'이면 업무 내용이 구체적으로 적힌 것이므로 범위는 다시 묻지 않는다
    ['실제로 맡게 될 업무 범위', (t, ctx) => (ctx.status === 'stated' ? null : undefined)],
    ['직무 외 업무가 추가될 수 있는지', () => undefined],
  ],
  employment_type: [
    ['정규직·계약직 등 고용형태', (t, ctx) => (ctx.status === 'stated' && ctx.employmentCategory && ctx.employmentCategory !== 'unclear' ? null : undefined)],
    // 정규직으로 채용되면 전환 조건은 해당하지 않는다
    ['정규직 전환 조건이 있다면 그 기준', (t, ctx) => (ctx.status === 'stated' && ctx.employmentCategory === 'permanent' ? null : undefined)],
  ],
  contract_period: [
    // 기간의 정함이 없는 계약(무기계약)에는 종료일·갱신이 없다
    ['계약 시작일과 종료일', (t) => (/기간의\s*정함이\s*없|무기\s*(근로\s*)?계약|정년까지/.test(t) || new RegExp(`${DATE.source}[^\\n]*(~|∼|〜|-|–|부터)[^\\n]*${DATE.source}`).test(t) ? null : undefined)],
    ['계약 갱신 여부와 기준', (t) => (/기간의\s*정함이\s*없|무기\s*(근로\s*)?계약|정년까지|갱신|재계약/.test(t) ? null : undefined)],
  ],
  probation_period: [
    ['수습 기간의 길이', (t, ctx) => (ctx.probationNone || /수습[^\n]*\d+\s*(개월|주|일)|\d+\s*(개월|주)\s*(간\s*)?수습/.test(t) ? null : undefined)],
    ['수습 종료 후 평가 기준과 결과', (t, ctx) => (ctx.probationNone || /평가\s*(기준|방법|결과)/.test(t) ? null : undefined)],
  ],
  probation_pay: [
    ['수습 기간 중 급여 금액 또는 비율', (t) => (AMOUNT.test(t) || /동일|같은\s*(급여|금액)|100\s*%/.test(t) ? null : undefined)],
    ['수습 종료 후 적용될 급여 기준', (t) => (/수습\s*(종료|후|이후|만료)[^\n]*(\d|동일|같)/.test(t) ? null : undefined)],
  ],
};

export const DEFAULT_FOLLOW_UPS = Object.fromEntries(Object.entries(RULES).map(([id, rules]) => [id, rules.map(([text]) => text)]));

// item 판단에 쓰는 근거 원문. 임금은 수습 기간 중 급여를 말하는 줄을 빼고 본다 (다른 줄이 남을 때만).
function evidenceText(itemId, texts) {
  let lines = texts;
  if (itemId === 'salary') {
    const own = texts.filter((l) => !/수습/.test(l));
    if (own.length) lines = own;
  }
  return lines.join('\n');
}

// ctx: { status, reasonCode, texts(근거 원문 줄), probationNone, employmentCategory }
// 반환: 보여 줄 확인 사항 목록 (없으면 빈 배열)
export function followUpsFor(itemId, ctx) {
  const rules = RULES[itemId];
  // 근거가 있는 판정(명시됨·분명하지 않음)일 때만 근거로 줄인다. 찾지 못함·분석 확인 불가는 기본 목록 그대로.
  // 서로 다른 값이 함께 적힌 경우(conflicting_values)는 어느 쪽이 사실인지 모르므로 줄이지 않는다.
  if (!['stated', 'unclear'].includes(ctx.status) || !ctx.texts?.length || ctx.reasonCode === 'conflicting_values') return rules.map(([text]) => text);
  const t = evidenceText(itemId, ctx.texts);
  const out = [];
  for (const [text, judge] of rules) {
    const r = judge(t, ctx);
    if (r === null) continue; // 이미 근거에 적혀 있음
    out.push(r ?? text);
  }
  return out;
}
