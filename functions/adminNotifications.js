import { persistInbox } from './notificationInbox.js';
import {createHash,randomUUID} from 'node:crypto';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {Expo} from 'expo-server-sdk';
import {buildExpoPushMessage} from './pushMessage.js';
import {validateNotification,effectiveOperations} from './adminOperations.js';
const chunk=(rows,n)=>Array.from({length:Math.ceil(rows.length/n)},(_,i)=>rows.slice(i*n,(i+1)*n));
export async function notificationRecipients({db,auth,data,policy,allowMissing=false}){
 const users=[];
 if(data.audience==='all'){
  let cursor;do{const page=await auth.listUsers(100,cursor);users.push(...page.users);cursor=page.pageToken;if(users.length>policy.maxNotificationRecipients)throw new HttpsError('resource-exhausted','จำนวนบัญชีเกินเพดานต่อครั้ง กรุณาเลือกผู้รับหรือปรับเพดานในหน้าตั้งค่า');}while(cursor);
 }else{
  if(data.uids.length>policy.maxNotificationRecipients)throw new HttpsError('resource-exhausted','จำนวนผู้รับเกินเพดานต่อครั้ง');
  for(const batch of chunk(data.uids,30)){const found=await auth.getUsers(batch.map(uid=>({uid})));if(found.notFound.length&&!allowMissing)throw new HttpsError('not-found','ผู้รับบางบัญชีไม่มีอยู่แล้ว กรุณาเลือกใหม่');users.push(...found.users);}
 }
 const profiles=users.length?await db.getAll(...users.map(u=>db.doc('users/'+u.uid))):[];
 const eligible=users.filter((u,i)=>!u.disabled),uidSet=new Set(eligible.map(u=>u.uid));
 const registrations=[];
 for(const ids of chunk([...uidSet],30)){
  const tokens=await db.collection('pushTokens').where('userId','in',ids).limit(1001).get();
  if(tokens.size>1000)throw new HttpsError('resource-exhausted','มีอุปกรณ์จำนวนมาก กรุณาแบ่งกลุ่มผู้รับ');
  registrations.push(...tokens.docs.map(d=>({...d.data(),ref:d.ref})).filter(t=>t.enabled!==false&&profiles[users.findIndex(u=>u.uid===t.userId)]?.data()?.notificationsEnabled!==false&&Expo.isExpoPushToken(t.expoPushToken)));
  if(registrations.length>1000)throw new HttpsError('resource-exhausted','เกิน 1,000 อุปกรณ์ต่อครั้ง กรุณาแบ่งกลุ่มผู้รับ');
 }
 const seen=new Set();return {uids:[...uidSet],registrations:registrations.filter(r=>{if(seen.has(r.expoPushToken))return false;seen.add(r.expoPushToken);return true;}),requested:users.length,excluded:users.length-eligible.length};
}
export async function previewNotification({db,auth,actor,input}){
 const policy=effectiveOperations((await db.doc('app_config/adminOperations').get()).data());if(!policy.customNotificationsEnabled)throw new HttpsError('failed-precondition','การส่งแจ้งเตือนถูกปิดในหน้าตั้งค่า');
 const data=validateNotification(input),recipients=await notificationRecipients({db,auth,data,policy});
 if(!recipients.uids.length)throw new HttpsError('failed-precondition','ไม่มีบัญชีที่รับแจ้งเตือนได้ ผู้รับอาจถูกระงับหรือปิดแจ้งเตือน');
 const id=randomUUID();await db.doc('adminNotificationPreviews/'+id).set({actor,...data,uids:recipients.uids,requested:recipients.requested,excluded:recipients.excluded,devices:recipients.registrations.length,expiresAt:Timestamp.fromMillis(Date.now()+300000),createdAt:FieldValue.serverTimestamp()});
 return {id,title:data.title,body:data.body,route:data.route,audience:data.audience,recipients:recipients.uids.length,devices:recipients.registrations.length,excluded:recipients.excluded,expiresAt:new Date(Date.now()+300000).toISOString()};
}
export async function sendNotification({db,auth,actor,id,client=new Expo()}){
 if(typeof id!=='string'||! /^[0-9a-f-]{36}$/.test(id))throw new HttpsError('invalid-argument','คำขอส่งไม่ถูกต้อง');
 const preview=db.doc('adminNotificationPreviews/'+id),job=db.doc('adminNotificationJobs/'+id),lock=db.doc('adminNotificationLocks/'+actor),log=db.doc('adminAudit/'+id);
 const policy=effectiveOperations((await db.doc('app_config/adminOperations').get()).data());if(!policy.customNotificationsEnabled)throw new HttpsError('failed-precondition','การส่งแจ้งเตือนถูกปิดในหน้าตั้งค่า');
 const claim=await db.runTransaction(async tx=>{
  const [p,j,l]=await Promise.all([tx.get(preview),tx.get(job),tx.get(lock)]);
  if(j.exists){if(j.data().actor!==actor)throw new HttpsError('permission-denied','คำขอไม่ใช่ของบัญชีนี้');if(j.data().result)return {duplicate:j.data().result};throw new HttpsError('failed-precondition','คำขอนี้เริ่มส่งแล้ว กรุณาตรวจประวัติ ห้ามส่งซ้ำหากยังไม่ทราบผล');}
  if(!p.exists||p.data().actor!==actor)throw new HttpsError('permission-denied','ไม่พบตัวอย่างแจ้งเตือนของบัญชีนี้');
  const data=p.data();if(data.expiresAt.toMillis()<Date.now())throw new HttpsError('failed-precondition','ตัวอย่างหมดอายุ กรุณาตรวจผู้รับใหม่');
  if(data.uids.length>policy.maxNotificationRecipients)throw new HttpsError('resource-exhausted','จำนวนผู้รับเกินเพดานล่าสุด กรุณาสร้างตัวอย่างใหม่');
  if(Date.now()-(l.data()?.sentAt?.toMillis?.()||0)<policy.notificationCooldownSeconds*1000)throw new HttpsError('resource-exhausted',`กรุณารอ ${policy.notificationCooldownSeconds} วินาทีก่อนส่งครั้งถัดไป`);
  const record={actor,title:data.title,body:data.body,route:data.route,audience:data.audience,recipients:data.uids.length,state:'started',createdAt:FieldValue.serverTimestamp()};
  tx.set(job,record);tx.set(lock,{sentAt:FieldValue.serverTimestamp()});tx.set(log,{actor,action:'sendNotification',target:id,after:record,state:'started',createdAt:FieldValue.serverTimestamp()});return {data};
 });
 if(claim.duplicate)return {...claim.duplicate,duplicate:true};
 let persisted=0,accepted=0,failed=0;const tickets=[];
 try{
  for (const uid of claim.data.uids) await persistInbox(db, 'announcement:' + id, uid, { title: claim.data.title, body: claim.data.body, data: { type: 'admin_announcement', route: claim.data.route } });
  // Recheck account status/preferences immediately before sending, using the frozen audience.
  const current=await notificationRecipients({db,auth,data:{...claim.data,audience:'selected'},policy,allowMissing:true});
  for(const ids of chunk(current.uids,200)){
   const batch=db.batch();for(const uid of ids)batch.set(db.doc('accountRestrictions/'+uid),{latestAnnouncement:{id,title:claim.data.title,message:claim.data.body,route:claim.data.route,createdAt:FieldValue.serverTimestamp()}},{merge:true});await batch.commit();persisted+=ids.length;
  }
  const message={title:claim.data.title,body:claim.data.body,channelId:'social',data:{type:'admin_announcement',announcementId:id,route:claim.data.route}};
  for(const registrations of chunk(current.registrations,100)){
   const response=await client.sendPushNotificationsAsync(registrations.map(r=>buildExpoPushMessage(r,message)));
   if(!Array.isArray(response)||response.length!==registrations.length)throw new Error('Incomplete push ticket response');
   const invalid=db.batch();let invalidCount=0;
   response.forEach((t,i)=>{if(t.status==='ok'){accepted++;tickets.push({id:t.id,registrationPath:registrations[i].ref.path,tokenHash:createHash('sha256').update(registrations[i].expoPushToken).digest('hex')});}else {failed++;if(t.details?.error==='DeviceNotRegistered'){invalidCount++;invalid.set(registrations[i].ref,{enabled:false,lastError:'DeviceNotRegistered'},{merge:true});}}});
   if(invalidCount)await invalid.commit();
  }
  const result={persisted,accepted,failed,devices:current.registrations.length,skipped:claim.data.uids.length-current.uids.length,state:failed?'partial':current.registrations.length?'accepted':'no-device'};
  await job.update({result,tickets,state:result.state,completedAt:FieldValue.serverTimestamp()});await log.update({state:result.state,notification:result});return result;
 }catch{
  const result={persisted,accepted,failed,state:'unknown'};await Promise.allSettled([job.update({result,tickets,state:'unknown'}),log.update({state:'unknown',notification:result})]);throw new HttpsError('unavailable','ส่งไม่ครบหรือยังยืนยันผลไม่ได้ กรุณาตรวจประวัติก่อนส่งใหม่');
 }
}
export async function refreshNotificationReceipts({db,id,client=new Expo()}){
 if(typeof id!=='string'||! /^[0-9a-f-]{36}$/.test(id))throw new HttpsError('invalid-argument','รหัสแจ้งเตือนไม่ถูกต้อง');
 const ref=db.doc('adminNotificationJobs/'+id),snapshot=await ref.get();if(!snapshot.exists)throw new HttpsError('not-found','ไม่พบการส่ง');
 const records=snapshot.data().tickets||[],ids=records.map(t=>t.id).filter(Boolean),counts={handedOff:0,error:0,pending:0},invalid=[];
 for(const part of chunk(ids,300)){const receipts=await client.getPushNotificationReceiptsAsync(part);for(const key of part){const r=receipts[key];if(!r)counts.pending++;else if(r.status==='ok')counts.handedOff++;else {counts.error++;if(r.details?.error==='DeviceNotRegistered'){const record=records.find(t=>t.id===key);if(/^pushTokens\/[^/]+$/.test(record?.registrationPath||''))invalid.push(record);}}}}
 for(const part of chunk(invalid,30))await db.runTransaction(async tx=>{
  const docs=await Promise.all(part.map(t=>tx.get(db.doc(t.registrationPath))));
  docs.forEach((doc,i)=>{if(doc.exists&&typeof doc.data().expoPushToken==='string'&&createHash('sha256').update(doc.data().expoPushToken).digest('hex')===part[i].tokenHash)tx.set(doc.ref,{enabled:false,lastError:'DeviceNotRegistered'},{merge:true});});
 });
 await ref.update({receipts:counts,receiptsCheckedAt:FieldValue.serverTimestamp()});return counts;
}
