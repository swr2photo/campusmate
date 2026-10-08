import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {previewAccountDeletion,deleteAccount} from './adminAccountDeletion.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Emulators required');
const app=initializeApp({projectId:'demo-campusmate'}),auth=getAuth(app),db=getFirestore(app),actor='delete-admin',uid='delete-target';
try{
 for(const id of [actor,uid,'delete-other'])await auth.createUser({uid:id,email:id+'@example.test',emailVerified:true});await auth.setCustomUserClaims(actor,{admin:true});
 for(const name of ['users','profiles','discoveryProfiles','entitlements','profileVisibility','discoveryState','matchingSignals'])await db.doc(name+'/'+uid).set({name:'QA'});
 await db.doc('discoveryActions/'+uid+'/items/one').set({ok:true});await db.doc('pushTokens/own').set({userId:uid});await db.doc('pushTokens/other').set({userId:'delete-other'});
 await db.doc('decisions/a').set({fromUserId:uid,toUserId:'delete-other'});await db.doc('decisions/b').set({fromUserId:'delete-other',toUserId:uid});
 await db.doc('conversations/shared').set({participants:[uid,'delete-other']});await db.doc('conversations/shared/messages/one').set({text:'preserved'});await db.doc('reports/evidence').set({reportedUserId:uid});
 await assert.rejects(previewAccountDeletion({db,auth,actor,uid:actor}),e=>e.code==='permission-denied');
 const preview=await previewAccountDeletion({db,auth,actor,uid});assert.equal(preview.devices,1);assert.equal(preview.decisions,2);
 await assert.rejects(deleteAccount({db,auth,actor,data:{id:preview.id,uid:'delete-other',note:'QA'}}),e=>e.code==='failed-precondition');
 await assert.rejects(deleteAccount({db,auth,actor,data:{id:preview.id,uid,note:''}}),e=>e.code==='invalid-argument');
 const result=await deleteAccount({db,auth,actor,data:{id:preview.id,uid,note:'QA deletion'}});assert.equal(result.deleted,true);await assert.rejects(auth.getUser(uid),e=>e.code==='auth/user-not-found');
 for(const name of ['users','profiles','discoveryProfiles','entitlements'])assert.equal((await db.doc(name+'/'+uid).get()).exists,false);
 assert.equal((await db.doc('discoveryActions/'+uid+'/items/one').get()).exists,false);assert.equal((await db.doc('pushTokens/own').get()).exists,false);assert.equal((await db.doc('pushTokens/other').get()).exists,true);assert.equal((await db.collection('decisions').get()).size,0);
 assert.equal((await db.doc('conversations/shared/messages/one').get()).exists,true);assert.equal((await db.doc('reports/evidence').get()).exists,true);assert.equal((await db.doc('accountRestrictions/'+uid).get()).data().deleted,true);
 assert.equal((await deleteAccount({db,auth,actor,data:{id:preview.id,uid,note:'QA'}})).duplicate,true);
 await db.doc('adminAccountDeletionJobs/'+uid).update({state:'failed'});assert.equal((await deleteAccount({db,auth,actor,data:{id:preview.id,uid,note:'QA'}})).reconciled,true);
 console.log(JSON.stringify({passed:true,checks:['adminProtection','preview','uidConfirmation','mandatoryReason','authDeletion','profileCleanup','subcollectionCleanup','deviceScope','decisionCleanup','sharedChatPreserved','evidencePreserved','restriction','duplicate','reconciliation']}));
}finally{await db.terminate();await deleteApp(app);}
