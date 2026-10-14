import React, { useState } from 'react';
import { initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { FaceLivenessDetectorCore } from '@aws-amplify/ui-react-liveness';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const MEDIA_HOST = 'images.getcampusmate.app';
// Reads only the signed-in person's own users/{uid} document (rules allow the
// owner) and reports where the primary photo lives. Shown on this screen only.
async function photoCheck(user) {
  const snap = await getDoc(doc(getFirestore(user.auth.app), 'users', user.uid));
  const raw = snap.exists() ? snap.data().avatarUri : null;
  if (typeof raw !== 'string' || !raw) return { present: false };
  try {
    const url = new URL(raw);
    const path = url.pathname.match(/^\/users\/([^/]+)\/avatar\.(jpe?g|png|webp)$/i);
    const ownPath = Boolean(path && decodeURIComponent(path[1]) === user.uid);
    let sameFile = null;
    if (ownPath && url.hostname !== MEDIA_HOST) {
      const compared = await fetch('/api/photo-compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: url.pathname }) }).then(r => r.json()).catch(() => null);
      sameFile = compared ? compared.same : null;
    }
    return { present: true, host: url.hostname, ownPath, sameFile, acceptedHost: url.hostname === MEDIA_HOST && url.protocol === 'https:' };
  } catch { return { present: true, host: 'ไม่ใช่ URL', ownPath: false, acceptedHost: false }; }
}

let auth;
async function currentAuth() {
  if (!auth) {
    const config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
    auth = initializeAuth(initializeApp(config, 'rust-staging'), { persistence: inMemoryPersistence });
  }
  return auth;
}
async function api(path, method = 'GET', body) {
  const user = (await currentAuth()).currentUser;
  if (!user) throw new Error('กรุณาเข้าสู่ระบบ');
  const uid = user.uid;
  const token = await user.getIdToken();
  const response = await fetch(`/api/identity/${path}`, {
    method, cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (auth.currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว');
  if (!response.ok) throw new Error(result.error?.details?.reason || result.error?.code || 'SERVICE_UNAVAILABLE');
  return result;
}

export default function RustApp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('เข้าสู่ระบบด้วยบัญชี CampusMate ที่ยืนยันอีเมลมหาวิทยาลัยแล้ว');
  const [result, setResult] = useState(null);
  const [photo, setPhoto] = useState(null);
  async function login(event) {
    event.preventDefault(); setBusy(true);
    try {
      await signInWithEmailAndPassword(await currentAuth(), email, password);
      setPassword(''); setSignedIn(true);
      photoCheck((await currentAuth()).currentUser).then(setPhoto).catch(() => setPhoto({ error: true }));
      const status = await api('photo-verification'); setResult(status);
      setNotice('พร้อมทดสอบกับรูปโปรไฟล์หลักของบัญชีนี้');
    } catch { setNotice('ยังเข้าสู่ระบบหรืออ่านสถานะไม่ได้ ตรวจบัญชีที่ยืนยันอีเมล @psu.ac.th แล้ว'); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!consent || busy) return; setBusy(true);setResult(null);
    try {
      setSession(await api('photo-verifications', 'POST', { consent: true, consentVersion: 'face-consent-2026-10', challenge: 'FACE_MOVEMENT' }));
      setNotice('ทำตามคำแนะนำหน้ากล้อง การตรวจนี้ไม่มีแสงกะพริบ');
    } catch (e) { setNotice(`เริ่มไม่ได้: ${e.message}`); }
    finally { setBusy(false); }
  }
  async function complete() {
    const id = session?.verificationId;setSession(null);setBusy(true);
    try {
      let value;
      for (let n=0;n<4;n++) {
        try { value=await api(`photo-verifications/${id}/complete`,'POST',{});break; }
        catch(e) { if(e.message!=='AWAITING_RESULT'||n===3)throw e;await new Promise(r=>setTimeout(r,1500)); }
      }
      setResult(value); setNotice(value.status==='REVIEW_REQUIRED'?'ส่งผลให้เจ้าหน้าที่ตรวจสอบแล้ว':'ได้รับผลที่บันทึกโดย Rust แล้ว');
    } catch(e) { setNotice(`อ่านผลไม่ได้: ${e.message}`); }
    finally { setBusy(false); }
  }
  async function deleteEvidence() {
    setBusy(true);
    try { await api('photo-verification','DELETE');setResult(null);setNotice('ถอนการยืนยันและขอลบหลักฐานแล้ว'); }
    catch(e){setNotice(`ลบไม่ได้: ${e.message}`);}finally{setBusy(false);}
  }
  return <main>
    <p className="eyebrow">CampusMate · Rust staging</p><h1>ทดสอบยืนยันรูปครบ flow</h1>
    <p>ใช้ล็อกอิน Firebase เดิม Rust ตรวจ token และผูกผลกับรูปหลักของบัญชีนี้ เฉพาะ staging</p>
    <p>วิดีโอไป AWS Thailand; backend และ Neon อยู่สิงคโปร์ สำเนารูปกับหลักฐานอยู่ใน R2 ส่วนตัวใน APAC ผลคลุมเครือให้เจ้าหน้าที่ตรวจ และหลักฐานหมดอายุภายใน 14 วัน คุณถอนการยืนยันและขอลบได้</p>
    <p>การทดสอบนี้ไม่เพิ่มเครื่องหมายใน Firebase production และไม่ส่งอีเมลสมัครใหม่</p>
    {!signedIn?<form className="controls" onSubmit={login}>
      <label>อีเมล CampusMate <input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>รหัสผ่าน <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button disabled={busy}>เข้าสู่ระบบ</button>
    </form>:!session&&<section className="controls">
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy}/><span>ฉันยินยอมให้ประมวลผลภาพเพื่อการทดสอบ เปรียบเทียบกับรูปหลัก และเก็บหลักฐานส่วนตัวตามที่อธิบายไว้ (face-consent-2026-10)</span></label>
      <button onClick={start} disabled={!consent||busy}>เริ่มตรวจแบบไม่มีแสงกะพริบ</button>
      <button className="secondary" onClick={deleteEvidence} disabled={busy}>ถอนการยืนยันและลบหลักฐานของฉัน</button>
      <button className="secondary" disabled={busy} onClick={async()=>{await signOut(await currentAuth());setSignedIn(false);setConsent(false);setResult(null);setNotice('ออกจากระบบแล้ว');}}>ออกจากระบบ</button>
    </section>}
    <p role="status" aria-live="polite">{notice}</p>
    {signedIn&&photo&&<section className="result"><h2>ตรวจรูปหลัก</h2>{photo.error?<p>อ่านข้อมูลรูปหลักไม่ได้</p>:<dl>
      <dt>มีรูปหลัก</dt><dd>{photo.present?'มี':'ไม่มี'}</dd>
      {photo.present&&<><dt>โดเมน</dt><dd>{photo.host}</dd>
      <dt>รูปแบบ users/&lt;uid&gt;/avatar</dt><dd>{photo.ownPath?'ตรง':'ไม่ตรง'}</dd>
      <dt>โดเมนที่ระบบรับ ({MEDIA_HOST})</dt><dd>{photo.acceptedHost?'ใช่':'ไม่ใช่'}</dd>
      {photo.sameFile!==undefined&&photo.sameFile!==null&&<><dt>ไฟล์เดียวกับบน {MEDIA_HOST}</dt><dd>{photo.sameFile?'ใช่ (SHA-256 ตรงกัน)':'ไม่ใช่'}</dd></>}</>}
    </dl>}</section>}
    {session&&<section className="camera"><FaceLivenessDetectorCore sessionId={session.sessionId} region={session.region}
      config={{credentialProvider:async()=>({...session.credentials,expiration:new Date(session.credentials.expiration)})}}
      onAnalysisComplete={complete} onUserCancel={()=>{setSession(null);setNotice('ยกเลิกแล้ว session เดิมจะหมดอายุ');}}
      onError={(e)=>{setSession(null);const state=e?.state||'UNKNOWN';const detail=String(e?.error?.message||e?.error||'').slice(0,200);
        console.warn('[liveness]',state,detail);
        setNotice(`การตรวจหยุด (${state}) ${detail} — สร้าง session ใหม่ได้หลังรายการเดิมหมดอายุ หรือกดถอนการยืนยันก่อน`);}}/></section>}
    {result&&<section className="result"><h2>ผลจาก Rust</h2><dl><dt>สถานะ</dt><dd>{result.status}</dd><dt>เครื่องหมาย</dt><dd>{result.badge||'ยังไม่มี'}</dd></dl><p>ไม่แสดงคะแนนหรือภาพหลักฐาน</p></section>}
  </main>;
}
