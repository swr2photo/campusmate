type Row=Record<string,any>;
const activities:Row={all:'ทั้งหมด',other:'กิจกรรมอื่น ๆ',sports:'เล่นกีฬา',running:'วิ่งออกกำลังกาย',gym:'เข้ายิม / ฟิตเนส',study:'ทบทวนบทเรียน',chill:'คุยเล่น / คาเฟ่',cycling:'ปั่นจักรยาน',swimming:'ว่ายน้ำ',yoga:'โยคะ / สมาธิ',music:'ดนตรี / ร้องเพลง',gaming:'เกม / บอร์ดเกม',art:'ศิลปะ / ถ่ายรูป',language:'ฝึกภาษา',food:'กินข้าว / ตะลุยร้าน',volunteer:'จิตอาสา / ชมรม'};
const names:Row={showGender:'แสดงเพศ',showFaculty:'แสดงคณะ',showLocation:'แสดงตำแหน่ง',showAge:'แสดงอายุ',showActivity:'แสดงกิจกรรม',showAvailability:'แสดงเวลาที่สะดวก',ageMin:'อายุต่ำสุด',ageMax:'อายุสูงสุด',years:'ชั้นปี',maxDistance:'ระยะทางสูงสุด',sameFacultyOnly:'ค้นหาเฉพาะคณะเดียวกัน',activities:'กิจกรรม',paces:'เพซ',genders:'เพศ',faculty:'คณะ',availabilityPeriods:'ช่วงเวลาที่สะดวก',pace:'เพซ',distance:'ระยะทาง',timeOfDay:'ช่วงเวลา',focus:'รูปแบบการฝึก',level:'ระดับ',goal:'เป้าหมาย',sports:'กีฬา',subjects:'วิชา',style:'รูปแบบ',name:'ชื่อ',title:'ชื่อเพลง',artist:'ศิลปิน',artists:'ศิลปิน',artistName:'ศิลปิน',album:'อัลบั้ม',date:'วันที่',start:'เริ่ม',end:'สิ้นสุด',label:'ชื่อ',value:'ค่า',enabled:'เปิดใช้งาน'};
const dates=(v:any)=>v?new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'ไม่ระบุ';
function text(value:any,field:string){
 if(value==null||value==='')return 'ไม่ระบุ';
 if(typeof value==='boolean')return value?'เปิด':'ปิด';
 if(field.endsWith('At'))return dates(value);
 if(['activity','activities','interests','tags'].includes(field))return activities[value]||String(value);
 if(['gender','genders'].includes(field))return ({female:'หญิง',male:'ชาย',other:'อื่น ๆ',all:'ทุกเพศ'} as Row)[value]||String(value);
 if(field==='faculty'&&value==='all')return 'ทุกคณะ';
 if(field==='maxDistance')return `${value} กม.`;
 if(field==='ageMin'||field==='ageMax'||field==='age')return `${value} ปี`;
 return String(value);
}
export function ProfileValue({value,field,depth=0}:{value:any;field:string;depth?:number}){
 if(Array.isArray(value)){
  if(!value.length)return <span className="muted">{['years','activities','paces','genders','availabilityPeriods'].includes(field)?'ไม่จำกัด':'ไม่ได้ระบุ'}</span>;
  if(field==='availabilitySlots')return <ul className="profile-slots">{value.map((slot,i)=><li key={i}><strong>{slot.date?new Date(slot.date+'T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'long',year:'numeric'}):'ไม่ระบุวันที่'}</strong><span>{slot.start||'—'} – {slot.end||'—'} น.</span></li>)}</ul>;
  return <ul className="profile-values">{value.map((item,i)=><li key={i}><ProfileValue value={item} field={field} depth={depth+1}/></li>)}</ul>;
 }
 if(value&&typeof value==='object'){
  const entries=Object.entries(value);
  if(!entries.length)return <span className="muted">ไม่มีข้อมูล</span>;
  return <div className="profile-properties">{entries.map(([key,item])=><div key={key}><span>{activities[key]||names[key]||key}</span><div><ProfileValue value={item} field={key} depth={depth+1}/></div></div>)}</div>;
 }
 return <span>{text(value,field)}</span>;
}
