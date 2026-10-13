import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyze.js';
import { CRITERION_IDS } from '../src/criteria.js';
import { segmentText } from '../src/segment.js';
import { buildExtraction } from './v22-fixtures.js';
import { QA2_CONTRACT, QA2_CONTRACT_SPECS } from './gemini-qa-docs.js';
import { contractSummaryGroup, summaryEvidence } from '../public/result-presentation.js';
import { weeklyCalc } from '../public/followups.js';

test('QA: 근무시간을 원문 기준으로 계산한 경우 질문 유무와 관계없이 계산값 그룹', async () => {
  const ai = { async analyze({criterionIds}) {
    const extraction = buildExtraction(segmentText(QA2_CONTRACT), QA2_CONTRACT_SPECS, CRITERION_IDS);
    return { criteria: extraction.criteria.filter(c => criterionIds.includes(c.id)) };
  }};
  const analysis = await analyzeDocument({text:QA2_CONTRACT,docType:'contract',ai,withCriteria:true});
  const time = analysis.topics.find(t=>t.id==='02');
  assert.ok(weeklyCalc(time), '근무일·출퇴근 시각·휴게시간이 검증되면 계산 가능해야 함');
  assert.equal(contractSummaryGroup(time, true),'calculated');
  assert.equal(contractSummaryGroup(time, false),'calculated');
  const probation=analysis.topics.find(t=>t.id==='07');
  const quote=summaryEvidence(probation)?.text;
  assert.ok(quote?.includes('입사 후 3개월'), '제목 대신 기간이 적힌 실제 원문 인용을 선택');
  assert.ok(!quote.includes('2027년 2월'), '원문에 없는 산출 종료일을 인용하지 않음');
});

test('QA: 계산 불가·원문 없음·분석 불가에서는 그룹/근거를 꾸미지 않음',()=>{
  assert.equal(contractSummaryGroup(null,true),null);
  assert.equal(contractSummaryGroup({status:'MAIN_UNAVAILABLE'},true),null);
  assert.equal(contractSummaryGroup({status:'MAIN_MISSING',id:'10',criteria:[]},true),'needs');
  assert.equal(summaryEvidence({id:'07',criteria:[]}),null);
});
