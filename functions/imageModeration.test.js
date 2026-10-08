import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { evaluateSafeSearchResults, detectSafeSearch } from './imageModeration.js';
const clean = { adult: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY' };
for (const changes of [{}, {racy:'VERY_LIKELY'}, {adult:'POSSIBLE',racy:'POSSIBLE'}, {adult:'POSSIBLE',spoof:'VERY_LIKELY'}, {medical:'VERY_LIKELY',racy:'POSSIBLE'}, {adult:'LIKELY',racy:'UNLIKELY'}]) {
 test(`allows non-conclusive signals ${JSON.stringify(changes)}`, () => {
  const result = evaluateSafeSearchResults({...clean,...changes});
  assert.equal(result.status,'allowed');
  assert.equal(result.isSafe,true);
  assert.equal(result.reason,null);
 });
}
for (const changes of [{adult:'VERY_LIKELY'}, {adult:'LIKELY',racy:'LIKELY'}, {adult:5,racy:1,violence:1}]) {
 test(`blocks strong adult signals ${JSON.stringify(changes)}`, () => {
  const result = evaluateSafeSearchResults({...clean,...changes});
  assert.equal(result.status,'blocked');
  assert.equal(result.reason,'adult');
  assert.equal(result.isSafe,false);
 });
}
test('preserves violence policy', () => assert.equal(evaluateSafeSearchResults({...clean,violence:'LIKELY'}).reason,'violence'));
for (const annotation of [null, {}, {...clean,adult:'UNKNOWN'}, {...clean,violence:'invalid'}]) {
 test(`incomplete result is unavailable ${JSON.stringify(annotation)}`, () => {
  assert.equal(evaluateSafeSearchResults(annotation).status,'unavailable');
  assert.equal(evaluateSafeSearchResults(annotation).isSafe,null);
 });
}
// These JPEG colours caused the previous heuristic to reject ordinary images.
for (const [name,rgb] of [['warm beige',[205,145,125]],['dark brown',[38,24,18]],['red',[230,25,25]]]) {
 test(`${name} JPEG reaches semantic analysis`, async () => {
  const data = Buffer.alloc(64*64*4);
  for(let i=0;i<data.length;i+=4) data.set([...rgb,255],i);
  const image = jpeg.encode({data,width:64,height:64}).data.toString('base64');
  let calls=0;
  const result = await detectSafeSearch(`data:image/jpeg;base64,${image}`, {visionClient:{safeSearchDetection:async ({image:input}) => {
   calls++; assert.equal(input.content,image); return [{safeSearchAnnotation:clean}];
  }}});
  assert.equal(calls,1); assert.equal(result.isSafe,true);
 });
}
test('SDK and REST use identical policy',async () => {
 const annotation = {...clean,racy:'VERY_LIKELY',spoof:'LIKELY'};
 const sdk = await detectSafeSearch('ZmFrZQ==',{visionClient:{safeSearchDetection:async()=>[{safeSearchAnnotation:annotation}]}});
 const rest = await detectSafeSearch('ZmFrZQ==',{apiKey:'test',fetchImpl:async(_,options)=>{
  assert.equal(JSON.parse(options.body).requests[0].features[0].type,'SAFE_SEARCH_DETECTION');
  return {ok:true,json:async()=>({responses:[{safeSearchAnnotation:annotation}]})};
 }});
 assert.deepEqual(rest,sdk);
});
test('REST image error is not safe',async()=>{
 await assert.rejects(detectSafeSearch('ZmFrZQ==',{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({responses:[{error:{code:3}}]})})}));
});
test('missing SDK annotation is unavailable',async()=>{
 const result=await detectSafeSearch('ZmFrZQ==',{visionClient:{safeSearchDetection:async()=>[{}]}});
 assert.equal(result.status,'unavailable');
});
test('network errors propagate',async()=>{
 await assert.rejects(detectSafeSearch('ZmFrZQ==',{visionClient:{safeSearchDetection:async()=>{throw new Error('offline');}}}),/offline/);
});
