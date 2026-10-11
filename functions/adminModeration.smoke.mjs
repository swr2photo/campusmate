import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {moderateReport,mediaObjectKey} from './adminModeration.js';
import {adminConsole} from './adminFunctions.js';
if(!process.argv.includes('--live'))throw new Error('Pass --live for disposable production QA');
const app=initializeApp({projectId:'campusmate-7f1ab'}),db=getFirestore(app),auth=getAuth(app),tag='moderation-qa-'+Date.now(),actor=tag+'-admin',alice=tag+'-alice',bob=tag+'-bob',room=tag+'-room',report=tag+'-report',checks=[];
const r=db.doc('reports/'+report),c=db.doc('conversations/'+room),m=c.collection('messages').doc('reported'),good=c.collection('messages').doc('unrelated');
const revision=s=>`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`;
const call=data=>adminConsole.run({auth:{uid:actor,token:{admin:true,email_verified:true}},data});
const notify=async()=>({state:'no-device',accepted:0});
try{
 for(const uid of [actor,alice,bob])await auth.createUser({uid,email:uid+'@example.test',emailVerified:true});await auth.setCustomUserClaims(actor,{admin:true});
 await c.set({participants:[alice,bob],lastMessageId:'reported',lastMessage:'encrypted'});await m.set({id:'reported',senderId:bob,encrypted:true,ciphertext:'fixture-ciphertext',nonce:'fixture',createdAt:FieldValue.serverTimestamp()});await good.set({id:'unrelated',senderId:alice,text:'keep fixture'});
 const base={reporterId:alice,reportedUserId:bob,conversationId:room,messageId:'reported',mediaUrl:`https://media.getcampusmate.app/chat_media/${room}/fixture.enc`,status:'pending',reason:'QA fixture'};await r.set(base);
 let d=await call({op:'reportDetail',id:report});assert.equal(d.canRemoveMessage,true);assert.equal(d.reported.email,bob+'@example.test');checks.push('detailed identities and scoped message');
 await assert.rejects(moderateReport({db,actor,data:{id:report,revision:'stale',note:'QA',action:'removeMessage'},notify}),e=>e.code==='aborted');assert.equal((await m.get()).exists,true);checks.push('stale revision prevents deletion');
 let deleted=0;let result=await moderateReport({db,actor,data:{id:report,revision:revision(await r.get()),note:'QA warning only',action:'warn'},notify});assert.equal(result.warningSaved,true);assert.equal((await m.get()).exists,true);checks.push('warning preserves message');
 result=await moderateReport({db,actor,data:{id:report,revision:revision(await r.get()),note:'QA scoped remove',action:'removeMessageAndMedia'},deleteMedia:async()=>{deleted++;},notify});assert.equal(deleted,1);assert.equal(result.mediaState,'deleted');assert.equal((await m.get()).exists,false);assert.equal((await good.get()).exists,true);assert.equal((await db.doc('accountRestrictions/'+bob).get()).data().latestWarning.message,'QA scoped remove');checks.push('only reported message removed and warning persisted');
 await r.set(base);result=await moderateReport({db,actor,data:{id:report,revision:revision(await r.get()),note:'QA media failure',action:'removeMedia'},deleteMedia:async()=>{throw new Error('fixture failure');},notify});assert.equal(result.success,false);assert.equal((await r.get()).data().moderation.mediaState,'failed');assert.equal((await r.get()).data().status,'reviewing');checks.push('partial deletion failure recorded');
 result=await moderateReport({db,actor,data:{id:report,revision:revision(await r.get()),note:'QA retry media',action:'removeMedia'},deleteMedia:async()=>{},notify});assert.equal(result.success,true);checks.push('failed media deletion can retry');
 await r.set(base);await moderateReport({db,actor,data:{id:report,revision:revision(await r.get()),note:'QA slow media',action:'removeMedia'},deleteMedia:async()=>{await r.update({status:'dismissed','moderation.noticeId':'newer-decision',reviewNote:'newer decision'});},notify});assert.equal((await r.get()).data().status,'dismissed');assert.equal((await r.get()).data().reviewNote,'newer decision');checks.push('slow media completion preserves newer review');
 await assert.rejects(call({op:'accountStatus',uid:bob,disabled:true,note:''}),e=>e.code==='invalid-argument');await call({op:'accountStatus',uid:bob,disabled:true,note:'QA suspension'});assert.equal((await auth.getUser(bob)).disabled,true);assert.equal((await db.doc('accountRestrictions/'+bob).get()).data().suspended,true);await call({op:'accountStatus',uid:bob,disabled:false,note:'QA restore'});assert.equal((await auth.getUser(bob)).disabled,false);checks.push('account suspension and restoration');
 await assert.rejects(call({op:'accountStatus',uid:actor,disabled:true,note:'QA'}),e=>e.code==='failed-precondition');checks.push('admin self-suspension rejected');
 assert.throws(()=>mediaObjectKey({...base,mediaUrl:'https://media.getcampusmate.app/chat_media/another-room/fixture.enc'}));checks.push('foreign-room media rejected');
 console.log(JSON.stringify({passed:true,checks,externalNotificationsSent:0,externalEmailsSent:0,realUserDataChanged:false}));
}finally{
 await db.recursiveDelete(c);await r.delete();for(const uid of [actor,alice,bob]){await db.recursiveDelete(db.doc('users/'+uid));await db.doc('accountRestrictions/'+uid).delete();await auth.deleteUser(uid).catch(()=>{});}
 for(const collection of ['adminAudit','adminModerationEvidence']){const docs=await db.collection(collection).where('actor','==',actor).get();for(const doc of docs.docs)await doc.ref.delete();}
 await db.terminate();await deleteApp(app);
}
