import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonPair, comparisonView, replaceComparedDocument } from '../public/comparison-selection.js';
import { buildFollowUps } from '../public/followups.js';

const docs = [
  {id:'offer',docType:'offer',analysis:{topics:[],criteria:{}}},
  {id:'contract',docType:'contract',analysis:{topics:[],criteria:{}}},
  {id:'posting',docType:'job_posting',analysis:{topics:[],criteria:{}}},
];
test('3개 문서 중 두 문서만 비교하고 기록의 원본은 보존',()=>{
  const record={id:'abc',alias:'테스트',documents:docs,notes:[]};
  assert.deepEqual(comparisonPair(docs),['offer','contract']);
  const selected=comparisonView(record,['posting','contract']);
  assert.deepEqual(selected.documents.map(d=>d.id),['contract','posting']);
  assert.deepEqual(record.documents.map(d=>d.id),['offer','contract','posting']);
  assert.equal(buildFollowUps(selected).relation.items.every(i=>i.facets.every(f=>f.sides.length===2)),true);
});
test('같은 자료 중복 선택 금지, 바꾼 한쪽만 대체, 분석 안 된 문서 제외',()=>{
  assert.deepEqual(replaceComparedDocument(['offer','contract'],0,'posting',docs),['posting','contract']);
  assert.deepEqual(replaceComparedDocument(['offer','contract'],0,'contract',docs),['offer','contract']);
  const d=[...docs,{id:'failed',docType:'offer',analysis:null}];
  assert.deepEqual(comparisonPair(d,['failed','posting']),['offer','contract']);
  assert.deepEqual(comparisonPair(d,['offer','offer']),['offer','contract']);
});
test('2개 이하의 기존 흐름 보존',()=>{
  const original={documents:docs.slice(0,2)};
  assert.equal(comparisonView(original),original);
  assert.deepEqual(comparisonPair(docs.slice(0,1)),['offer']);
});
