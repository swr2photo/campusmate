import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {previewNotification,sendNotification,refreshNotificationReceipts} from './adminNotifications.js';
import {adminConsole} from './adminFunctions.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Use the Firestore and Auth emulators');
const app=initializeApp({projectId:'demo-campusmate'}),db=getFirestore(app),auth=getAuth(app),actor='operations-admin';
const call=data=>adminConsole.run({auth:{uid:actor,token:{admin:true,email_verified:true}},data});
try{
 await auth.createUser({uid:actor,email:'ops@example.test',emailVerified:true});await auth.setCustomUserClaims(actor,{admin:true});
 for(let i=0;i<105;i++)await auth.createUser({uid:'directory-'+String(i).padStart(3,'0'),email:`directory-${i}@example.test`,emailVerified:i%2===0,disabled:i===1});
 await db.doc('users/directory-000').set({name:'Detailed QA',isDiscoverable:false,faculty:'QA faculty',gallery:['https://example.test/photo.jpg'],activities:['running'],spotifyTokens:{accessToken:'must-not-leak'},publicKey:'secret'});
 await db.doc('users/directory-002').set({notificationsEnabled:false});
 const first=await call({op:'users'});assert.equal(first.rows.length,100);assert.ok(first.cursor);const second=await call({op:'users',cursor:first.cursor});assert.equal(second.rows.length,6);assert.equal(new Set([...first.rows,...second.rows].map(u=>u.uid)).size,106);
 const details=await call({op:'user',query:'directory-000'});assert.equal(details.profile.faculty,'QA faculty');assert.equal('spotifyTokens' in details.profile,false);assert.equal('publicKey' in details.profile,false);assert.equal(details.stats.conversations,0);
 await call({op:'saveOperations',revision:'missing',config:{maxNotificationRecipients:500,customNotificationsEnabled:true,notificationCooldownSeconds:30,adminEmailCooldownSeconds:60}});await assert.rejects(call({op:'saveOperations',revision:'missing',config:{}}),e=>e.code==='aborted');
 let batch=db.batch();for(let i=0;i<125;i++)batch.set(db.doc('pushTokens/device-'+i),{userId:'directory-000',enabled:true,platform:'android',expoPushToken:`ExponentPushToken[qaToken${i}]`});await batch.commit();
 const draft={title:'QA custom notice',body:'QA body',audience:'selected',uids:['directory-000','directory-001','directory-002'],route:'/home'},preview=await previewNotification({db,auth,actor,input:draft});assert.equal(preview.recipients,1);assert.equal(preview.excluded,2);assert.equal(preview.devices,125);
 let chunks=0;
 const client={sendPushNotificationsAsync:async messages=>{chunks++;assert.ok(messages.length<=100);assert.equal(messages[0].data.type,'admin_announcement');return messages.map((_,i)=>chunks===2&&i===0?{status:'error',details:{error:'DeviceNotRegistered'}}:{status:'ok',id:`ticket-${chunks}-${i}`});},getPushNotificationReceiptsAsync:async ids=>Object.fromEntries(ids.slice(0,-1).map((id,i)=>[id,{status:i===0?'error':'ok',...(i===0?{details:{error:'DeviceNotRegistered'}}:{})}]))};
 const result=await sendNotification({db,auth,actor,id:preview.id,client});assert.equal(chunks,2);assert.equal(result.accepted,124);assert.equal(result.failed,1);assert.equal(result.persisted,1);assert.equal((await db.collection('pushTokens').where('enabled','==',false).get()).size,1);const duplicate=await sendNotification({db,auth,actor,id:preview.id,client});assert.equal(duplicate.duplicate,true);assert.equal(chunks,2);
 assert.equal((await db.doc('accountRestrictions/directory-000').get()).data().latestAnnouncement.title,draft.title);assert.equal((await db.doc('accountRestrictions/directory-001').get()).exists,false);
 const receipts=await refreshNotificationReceipts({db,id:preview.id,client});assert.equal(receipts.pending,1);assert.equal(receipts.error,1);assert.equal((await db.collection('pushTokens').where('enabled','==',false).get()).size,2);
 const next=await previewNotification({db,auth,actor,input:draft});await assert.rejects(sendNotification({db,auth,actor,id:next.id,client}),e=>e.code==='resource-exhausted');
 await db.doc('adminNotificationLocks/'+actor).delete();await db.doc('adminNotificationPreviews/'+next.id).update({expiresAt:Timestamp.fromMillis(0)});await assert.rejects(sendNotification({db,auth,actor,id:next.id,client}),e=>e.code==='failed-precondition');
 await db.doc('app_config/adminOperations').update({customNotificationsEnabled:false});await assert.rejects(previewNotification({db,auth,actor,input:draft}),e=>e.code==='failed-precondition');
 console.log(JSON.stringify({passed:true,checks:['allAuthPages','incompleteAccounts','profileCredentialProjection','operationsRevision','notificationScopeAndOptOut','pushChunks','invalidDeviceDisabled','duplicateSuppression','persistedAnnouncement','receiptStates','cooldown','expiredPreview','disabledSending'],externalNotificationsSent:0}));
}finally{await db.terminate();await deleteApp(app);}
