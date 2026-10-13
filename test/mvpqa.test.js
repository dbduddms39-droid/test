// MVP 통합 QA(PC·모바일) 회귀 테스트: 계산값 구분, 요약 값의 원문 목차 제거, 같은 연봉과 추가 세부 조건 구분, 체험용 ZIP.
// 모의 AI 응답(test/gemini-qa-docs.js, 사람이 작성)이며 실제 Gemini 결과가 아니다. 동결 기준표 판정은 바꾸지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildFollowUps, weeklyCalc } from '../public/followups.js';
import { relateRecord, displayValue } from '../public/relate.js';
import { buildZip, crc32 } from '../public/samples.js';
import { buildExtraction } from './v22-fixtures.js';
import { GQ_POSTING, GQ_POSTING_SPECS, QA2_CONTRACT, QA2_CONTRACT_SPECS, QA2_OFFER, QA2_OFFER_SPECS } from './gemini-qa-docs.js';

const ai = (text, specs) => ({
  name: 'scripted',
  async analyze({ criterionIds }) {
    const all = buildExtraction(segmentText(text), specs, CRITERION_IDS);
    return { criteria: all.criteria.filter((c) => criterionIds.includes(c.id)) };
  },
});
let n = 0;
const doc = async (docType, text, specs) => ({ id: `m${n += 1}`, docType, analysis: await analyzeDocument({ text, docType, ai: ai(text, specs), withCriteria: true }) });
const topic = (d, id) => d.analysis.topics.find((t) => t.id === id);
const swap = (text, specs, from, to) => [text.split(from).join(to), JSON.parse(JSON.stringify(specs).split(from).join(to))];

test('계산값: 근무일 월~금 + 10:00~19:00 + 휴게 13:00~14:00 → 주 40시간(계산값), 판정은 기준표 그대로(일부 확인), 질문 없음', async () => {
  const c = await doc('contract', QA2_CONTRACT, QA2_CONTRACT_SPECS);
  const t02 = topic(c, '02');
  assert.equal(t02.status, 'MAIN_PARTIAL', '원문에 주 N시간이 직접 없으므로 동결 기준표 판정은 그대로');
  assert.equal(t02.criteria.find((x) => x.id === '02-a').boundary, 'hours_not_quoted');
  assert.deepEqual(weeklyCalc(t02), { hours: 40, source: 'display_calc', text: '주 40시간', days: 5, work: '10:00~19:00', breakMinutes: 60 });
  const f = buildFollowUps({ documents: [c] });
  assert.ok(![...f.primary, ...f.more].some((x) => x.topicIds.includes('02')), '계산으로 확인한 근무시간은 질문하지 않는다');
});

test('계산값: 근거가 부족하거나 서로 충돌하면 계산하지 않는다 (추론 없음)', async () => {
  // 근무일 없음
  const noDays = { ...QA2_CONTRACT_SPECS, '02-a': { f: 'specific', q: ['근무시간: 10:00~19:00'], kind: 'quoted' }, '02-d': { f: 'absent', q: [] } };
  assert.equal(weeklyCalc(topic(await doc('contract', QA2_CONTRACT, noDays), '02')), null);
  // 휴게시간 없음 (휴게를 가정하지 않음)
  const noBreak = { ...QA2_CONTRACT_SPECS, '02-c': { f: 'absent', q: [] } };
  assert.equal(weeklyCalc(topic(await doc('contract', QA2_CONTRACT, noBreak), '02')), null);
  // 근무일 표기가 서로 다름 (월~금 vs 주 6일)
  const [t2, s2] = swap(QA2_CONTRACT, QA2_CONTRACT_SPECS, '근무일: 월요일~금요일', '근무일: 월요일~금요일 (주 6일)');
  assert.equal(weeklyCalc(topic(await doc('contract', t2, s2), '02')), null);
  // 휴게가 근무시간 밖
  const [t3, s3] = swap(QA2_CONTRACT, QA2_CONTRACT_SPECS, '13:00~14:00', '20:00~21:00');
  assert.equal(weeklyCalc(topic(await doc('contract', t3, s3), '02')), null);
  // 원문에 주 40시간이 직접 적힘 → 계산하지 않음(원문 기재값)
  const [t4, s4] = swap(QA2_CONTRACT, QA2_CONTRACT_SPECS, '근무일: 월요일~금요일', '근무일: 월요일~금요일, 주 40시간');
  const direct = await doc('contract', t4, { ...s4, '02-a': { f: 'specific', q: ['근무일: 월요일~금요일, 주 40시간'], sv: '주 40시간', kind: 'quoted' } });
  assert.equal(topic(direct, '02').criteria.find((x) => x.id === '02-a').status, 'CONFIRMED');
  assert.equal(weeklyCalc(topic(direct, '02')), null);
});

