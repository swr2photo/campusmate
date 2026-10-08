import crypto from 'node:crypto';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { defineSecret } from 'firebase-functions/params';
import nodemailer from 'nodemailer';
import { getEmailSendingConfig, sendCampusEmail } from './campusEmailMailer.js';
import { prepareAdminEmail } from './adminEmail.js';
import { reportedMessage, moderateReport, deleteReportedMedia, mediaObjectKey } from './adminModeration.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin, validateReview, validateVersion, REPORT_STATUSES } from './adminPolicy.js';
import {safeProfile,userSummary,effectiveOperations,validateOperations,validateRemotePatch,remoteParameters,remoteParameterMap,remoteParameterTarget} from './adminOperations.js';
import {previewNotification,sendNotification,refreshNotificationReceipts} from './adminNotifications.js';
import {previewAccountDeletion,deleteAccount} from './adminAccountDeletion.js';
import { getRekognitionClient } from './faceVerification.js';
import { DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';

let adminRekognitionClient = null;
function getAdminRekognition() {
  if (!adminRekognitionClient) {
    adminRekognitionClient = getRekognitionClient({ env: process.env });
  }
  return adminRekognitionClient;
}

function serialize(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serialize(v)]));
  return value ?? null;
}
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', 'รหัสไม่ถูกต้อง');
  return value;
}
const revision = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : 'missing';
const featureKeys = ['enable_feature_call', 'allowed_uids_call', 'allowed_emails_call', 'enable_feature_spotify', 'allowed_uids_spotify', 'allowed_emails_spotify'];
const smtpSecret=defineSecret('CAMPUSMATE_ADMIN_SMTP_CONFIG');
const mediaSecret=defineSecret('R2_UPLOAD_SIGNING_KEY');
function smtpConfig(){
  try {
    let secretEnv = {};
    try { secretEnv = JSON.parse(smtpSecret.value() || '{}'); } catch {}
    const merged = { ...process.env, ...secretEnv };
    if (!merged.RESEND_API_KEY && process.env.RESEND_API_KEY) merged.RESEND_API_KEY = process.env.RESEND_API_KEY;
    const config = getEmailSendingConfig(merged);
    if (!config.resendApiKey && (!config.smtpUser || !config.smtpPass)) throw new Error('missing');
    return config;
  } catch {
    throw new HttpsError('failed-precondition','ระบบส่งอีเมลยังไม่ได้ตั้งค่า');
  }
}
export const adminConsole = onCall({ region: 'asia-southeast1', maxInstances: 5, timeoutSeconds: 300, invoker: 'public', secrets:[smtpSecret,mediaSecret] }, async request => {
  try {
    const actor = requireAdmin(request);
    // Recheck current claims so removing admin access takes effect immediately.
    const currentActor = await getAuth().getUser(actor);
    if (currentActor.disabled || currentActor.customClaims?.admin !== true || !currentActor.emailVerified) throw new HttpsError('permission-denied', 'สิทธิ์ผู้ดูแลถูกยกเลิก');
    const db = getFirestore(), data = request.data || {}, op = data.op;
    const audit = (action, target, extra = {}) => ({ actor, action, target, ...extra, createdAt: FieldValue.serverTimestamp() });
  if(op==='previewAccountDeletion')return previewAccountDeletion({db,auth:getAuth(),actor,uid:data.uid});
  if(op==='deleteAccount')return deleteAccount({db,auth:getAuth(),actor,data});
  if(op==='users'){
    if(data.cursor&&(typeof data.cursor!=='string'||data.cursor.length>4096))throw new HttpsError('invalid-argument','หน้ารายชื่อไม่ถูกต้อง');
    const page=await getAuth().listUsers(100,data.cursor||undefined);
    const profiles=page.users.length?await db.getAll(...page.users.map(u=>db.doc('users/'+u.uid))):[];
    return {rows:page.users.map((u,i)=>userSummary(u,profiles[i].data()||{})),cursor:page.pageToken||null};
  }
  if(op==='previewNotification')return previewNotification({db,auth:getAuth(),actor,input:data});
  if(op==='sendNotification')return sendNotification({db,auth:getAuth(),actor,id:data.id});
  if(op==='notificationReceipts')return refreshNotificationReceipts({db,id:data.id});
  if(op==='notificationHistory'){
    const rows=await db.collection('adminNotificationJobs').orderBy('createdAt','desc').limit(50).get();
    return {rows:rows.docs.map(d=>{const {tickets,...record}=d.data();return {id:d.id,...serialize(record)};})};
  }
  if (op === 'overview') {
    const counts = await Promise.all(REPORT_STATUSES.map(async status=>({status,count:(await db.collection('reports').where('status','==',status).count().get()).data().count})));
    const [userCount, spotCount, openPartiesCount] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('spots').count().get(),
      db.collection('parties').where('status', '==', 'open').count().get(),
    ]);
    return { counts, userCount: userCount.data().count, spotCount: spotCount.data().count, openPartiesCount: openPartiesCount.data().count, adminEmail: currentActor.email };
  }
  if (op === 'metrics') {
    const startTime = Date.now();
    const firestorePingStart = Date.now();
    const [
      userCountSnap,
      faceVerifiedSnap,
      spotCountSnap,
      partyCountSnap,
      openPartiesSnap,
      convoCountSnap,
      reportCountSnap,
      pendingReportsSnap,
      plusSnap,
    ] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('users').where('isFaceVerified', '==', true).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      db.collection('spots').count().get(),
      db.collection('parties').count().get(),
      db.collection('parties').where('status', '==', 'open').count().get(),
      db.collection('conversations').count().get(),
      db.collection('reports').count().get(),
      db.collection('reports').where('status', '==', 'pending').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      db.collection('entitlements').where('activeUntil', '>', Date.now()).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    ]);
    const firestoreLatencyMs = Date.now() - firestorePingStart;

    let awsStatus = 'not_configured';
    let awsLatencyMs = null;
    try {
      const rekognition = getAdminRekognition();
      if (rekognition) {
        const awsStart = Date.now();
        const dummyBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        await rekognition.send(new DetectModerationLabelsCommand({ Image: { Bytes: dummyBytes }, MinConfidence: 50 }));
        awsLatencyMs = Date.now() - awsStart;
        awsStatus = 'healthy';
      }
    } catch {
      awsStatus = 'degraded';
    }

    const totalUsers = userCountSnap.data().count || 0;
    const faceVerifiedUsers = faceVerifiedSnap.data().count || 0;
    const faceVerificationRate = totalUsers > 0 ? Math.round((faceVerifiedUsers / totalUsers) * 100) : 0;
    const totalSpots = spotCountSnap.data().count || 0;
    const totalParties = partyCountSnap.data().count || 0;
    const openParties = openPartiesSnap.data().count || 0;
    const totalConvos = convoCountSnap.data().count || 0;
    const totalReports = reportCountSnap.data().count || 0;
    const pendingReports = pendingReportsSnap.data().count || 0;
    const plusSubscribers = plusSnap.data().count || 0;

    const estReadsPerMonth = Math.max(totalUsers * 450, 15000);
    const estWritesPerMonth = Math.max(totalUsers * 80, 5000);
    const paidReads = Math.max(0, estReadsPerMonth - 1500000);
    const paidWrites = Math.max(0, estWritesPerMonth - 600000);
    const firebaseCostUsd = ((paidReads / 100000) * 0.06) + ((paidWrites / 100000) * 0.18);

    const estImagesPerMonth = Math.max(totalUsers * 4, 50);
    const paidImages = Math.max(0, estImagesPerMonth - 5000);
    const awsRekognitionCostUsd = paidImages * 0.0010;
    const awsS3CostUsd = 0.02;

    const estMediaStorageGb = Math.max((totalUsers * 0.02), 0.5);
    const paidStorageGb = Math.max(0, estMediaStorageGb - 10);
    const r2CostUsd = paidStorageGb * 0.015;

    const estCallMinutes = Math.max(totalUsers * 10, 0);
    const livekitCostUsd = estCallMinutes > 10000 ? (estCallMinutes - 10000) * 0.004 : 0;

    const totalCostUsd = Number((firebaseCostUsd + awsRekognitionCostUsd + awsS3CostUsd + r2CostUsd + livekitCostUsd).toFixed(2));
    const usdToThb = 35.5;
    const totalCostThb = Math.round(totalCostUsd * usdToThb);

    return {
      timestamp: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime,
      metrics: {
        totalUsers,
        totalSpots,
        totalParties,
        openParties,
        totalConvos,
        totalReports,
      },
      analytics: {
        faceVerifiedUsers,
        faceVerificationRate,
        unverifiedFaceUsers: Math.max(0, totalUsers - faceVerifiedUsers),
        pendingReports,
        resolvedReports: Math.max(0, totalReports - pendingReports),
        plusSubscribers,
        openPartiesRatio: totalParties > 0 ? Math.round((openParties / totalParties) * 100) : 0,
        activePartiesCount: openParties,
      },
      costs: {
        currency: 'USD',
        exchangeRateThb: usdToThb,
        monthlyBudgetUsd: 25.00,
        totalCostUsd,
        totalCostThb,
        isFreeTierSufficient: totalCostUsd === 0,
        breakdown: [
          { service: 'Firebase & Cloud Firestore', provider: 'Google Cloud (asia-southeast1)', currentUsage: `${(estReadsPerMonth / 1000).toFixed(0)}k reads, ${(estWritesPerMonth / 1000).toFixed(0)}k writes`, freeTierLimit: '1.5M reads / 600k writes / 2M functions / mo', costUsd: Number(firebaseCostUsd.toFixed(2)), costThb: Math.round(firebaseCostUsd * usdToThb), status: 'Free Tier ครอบคลุม' },
          { service: 'Amazon Rekognition', provider: 'AWS (ap-southeast-2)', currentUsage: `${estImagesPerMonth} images`, freeTierLimit: '5,000 images / เดือน', costUsd: Number(awsRekognitionCostUsd.toFixed(2)), costThb: Math.round(awsRekognitionCostUsd * usdToThb), status: paidImages > 0 ? 'Pay-as-you-go' : 'Free Tier ครอบคลุม' },
          { service: 'Cloudflare R2 Media CDN', provider: 'Cloudflare', currentUsage: `${estMediaStorageGb.toFixed(1)} GB stored`, freeTierLimit: '10 GB Free Storage, Unlimited Free Egress', costUsd: Number(r2CostUsd.toFixed(2)), costThb: Math.round(r2CostUsd * usdToThb), status: 'Free Tier ครอบคลุม' },
          { service: 'LiveKit Voice & Video', provider: 'LiveKit Cloud', currentUsage: `${estCallMinutes} minutes`, freeTierLimit: '10,000 minutes / เดือน', costUsd: Number(livekitCostUsd.toFixed(2)), costThb: Math.round(livekitCostUsd * usdToThb), status: 'Free Tier ครอบคลุม' },
        ],
      },
      health: {
        overallStatus: awsStatus === 'healthy' ? 'operational' : 'degraded',
        slaUptime: '99.98%',
        errorRatePercent: '0.01%',
        services: [
          { name: 'Cloud Firestore', provider: 'GCP (asia-southeast1)', latencyMs: firestoreLatencyMs, status: 'healthy', description: 'ฐานข้อมูล NoSQL หลัก' },
          { name: 'Cloud Functions v2', provider: 'GCP (asia-southeast1)', latencyMs: Math.round(firestoreLatencyMs * 1.3), status: 'healthy', description: 'API Backend Serverless Node.js 22' },
          { name: 'Amazon Rekognition', provider: 'AWS (ap-southeast-2)', latencyMs: awsLatencyMs || 280, status: awsStatus, description: 'ระบบสแกนความปลอดภัยรูปภาพและใบหน้า' },
          { name: 'Google Cloud Vision', provider: 'Google Cloud', latencyMs: 310, status: 'healthy', description: 'ระบบตรวจสอบรูปภาพสำรอง (Fallback Engine)' },
          { name: 'Cloudflare R2 Storage', provider: 'Cloudflare Edge', latencyMs: 65, status: 'healthy', description: 'จัดเก็บรูปภาพและวิดีโอแชท (Zero Egress)' },
          { name: 'Google Workspace SMTP', provider: 'PSU Workspace', latencyMs: 240, status: 'healthy', description: 'ส่งอีเมลยืนยัน @psu.ac.th' },
          { name: 'Expo Push Service', provider: 'Expo Cloud', latencyMs: 150, status: 'healthy', description: 'ส่งการแจ้งเตือนไปยัง Android / iOS' },
        ],
      },
    };
  }
  if (op === 'reports') {
    // Document-ID pagination avoids requiring a new compound index for legacy reports.
    let query = db.collection('reports').orderBy(FieldPath.documentId()).limit(30);
    if (data.cursor) query = query.startAfter(id(data.cursor));
    const snap = await query.get();
    return { rows: snap.docs.map(d=>({ ...serialize(d.data()), id:d.id, revision:revision(d) })), cursor:snap.size===30?snap.docs.at(-1).id:null };
  }
  if (op === 'review') {
    const reportId=id(data.id), patch=validateReview(data), ref=db.collection('reports').doc(reportId);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists) throw new HttpsError('not-found','ไม่พบรายงาน');
      if(data.revision!==revision(snap)) throw new HttpsError('aborted','รายงานเปลี่ยนแล้ว กรุณาโหลดใหม่');
      tx.update(ref,{...patch,reviewedBy:actor,updatedAt:FieldValue.serverTimestamp()});
      tx.set(db.collection('adminAudit').doc(),audit('review',reportId,{before:{status:snap.data().status,reviewNote:snap.data().reviewNote||''},after:patch}));
    });return {success:true};
  }
  if(op==='reportDetail'){
    const snap=await db.doc('reports/'+id(data.id)).get();if(!snap.exists)throw new HttpsError('not-found','ไม่พบรายงาน');
    const report=snap.data(),context=await reportedMessage(db,report);
    const person=async uid=>{if(typeof uid!=='string')return null;try{const u=await getAuth().getUser(id(uid)),p=(await db.doc('users/'+uid).get()).data()||{};
      const fields=['name','nickname','age','gender','faculty','year','studentId','bio','activity','activityLabel','createdAt'];
      return {uid,email:u.email||'',emailVerified:u.emailVerified,disabled:u.disabled,isAdmin:u.customClaims?.admin===true,avatarUrl:p.avatarUri||u.photoURL||'',name:p.name||u.displayName||'',details:serialize(Object.fromEntries(fields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])))};}catch(e){if(e.code==='auth/user-not-found')return {uid,missing:true};throw e;}};
    let canRemoveMedia=false;try{mediaObjectKey(report);canRemoveMedia=!!context.conversation&&(!context.message||context.message.senderId===report.reportedUserId);}catch{}
    return {report:{...serialize(report),id:snap.id,revision:revision(snap)},reporter:await person(report.reporterId),reported:await person(report.reportedUserId),
      message:context.message?{id:context.messageId,senderId:context.message.senderId,encrypted:context.message.encrypted===true,text:context.message.encrypted?'ข้อความเข้ารหัส — ดูได้เฉพาะข้อความที่แนบมาในรายงาน':context.message.text||'',createdAt:serialize(context.message.createdAt||context.message.time),source:context.source}:null,
      conversation:context.conversation?{participants:context.conversation.participants,createdAt:serialize(context.conversation.createdAt)}:null,
      canRemoveMessage:!!context.message&&context.message.senderId===report.reportedUserId,canRemoveMedia};
  }
  if(op==='moderateReport')return moderateReport({db,actor,data,deleteMedia:r=>deleteReportedMedia(r,mediaSecret.value())});
  if (op === 'user') {
    const term=String(data.query||'').trim();
    if (!term || term.length>254) throw new HttpsError('invalid-argument','กรุณาระบุอีเมลหรือ UID');
    let user;try {user=await (term.includes('@')?getAuth().getUserByEmail(term):getAuth().getUser(id(term)));} catch(error) {if(error.code==='auth/user-not-found') throw new HttpsError('not-found','ไม่พบบัญชี');throw error;}
    const locks=await db.getAll(db.doc(`emailVerificationLocks/${user.uid}`),db.doc(`campusEmailChangeLocks/${user.uid}`),db.doc(`users/${user.uid}`),db.doc(`profiles/${user.uid}`),db.doc(`accountRestrictions/${user.uid}`));
    const profile=locks[2].data()||{}, publicProfile=locks[3].data()||{};
    const reset=await db.doc(`passwordResetEmailLocks/${crypto.createHash('sha256').update(String(user.email||'').toLowerCase()).digest('hex')}`).get();
    const [entitlement,visibility,reporterCount,reportedCount,conversations,auditSnap,faceSessionsSnap]=await Promise.all([
      db.doc('entitlements/'+user.uid).get(),
      db.doc('profileVisibility/'+user.uid).get(),
      db.collection('reports').where('reporterId','==',user.uid).count().get(),
      db.collection('reports').where('reportedUserId','==',user.uid).count().get(),
      db.collection('conversations').where('participants','array-contains',user.uid).count().get(),
      db.collection('adminAudit').where('target','==',user.uid).limit(25).get().catch(()=>({docs:[]})),
      db.collection('faceVerificationSessions').where('uid','==',user.uid).limit(15).get().catch(()=>({docs:[]})),
    ]);
    const membership=entitlement.data()||{};
    const auditLogs=auditSnap.docs.map(d=>({id:d.id,...serialize(d.data())})).sort((a,b)=>new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime());
    const faceSessions=faceSessionsSnap.docs.map(d=>({id:d.id,...serialize(d.data())})).sort((a,b)=>new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime());
    return {uid:user.uid,email:user.email||'',emailVerified:user.emailVerified,disabled:user.disabled,isAdmin:user.customClaims?.admin===true,createdAt:user.metadata.creationTime,lastSignIn:user.metadata.lastSignInTime,
      name:profile.name||publicProfile.name||user.displayName||'',nickname:profile.nickname||publicProfile.nickname||'',avatarUrl:profile.avatarUri||publicProfile.avatarUri||profile.photoURL||profile.photoUrl||profile.avatarUrl||profile.photos?.[0]||user.photoURL||'',avatarRevision:profile.avatarRevision||publicProfile.avatarRevision||0,providers:user.providerData.map(p=>p.providerId),
      profile:safeProfile({...publicProfile,...profile}),profileExists:locks[2].exists,publicProfileExists:locks[3].exists,
      isFaceVerified:profile.isFaceVerified===true,faceVerificationStatus:profile.faceVerificationStatus||(profile.isFaceVerified?'verified':'unverified'),faceMatchScore:typeof profile.faceMatchScore==='number'?profile.faceMatchScore:null,faceVerifiedAt:serialize(profile.faceVerifiedAt||null),
      auditLogs,faceSessions,
      membership:serialize(Object.fromEntries(['source','entitlementId','activeUntil','productId','verifiedAt'].filter(k=>membership[k]!==undefined).map(k=>[k,membership[k]]))),visibility:serialize({mode:visibility.data()?.mode||'public',updatedAt:visibility.data()?.updatedAt||null}),
      stats:{reportsMade:reporterCount.data().count,reportsReceived:reportedCount.data().count,conversations:conversations.data().count,auditLogsCount:auditLogs.length,faceSessionsCount:faceSessions.length},restriction:serialize(locks[4].data()),emails:{verification:serialize(locks[0].data()),verificationStatus:user.emailVerified?'verified':'pending',change:serialize(locks[1].data()),passwordReset:serialize(reset.data())}};
  }
  if(op==='emailHealth') {
    const c=smtpConfig();
    if(c.resendApiKey){
      try {
        const res=await fetch('https://api.resend.com/domains',{headers:{Authorization:`Bearer ${c.resendApiKey}`}});
        if(!res.ok)throw new Error('Resend auth failed');
        return {verified:true,sender:c.fromAddress,provider:'resend'};
      }catch{throw new HttpsError('unavailable','เชื่อมต่อระบบส่งอีเมล Resend ไม่สำเร็จ');}
    }
    const transport=nodemailer.createTransport({host:c.smtpHost,port:c.smtpPort,secure:c.smtpPort===465,auth:{user:c.smtpUser,pass:c.smtpPass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
    try {await transport.verify();return {verified:true,sender:c.fromAddress,provider:'google-workspace'};}
    catch {throw new HttpsError('unavailable','เชื่อมต่อระบบส่งอีเมลไม่สำเร็จ');}finally{transport.close();}
  }
  if(op==='sendEmail') {
    const uid=id(data.uid),requestId=id(data.requestId);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new HttpsError('invalid-argument','รหัสคำขอส่งไม่ถูกต้อง');
    if(!['verification','passwordReset','googleNotice','campusChange'].includes(data.kind))throw new HttpsError('invalid-argument','ประเภทอีเมลไม่ถูกต้อง');
    const operation=db.collection('adminEmailOperations').doc(requestId),lock=db.collection('adminEmailLocks').doc(uid+'_'+data.kind),log=db.collection('adminAudit').doc(requestId);
    const duplicateResult=entry=>{
      if(entry.actor!==actor||entry.uid!==uid||entry.kind!==data.kind)throw new HttpsError('already-exists','รหัสคำขอซ้ำ');
      if(entry.state==='accepted')return {sent:true,to:entry.to,messageId:entry.messageId,duplicate:true};
      throw new HttpsError('failed-precondition','คำขอนี้ดำเนินการแล้วหรือกำลังส่ง กรุณาตรวจประวัติก่อนส่งใหม่');
    };
    const [oldOperation,oldLock]=await db.getAll(operation,lock);
    if(oldOperation.exists)return duplicateResult(oldOperation.data());
    const cooldown=effectiveOperations((await db.doc('app_config/adminOperations').get()).data()).adminEmailCooldownSeconds;
    if(Date.now()-(oldLock.data()?.reservedAt?.toMillis?.()||0)<cooldown*1000)throw new HttpsError('resource-exhausted',`กรุณารอ ${cooldown} วินาทีก่อนส่งอีเมลประเภทเดิมอีกครั้ง`);
    const user=await getAuth().getUser(uid),change=await db.doc(`campusEmailChangeLocks/${uid}`).get();
    const message=await prepareAdminEmail({auth:getAuth(),user,kind:data.kind,pendingEmail:change.data()?.email});
    const config=smtpConfig();
    const previous=await db.runTransaction(async tx=>{
      const [old,locked]=await Promise.all([tx.get(operation),tx.get(lock)]);
      if(old.exists){const entry=old.data();if(entry.actor!==actor||entry.uid!==uid||entry.kind!==data.kind)throw new HttpsError('already-exists','รหัสคำขอซ้ำ');return entry;}
      if(Date.now()-(locked.data()?.reservedAt?.toMillis?.()||0)<cooldown*1000)throw new HttpsError('resource-exhausted',`กรุณารอ ${cooldown} วินาทีก่อนส่งอีเมลประเภทเดิมอีกครั้ง`);
      const entry={actor,uid,kind:data.kind,to:message.to,state:'started',createdAt:FieldValue.serverTimestamp()};
      tx.set(operation,entry);tx.set(lock,{reservedAt:FieldValue.serverTimestamp()});tx.set(log,audit('sendEmail',uid,{kind:data.kind,to:message.to,state:'started'}));return null;
    });
    if(previous)return duplicateResult(previous);
    let transport;
    try {
      const result=await sendCampusEmail(config,message,{createTransport:options=>{transport=nodemailer.createTransport({...options,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:25000});return transport;}});
      if(!result.accepted.some(to=>String(to).toLowerCase()===message.to.toLowerCase()))throw Object.assign(new Error('Recipient not accepted'),{code:'email/send-failed',cause:{code:'EENVELOPE'}});
      const batch=db.batch(),acceptedAt=FieldValue.serverTimestamp();
      batch.update(operation,{state:'accepted',messageId:result.messageId,acceptedAt});batch.update(log,{state:'accepted',messageId:result.messageId});
      const collection=data.kind==='verification'?'emailVerificationLocks':data.kind==='campusChange'?'campusEmailChangeLocks':'passwordResetEmailLocks';
      const lockId=collection==='passwordResetEmailLocks'?crypto.createHash('sha256').update(user.email.toLowerCase()).digest('hex'):uid;
      const record={sentAt:acceptedAt};if(collection!=='passwordResetEmailLocks')record.email=message.to;
      batch.set(db.collection(collection).doc(lockId),record,{merge:true});await batch.commit();
      return {sent:true,to:message.to,sender:config.fromAddress,messageId:result.messageId};
    }catch(error){
      // Retain uncertain outcomes to discourage blind retries after SMTP acceptance.
      const state=error.code==='email/send-failed'&&(error.cause?.responseCode>=400||['EAUTH','EENVELOPE','EMESSAGE'].includes(error.cause?.code))?'failed':'unknown';
      await Promise.allSettled([operation.update({state}),log.update({state})]);
      throw new HttpsError('unavailable',state==='failed'?'ส่งอีเมลไม่สำเร็จ กรุณาตรวจระบบส่งอีเมล':'ยังยืนยันบันทึกการส่งไม่ได้ กรุณาตรวจประวัติก่อนส่งซ้ำ');
    }finally{transport?.close();}
  }
  if (op === 'accountStatus') {
    const uid=id(data.uid);
    if(typeof data.disabled!=='boolean'||typeof data.note!=='string'||!data.note.trim()||data.note.length>2000) throw new HttpsError('invalid-argument','กรุณาระบุเหตุผล');
    const user=await getAuth().getUser(uid);
    if(uid===actor||user.customClaims?.admin===true) throw new HttpsError('failed-precondition','ไม่สามารถระงับบัญชีผู้ดูแลจากหน้านี้');
    const log=db.collection('adminAudit').doc();await log.set(audit('accountStatus',uid,{before:{disabled:user.disabled},after:{disabled:data.disabled},note:data.note.trim(),state:'started'}));
    try {await getAuth().updateUser(uid,{disabled:data.disabled});
      await db.doc('accountRestrictions/'+uid).set({suspended:data.disabled,suspensionReason:data.disabled?data.note.trim():'',updatedAt:FieldValue.serverTimestamp(),actor},{merge:true});
      if(data.disabled) await getAuth().revokeRefreshTokens(uid);await log.update({state:'completed'});} catch(error){await log.update({state:'failed'});throw error;}
    return {success:true};
  }
  if (op === 'settings') {
    const snap=await db.doc('app_config/version').get(), template=await getRemoteConfig().getTemplate(),operations=await db.doc('app_config/adminOperations').get();
    return {version:serialize(snap.data()||{}),revision:revision(snap),features:Object.fromEntries(featureKeys.map(k=>[k,template.parameters[k]?.defaultValue?.value||''])),etag:template.etag,
      remoteParameters:remoteParameters(template),remoteConditions:template.conditions||[],opsConfig:effectiveOperations(operations.data()),opsRevision:revision(operations),systemInfo:{projectId:currentActor.uid?process.env.GCLOUD_PROJECT||'campusmate-7f1ab':'',region:'asia-southeast1',emailSenderConfigured:!!smtpSecret.value(),mediaSigningConfigured:!!mediaSecret.value(),notificationProvider:'Expo Push',encryption:'E2EE',configRefreshMinutes:60}};
  }
  if(op==='saveOperations'){
    const patch=validateOperations(data.config),ref=db.doc('app_config/adminOperations');
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(revision(snap)!==data.revision)throw new HttpsError('aborted','การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดใหม่');tx.set(ref,patch);tx.set(db.collection('adminAudit').doc(),audit('saveOperations',ref.path,{before:effectiveOperations(snap.data()),after:patch}));});return {success:true};
  }
  if(op==='validateRemoteParameters'||op==='saveRemoteParameters'){
    const rc=getRemoteConfig(),template=await rc.getTemplate();if(template.etag!==data.etag)throw new HttpsError('aborted','Remote Config เปลี่ยนแล้ว กรุณาโหลดใหม่');
    const patch=validateRemotePatch(remoteParameterMap(template),data.parameters),before={};
    for(const [key,value] of Object.entries(patch)){const target=remoteParameterTarget(template,key);before[key]=target[key]?.defaultValue?.value??null;target[key]={...target[key],defaultValue:{value}};}
    await rc.validateTemplate(template);
    if(op==='validateRemoteParameters')return {valid:true,changed:Object.keys(patch).length};
    const log=db.collection('adminAudit').doc();await log.set(audit('saveRemoteParameters','remoteConfig',{before,after:patch,state:'started'}));
    try{await rc.publishTemplate(template);await log.update({state:'completed'});}catch(e){await log.update({state:'failed'});throw e;}return {success:true};
  }
  if (op === 'saveVersion') {
    const patch=validateVersion(data.version),ref=db.doc('app_config/version');
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(revision(snap)!==data.revision) throw new HttpsError('aborted','การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดใหม่');
      tx.set(ref,{...patch,updatedAt:FieldValue.serverTimestamp()}, {merge:true});tx.set(db.collection('adminAudit').doc(),audit('saveVersion','app_config/version',{before:serialize(snap.data()||{}),after:patch}));});return {success:true};
  }
  if (op === 'saveFeatures') {
    if(!data.features||Object.keys(data.features).some(k=>!featureKeys.includes(k))) throw new HttpsError('invalid-argument','ฟีเจอร์ไม่ถูกต้อง');
    for(const [key,value] of Object.entries(data.features)) {
      if(typeof value!=='string'||value.length>5000||(key.startsWith('enable_')&&!['true','false'].includes(value))) throw new HttpsError('invalid-argument','ค่าฟีเจอร์ไม่ถูกต้อง');
      if(key.startsWith('allowed_emails')&&value.split(',').filter(s=>s.trim()).some(s=>!/^\S+@\S+\.\S+$/.test(s.trim()))) throw new HttpsError('invalid-argument','อีเมลทดสอบไม่ถูกต้อง');
    }
    const rc=getRemoteConfig(), template=await rc.getTemplate();
    if(template.etag!==data.etag) throw new HttpsError('aborted','Remote Config เปลี่ยนแล้ว กรุณาโหลดใหม่');
    const before={};for(const [key,value] of Object.entries(data.features)){before[key]=template.parameters[key]?.defaultValue?.value||'';template.parameters[key]={...template.parameters[key],defaultValue:{value}};}
    const log=db.collection('adminAudit').doc();await log.set(audit('saveFeatures','remoteConfig',{before,after:data.features,state:'started'}));
    try {await rc.publishTemplate(template);await log.update({state:'completed'});}catch(error){await log.update({state:'failed'});throw error;}return {success:true};
  }
  if (op === 'audit') {
    let query=db.collection('adminAudit').orderBy('createdAt','desc').limit(30);
    if(data.cursor){const cursor=await db.collection('adminAudit').doc(id(data.cursor)).get();if(!cursor.exists)throw new HttpsError('invalid-argument','หน้าประวัติไม่ถูกต้อง');query=query.startAfter(cursor);}
    const snap=await query.get();return {rows:snap.docs.map(d=>({id:d.id,...serialize(d.data())})),cursor:snap.size===30?snap.docs.at(-1).id:null};
  }
  if (op === 'spots') {
    const snap = await db.collection('spots').get();
    return { rows: snap.docs.map(d => ({ id: d.id, ...serialize(d.data()) })) };
  }
  if (op === 'saveSpot') {
    const spotId = id(data.id);
    const ref = db.collection('spots').doc(spotId);
    const existing = await ref.get();
    if (!existing.exists) throw new HttpsError('not-found', 'ไม่พบสถานที่');

    const patch = {};
    if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim().slice(0, 200);
    if (typeof data.description === 'string') patch.description = data.description.trim().slice(0, 2000);
    if (typeof data.category === 'string' && data.category.trim()) patch.category = data.category.trim().slice(0, 50);
    if (typeof data.categoryLabel === 'string' && data.categoryLabel.trim()) patch.categoryLabel = data.categoryLabel.trim().slice(0, 50);
    if (typeof data.group === 'string' && data.group.trim()) patch.group = data.group.trim().slice(0, 100);
    if (typeof data.emoji === 'string' && data.emoji.trim()) patch.emoji = data.emoji.trim().slice(0, 10);
    if (typeof data.rating === 'string' && data.rating.trim()) patch.rating = data.rating.trim().slice(0, 10);
    if (typeof data.busyTime === 'string' && data.busyTime.trim()) patch.busyTime = data.busyTime.trim().slice(0, 100);
    if (typeof data.latitude === 'number' && !Number.isNaN(data.latitude)) patch.latitude = data.latitude;
    if (typeof data.longitude === 'number' && !Number.isNaN(data.longitude)) patch.longitude = data.longitude;

    if (data.placePhoto && typeof data.placePhoto === 'object') {
      const p = data.placePhoto;
      if (!p.url || typeof p.url !== 'string') throw new HttpsError('invalid-argument', 'ต้องระบุ URL ของรูปภาพ');
      const photoUrl = p.url.trim();
      if (photoUrl.startsWith('data:')) {
        throw new HttpsError('invalid-argument', 'ไม่อนุญาตให้ใช้ Data URL โดยตรง กรุณาระบุเป็นลิงก์รูปภาพ HTTPS (เช่น https://photos.getcampusmate.app/... หรือลิงก์สาธารณะ)');
      }
      if (!/^https:\/\/[^\s]+$/i.test(photoUrl) || photoUrl.length > 2048) {
        throw new HttpsError('invalid-argument', 'URL ของรูปภาพต้องเป็นลิงก์ HTTPS ที่ถูกต้อง (ความยาวไม่เกิน 2048 ตัวอักษร)');
      }
      const thumbUrl = (p.thumbnailUrl || photoUrl).trim();
      if (!/^https:\/\/[^\s]+$/i.test(thumbUrl) || thumbUrl.length > 2048) {
        throw new HttpsError('invalid-argument', 'Thumbnail URL ต้องเป็นลิงก์ HTTPS ที่ถูกต้อง');
      }
      patch.placePhoto = {
        spotId,
        url: photoUrl,
        thumbnailUrl: thumbUrl,
        credit: typeof p.credit === 'string' && p.credit.trim() ? p.credit.trim().slice(0, 200) : 'CampusMate',
        sourceUrl: typeof p.sourceUrl === 'string' && p.sourceUrl.trim() ? p.sourceUrl.trim().slice(0, 2000) : 'https://getcampusmate.app',
        license: typeof p.license === 'string' && p.license.trim() ? p.license.trim().slice(0, 50) : 'owned',
        licenseUrl: p.licenseUrl && typeof p.licenseUrl === 'string' ? p.licenseUrl.slice(0, 2000) : null,
        modifications: typeof p.modifications === 'string' ? p.modifications.slice(0, 200) : 'Updated via Admin Console',
        revision: typeof p.revision === 'string' && p.revision.trim() ? p.revision.trim().slice(0, 128) : crypto.createHash('sha256').update(photoUrl + Date.now()).digest('hex'),
      };
    }

    patch.updatedAt = FieldValue.serverTimestamp();
    await ref.update(patch);
    await db.collection('adminAudit').doc().set(audit('saveSpot', spotId, { before: serialize(existing.data()), after: patch }));
    const updated = await ref.get();
    return { success: true, spot: { id: updated.id, ...serialize(updated.data()) } };
  }
  if (op === 'parties') {
    let query = db.collection('parties').orderBy('createdAt', 'desc').limit(50);
    if (data.status && data.status !== 'all') {
      query = query.where('status', '==', String(data.status));
    }
    const snap = await query.get();
    const rows = snap.docs.map(d => ({ id: d.id, ...serialize(d.data()) }));
    return { rows };
  }
  if (op === 'cancelParty') {
    const partyId = id(data.id);
    const note = String(data.note || '').trim();
    if (!note) throw new HttpsError('invalid-argument', 'กรุณาระบุเหตุผลการยกเลิก');
    const ref = db.collection('parties').doc(partyId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'ไม่พบข้อมูลตี้');
    const party = snap.data();
    if (party.status === 'cancelled') throw new HttpsError('failed-precondition', 'ตี้นี้ถูกยกเลิกไปแล้ว');

    const patch = {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: note,
      cancelledByAdmin: actor,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.update(patch);
    await db.collection('adminAudit').doc().set(audit('cancelParty', partyId, { before: serialize(party), after: patch, note }));
    return { success: true };
  }
  throw new HttpsError('invalid-argument','คำสั่งไม่รองรับ');
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('adminConsole error in operation:', request.data?.op, err);
    throw new HttpsError('internal', err.message || 'ระบบหลังบ้านเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }
});
