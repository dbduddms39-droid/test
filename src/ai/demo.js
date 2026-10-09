// 데모 분석기: API 키 없이 전체 흐름을 확인하기 위한 키워드 규칙 기반 추출기 (점검 기준 v2.2 응답 형식).
// AI가 아니며 정확도가 낮다. AI와 같은 응답 형식을 돌려주므로 서버의 인용 검증·상태 규칙을 똑같이 거친다.

// 세부기준별로 관련 줄을 찾는 키워드
const LINE = {
  '01-a': /(급여|임금|연봉|월급|시급|시간급|보수|만\s*원)/,
  '01-b': /(연봉|월급|시급|시간급|월\s*보수|월\s*\d|연\s*\d)/,
  '01-c': /(기본급|수당|식대|구성)/,
  '01-d': /(계산|산정|곱하)/,
  '01-e': /(계좌|이체|입금|현금)/,
  '01-f': /(매월\s*\d+\s*일|지급일|말일|\d+\s*일\s*지급)/,
  '01-g': /(세전|세후)/,
  '02-a': /(\d+\s*시간|근무\s*시간|근로\s*시간|\d{1,2}:\d{2}\s*[~\-∼]|주\s*\d+(\.\d+)?\s*일)/,
  '02-b': /\d{1,2}:\d{2}\s*[~\-∼]\s*\d{1,2}:\d{2}/,
  '02-c': /휴게/,
  '02-d': /(근로일|월요일|월·|월~|월\s*[~\-]\s*[목금])/,
  '03-a': /(근무\s*(장소|지)|근무지|취업\s*장소|배치\s*장소|근무할\s*곳|사업장|본사|사무실|오피스|사옥)/,
  '03-b': /(재택|원격|파견|출장)/,
  '03-c': /(근무지\s*변경|장소\s*변경|전보)/,
  '04-a': /(담당\s*업무|업무\s*내용|수행\s*업무|담당\s*직무|맡을\s*일|모집\s*직무|직무)/,
  '04-b': /(그\s*밖의\s*담당|추가\s*업무|부수\s*업무)/,
  '05-a': /(정규직|계약직|기간제|단시간|인턴|고용\s*형태|고용\s*방식|계약\s*(형태|유형))/,
  '05-b': /(정규직\s*전환|전환\s*(조건|논의|평가))/,
  '06-a': /(계약\s*기간|근로계약\s*기간|기간의\s*정함|기간제|계약\s*존속|계약\s*종료)/,
  '06-b': /(\d{4}\s*년.*(부터|~).*(까지|\d{4}\s*년)|계약\s*기간\s*[:：]?\s*\d)/,
  '06-c': /(갱신|재계약)/,
  '07-a': /수습/,
  '07-b': /수습.*(\d+\s*개월|\d+\s*주)/,
  '07-c': /수습.*(평가|전환)/,
  '08-a': /수습.*(급여|임금|보수|%|동일|차감)/,
  '08-b': /(종료\s*후|수습\s*후)\s*.*(월|만\s*원)/,
  '09-a': /(휴일|주휴|휴무)/,
  '09-b': /(유급|무급)/,
  '09-c': /공휴일/,
  '10-a': /(연차|유급\s*휴가)/,
  '10-b': /(연차|유급\s*휴가).*(\d+\s*일|개근)/,
  '10-c': /(연차|휴가).*(신청|사용)/,
};
const UNDECIDED = /(협의|추후|미정|결정|입사\s*(시|후|전)|확정\s*(후|시)|별도\s*안내|안내\s*(예정|합니다|드립니다)|공유|지정)/;
const EXTERNAL = /(내규|규정|법령|관계\s*법)/;
const NEGATED = /(없음|없습니다|미부여|부여하지\s*않|적용하지\s*않|두지\s*않|미적용|미지급)/;

export function createDemoAnalyzer() {
  return {
    name: 'demo',
    async analyze({ segments, criterionIds }) {
      return { criteria: criterionIds.map((id) => extract(id, segments)) };
    },
  };
}

function extract(id, segments) {
  const base = { id, finding: 'absent', quotes: [], source_value: null, term_type: null, value_kind: null, calc: null };
  const hits = segments.filter((s) => LINE[id].test(s.text) && !(id.startsWith('09-') && /주\s*\d+(\.\d+)?\s*일/.test(s.text) && !/(휴일|휴무|주휴)/.test(s.text)));
  if (!hits.length) return base;
  const quotes = hits.slice(0, 2).map((s) => ({ line: s.id, text: s.text }));
  const text = quotes.map((q) => q.text).join(' ');
  let finding = 'specific';
  if (['07-a', '09-a', '10-a', '08-a', '02-c'].includes(id) && NEGATED.test(text)) finding = 'negated';
  else if (UNDECIDED.test(text)) finding = 'undecided';
  else if (EXTERNAL.test(text)) finding = 'coarse';
  if (id === '02-a' && finding === 'specific' && !/\d+\s*시간/.test(text)) finding = 'coarse';
  const out = { ...base, finding, quotes: quotes.slice(0, 1) };
  if (id === '06-a' && finding === 'specific') {
    if (/(기간의\s*정함이\s*없|정하지\s*않)/.test(text)) out.term_type = 'indefinite';
    else out.term_type = 'fixed';
  }
  if (id === '02-a' && finding === 'specific') out.value_kind = 'quoted';
  return out;
}
