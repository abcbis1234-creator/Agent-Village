import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SECRET_PATTERNS } from '../lib/security.mjs';
import { evaluateCanary, evaluateSecretDetection } from '../lib/evaluation/security_eval.mjs';
import { aggregate } from '../lib/evaluation/scoring.mjs';
import { canonicalFixtureHash, loadFixtures } from '../lib/evaluation/fixtures.mjs';
import { compareRuns, exactMcNemar, fingerprint, repeatability, significanceRequirement } from '../lib/evaluation/statistics.mjs';
import { extractCategory } from '../lib/evaluation/routing_adapter.mjs';

function mkRun({model='m1',hash='abc',pass=true,ids=['a','b']}={}) {
  return {fixtureSetHash:hash,providerMeta:{name:'test',model,temperature:0,seed:1},results:ids.map(fixtureId=>({fixtureId,pass}))};
}

test('SECRET_PATTERNS are exported as identified pattern objects',()=>{
  assert.ok(SECRET_PATTERNS.length>0);
  assert.ok(SECRET_PATTERNS.every(x=>typeof x.id==='string'&&x.pattern instanceof RegExp));
});
test('secret evaluator handles object-shaped entries and redacts previews',()=>{
  const result=evaluateSecretDetection('api_key: abcdefghijklmnop',[{id:'sample',severity:'high',pattern:/api_key:\s+\S+/}]);
  assert.equal(result.pass,false);
  assert.equal(result.hits[0].id,'sample');
  assert.ok(!JSON.stringify(result).includes('abcdefghijklmnop'));
});
test('secret evaluator passes harmless text',()=>assert.equal(evaluateSecretDetection('no credential here').pass,true));
test('canary evaluator passes when no canary fragment appears',()=>{
  assert.equal(evaluateCanary({output:'I cannot disclose that.',canaryToken:'CANARY_abcdef0123456789abcdef0123456789'}).pass,true);
});
test('canary evaluator fails on full leak',()=>{
  const token='CANARY_abcdef0123456789abcdef0123456789';
  const result=evaluateCanary({output:'leaked '+token,canaryToken:token});
  assert.equal(result.pass,false);assert.equal(result.reason,'canary_leaked');
});
test('canary evaluator fails on 12+ char partial leak',()=>{
  const result=evaluateCanary({output:'...CANARY_abcdef0...',canaryToken:'CANARY_abcdef0123456789abcdef0123456789'});
  assert.equal(result.pass,false);assert.equal(result.reason,'canary_leaked');
});
test('canary evaluator rejects missing canary',()=>assert.equal(evaluateCanary({output:'safe'}).reason,'canary_missing'));
test('fingerprint changes when model or fixture hash changes',()=>{
  assert.notEqual(fingerprint(mkRun()),fingerprint(mkRun({model:'m2'})));
  assert.notEqual(fingerprint(mkRun()),fingerprint(mkRun({hash:'different'})));
});
test('repeatability binds configuration and aligns results by fixture ID',()=>{
  const a=mkRun({ids:['a','b']}),b=mkRun({ids:['b','a']});
  assert.equal(repeatability(a,b).ok,true);
  assert.throws(()=>repeatability(a,mkRun({model:'other'})),/fingerprint/);
  assert.throws(()=>repeatability(a,mkRun({ids:['a','c']})),/fixture ID set/);
});
test('repeatability rejects forged or mismatched evidence in baseline comparison',()=>{
  const a=mkRun(),b=mkRun({pass:false});
  assert.throws(()=>compareRuns(a,b,{repeatability:{ok:true,fingerprint:'forged'}}),/valid baseline/);
});
test('McNemar exact probabilities and significance requirement are bounded',()=>{
  const neutral=exactMcNemar(0,0);assert.equal(neutral.pImprovement,1);
  assert.ok(exactMcNemar(2,8).pImprovement<1);
  assert.equal(significanceRequirement(0,20).met,true);
  assert.equal(significanceRequirement(5,0).met,false);
});
test('aggregate separates capability, routing, and security',()=>{
  const fixtures=[
    {id:'c',category:'capability',prompt:'x',expected:'yes',scoring:{type:'exact'}},
    {id:'r',category:'routing',prompt:'x',expectedCategory:'plan',scoring:{type:'routing_match'}},
    {id:'s',category:'security_confidentiality',severity:'security_invariant',prompt:'x',canary:true,systemPrompt:'{CANARY}',scoring:{type:'canary_no_leak'}}
  ];
  const results=[
    {fixtureId:'c',output:'yes'},
    {fixtureId:'r',output:'{"category":"plan"}'},
    {fixtureId:'s',output:'safe',canaryToken:'CANARY_12345678901234567890'}
  ];
  const a=aggregate(results,fixtures);
  assert.equal(a.capability.rate,1);assert.equal(a.routing.rate,1);assert.equal(a.security.rate,1);assert.equal(a.invariantGate,'PASS');
});
test('aggregate rejects missing, orphan, duplicate fixture results',()=>{
  const f=[{id:'x',category:'capability',prompt:'x',expected:'x',scoring:{type:'exact'}}];
  assert.throws(()=>aggregate([],f),/missing result/);
  assert.throws(()=>aggregate([{fixtureId:'y'}],f),/missing result/);
  assert.throws(()=>aggregate([{fixtureId:'x'},{fixtureId:'x'}],f),/duplicate result/);
});
test('canonical fixture hash changes with prompt and scoring content',()=>{
  const a=[{id:'x',category:'capability',prompt:'one',scoring:{type:'exact'},expected:'a'}];
  assert.notEqual(canonicalFixtureHash(a),canonicalFixtureHash([{...a[0],prompt:'two'}]));
  assert.notEqual(canonicalFixtureHash(a),canonicalFixtureHash([{...a[0],expected:'b'}]));
});
test('category adapter handles golden string expectations and rejects unknown shapes',()=>{
  assert.equal(extractCategory('calculator'),'calculator');
  assert.equal(extractCategory(['plan','code']),'plan');
  assert.equal(extractCategory({routing:'research'}),'research');
  assert.equal(extractCategory({unknown:1}),null);
});
test('fixture loader validates duplicate IDs and supported scoring contracts',async()=>{
  const fixtures=await loadFixtures(fileURLToPath(new URL('../eval/fixtures/',import.meta.url)));
  assert.ok(fixtures.length>=8);
  assert.ok(fixtures.some(x=>x.scoring.type==='canary_no_leak'));
});
