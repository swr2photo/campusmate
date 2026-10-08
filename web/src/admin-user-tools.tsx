import {useState} from 'react';
import {Mail, Send, ShieldCheck, UserRound} from 'lucide-react';
import {reportMediaSource} from './report-media-policy.mjs';

type Account=Record<string, any>;
export function AdminUserIdentity({account}:{account:Account}){
 const [failed,setFailed]=useState(false),[expanded,setExpanded]=useState(false);
 const source=reportMediaSource(account.avatarUrl);
 if(source.url&&account.avatarRevision&&!/[?&](token|x-amz-signature|signature|sig)=/i.test(source.url)){
  const imageUrl=new URL(source.url);imageUrl.searchParams.set('v',String(account.avatarRevision));source.url=imageUrl.toString();
 }
 const available=source.state==='image'&&!failed;
 return <div className="admin-user-identity"><button className="admin-avatar" aria-label="ขยายรูปโปรไฟล์ผู้ใช้" disabled={!available} onClick={()=>setExpanded(true)}>{available?<img src={source.url} alt={`รูปโปรไฟล์ ${account.name||account.email}`} referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<UserRound size={32}/>}</button><div><h2>{account.name||account.email}</h2>{account.nickname&&<p className="muted">{account.nickname}</p>}{account.name&&<h3 className="account-email">{account.email}</h3>}<span className={'badge '+(account.emailVerified?'resolved':'pending')}>{account.emailVerified?'ยืนยันอีเมลแล้ว':'ยังไม่ยืนยันอีเมล'}</span></div>{expanded&&<dialog open className="report-image-dialog" aria-label="รูปโปรไฟล์ผู้ใช้"><div><button autoFocus onClick={()=>setExpanded(false)}>ปิดรูปภาพ</button><img src={source.url} alt={`รูปโปรไฟล์ ${account.name||account.email} ขนาดเต็ม`} referrerPolicy="no-referrer"/></div></dialog>}</div>;
}
export function AdminEmailActions({account,busy,onSend,onCheck}:{account:Account;busy:boolean;onSend:(kind:string,requestId:string)=>void;onCheck:()=>void}){
 const [kind,setKind]=useState('verification');
 const providers=account.providers||[],password=providers.includes('password'),google=providers.includes('google.com')&&!password;
 const changeEmail=account.emails?.change?.email,canChange=!!changeEmail&&changeEmail!==account.email&&!account.email.endsWith('@psu.ac.th');
 const target=kind==='campusChange'?changeEmail:account.email;
 const labels:Record<string,string>={verification:'ส่งลิงก์ยืนยันอีเมลอีกครั้ง',passwordReset:'ส่งลิงก์รีเซ็ตรหัสผ่าน',googleNotice:'ส่งคำแนะนำเข้าสู่ระบบด้วย Google',campusChange:'ส่งลิงก์เปลี่ยนอีเมลมหาวิทยาลัยซ้ำ'};
 const blocked=account.disabled||(kind==='passwordReset'&&!password)||(kind==='googleNotice'&&!google)||(kind==='campusChange'&&!canChange);
 return <section className="email-actions"><div className="panel-heading"><h3><Mail size={17}/>ส่งอีเมลให้ผู้ใช้</h3><button disabled={busy} onClick={onCheck} className="email-check"><ShieldCheck size={15}/>ตรวจระบบส่ง</button></div><label>ประเภทอีเมล<select value={kind} onChange={e=>setKind(e.target.value)}><option value="verification">{labels.verification}</option><option value="passwordReset" disabled={!password}>{labels.passwordReset}{!password?' (บัญชีนี้ไม่ใช้รหัสผ่าน)':''}</option><option value="googleNotice" disabled={!google}>{labels.googleNotice}{!google?' (ไม่ใช่บัญชี Google อย่างเดียว)':''}</option><option value="campusChange" disabled={!canChange}>{labels.campusChange}{!canChange?' (ไม่มีคำขอเดิม)':''}</option></select></label><p className="email-target">ส่งถึง <strong>{target}</strong></p><button className="primary" disabled={busy||blocked} onClick={()=>{if(window.confirm(`${labels[kind]} ไปที่ ${target} หรือไม่?`))onSend(kind,crypto.randomUUID());}}><Send size={16}/>{busy?'กำลังดำเนินการ…':'ส่งอีเมล'}</button><p className="small muted">ส่งลิงก์ให้ผู้ใช้ดำเนินการเอง ระบบไม่แสดงหรือส่งรหัสผ่านเดิม และไม่เปลี่ยนรหัสผ่านจนกว่าผู้ใช้จะยืนยันผ่านลิงก์</p>{account.disabled&&<p className="small error">ต้องเปิดใช้งานบัญชีก่อนส่งอีเมล</p>}</section>;
}
