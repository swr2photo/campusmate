import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/This PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
if(!process.argv.includes('--live'))throw new Error('Pass --live for disposable production QA');
const app=initializeApp({projectId:'campusmate-7f1ab'}),auth=getAuth(app),db=getFirestore(app);
const uid='admin-web-qa-'+Date.now(),email=uid+'@example.test',password=crypto.randomBytes(24).toString('base64url')+'Aa1!',report='admin-qa-report-'+Date.now();
let browser, page;
try{
 await auth.createUser({uid,email,password,emailVerified:true});await auth.setCustomUserClaims(uid,{admin:true});
 await db.doc('reports/'+report).set({reporterId:uid,reason:'QA fixture · ทดสอบระบบแอดมิน',details:'ข้อมูลทดสอบชั่วคราว ลบหลังการตรวจ',mediaUrl:'https://campusmate-7f1ab.web.app/brand-icon.png',status:'pending',createdAt:FieldValue.serverTimestamp()});
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(process.env.ADMIN_QA_URL||'http://127.0.0.1:5183/admin.html');
 await page.getByLabel('อีเมล',{exact:true}).fill(email);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await page.getByText('ดูแลชุมชนให้ปลอดภัย').waitFor();await page.waitForFunction(()=>!document.querySelector('.loading'));if(await page.locator('[role=alert]').count())throw new Error(await page.locator('[role=alert]').innerText());
 mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/admin-live-overview.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'รายงานจากผู้ใช้'}).click();await page.getByRole('button',{name:/QA fixture/}).click();
 await page.waitForFunction(()=>{const img=document.querySelector('.report-image-button img');return img?.complete&&img.naturalWidth>0;});
 await page.getByRole('button',{name:'ขยายรูปภาพที่แนบในรายงาน'}).click();await page.getByRole('dialog',{name:'รูปภาพที่แนบในรายงาน'}).waitFor();await page.getByRole('button',{name:'ปิดรูปภาพ'}).click();
 const encrypted=page.getByRole('button',{name:/^nudity/});if(await encrypted.count()){await encrypted.first().click();await page.getByText('รูปภาพนี้เข้ารหัสไว้',{exact:true}).waitFor();await page.screenshot({path:'artifacts/admin-report-encrypted.png',fullPage:true});await page.getByRole('button',{name:/QA fixture/}).click();}
 await page.getByLabel('ผลการตรวจสอบ').fill('ตรวจสอบข้อมูลทดสอบแล้ว');await page.locator('.detail select').selectOption('resolved');await page.getByRole('button',{name:'บันทึกผลการตรวจสอบ'}).click();await page.getByText('บันทึกผลการตรวจสอบแล้ว',{exact:true}).waitFor();
 await page.locator('nav').getByRole('button',{name:'ผู้ใช้และอีเมล'}).click();await page.getByLabel('อีเมลหรือ UID').fill('6710210317@psu.ac.th');await page.getByRole('button',{name:'ค้นหา',exact:true}).click();await page.getByRole('heading',{name:'6710210317@psu.ac.th'}).waitFor();
 await page.waitForFunction(()=>{const img=document.querySelector('.admin-avatar img');return img?.complete&&img.naturalWidth>0;});
 await page.getByRole('button',{name:'ขยายรูปโปรไฟล์ผู้ใช้'}).click();await page.getByRole('dialog',{name:'รูปโปรไฟล์ผู้ใช้'}).waitFor();await page.getByRole('button',{name:'ปิดรูปภาพ'}).click();
 await page.getByRole('button',{name:'ตรวจระบบส่ง'}).click();await page.getByText(/เชื่อมต่อ SMTP สำเร็จ/).waitFor();
 let simulatedSend=false;
 await page.route('**/adminConsole',async route=>{const request=route.request();if(request.method()!=='POST'){await route.continue();return;}const payload=request.postDataJSON();if(payload.data?.op==='sendEmail'){
  if(payload.data.kind!=='passwordReset'||!payload.data.requestId)throw new Error('Email menu sent wrong request');simulatedSend=true;
  await route.fulfill({contentType:'application/json',body:JSON.stringify({result:{sent:true,to:'6710210317@psu.ac.th',messageId:'ui-fixture-no-email'}})});
 }else await route.continue();});
 await page.getByLabel('ประเภทอีเมล').selectOption('passwordReset');await page.getByRole('button',{name:'ส่งอีเมล',exact:true}).click();await page.getByText(/เซิร์ฟเวอร์รับอีเมลไปที่/).waitFor();if(!simulatedSend)throw new Error('Email menu did not call API');await page.unroute('**/adminConsole');
 await page.screenshot({path:'artifacts/admin-user-email-tools.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'การตั้งค่าระบบ'}).click();await page.getByLabel('เวอร์ชันล่าสุด').waitFor();await page.screenshot({path:'artifacts/admin-live-settings.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'ประวัติการจัดการ'}).click();await page.getByText('ดูการเปลี่ยนแปลง').first().waitFor();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/admin-live-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow||errors.length)throw new Error(JSON.stringify({overflow,errors}));
 const anonymous=await fetch('https://asia-southeast1-campusmate-7f1ab.cloudfunctions.net/adminConsole',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{op:'overview'}})});
 if(anonymous.status!==401)throw new Error('Anonymous access was not rejected: '+anonymous.status);
 console.log(JSON.stringify({passed:true,liveFlows:['login','overview','reportImagePreview','imageExpand','encryptedReportNotice','reportReview','userLookup','avatarRender','avatarExpand','smtpHealth','settingsRead','audit','mobile','anonymousDenied'],simulatedFlows:['emailSendMenu'],externalEmailsSent:0,errors,overflow}));
}catch(e){if(page){await page.screenshot({path:'artifacts/admin-qa-failure.png',fullPage:true});console.error(JSON.stringify({visibleText:(await page.locator('body').innerText()).slice(0,1500)}));}console.error(JSON.stringify({passed:false,message:e.message}));process.exitCode=1;}
finally{await browser?.close();await db.doc('reports/'+report).delete();const logs=await db.collection('adminAudit').where('actor','==',uid).get();for(const d of logs.docs)await d.ref.delete();await auth.deleteUser(uid).catch(()=>{});await db.terminate();await deleteApp(app);}
