import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const {chromium}=createRequire(import.meta.url)('C:/Users/This PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
if(!process.argv.includes('--live'))throw new Error('--live required');
const app=initializeApp({projectId:'campusmate-7f1ab'}),auth=getAuth(app),db=getFirestore(app),tag='picker-qa-'+Date.now(),actor=tag+'-admin',first=tag+'-one',second=tag+'-two',password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
let browser,page,featurePayload,previewPayload;const errors=[];let externalWrites=0;
try{
 for(const uid of [actor,first,second])await auth.createUser({uid,email:uid+'@example.test',emailVerified:true,...(uid===actor?{password}:{}),disabled:uid===second});await auth.setCustomUserClaims(actor,{admin:true});
 await db.doc('users/'+first).set({name:'Picker first QA',faculty:'คณะวิทยาศาสตร์',avatarUri:'https://campusmate-7f1ab.web.app/brand-icon.png',notificationsEnabled:true});await db.doc('users/'+second).set({name:'Picker second QA',faculty:'คณะวิศวกรรมศาสตร์'});
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/adminConsole',async route=>{
  const data=route.request().postDataJSON()?.data;
  if(data?.op==='settings'){const response=await route.fetch(),body=await response.json();body.result.features={enable_feature_call:'false',allowed_uids_call:'legacy-unknown-uid',allowed_emails_call:first+'@example.test',enable_feature_spotify:'false',allowed_uids_spotify:'',allowed_emails_spotify:''};return route.fulfill({response,json:body});}
  if(data?.op==='saveFeatures'){featurePayload=data.features;return route.fulfill({json:{result:{success:true}}});}
  if(data?.op==='previewNotification')previewPayload=data;
  if(['sendNotification','saveRemoteParameters','saveOperations'].includes(data?.op)){externalWrites++;return route.abort();}
  return route.continue();
 });
 await page.goto('https://campusmate-7f1ab.web.app/admin.html');await page.getByLabel('อีเมล',{exact:true}).fill(actor+'@example.test');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.getByText('ดูแลชุมชนให้ปลอดภัย').waitFor();await page.locator('nav').getByRole('button',{name:'การตั้งค่าระบบ'}).click();
 const call=page.getByRole('region',{name:'ผู้ทดสอบ การโทร',exact:true}),spotify=page.getByRole('region',{name:'ผู้ทดสอบ Spotify',exact:true});
 await call.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้ทดสอบ การโทร',exact:true}).waitFor();assert.equal(await call.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้ทดสอบ การโทร',exact:true}).isChecked(),true);
 await call.getByLabel('ค้นหาโปรไฟล์ ผู้ทดสอบ การโทร',{exact:true}).fill('Picker second QA');await call.getByRole('checkbox',{name:'เลือก Picker second QA สำหรับ ผู้ทดสอบ การโทร',exact:true}).check();await call.getByLabel('ค้นหาโปรไฟล์ ผู้ทดสอบ การโทร',{exact:true}).fill('');assert.equal(await call.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้ทดสอบ การโทร',exact:true}).isChecked(),true);
 await spotify.getByLabel('ค้นหาโปรไฟล์ ผู้ทดสอบ Spotify',{exact:true}).fill('Picker first QA');await spotify.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้ทดสอบ Spotify',exact:true}).check();await page.screenshot({path:'artifacts/admin-feature-profile-picker.png',fullPage:true});
 await page.getByRole('button',{name:'เผยแพร่การตั้งค่าฟีเจอร์',exact:true}).click();await page.getByRole('status').filter({hasText:'เผยแพร่การตั้งค่าฟีเจอร์แล้ว'}).waitFor();assert.ok(featurePayload.allowed_uids_call.split(',').includes(second));assert.ok(featurePayload.allowed_uids_call.split(',').includes('legacy-unknown-uid'));assert.equal(featurePayload.allowed_emails_call,first+'@example.test');assert.equal(featurePayload.allowed_uids_spotify,first);
 await page.locator('nav').getByRole('button',{name:'ส่งแจ้งเตือน',exact:true}).click();const recipients=page.getByRole('region',{name:'ผู้รับแจ้งเตือน',exact:true});await recipients.getByLabel('ค้นหาโปรไฟล์ ผู้รับแจ้งเตือน',{exact:true}).fill('Picker');await recipients.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้รับแจ้งเตือน',exact:true}).check();assert.equal(await recipients.getByRole('checkbox',{name:'เลือก Picker second QA สำหรับ ผู้รับแจ้งเตือน',exact:true}).isDisabled(),true);
 await recipients.getByRole('button',{name:'นำออก Picker first QA',exact:true}).click();assert.equal(await recipients.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้รับแจ้งเตือน',exact:true}).isChecked(),false);await recipients.getByRole('checkbox',{name:'เลือก Picker first QA สำหรับ ผู้รับแจ้งเตือน',exact:true}).check();
 await page.getByLabel('หัวข้อแจ้งเตือน',{exact:true}).fill('Picker QA preview only');await page.getByLabel('ข้อความแจ้งเตือน',{exact:true}).fill('No external notification');await page.getByRole('button',{name:'ตรวจผู้รับและสร้างตัวอย่าง',exact:true}).click();await page.getByText('ไม่มีอุปกรณ์รับ Push ในกลุ่มนี้',{exact:false}).waitFor();assert.deepEqual(previewPayload.uids,[first]);await page.screenshot({path:'artifacts/admin-notification-profile-picker.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'artifacts/admin-profile-picker-mobile.png',fullPage:true});assert.deepEqual(errors,[]);assert.equal(externalWrites,0);
 console.log(JSON.stringify({passed:true,flows:['existingEmailSelection','profileSearch','multipleFeatureTesters','legacyPreserved','featurePayloadSimulated','recipientSelection','disabledRecipient','removeRecipient','actualRecipientPreview','mobile'],remoteConfigWrites:0,externalNotificationsSent:0,errors}));
}catch(e){if(page){await page.screenshot({path:'artifacts/admin-picker-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));}throw e;}finally{
 await browser?.close();for(const uid of [actor,first,second]){await auth.deleteUser(uid).catch(()=>{});await db.doc('users/'+uid).delete();}const rows=await db.collection('adminNotificationPreviews').where('actor','==',actor).get();for(const row of rows.docs)await row.ref.delete();await db.terminate();await deleteApp(app);
}
