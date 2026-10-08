import { useState } from 'react';
import { Image, LockKeyhole, RefreshCw } from 'lucide-react';
import { reportMediaSource } from './report-media-policy.mjs';

export function ReportMedia({url}:{url:unknown}) {
  const source=reportMediaSource(url);
  const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false),[attempt,setAttempt]=useState(0),[expanded,setExpanded]=useState(false);
  if(source.state==='absent')return null;
  if(source.state==='encrypted')return <section className="report-media-info"><LockKeyhole size={21}/><div><strong>รูปภาพนี้เข้ารหัสไว้</strong><p>รายงานแนบไฟล์แชตที่เข้ารหัส (.enc) เว็บแอดมินไม่มีกุญแจถอดรหัส จึงยังแสดงรูปนี้ไม่ได้</p><p>ต้องให้ผู้รายงานส่งสำเนารูปที่เปิดดูได้เป็นหลักฐานเพิ่มเติม</p></div></section>;
  if(source.state!=='image')return <section className="report-media-info"><Image size={21}/><div><strong>{source.state==='not-image'?'สื่อแนบนี้ไม่ใช่รูปภาพ':'ไม่สามารถแสดงรูปจากแหล่งนี้ได้'}</strong><p>ตัวแสดงรูปนี้รองรับไฟล์รูปจากพื้นที่เก็บสื่อของ CampusMate ต้องแนบหลักฐานที่เปิดดูได้เพิ่มเติม</p></div></section>;
  const retry=()=>{setAttempt(attempt+1);setFailed(false);setLoaded(false);};
  return <section className="report-media"><h3>รูปภาพที่แนบในรายงาน</h3>{failed?<div className="report-media-info"><Image size={21}/><div><strong>โหลดรูปภาพไม่สำเร็จ</strong><p>ไฟล์อาจถูกลบ ลิงก์หมดอายุ หรือปลายทางไม่ใช่ไฟล์รูปที่เปิดดูได้</p><button onClick={retry}><RefreshCw size={15}/>ลองโหลดอีกครั้ง</button></div></div>:<>{!loaded&&<p className="small muted" role="status">กำลังโหลดรูปภาพ…</p>}<button className="report-image-button" aria-label="ขยายรูปภาพที่แนบในรายงาน" disabled={!loaded} onClick={()=>setExpanded(true)}><img key={attempt} src={source.url} alt="รูปภาพที่ผู้ใช้แนบในรายงาน" referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/></button>{loaded&&<p className="small muted">คลิกรูปเพื่อขยาย</p>}</>}{expanded&&<dialog open className="report-image-dialog" aria-label="รูปภาพที่แนบในรายงาน"><div><button autoFocus onClick={()=>setExpanded(false)}>ปิดรูปภาพ</button><img src={source.url} alt="รูปภาพที่ผู้ใช้แนบในรายงาน ขนาดเต็ม" referrerPolicy="no-referrer"/></div></dialog>}</section>;
}