test('요약 값: 원문 목차·항목명(번호 + 항목명, 콜론 없음)을 빼고 실제 값만, 원문 근거는 그대로', async () => {
  const c = await doc('contract', QA2_CONTRACT, QA2_CONTRACT_SPECS);
  const rel = relateRecord([{ ...c }, { ...(await doc('offer', QA2_OFFER, QA2_OFFER_SPECS)) }]);
  const side = (item, facet) => rel.items.find((i) => i.id === item).facets.find((f) => f.id === facet).sides.find((s) => s.docId === c.id);
  assert.equal(side('03', '03-a').display, '서울 성동구 성수동 본사');
  assert.equal(side('04', '04-a').display, '브랜드 공식 SNS 채널 운영 및 SNS 콘텐츠 기획·제작 일정 관리');
  assert.equal(side('07', '07-b').display, '입사 후 3개월');
  assert.doesNotMatch(side('07', '07-a').display, /^7\.|및 수습 중 임금/, "항목명만 있는 줄('7. 수습기간 및 수습 중 임금')은 값으로 쓰지 않는다");
  assert.equal(side('03', '03-a').evidence[0].text, '2. 근무장소 서울 성동구 성수동 본사', '원문 근거는 목차·항목명을 그대로 유지');
  // 번호 없는 문장 앞부분은 항목명으로 보고 지우지 않는다
  assert.equal(displayValue({ id: '04-a', kind: 'text' }, { kind: 'present', value: null, evidence: [{ text: '업무 범위는 협의 후 정합니다' }] }), '업무 범위는 협의 후 정합니다');
});

test('같은 연봉 + 추가 세부 조건: 3,600만 원 = 36,000,000원은 같은 금액, 월 지급 기준액·지급일은 추가로 구분', async () => {
  const o = await doc('offer', QA2_OFFER, QA2_OFFER_SPECS);
  const c = await doc('contract', QA2_CONTRACT, QA2_CONTRACT_SPECS);
  const rel = relateRecord([o, c]);
  const i01 = rel.items.find((i) => i.id === '01');
  assert.equal(i01.facets[0].relation, 'same', '연봉 3,600만 원 = 36,000,000원');
  assert.equal(i01.relation, 'same', '임금 전체를 \'새롭게 적힘\'으로 보지 않는다');
  assert.equal(i01.addedNote, "연봉은 동일하며, 근로계약서에 '월 지급 기준액 3,000,000원(세전)', 지급일(매월 25일)이 추가로 기재되어 있어요.");
  for (const frag of ['월 지급 기준액 3,000,000원(세전)', '매월 25일']) assert.ok(QA2_CONTRACT.includes(frag), `원문에 있는 조각만: ${frag}`);
  const f = buildFollowUps({ documents: [o, c] });
  assert.ok(!f.summary.different.some((x) => x.topicId === '01'));
  assert.ok(![...f.primary, ...f.more].some((x) => x.topicIds.includes('01')), '같은 금액이면 임금 질문 없음');
});

test('임금 차이 유지: 공고 연봉 3,400만 원 ↔ 계약서 36,000,000원 → 서로 다른 안내 + 질문 (\'임금\' 용어)', async () => {
  const f = buildFollowUps({ documents: [await doc('job_posting', GQ_POSTING, GQ_POSTING_SPECS), await doc('contract', QA2_CONTRACT, QA2_CONTRACT_SPECS)] });
  assert.ok(f.summary.different.some((x) => x.topicId === '01'));
  const q = [...f.primary, ...f.more].find((x) => x.topicIds.includes('01')).question;
  assert.match(q, /^채용공고에는 임금이 연봉 3,400만 원, 근로계약서에는 연봉 36,000,000원\(세전\)/);
  assert.match(q, /실제 적용되는 임금을 확인 부탁드립니다\.$/);
});

test('체험용 전체 다운로드 ZIP: 표준 도구(파이썬 zipfile)로 열리고 이름·내용·CRC가 같다', () => {
  const enc = new TextEncoder();
  const files = [
    { name: '일단확인_가상문서_1_채용공고.pdf', bytes: enc.encode('%PDF-1.4 가상 채용공고') },
    { name: '일단확인_가상문서_2_처우·근로조건안내(메일).pdf', bytes: enc.encode('%PDF-1.4 가상 처우 안내') },
    { name: '일단확인_가상문서_3_근로계약서.pdf', bytes: new Uint8Array([0, 1, 2, 255, 254]) },
  ];
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926, 'CRC-32 표준 검사값');
  const dir = mkdtempSync(join(tmpdir(), 'ildan-zip-'));
  const p = join(dir, 'a.zip');
  writeFileSync(p, buildZip(files));
  const out = JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([[i.filename, list(z.read(i))] for i in z.infolist()]))', p]).toString());
  assert.deepEqual(out.map((x) => x[0]), files.map((f) => f.name));
  out.forEach(([, bytes], k) => assert.deepEqual(bytes, [...files[k].bytes]));
});
