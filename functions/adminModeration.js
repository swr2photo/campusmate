import crypto from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { buildExpoPushMessage } from './pushMessage.js';

const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function mediaObjectKey(report){
  let url;try{url=new URL(report.mediaUrl);}catch{throw new HttpsError('failed-precondition','รายงานไม่มีลิงก์สื่อที่ลบได้');}
  const allowed=['media.getcampusmate.app','pub-50c04ae03d1b4222b7402a2b1ff02c62.r2.dev'];
  const key=url.pathname.slice(1);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed.includes(url.hostname)||!safeId(report.conversationId)||!key.startsWith(`chat_media/${report.conversationId}/`)||!/^chat_media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.enc$/.test(key))throw new HttpsError('failed-precondition','ลบได้เฉพาะสื่อแชตในห้องที่ถูกรายงาน');
  return key;
}
export function createDeleteTicket(key,secret,now=Date.now()){
  const payload=Buffer.from(JSON.stringify({v:1,action:'delete',key,exp:Math.floor(now/1000)+300})).toString('base64url');
  return payload+'.'+crypto.createHmac('sha256',secret.trim()).update(payload).digest('base64url');
}
export async function deleteReportedMedia(report,secret,request=fetch){
  const key=mediaObjectKey(report);
  const response=await request(`https://media.getcampusmate.app/moderate/${key}`,{method:'DELETE',headers:{Authorization:'Bearer '+createDeleteTicket(key,secret)},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new HttpsError('unavailable','ลบไฟล์สื่อไม่สำเร็จ กรุณาลองใหม่จากรายงานนี้');
  return key;
}
export async function reportedMessage(db,report){
  if(!safeId(report.conversationId))return {conversation:null,message:null};
  const ref=db.doc('conversations/'+report.conversationId),snap=await ref.get();
  if(!snap.exists)return {conversation:null,message:null};
  const conversation=snap.data(),participants=conversation.participants||[];
  if(!participants.includes(report.reporterId)||!participants.includes(report.reportedUserId))throw new HttpsError('failed-precondition','ผู้เกี่ยวข้องในรายงานไม่ตรงกับห้องสนทนา');
  if(safeId(report.messageId)){
    const target=await ref.collection('messages').doc(report.messageId).get();
    if(target.exists)return {conversation,snap,message:target.data(),messageSnap:target,source:'document',messageId:target.id};
  }
  const legacy=Array.isArray(conversation.messages)?conversation.messages:[];
  const matches=legacy.map((m,index)=>({m,index})).filter(({m})=>m.id===report.messageId||(report.mediaUrl&&m.mediaUrl===report.mediaUrl));
  if(matches.length===1)return {conversation,snap,message:matches[0].m,source:'legacy',index:matches[0].index,messageId:matches[0].m.id||report.messageId};
  if(report.mediaUrl){const matches=await ref.collection('messages').where('mediaUrl','==',report.mediaUrl).limit(2).get();if(matches.size===1){const d=matches.docs[0];return {conversation,snap,message:d.data(),messageSnap:d,source:'document',messageId:d.id};}}
  return {conversation,snap,message:null};
}
export async function moderationPush(db,uid,body,reportId){
  const {Expo}=await import('expo-server-sdk');
  const tokens=await db.collection('pushTokens').where('userId','==',uid).limit(10).get();
  const registrations=tokens.docs.map(d=>d.data()).filter(t=>t.enabled!==false&&Expo.isExpoPushToken(t.expoPushToken));
  if(!registrations.length)return {state:'no-device',accepted:0};
  const client=new Expo(),notification={title:'แจ้งเตือนจากผู้ดูแล CampusMate',body:body.slice(0,220),channelId:'social',data:{type:'moderation_warning',reportId,url:'/me'}};
  const tickets=await client.sendPushNotificationsAsync(registrations.map(t=>buildExpoPushMessage(t,notification)));
  return {state:tickets.some(t=>t.status==='ok')?'accepted':'failed',accepted:tickets.filter(t=>t.status==='ok').length};
}
export async function moderateReport({db,actor,data,deleteMedia,notify=moderationPush}){
  if(!safeId(data.id)||typeof data.note!=='string'||!data.note.trim()||data.note.length>2000||!['warn','removeMessage','removeMedia','removeMessageAndMedia'].includes(data.action))throw new HttpsError('invalid-argument','กรุณาระบุคำสั่งและเหตุผลให้ครบ');
  const ref=db.doc('reports/'+data.id),snap=await ref.get();if(!snap.exists)throw new HttpsError('not-found','ไม่พบรายงาน');
  const report=snap.data(),target=await reportedMessage(db,report);
  const removesMessage=['removeMessage','removeMessageAndMedia'].includes(data.action),removesMedia=['removeMedia','removeMessageAndMedia'].includes(data.action);
  if(removesMessage&&(!target.message||target.message.senderId!==report.reportedUserId))throw new HttpsError('failed-precondition','ไม่พบข้อความที่ยืนยันได้ว่าเป็นของผู้ถูกรายงาน');
  if(removesMedia){if(!target.conversation)throw new HttpsError('failed-precondition','ไม่พบห้องสนทนาที่ตรวจสอบผู้เกี่ยวข้องได้');
    if(target.message&&target.message.senderId!==report.reportedUserId)throw new HttpsError('failed-precondition','สื่อไม่ได้อยู่ในข้อความของผู้ถูกรายงาน');mediaObjectKey(report);}
  if(!safeId(report.reportedUserId))throw new HttpsError('failed-precondition','รายงานไม่มีผู้ถูกรายงาน');
  const rev=s=>s.updateTime?`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`:'missing',log=db.collection('adminAudit').doc(),noticeId=log.id;
  await db.runTransaction(async tx=>{
    const fresh=await tx.get(ref);if(rev(fresh)!==data.revision)throw new HttpsError('aborted','รายงานเปลี่ยนแล้ว กรุณาโหลดใหม่');
    let messageSnapshot,roomSnapshot;
    if(removesMessage){roomSnapshot=await tx.get(target.snap.ref);if(target.source==='document')messageSnapshot=await tx.get(target.messageSnap.ref);
      if(rev(roomSnapshot)!==rev(target.snap)||(target.source==='document'&&rev(messageSnapshot)!==rev(target.messageSnap)))throw new HttpsError('aborted','ข้อความเปลี่ยนแล้ว กรุณาโหลดใหม่');}
    if(removesMessage){
      tx.set(db.doc('adminModerationEvidence/'+noticeId),{reportId:data.id,actor,message:target.message,createdAt:FieldValue.serverTimestamp()});
      if(target.source==='document')tx.delete(target.messageSnap.ref);
      const patch={updatedAt:FieldValue.serverTimestamp()};
      if(target.source==='legacy')patch.messages=roomSnapshot.data().messages.filter((_,i)=>i!==target.index);
      if(roomSnapshot.data().lastMessageId===target.messageId){patch.lastMessage='ข้อความถูกลบโดยผู้ดูแล';patch.lastMessageId=null;patch.lastMessageSenderId=null;patch.lastMessageMediaUrl=null;}
      tx.update(target.snap.ref,patch);
    }
    const moderation={action:data.action,note:data.note.trim(),actor,noticeId,at:FieldValue.serverTimestamp(),messageRemoved:removesMessage||report.moderation?.messageRemoved===true,mediaState:removesMedia?'pending':report.moderation?.mediaState||'not-requested'};
    tx.update(ref,{status:removesMedia?'reviewing':'resolved',reviewNote:data.note.trim(),reviewedBy:actor,updatedAt:FieldValue.serverTimestamp(),moderation});
    tx.set(db.doc('accountRestrictions/'+report.reportedUserId),{latestWarning:{id:noticeId,reportId:data.id,message:data.note.trim(),action:data.action,createdAt:FieldValue.serverTimestamp()}},{merge:true});
    tx.set(log,{actor,action:'moderateReport',target:data.id,moderationAction:data.action,note:data.note.trim(),messageId:target.messageId||null,state:removesMedia?'started':'completed',createdAt:FieldValue.serverTimestamp()});
  });
  let mediaState='not-requested';
  if(removesMedia){try{await deleteMedia(report);mediaState='deleted';}catch{mediaState='failed';}
    await db.runTransaction(async tx=>{
      const latest=await tx.get(ref);
      // A slow external deletion must not overwrite a newer administrator decision.
      if(latest.exists&&latest.data().moderation?.noticeId===noticeId)tx.update(ref,{'moderation.mediaState':mediaState,status:mediaState==='deleted'?'resolved':'reviewing',updatedAt:FieldValue.serverTimestamp()});
      tx.update(log,{state:mediaState==='deleted'?'completed':'partial',mediaState});
    });}
  let notification;try{notification=await notify(db,report.reportedUserId,data.note.trim(),data.id);}catch{notification={state:'failed',accepted:0};}
  await log.update({notification});
  return {success:mediaState!=='failed',messageRemoved:removesMessage,mediaState,warningSaved:true,notification};
}
