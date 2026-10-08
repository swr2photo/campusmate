import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createR2WorkerUpload} from './r2UploadTicket.js';
import {createDeleteTicket} from './adminModeration.js';
import {mediaProbeFetch} from '../scripts/media-probe-fetch.mjs';
if(!process.argv.includes('--live'))throw new Error('Pass --live for disposable production QA');
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/This PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const credentials=spawnSync('cmd.exe',['/d','/s','/c','gcloud secrets versions access latest --secret=R2_UPLOAD_SIGNING_KEY --project=campusmate-7f1ab'],{encoding:'utf8'});if(credentials.status!==0)throw new Error('Unable to load moderation signing credential');const secret=credentials.stdout.trim();
const app=initializeApp({projectId:'campusmate-7f1ab'}),db=getFirestore(app),auth=getAuth(app),tag='admin-qa-mod-'+Date.now(),actor=tag+'-admin',alice=tag+'-alice',bob=tag+'-bob',room=tag+'-room',report=tag+'-report',password=crypto.randomBytes(24).toString('base64url')+'Aa1!',domain='https://media.getcampusmate.app',key=`chat_media/${room}/fixture.enc`;
const r=db.doc('reports/'+report),c=db.doc('conversations/'+room),m=c.collection('messages').doc('reported'),good=c.collection('messages').doc('unrelated'),upload=createR2WorkerUpload({domain,secret,objectKey:key}),request=(url,options={})=>mediaProbeFetch(url,{...options,signal:AbortSignal.timeout(25000)});
let browser,page;
try{
 for(const uid of [actor,alice,bob])await auth.createUser({uid,email:uid+'@example.test',password,emailVerified:true});await auth.setCustomUserClaims(actor,{admin:true});
 await db.doc('users/'+bob).set({id:bob,name:'QA reported user',faculty:'QA faculty',age:22,isDiscoverable:false});await c.set({participants:[alice,bob],lastMessageId:'reported',lastMessage:'encrypted'});await m.set({id:'reported',senderId:bob,encrypted:true,ciphertext:'fixture',nonce:'fixture',createdAt:FieldValue.serverTimestamp()});await good.set({id:'unrelated',senderId:alice,text:'keep fixture'});
 await r.set({reporterId:alice,reportedUserId:bob,conversationId:room,messageId:'reported',mediaUrl:upload.downloadUrl,status:'pending',reason:'QA moderation fixture',messageText:'[รูปภาพ]',createdAt:FieldValue.serverTimestamp()});
 assert.equal((await request(upload.uploadUrl,{method:'PUT',headers:upload.uploadHeaders,body:new Uint8Array(128)})).status,201);
 assert.equal((await request(upload.downloadUrl)).status,200);
 assert.equal((await request(`${domain}/moderate/${key}`,{method:'DELETE',headers:upload.uploadHeaders})).status,403);
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let cancel=false,dialogs=0;page.on('dialog',async d=>{dialogs++;if(cancel){cancel=false;await d.dismiss();}else await d.accept();});
 await page.goto('https://campusmate-7f1ab.web.app/admin.html');await page.getByLabel('อีเมล',{exact:true}).fill(actor+'@example.test');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.getByText('ดูแลชุมชนให้ปลอดภัย').waitFor();await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.locator('nav').getByRole('button',{name:'ผู้ใช้และอีเมล'}).click();await page.getByLabel('อีเมลหรือ UID').fill(alice);await page.getByRole('button',{name:'ค้นหา',exact:true}).click();await page.getByRole('heading',{name:alice+'@example.test',exact:true}).waitFor();
 await page.locator('nav').getByRole('button',{name:'รายงานจากผู้ใช้'}).click();await page.getByRole('button',{name:/QA moderation fixture/}).click();await page.getByRole('heading',{name:'QA reported user'}).waitFor();await page.getByText('QA faculty',{exact:true}).waitFor();await page.getByLabel('ผลการตรวจสอบ').fill('QA disposable moderation warning');
 cancel=true;await page.getByRole('button',{name:'ลบข้อความและไฟล์สื่อ',exact:true}).click();assert.equal((await m.get()).exists,true);
 await page.screenshot({path:'artifacts/admin-report-moderation-details.png',fullPage:true});
 await page.getByRole('button',{name:'ลบข้อความและไฟล์สื่อ',exact:true}).click();await page.getByRole('status').filter({hasText:'ดำเนินการแล้วและบันทึกคำเตือนผู้ใช้'}).waitFor({timeout:60000});
 assert.equal((await m.get()).exists,false);assert.equal((await good.get()).exists,true);assert.equal((await r.get()).data().moderation.mediaState,'deleted');assert.equal((await request(upload.downloadUrl,{method:'HEAD'})).status,404);assert.equal((await request(upload.uploadUrl,{method:'PUT',headers:upload.uploadHeaders,body:new Uint8Array(128)})).status,410);assert.equal((await db.doc('accountRestrictions/'+bob).get()).data().latestWarning.message,'QA disposable moderation warning');
 await page.locator('.report-person').filter({hasText:'ผู้ถูกรายงาน'}).getByRole('button',{name:'ตรวจบัญชีและอีเมล'}).click();await page.getByRole('heading',{name:'QA reported user'}).waitFor();await page.waitForFunction(()=>!document.querySelector('.loading'));
 await page.getByRole('button',{name:'ระงับบัญชี',exact:true}).click();await page.getByRole('alert').filter({hasText:'กรุณากรอกเหตุผล'}).waitFor();
 await page.getByLabel('เหตุผลการเปลี่ยนสถานะ (จำเป็น)').fill('QA disposable suspension');await page.getByRole('button',{name:'ระงับบัญชี',exact:true}).click();await page.getByRole('button',{name:'เปิดใช้งานบัญชี',exact:true}).waitFor();assert.equal((await auth.getUser(bob)).disabled,true);
 await page.getByLabel('เหตุผลการเปลี่ยนสถานะ (จำเป็น)').fill('QA restore');await page.getByRole('button',{name:'เปิดใช้งานบัญชี',exact:true}).click();await page.getByRole('button',{name:'ระงับบัญชี',exact:true}).waitFor();assert.equal((await auth.getUser(bob)).disabled,false);
 await page.getByRole('button',{name:'รีเฟรช',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.loading'));await page.getByText('ยืนยันบัญชีแล้ว',{exact:true}).waitFor();await page.screenshot({path:'artifacts/admin-account-restrictions.png',fullPage:true});
 assert.equal(errors.length,0);assert.ok(dialogs>=4);console.log(JSON.stringify({passed:true,flows:['detailedReport','cancelDeletion','deployedMessageAndR2Deletion','unrelatedMessagePreserved','oldURL404','uploadReplayBlocked','warningPersisted','reasonRequired','suspend','restore','refresh','verificationStatus'],externalNotificationsSent:0,realUserDataChanged:false,errors}));
}catch(e){if(page){await page.screenshot({path:'artifacts/admin-moderation-qa-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-2400));}throw e;}
finally{
 await browser?.close();await request(`${domain}/moderate/${key}`,{method:'DELETE',headers:{Authorization:'Bearer '+createDeleteTicket(key,secret)}}).catch(()=>{});
 await db.recursiveDelete(c);await r.delete();for(const uid of [actor,alice,bob]){await db.doc('users/'+uid).delete();await db.doc('accountRestrictions/'+uid).delete();await auth.deleteUser(uid).catch(()=>{});await db.doc('profiles/'+uid).delete();await db.doc('discoveryProfiles/'+uid).delete();}
 for(const collection of ['adminAudit','adminModerationEvidence']){const docs=await db.collection(collection).where('actor','==',actor).get();for(const doc of docs.docs)await doc.ref.delete();}await db.terminate();await deleteApp(app);
}
