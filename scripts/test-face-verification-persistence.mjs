import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const helper=fs.readFileSync('src/utils/faceVerificationState.js','utf8').replaceAll('export ', '');
const service=fs.readFileSync('src/services/firestoreService.js','utf8');
function context(extra={}) {const c=vm.createContext({...extra});vm.runInContext(helper+'\nglobalThis.preserve=withServerFaceVerification;',c);return c;}
test('general edits preserve server verification and reject stale or forged client values',()=>{
 const c=context();const server={isFaceVerified:true,faceVerifiedAt:123,faceMatchScore:98,faceVerificationStatus:'verified'};
 const result=c.preserve({name:'Edited',isFaceVerified:false,faceMatchScore:0},server);
 assert.equal(result.name,'Edited');for(const key in server)assert.equal(result[key],server[key]);
 for(const serverProfile of [{},{isFaceVerified:false,faceVerificationStatus:'unverified'}]){
  const unverified=c.preserve({isFaceVerified:true,faceMatchScore:99,faceVerifiedAt:1},serverProfile);
  assert.notEqual(unverified.isFaceVerified,true);assert.equal(unverified.faceMatchScore,undefined);
 }
});
test('profile replacement preserves a verification completed after its initial read',async()=>{
 const records={users:{id:'owner',name:'Old',isFaceVerified:true,faceVerifiedAt:123,faceMatchScore:98,faceVerificationStatus:'verified'},profiles:{id:'owner',name:'Old',isFaceVerified:true}};
 const c=context({console,Number,Date,requireFirebase:()=>({db:{},auth:{}}),doc:(_db,collection)=>collection,
 getProfileDocFresh:async()=>({exists:()=>true,data:()=>({id:'owner',name:'Old',isFaceVerified:false})}),
 normalizeProfileRecord:(id,data)=>({id,...data}),mergeProfileInput:(a,b)=>({...a,...b}),getOrCreateEncryptionIdentity:async()=>({}),
 withIdentityDevice:v=>v,sanitizeProfileForFirestore:(_id,v)=>v,serverTimestamp:()=>456,sanitizeMeetup:v=>v,
 privateProfileFields:['name'],legacyPrivateProfileFields:[],toPublicProfile:(_id,v)=>({name:v.name}),withoutUndefined:v=>v,
 runTransaction:async(_db,run)=>run({get:async ref=>({exists:()=>true,data:()=>records[ref]}),set:(ref,data)=>{records[ref]=data;}})});
 const body=service.slice(service.indexOf('export async function createUserProfile('),service.indexOf('export async function updateUserMatchingPreferences(')).replace('export ','');
 vm.runInContext(body+'\nglobalThis.save=createUserProfile;',c);
 const saved=await c.save('owner',{name:'Edited',isFaceVerified:false});
 assert.equal(saved.isFaceVerified,true);assert.equal(records.users.isFaceVerified,true);assert.equal(records.users.faceVerifiedAt,123);
 assert.equal(records.profiles.isFaceVerified,true);assert.equal(records.profiles.name,'Edited');
});
test('reopening reads server verification rather than a stale unverified cache',async()=>{
 const c=context({secureDiscoveryConfigured:()=>false,requireFirebase:()=>({db:{}}),doc:(_db,collection)=>collection,
 normalizeProfileRecord:(id,data)=>({id,...data}),getProfileDocFresh:async()=>({exists:()=>true,data:()=>({isFaceVerified:true})}),
 getProfileDocPreferCache:async()=>({exists:()=>true,data:()=>({isFaceVerified:false})})});
 const body=service.slice(service.indexOf('export async function getUserProfile('),service.indexOf('export async function createUserProfile(')).replace('export ','');
 vm.runInContext(body+'\nglobalThis.load=getUserProfile;',c);assert.equal((await c.load('owner')).isFaceVerified,true);
});
test('status subscription ignores stale cache and pending writes, applies server revocation, and unsubscribes',async()=>{
 let emit,stopped=false;const values=[];
 const c=context({Promise,requireFirebase:()=>({db:{},app:{}}),getAuth:()=>({}),waitForAuthReady:async()=>({uid:'owner'}),
 doc:(_db,col,id)=>col+'/'+id,onSnapshot:(ref,options,callback)=>{assert.equal(ref,'users/owner');emit=callback;return()=>{stopped=true;};}});
 const body=service.slice(service.indexOf('export function subscribeToFaceVerification('),service.indexOf('export async function getUserProfile(')).replace('export ','').replace("import('firebase/auth')","Promise.resolve({getAuth})");
 vm.runInContext(body+'\nglobalThis.subscribe=subscribeToFaceVerification;',c);
 const stop=c.subscribe('owner',value=>values.push(value),assert.fail);await new Promise(r=>setImmediate(r));
 const snapshot=(isFaceVerified,fromCache=false,hasPendingWrites=false)=>({metadata:{fromCache,hasPendingWrites},exists:()=>true,data:()=>({isFaceVerified})});
 emit(snapshot(false,true));emit(snapshot(false,false,true));assert.equal(values.length,0);
 emit(snapshot(true));emit(snapshot(false));assert.deepEqual(values.map(x=>x.isFaceVerified),[true,false]);stop();assert.equal(stopped,true);
});
