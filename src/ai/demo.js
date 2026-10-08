// 데모 분석기: API 키 없이 전체 흐름을 확인하기 위한 키워드 규칙 기반 분석기.
// AI가 아니며 정확도가 낮다. AI와 같은 응답 형식을 돌려주므로 동일한 검증을 거친다.

const RULES = {
  salary: /(급여|임금|연봉|월급|시급|월\s*\d|만\s*원|기본급|보수)/,
  work_hours: /(근무\s*시간|근로\s*시간|출근|퇴근|\d{1,2}\s*[:시]\s*\d{0,2}\s*[~-]|주\s*\d+\s*(일|시간)|교대|주\s*5일)/,
  workplace: /(근무\s*(장소|지|처)|근무지|사업장|소재지|재택|본사|지점|[가-힣]+(시|구)\s)/,
  duties: /(담당\s*업무|업무\s*내용|주요\s*업무|직무|업무\s*:)/,
  employment_type: /(정규직|계약직|기간제|인턴(?!\s*경험|\s*경력)|파견|고용\s*형태|채용\s*형태|근무\s*형태)/,
  contract_period: /(계약\s*기간|근로\s*계약\s*기간|\d{4}[.\-/년]\s*\d{1,2}.*[~-].*\d{4}|개월\s*계약)/,
  probation_period: /(수습|시용)/,
  probation_pay: /수습.*(급여|임금|\d+\s*%|만\s*원)|(급여|임금).*수습/,
};
const VAGUE = /(협의|내규|추후|면접\s*후|경력에\s*따라|별도\s*안내|추후\s*결정|회사\s*규정)/;
const NO_PROBATION = /수습\s*(기간)?\s*[:：]?\s*(없음|해당\s*없음|미적용|없습니다)/;

export function createDemoAnalyzer() {
  return {
    name: 'demo',
    async analyze({ segments, itemIds }) {
      return { items: itemIds.map((id) => judge(id, segments)) };
    },
  };
}

function judge(id, segments) {
  const hits = segments.filter((s) => RULES[id].test(s.text));
  // 라벨만 있고 값이 다음 줄로 갈라진 경우 다음 줄도 근거에 포함
  const ids = new Set();
  for (const h of hits) {
    ids.add(h.id);
    if (/^[^\d]{1,12}[:：]?$/.test(h.text) && h.id < segments.length) ids.add(h.id + 1);
  }
  const evidence = [...ids].sort((a, b) => a - b);
  const base = { id, probation_status: null, employment_category: null };
  if (!evidence.length) return { ...base, presence: 'not_found', specificity: null, reason_code: null, evidence_ids: [] };

  const texts = evidence.map((n) => segments[n - 1].text).join(' ');
  const vague = VAGUE.test(texts);
  const out = {
    ...base,
    presence: 'found',
    specificity: vague ? 'vague' : 'specific',
    reason_code: vague ? 'vague_expression' : null,
    evidence_ids: evidence,
  };
  if (id === 'probation_period') {
    out.probation_status = NO_PROBATION.test(texts) ? 'none' : 'applies';
    if (out.probation_status === 'none') Object.assign(out, { specificity: 'specific', reason_code: null });
  }
  if (id === 'employment_type') {
    out.employment_category = /정규직/.test(texts) ? 'permanent'
      : /(계약직|기간제)/.test(texts) ? 'fixed_term'
        : /인턴/.test(texts) ? 'intern' : 'other';
  }
  return out;
}
