import { HttpsError } from 'firebase-functions/v2/https';
export const OPERATION_DEFAULTS={customNotificationsEnabled:true,notificationCooldownSeconds:60,maxNotificationRecipients:500,adminEmailCooldownSeconds:60};
export const PROFILE_FIELDS=['name','nickname','studentId','campusEmail','age','gender','faculty','year','bio','activities','activity','activityLabel','activityDetails','skill','pace','availability','availabilitySlots','tags','interests','gallery','favoriteTracks','isDiscoverable','notificationsEnabled','privacy','matchingPreferences','locationEnabled','consentAcceptedAt','consentVersion','createdAt','updatedAt','lastActiveAt','canCall','isCallTester','isTester','isFaceVerified','faceVerificationStatus','faceMatchScore','faceVerifiedAt'];
const sensitive=/password|secret|token|private.?key|public.?key|api.?key|credential|ciphertext|nonce|latitude|longitude/i;
export function safeProfile(profile={}){
 const scrub=value=>{if(value?.toDate)return value.toDate().toISOString();if(Array.isArray(value))return value.slice(0,100).map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!sensitive.test(k)).map(([k,v])=>[k,scrub(v)]));return value;};
 return scrub(Object.fromEntries(PROFILE_FIELDS.filter(k=>profile[k]!==undefined).map(k=>[k,profile[k]])));
}
export function userSummary(user,profile={}){return {uid:user.uid,email:user.email||'',emailVerified:user.emailVerified,disabled:user.disabled,isAdmin:user.customClaims?.admin===true||profile.isAdmin===true||profile.role==='admin',createdAt:user.metadata.creationTime,lastSignIn:user.metadata.lastSignInTime,name:profile.name||user.displayName||'',nickname:profile.nickname||'',faculty:profile.faculty||'',studentId:profile.studentId||'',avatarUrl:profile.avatarUri||user.photoURL||'',avatarRevision:profile.avatarRevision||0,profileExists:Object.keys(profile).length>0,isFaceVerified:profile.isFaceVerified===true,faceVerificationStatus:profile.faceVerificationStatus||(profile.isFaceVerified?'verified':'unverified'),faceMatchScore:profile.faceMatchScore??null};}
export function validateOperations(input){
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(OPERATION_DEFAULTS,k)))throw new HttpsError('invalid-argument','การตั้งค่าการจัดการไม่ถูกต้อง');
 const out={...OPERATION_DEFAULTS,...input};if(typeof out.customNotificationsEnabled!=='boolean')throw new HttpsError('invalid-argument','สถานะการส่งแจ้งเตือนไม่ถูกต้อง');
 for(const [key,min,max] of [['notificationCooldownSeconds',30,3600],['maxNotificationRecipients',1,1000],['adminEmailCooldownSeconds',60,3600]])if(!Number.isSafeInteger(out[key])||out[key]<min||out[key]>max)throw new HttpsError('invalid-argument',`${key} ต้องอยู่ระหว่าง ${min}–${max}`);
 return out;
}
export function effectiveOperations(input){try{return validateOperations(input||{});}catch{return {...OPERATION_DEFAULTS};}}
export function validateRemotePatch(parameters,patch){
 if(!patch||Array.isArray(patch)||Object.keys(patch).length===0||Object.keys(patch).length>100)throw new HttpsError('invalid-argument','กรุณาระบุพารามิเตอร์ที่ต้องการแก้');
 const out={};for(const [key,value] of Object.entries(patch)){
  const p=parameters[key];if(!Object.hasOwn(parameters,key)||!p||sensitive.test(key)||typeof value!=='string'||value.length>10000)throw new HttpsError('invalid-argument','พารามิเตอร์หรือค่าที่ส่งไม่ถูกต้อง');
  if((p.valueType==='BOOLEAN'||key.startsWith('enable_feature_'))&&!['true','false'].includes(value))throw new HttpsError('invalid-argument',key+' ต้องเป็น true หรือ false');
  if(p.valueType==='NUMBER'&&(!value.trim()||!Number.isFinite(Number(value))))throw new HttpsError('invalid-argument',key+' ต้องเป็นตัวเลข');
  if(p.valueType==='JSON'){try{JSON.parse(value);}catch{throw new HttpsError('invalid-argument',key+' ต้องเป็น JSON ที่ถูกต้อง');}}
  if(key.startsWith('allowed_emails_')&&value.split(',').filter(s=>s.trim()).some(s=>!/^\S+@\S+\.\S+$/.test(s.trim())))throw new HttpsError('invalid-argument','อีเมลผู้ทดสอบไม่ถูกต้อง');
  out[key]=value;
 }return out;
}
export function remoteParameterMap(template){return Object.assign({},template.parameters,...Object.values(template.parameterGroups||{}).map(g=>g.parameters||{}));}
export function remoteParameterTarget(template,key){if(Object.hasOwn(template.parameters,key))return template.parameters;return Object.values(template.parameterGroups||{}).find(g=>Object.hasOwn(g.parameters||{},key))?.parameters;}
export function remoteParameters(template){return Object.entries(remoteParameterMap(template)).filter(([key])=>!sensitive.test(key)).map(([key,p])=>({key,group:Object.entries(template.parameterGroups||{}).find(([,g])=>Object.hasOwn(g.parameters||{},key))?.[0]||'',type:p.valueType||'STRING',description:p.description||'',value:p.defaultValue?.value??null,conditional:!!Object.keys(p.conditionalValues||{}).length,conditionalValues:p.conditionalValues||{},usedByApp:['enable_feature_call','allowed_uids_call','allowed_emails_call','enable_feature_spotify','allowed_uids_spotify','allowed_emails_spotify'].includes(key)}));}
export function validateNotification(data){
 const title=typeof data.title==='string'?data.title.trim():'',body=typeof data.body==='string'?data.body.trim():'';
 if(!title||title.length>80||!body||body.length>1000||!['selected','all'].includes(data.audience))throw new HttpsError('invalid-argument','กรอกหัวข้อไม่เกิน 80 ตัวอักษร และข้อความไม่เกิน 1,000 ตัวอักษร');
 const route=data.route||'/home';if(!['/home','/discover','/meetup','/me','/chat'].includes(route))throw new HttpsError('invalid-argument','หน้าในแอปไม่ถูกต้อง');
 const uids=data.audience==='selected'?[...new Set(Array.isArray(data.uids)?data.uids:[])]:[];
 if(data.audience==='selected'&&(!uids.length||uids.length>1000||uids.some(uid=>typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(uid))))throw new HttpsError('invalid-argument','กรุณาเลือกผู้รับที่ถูกต้อง');
 return {title,body,route,audience:data.audience,uids};
}
