// Exercises live Auth/Firestore with a stubbed SMTP transport. No emails sent.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {adminConsole} from './adminFunctions.js';
if(!process.argv.includes('--live'))throw new Error('Pass --live to use disposable Auth/Firestore fixtures');
process.env.CAMPUSMATE_ADMIN_SMTP_CONFIG=JSON.stringify({SMTP_USER:'test@example.test',SMTP_PASS:'fixture-password'});
const app=initializeApp({projectId:'campusmate-7f1ab'}),db=getFirestore(app),auth=getAuth(app);
const actor='admin-mail-qa-'+Date.now(),uid='email-qa-'+Date.now(),email='999999'+String(Date.now()).slice(-4)+'@psu.ac.th';
const requests=[],original=nodemailer.createTransport;let sends=0;
nodemailer.createTransport=()=>({sendMail:async payload=>{sends++;return {messageId:'qa-stub-'+sends,accepted:[payload.to],rejected:[],response:'250 fixture only'};},close:()=>{}});
const call=data=>adminConsole.run({data,auth:{uid:actor,token:{admin:true,email_verified:true}}});
try{
 await auth.createUser({uid:actor,email:actor+'@example.test',emailVerified:true});await auth.setCustomUserClaims(actor,{admin:true});
 await auth.createUser({uid,email,password:crypto.randomBytes(20).toString('hex')+'Aa1!'});
 const requestId=crypto.randomUUID();requests.push(requestId);
 const first=await call({op:'sendEmail',uid,kind:'verification',requestId});const repeat=await call({op:'sendEmail',uid,kind:'verification',requestId});
 if(!first.sent||!repeat.duplicate||sends!==1)throw new Error('Duplicate send was not prevented');
 const rateId=crypto.randomUUID();requests.push(rateId);try{await call({op:'sendEmail',uid,kind:'verification',requestId:rateId});throw new Error('Rate limit missing');}catch(e){if(e.code!=='resource-exhausted')throw e;}
 const resetId=crypto.randomUUID();requests.push(resetId);await call({op:'sendEmail',uid,kind:'passwordReset',requestId:resetId});
 if(sends!==2||(await db.doc('adminAudit/'+resetId).get()).data().state!=='accepted')throw new Error('Reset audit missing');
 const user=await call({op:'user',query:uid});if(!user.emails.verification.sentAt||!user.emails.passwordReset.sentAt)throw new Error('Email times not saved');
 console.log(JSON.stringify({passed:true,externalEmailsSent:0,checks:['verification','reset','duplicateSuppression','rateLimit','audit','timestamps']}));
}catch(e){console.error(JSON.stringify({passed:false,message:e.message,code:e.code}));process.exitCode=1;}
finally{
 nodemailer.createTransport=original;
 for(const r of requests){await db.doc('adminEmailOperations/'+r).delete();await db.doc('adminAudit/'+r).delete();}
 for(const kind of ['verification','passwordReset'])await db.doc('adminEmailLocks/'+uid+'_'+kind).delete();
 await db.doc('emailVerificationLocks/'+uid).delete();await db.doc('passwordResetEmailLocks/'+crypto.createHash('sha256').update(email).digest('hex')).delete();
 await auth.deleteUser(uid).catch(()=>{});await auth.deleteUser(actor).catch(()=>{});await db.terminate();await deleteApp(app);
}
