import {randomUUID,createHash} from 'node:crypto';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
const safeUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
const ownedCollections=['users','profiles','discoveryProfiles','entitlements','profileVisibility','discoveryState','matchingSignals','discoveryActions','rewindReceipts','likePageCursors','discoveryPageCursors','emailVerificationLocks','campusEmailChangeLocks'];
async function target(auth,actor,uid){
 if(!safeUid(uid))throw new HttpsError('invalid-argument','UID ไม่ถูกต้อง');
 const user=await auth.getUser(uid);
 if(uid===actor||user.customClaims?.admin===true)throw new HttpsError('permission-denied','ไม่อนุญาตให้ลบบัญชีแอดมิน');
 return user;
}
export async function previewAccountDeletion({db,auth,actor,uid}){
 const user=await target(auth,actor,uid),id=randomUUID();
 const counts=await Promise.all([['decisions','fromUserId'],['decisions','toUserId'],['pushTokens','userId']].map(async([name,field])=>(await db.collection(name).where(field,'==',uid).count().get()).data().count));
 await db.doc('adminAccountDeletionPreviews/'+id).set({actor,uid,created:user.metadata.creationTime,email:user.email||'',expiresAt:Timestamp.fromMillis(Date.now()+300000)});
 return {id,uid,email:user.email||'',decisions:counts[0]+counts[1],devices:counts[2]};
}
export async function deleteAccount({db,auth,actor,data}){
 if(typeof data.id!=='string'||!/^[0-9a-f-]{36}$/.test(data.id)||!safeUid(data.uid)||typeof data.note!=='string'||!data.note.trim()||data.note.length>2000)throw new HttpsError('invalid-argument','กรุณายืนยัน UID และระบุเหตุผล');
 const preview=await db.doc('adminAccountDeletionPreviews/'+data.id).get(),p=preview.data();
 if(!p||p.actor!==actor||p.uid!==data.uid||p.expiresAt.toMillis()<Date.now())throw new HttpsError('failed-precondition','ตัวอย่างหมดอายุหรือบัญชีไม่ตรงกัน กรุณาตรวจใหม่');
 const job=db.doc('adminAccountDeletionJobs/'+data.uid),log=db.doc('adminAudit/'+data.id);
 const old=await job.get();if(old.data()?.id===data.id&&old.data()?.state==='completed')return {deleted:true,duplicate:true,uid:data.uid};
 let user;
 try{user=await target(auth,actor,data.uid);}catch(e){
  if(e.code!=='auth/user-not-found'||old.data()?.id!==data.id||old.data()?.actor!==actor)throw e;
  const b=db.batch();b.set(job,{state:'completed',updatedAt:FieldValue.serverTimestamp()},{merge:true});b.set(log,{state:'completed',completedAt:FieldValue.serverTimestamp()},{merge:true});b.set(db.doc('accountRestrictions/'+data.uid),{suspended:true,deleted:true,deletionPending:false,actor,deletedAt:FieldValue.serverTimestamp()});await b.commit();return {deleted:true,uid:data.uid,reconciled:true};
 }
 if(user.metadata.creationTime!==p.created)throw new HttpsError('aborted','บัญชีเปลี่ยนแล้ว กรุณาตรวจใหม่');
 await db.runTransaction(async tx=>{
  const j=await tx.get(job);
  if(j.exists&&j.data().state==='started'&&Date.now()-(j.data().updatedAt?.toMillis?.()||0)<360000)throw new HttpsError('failed-precondition','บัญชีกำลังถูกลบ กรุณาตรวจประวัติก่อนลองอีกครั้ง');
  tx.set(job,{id:data.id,actor,state:'started',updatedAt:FieldValue.serverTimestamp()});
  tx.set(log,{actor,action:'deleteAccount',target:data.uid,note:data.note.trim(),state:'started',createdAt:FieldValue.serverTimestamp()});
  tx.set(db.doc('accountRestrictions/'+data.uid),{suspended:true,deletionPending:true,suspensionReason:'บัญชีกำลังถูกลบโดยผู้ดูแล',actor,updatedAt:FieldValue.serverTimestamp()},{merge:true});
 });
 try{
  await auth.updateUser(data.uid,{disabled:true});await auth.revokeRefreshTokens(data.uid);
  // Shared conversations, report evidence and media are deliberately retained.
  for(const [name,field] of [['decisions','fromUserId'],['decisions','toUserId'],['pushTokens','userId'],['notificationDeliveries','userId']]){
   let rows;do{rows=await db.collection(name).where(field,'==',data.uid).limit(200).get();if(rows.size){const b=db.batch();for(const row of rows.docs)b.delete(row.ref);await b.commit();}}while(rows.size===200);
  }
  for(const name of ownedCollections)await db.recursiveDelete(db.doc(name+'/'+data.uid));
  if(user.email)await db.doc('passwordResetEmailLocks/'+createHash('sha256').update(user.email.toLowerCase()).digest('hex')).delete();
  // Recheck privileges immediately before removing the Auth identity.
  await target(auth,actor,data.uid);await auth.deleteUser(data.uid);
  const batch=db.batch();batch.set(job,{state:'completed',updatedAt:FieldValue.serverTimestamp()},{merge:true});batch.set(log,{state:'completed',completedAt:FieldValue.serverTimestamp()},{merge:true});batch.set(db.doc('accountRestrictions/'+data.uid),{suspended:true,deleted:true,deletionPending:false,actor,deletedAt:FieldValue.serverTimestamp()});await batch.commit();
  return {deleted:true,uid:data.uid};
 }catch(e){await Promise.allSettled([job.set({state:'failed',updatedAt:FieldValue.serverTimestamp()},{merge:true}),log.set({state:'failed'},{merge:true})]);throw new HttpsError('unavailable','ลบบัญชียังไม่ครบ บัญชีถูกปิดไว้แล้ว ตรวจประวัติและลองดำเนินการใหม่');}
}
