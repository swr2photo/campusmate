import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@aws-amplify/ui-react';
import { FaceLivenessDetectorCore } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';
import './style.css';
import RustApp from './RustApp';

async function api(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'REQUEST_FAILED');
  return result;
}

function App() {
  const [consent, setConsent] = useState(false);
  const [movementOnly, setMovementOnly] = useState(true);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('พร้อมทดสอบเมื่อคุณพร้อมอยู่หน้ากล้อง');
  const [result, setResult] = useState(null);

  async function start() {
    setBusy(true); setResult(null); setMessage('กำลังสร้าง session ผ่าน Fly OIDC…');
    try { setSession(await api('create', { consent, movementOnly })); setMessage('ทำตามคำแนะนำของ AWS บนหน้ากล้อง'); }
    catch (error) { setMessage(`เริ่มไม่ได้: ${error.message}`); }
    finally { setBusy(false); }
  }

  async function complete() {
    setBusy(true); setSession(null); setMessage('กำลังอ่านผลจาก AWS บน server…');
    try {
      const answer = await api('complete'); setResult(answer);
      setMessage(answer.sessionStatus === 'SUCCEEDED' ? 'AWS รับและประมวลผลวิดีโอสำเร็จ' : `ผลจาก AWS: ${answer.sessionStatus}`);
    } catch (error) { setMessage(`อ่านผลไม่ได้: ${error.message}`); }
    finally { setBusy(false); }
  }

  async function cancel(errorState) {
    setSession(null); setBusy(true);
    try { await api('cancel'); } catch { /* The AWS session also expires by itself. */ }
    setMessage(typeof errorState === 'string' ? `การทดสอบหยุด: ${errorState}` : 'ยกเลิกแล้ว กล้องหยุดทำงาน คุณเริ่ม session ใหม่ได้'); setBusy(false);
  }

  return <ThemeProvider><main>
    <p className="eyebrow">CampusMate · ทดสอบการเชื่อมต่อ</p>
    <h1>ทดสอบ liveness ใน Thailand</h1>
    <p>วิดีโอใบหน้าจะส่งตรงไป Amazon Rekognition ใน <strong>Thailand (ap-southeast-7)</strong> ใช้ credentials ชั่วคราวจาก Fly.io OIDC</p>
    <p>การทดสอบนี้ไม่เปลี่ยนตรายืนยันใน CampusMate ไม่บันทึกภาพหรือคะแนนลงไฟล์ และไม่เทียบกับรูปโปรไฟล์</p>
    {!session && <section className="controls" aria-label="เตรียมทดสอบ">
      <label><input type="checkbox" checked={movementOnly} onChange={e => setMovementOnly(e.target.checked)} disabled={busy}/><span>ใช้การขยับใบหน้าอย่างเดียว ไม่มีแสงสีซ้ำ</span></label>
      {!movementOnly && <p className="notice">โหมดแสงสีอาจกระทบผู้ไวต่อแสง คุณเลือกโหมดไม่มีแสงสีด้านบนได้</p>}
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>ฉันยินยอมส่งวิดีโอใบหน้าของฉันไป AWS Thailand สำหรับการทดสอบครั้งนี้</span></label>
      <button onClick={start} disabled={!consent || busy}>{busy ? 'กำลังดำเนินการ…' : 'เริ่มทดสอบหน้ากล้อง'}</button>
    </section>}
    <p role="status" aria-live="polite">{message}</p>
    {session && <section className="camera" aria-label="AWS Face Liveness">
      <FaceLivenessDetectorCore sessionId={session.sessionId} region={session.region}
        config={{ credentialProvider: async () => ({ ...session.credentials, expiration: new Date(session.credentials.expiration) }) }}
        onAnalysisComplete={complete} onUserCancel={cancel}
        onError={error => { void cancel(error.state || 'LIVENESS_ERROR'); }}/>
      <button className="secondary" onClick={cancel}>ยกเลิกและปิดกล้อง</button>
    </section>}
    {result && <section className="result"><h2>ผลจาก server</h2>
      <dl><dt>AWS session</dt><dd>{result.sessionStatus}</dd><dt>เฟรมอ้างอิงจาก AWS</dt><dd>{result.referenceImagePresent ? 'ได้รับแล้ว (ไม่บันทึกภาพ)' : 'ยังไม่ได้รับ'}</dd><dt>Fly OIDC → backend role</dt><dd>{result.assumeRoleWithWebIdentity}</dd><dt>backend → stream role</dt><dd>{result.streamAssumeRole}</dd></dl>
      <p>สถานะ SUCCEEDED ยืนยันว่าการประมวลผลจบแล้ว การอนุมัติบุคคลยังต้องผ่านนโยบายและการเทียบรูปของ backend</p>
    </section>}
  </main></ThemeProvider>;
}

createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('rust') ? <ThemeProvider><RustApp/></ThemeProvider> : <App/>);
