// Explicit live smoke test: creates and removes its own disposable fixtures only.
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {adminConsole} from './adminFunctions.js';
if(!process.argv.includes('--live'))throw new Error('Pass --live to test against campusmate-7f1ab');
const app=initializeApp({projectId:'campusmate-7f1ab'}),db=getFirestore(app),auth=getAuth(app);
const uid='admin-qa-'+Date.now(),report='admin-qa-report-'+Date.now(),checks=[];
const call=data=>adminConsole.run({data,auth:{uid,token:{admin:true,email_verified:true}}});
try{
 await auth.createUser({uid,email:uid+'@example.test',emailVerified:true});await auth.setCustomUserClaims(uid,{admin:true});
 for(const op of ['overview','reports','settings','audit','spots','parties']){const r=await call({op});checks.push({op,passed:true,rows:r.rows?.length,remoteParameters:r.remoteParameters?.length,spotCount:r.spotCount,openPartiesCount:r.openPartiesCount});}
 await db.doc('reports/'+report).set({reporterId:uid,reason:'Admin QA fixture',status:'pending',createdAt:FieldValue.serverTimestamp()});
 const snap=await db.doc('reports/'+report).get(),revision=`${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}`;
 await call({op:'review',id:report,status:'resolved',note:'QA fixture only',revision});
 if((await db.doc('reports/'+report).get()).data().status!=='resolved')throw new Error('Review was not saved');checks.push({op:'review',passed:true});
 try{await call({op:'review',id:report,status:'dismissed',note:'conflict test',revision});throw new Error('Conflict was not rejected');}catch(e){if(e.code!=='aborted')throw e;checks.push({op:'staleRevisionDenied',passed:true});}
 const logs=await db.collection('adminAudit').where('actor','==',uid).get();if(logs.size!==1)throw new Error('Audit missing');checks.push({op:'auditRecorded',passed:true});
 await auth.setCustomUserClaims(uid,{});try{await call({op:'overview'});throw new Error('Revoked admin was accepted');}catch(e){if(e.code!=='permission-denied')throw e;checks.push({op:'revokedAdminDenied',passed:true});}
 console.log(JSON.stringify({checks},null,2));
}finally{
 await db.doc('reports/'+report).delete();const logs=await db.collection('adminAudit').where('actor','==',uid).get();for(const d of logs.docs)await d.ref.delete();
 await auth.deleteUser(uid).catch(()=>{});await db.terminate();await deleteApp(app);
}
