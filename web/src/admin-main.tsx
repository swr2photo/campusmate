import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, type User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { LayoutDashboard, Flag, Users, Settings, History, ShieldCheck, LogOut, RefreshCw, Search, ChevronRight, Mail, CheckCircle2, Bell, PanelLeftClose, PanelLeftOpen, MapPin, Sparkles, Activity, Menu, X, AlertTriangle, User as UserIcon } from 'lucide-react';
import { auth } from './lib/firebase';
import './admin.css';
import {FeatureTesterPicker} from './admin-user-picker';
import {UserDirectory} from './admin-users';
import {AdminUserModal} from './admin-user-modal';
import {AdminNotifications} from './admin-notifications';
import {AdvancedSettings} from './admin-settings';
import { AdminReportDetails } from './admin-report-details';
import { ReportMedia } from './report-media';
import { AdminSpots } from './admin-spots';
import { AdminParties } from './admin-parties';
import { AdminMetrics } from './admin-metrics';

type Row = Record<string, any>;
const invoke=httpsCallable(getFunctions(auth.app,'asia-southeast1'),'adminConsole');
const api=async(op:string,data:Row={})=>(await invoke({op,...data})).data as Row;
const date=(value:any)=>value?new Date(value).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}):'—';
const statuses:Row={pending:'รอตรวจสอบ',reviewing:'กำลังตรวจสอบ',resolved:'ดำเนินการแล้ว',dismissed:'ปิดโดยไม่ดำเนินการ'};
const nav=[{id:'overview',label:'ภาพรวม',icon:LayoutDashboard},{id:'metrics',label:'แดชบอร์ด & ประสิทธิภาพ',icon:Activity},{id:'reports',label:'รายงานจากผู้ใช้',icon:Flag},{id:'users',label:'ผู้ใช้และอีเมล',icon:Users},{id:'spots',label:'สถานที่และรูปภาพ',icon:MapPin},{id:'parties',label:'ระบบตี้ / นัดพบ',icon:Sparkles},{id:'notifications',label:'ส่งแจ้งเตือน',icon:Bell},{id:'settings',label:'การตั้งค่าระบบ',icon:Settings},{id:'audit',label:'ประวัติการจัดการ',icon:History}];
function App(){
 const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[admin,setAdmin]=useState(false),[page,setPage]=useState('overview');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
 useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t);}},[notice]);
 const [overview,setOverview]=useState<Row>({}),[reports,setReports]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null),[filter,setFilter]=useState('all'),[selected,setSelected]=useState<Row|null>(null),[status,setStatus]=useState('reviewing'),[note,setNote]=useState('');
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('campusmate_admin_sidebar')==='collapsed';}catch{return false;}}),[directoryRefresh,setDirectoryRefresh]=useState(0),[notificationUid,setNotificationUid]=useState(''),[notificationRefresh,setNotificationRefresh]=useState(0),[metricsRefresh,setMetricsRefresh]=useState(0);
 useEffect(()=>{try{localStorage.setItem('campusmate_admin_sidebar',collapsed?'collapsed':'expanded');}catch{}},[collapsed]);
 const [detail,setDetail]=useState<Row|null>(null);
 const [query,setQuery]=useState(''),[account,setAccount]=useState<Row|null>(null),[accountNote,setAccountNote]=useState('');
 const [settings,setSettings]=useState<Row|null>(null),[version,setVersion]=useState<Row>({}),[features,setFeatures]=useState<Row>({}),[audit,setAudit]=useState<Row[]>([]),[auditCursor,setAuditCursor]=useState<string|null>(null);
 const [isAdminClaim, setIsAdminClaim] = useState(false);
 const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async u => {
    setUser(u);
    setAdmin(false);
    setIsAdminClaim(false);
    setIsSuperAdmin(false);
    setReady(false);
    try {
      if (u) {
        const token = await u.getIdTokenResult(true);
        const superAdmin = u.email === '6710210317@psu.ac.th';
        const hasAdminClaim = Boolean(token?.claims?.admin === true);
        setIsAdminClaim(hasAdminClaim);
        setIsSuperAdmin(superAdmin);
        setAdmin(Boolean((hasAdminClaim || superAdmin) && u.emailVerified));
      }
    } catch {
      setError('ตรวจสิทธิ์ไม่สำเร็จ');
    } finally {
      setReady(true);
    }
  }), []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    await run(async () => {
      if (page === 'metrics') setMetricsRefresh(v => v + 1);
      if (page === 'users') setDirectoryRefresh(v => v + 1);
      if (page === 'users' && account?.uid) setAccount(await api('user', { query: account.uid }));
      if (page === 'notifications') setNotificationRefresh(v => v + 1);
      if (page === 'overview') {
        const o = await api('overview');
        setOverview(o || {});
      }
      if (page === 'reports') {
        const r = await api('reports');
        setReports(Array.isArray(r?.rows) ? r.rows : []);
        setCursor(r?.cursor || null);
        setSelected(null);
      }
      if (page === 'settings') {
        const r = await api('settings');
        setSettings(r || null);
        setVersion(r?.version || {});
        setFeatures(r?.features || {});
      }
      if (page === 'audit') {
        const r = await api('audit');
        setAudit(Array.isArray(r?.rows) ? r.rows : []);
        setAuditCursor(r?.cursor || null);
      }
    });
  }
  const handleToggleMyRole = async () => {
    await run(async () => {
      const targetIsAdmin = !isAdminClaim;
      const res = await api('switchMyRole', { isAdmin: targetIsAdmin });
      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true);
      }
      setIsAdminClaim(Boolean(res.isAdmin));
      setNotice(res.isAdmin ? 'สลับเป็นสิทธิ์แอดมินเรียบร้อยแล้ว' : 'สลับเป็นสิทธิ์ผู้ใช้ทั่วไปเรียบร้อยแล้ว');
      if (page === 'overview') {
        const o = await api('overview');
        setOverview(o || {});
      }
    });
  };
  useEffect(()=>{if(admin&&!['users','notifications','spots','parties','metrics'].includes(page))void load();},[admin,page]);
  const field=(key:string,label:string,type='text')=><label key={key}>{label}<input type={type} value={version[key]??''} onChange={e=>setVersion({...version,[key]:type==='number'?Number(e.target.value):e.target.value})}/></label>;
  const toggle=(key:string,label:string)=><label className="toggle" key={key}><span>{label}</span><input type="checkbox" checked={version[key]===true} onChange={e=>setVersion({...version,[key]:e.target.checked})}/></label>;
  if(!ready)return <main className="login"><div className="login-card">กำลังตรวจสอบสิทธิ์…</div></main>;
  if(!user)return <main className="login"><div className="login-card"><div className="brand-mark">C</div><p className="eyebrow">CAMPUSMATE ADMIN</p><h1>พื้นที่สำหรับผู้ดูแล</h1><p className="muted">ตรวจสอบรายงานและดูแลระบบ CampusMate</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{await signInWithEmailAndPassword(auth,email,password);});}}><label>อีเมล<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>รหัสผ่าน<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} className="primary">เข้าสู่ระบบ</button></form><div className="divider">หรือ</div><button disabled={busy} onClick={()=>void run(async()=>{await signInWithPopup(auth,new GoogleAuthProvider());})}>เข้าสู่ระบบด้วย Google</button>{error&&<p role="alert" className="error">{error}</p>}<p className="small muted">เฉพาะบัญชีที่ได้รับสิทธิ์ผู้ดูแลระบบ</p></div></main>;
  if(!admin)return <main className="login"><div className="login-card"><ShieldCheck size={38}/><h1>ยังไม่มีสิทธิ์เข้าถึง</h1><p>{user.email}</p><p className="muted">ต้องเป็นบัญชีที่ยืนยันอีเมลและได้รับสิทธิ์ผู้ดูแลระบบ</p><button onClick={()=>void signOut(auth)}>ออกจากระบบ</button></div></main>;
  return <div className={'shell '+(collapsed?'sidebar-collapsed':'')}>
    {/* Floating Toast Notification Center */}
    <div className="toast-container" aria-live="polite">
      {busy && (
        <div className="toast toast-busy" role="status">
          <RefreshCw size={16} className="spin" />
          <span>กำลังดำเนินการ…</span>
        </div>
      )}
      {notice && (
        <div className="toast toast-success" role="status">
          <CheckCircle2 size={18} />
          <span className="toast-text">{notice}</span>
          <button className="toast-close" onClick={() => setNotice('')} aria-label="ปิดการแจ้งเตือน">
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="toast toast-error" role="alert">
          <AlertTriangle size={18} />
          <span className="toast-text">{error}</span>
          <button className="toast-close" onClick={() => setError('')} aria-label="ปิดการแจ้งเตือน">
            <X size={15} />
          </button>
        </div>
      )}
    </div>

    {/* Mobile Slide-out Drawer */}
    {mobileMenuOpen && (
      <div className="mobile-drawer-backdrop" onClick={() => setMobileMenuOpen(false)}>
        <div className="mobile-drawer" onClick={e => e.stopPropagation()}>
          <div className="mobile-drawer-header">
            <div className="brand" style={{ margin: 0 }}>
              <div className="brand-mark">C</div>
              <div className="brand-label">
                <strong>CampusMate</strong>
                <span>ADMIN CONSOLE</span>
              </div>
            </div>
            <button className="icon-button" onClick={() => setMobileMenuOpen(false)} aria-label="ปิดเมนู">
              <X size={20} />
            </button>
          </div>
          <p className="nav-label" style={{ paddingLeft: 8, margin: '8px 0 12px' }}>พื้นที่จัดการระบบ</p>
          <nav>
            {nav.map(n => (
              <button
                key={n.id}
                title={n.label}
                className={page === n.id ? 'active' : ''}
                onClick={() => {
                  setPage(n.id);
                  setMobileMenuOpen(false);
                }}
              >
                <n.icon size={19} />
                <span className="nav-text">{n.label}</span>
                {page === n.id && <ChevronRight size={16} />}
              </button>
            ))}
          </nav>
          <div className="mobile-drawer-footer">
            <div className="admin-email-pill" title={user.email || ''}>
              <UserIcon size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              {user.email}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`badge ${isAdminClaim ? 'reviewing' : 'resolved'}`} style={{ flex: 1, textAlign: 'center', padding: '6px 8px', fontSize: 12 }}>
                {isAdminClaim ? '👑 แอดมิน' : '👤 ผู้ใช้'}
              </span>
              <button
                type="button"
                className="secondary"
                style={{ flex: 1, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}
                disabled={busy}
                onClick={handleToggleMyRole}
              >
                <RefreshCw size={12} className={busy ? 'spin' : ''} style={{ display: 'inline', marginRight: 4 }} />
                {isAdminClaim ? 'สลับเป็นผู้ใช้' : 'สลับเป็นแอดมิน'}
              </button>
            </div>
            <button className="danger" style={{ width: '100%', marginTop: 8 }} onClick={() => void signOut(auth)}>
              <LogOut size={16} /> ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Desktop Sidebar */}
    <aside className="desktop-aside" aria-label="เมนูแอดมิน">
      <button className="sidebar-toggle" aria-label={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
      <div className="brand">
        <div className="brand-mark">C</div>
        <div className="brand-label">
          <strong>CampusMate</strong>
          <span>ADMIN CONSOLE</span>
        </div>
      </div>
      <p className="nav-label">พื้นที่จัดการ</p>
      <nav>
        {nav.map(n => (
          <button key={n.id} title={n.label} aria-label={n.label} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
            <n.icon size={19} />
            <span className="nav-text">{n.label}</span>
            {page === n.id && <ChevronRight size={16} />}
          </button>
        ))}
      </nav>
      <div className="aside-bottom">
        <ShieldCheck size={18} />
        <span>เชื่อมต่อระบบ CampusMate</span>
      </div>
    </aside>

    {/* Main Workspace */}
    <div className="workspace">
      <header>
        <div className="header-left">
          <button className="mobile-menu-btn" aria-label="เปิดเมนู" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="header-breadcrumbs">
            <span className="brand-mobile-tag">CampusMate</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{nav.find(n => n.id === page)?.label}</span>
          </div>
        </div>
        <div className="header-right">
          <div className="admin-role-switcher" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
            <span
              className={`badge ${isAdminClaim ? 'reviewing' : 'resolved'}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}
            >
              <Sparkles size={13} />
              {isAdminClaim ? '👑 สิทธิ์แอดมิน' : '👤 สิทธิ์ผู้ใช้ทั่วไป'}
            </span>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: 12, padding: '4px 10px', height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              disabled={busy}
              onClick={handleToggleMyRole}
              title={isAdminClaim ? 'สลับเป็นสิทธิ์ผู้ใช้ทั่วไป' : 'สลับเป็นสิทธิ์แอดมิน'}
            >
              <RefreshCw size={13} className={busy ? 'spin' : ''} />
              {isAdminClaim ? 'สลับเป็นผู้ใช้' : 'สลับเป็นแอดมิน'}
            </button>
          </div>
          <span className="admin-email">{user.email}</span>
          <button className="icon-button" title="ออกจากระบบ" onClick={() => void signOut(auth)}>
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">CAMPUSMATE OPERATIONS</p>
            <h1>{nav.find(n => n.id === page)?.label}</h1>
            <p className="muted">
              {page === 'metrics'
                ? 'ตรวจสอบค่าใช้จ่ายคลาวด์ งบประมาณ และเวลาตอบสนองของระบบ'
                : page === 'spots'
                ? 'ตรวจพิกัดและอัปเดตรูปภาพสถานที่ทั้ง 31 จุดทั่วมหาวิทยาลัย'
                : page === 'parties'
                ? 'ตรวจสอบและจัดการกิจกรรมนัดพบ (ตี้) ในมหาวิทยาลัย'
                : page === 'reports'
                ? 'ตรวจสอบข้อร้องเรียนและบันทึกผลการดำเนินการ'
                : page === 'settings'
                ? 'ควบคุมการตั้งค่าที่แอปใช้งานจริง'
                : page === 'users'
                ? 'ตรวจบัญชี สถานะการยืนยัน และบันทึกการส่งอีเมล'
                : 'ข้อมูลจากระบบจริงสำหรับการดูแลชุมชน'}
            </p>
          </div>
          <button disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            รีเฟรช
          </button>
        </div>
  {page==='overview'&&<>
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: isAdminClaim ? '#f3e8ff' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={22} color={isAdminClaim ? '#7c3aed' : '#64748b'} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{user.email}</strong>
            <span className={`badge ${isAdminClaim ? 'reviewing' : 'resolved'}`}>
              {isAdminClaim ? '👑 สิทธิ์ผู้ดูแลระบบ (Admin)' : '👤 สิทธิ์ผู้ใช้ทั่วไป (Normal User)'}
            </span>
            {isSuperAdmin && (
              <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: 11 }}>
                ⭐ ซูเปอร์แอดมิน (สลับสิทธิ์ได้ตลอดเวลา)
              </span>
            )}
          </div>
          <small className="muted" style={{ display: 'block', marginTop: 2 }}>
            {isAdminClaim
              ? 'คุณกำลังใช้งานด้วยสิทธิ์ผู้ดูแลระบบ สามารถจัดการระบบและสลับเป็นสิทธิ์ผู้ใช้ทั่วไปได้ตลอดเวลา'
              : 'คุณกำลังจำลองสิทธิ์เป็นผู้ใช้ทั่วไป สามารถสลับกลับเป็นสิทธิ์ผู้ดูแลระบบได้ตลอดเวลา'}
          </small>
        </div>
      </div>
      <button
        type="button"
        className={isAdminClaim ? 'secondary' : 'primary'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        disabled={busy}
        onClick={handleToggleMyRole}
      >
        <RefreshCw size={14} className={busy ? 'spin' : ''} />
        {isAdminClaim ? 'สลับเป็นสิทธิ์ผู้ใช้ทั่วไป' : 'สลับกลับเป็นสิทธิ์แอดมิน'}
      </button>
    </div>
    <div className="stats"><div className="stat"><span>โปรไฟล์ในระบบ</span><strong>{overview.userCount??'—'}</strong><small>จำนวนเอกสารโปรไฟล์ผู้ใช้</small></div><div className="stat"><span>สถานที่ ม.อ.</span><strong>{overview.spotCount??'31'}</strong><small>จุดพิกัดทั้งหมด</small></div><div className="stat"><span>ตี้เปิดรับสมัคร</span><strong>{overview.openPartiesCount??'0'}</strong><small>กิจกรรมนัดพบ</small></div>{['pending','reviewing'].map(s=><div className="stat" key={s}><span>{statuses[s]}</span><strong>{Array.isArray(overview.counts) ? (overview.counts.find((r:Row)=>r.status===s)?.count??'0') : '—'}</strong><small>รายงานจากผู้ใช้</small></div>)}</div><section className="panel welcome"><div><p className="eyebrow">COMMUNITY SAFETY & CAMPUS</p><h2>ดูแลชุมชนและสถานที่ใน ม.อ.</h2><p className="muted">ตรวจสอบรายงานผู้ใช้ จัดการรูปภาพสถานที่ และตรวจความเรียบร้อยของกิจกรรมนัดพบ</p><div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:14}}><button className="primary" onClick={()=>setPage('metrics')}>ดูประสิทธิภาพ & ค่าใช้จ่าย<ChevronRight size={16}/></button><button onClick={()=>setPage('spots')}>จัดการสถานที่<ChevronRight size={16}/></button><button onClick={()=>setPage('parties')}>ตรวจระบบตี้<ChevronRight size={16}/></button><button onClick={()=>setPage('reports')}>เปิดรายงานผู้ใช้<ChevronRight size={16}/></button></div></div><ShieldCheck size={80} strokeWidth={1}/></section><div className="two-columns"><section className="panel"><Activity size={24} color="#2563eb"/><h2>แดชบอร์ด & ประสิทธิภาพระบบ</h2><p className="muted">ตรวจค่าใช้จ่ายคลาวด์ งบประมาณ และความเร็วการเชื่อมต่อแต่ละบริการ</p><button className="primary" onClick={()=>setPage('metrics')}>เปิดแดชบอร์ดระบบ</button></section><section className="panel"><MapPin size={24}/><h2>จัดการสถานที่และรูปภาพ</h2><p className="muted">ตรวจพิกัดและเปลี่ยนรูปสถานที่ ม.อ. ทั้ง 31 จุด</p><button onClick={()=>setPage('spots')}>เปิดหน้ารายการสถานที่</button></section><section className="panel"><Sparkles size={24}/><h2>จัดการระบบตี้</h2><p className="muted">ตรวจกิจกรรมนัดพบและดูแลความปลอดภัย</p><button onClick={()=>setPage('parties')}>เปิดหน้ารายการตี้</button></section><section className="panel"><Mail size={24}/><h2>ตรวจสถานะอีเมล</h2><p className="muted">ตรวจการยืนยันบัญชีและเวลาที่ระบบบันทึกการส่ง โดยไม่เปิดเผยลิงก์ยืนยันหรือรหัสลับ</p><button onClick={()=>setPage('users')}>ค้นหาบัญชี</button></section></div></>}
  {page==='metrics'&&<AdminMetrics refreshKey={metricsRefresh} api={api} busy={busy} onNotice={setNotice} onError={setError}/>}
 {page==='spots'&&<AdminSpots api={api} busy={busy} onNotice={setNotice} onError={setError}/>}
 {page==='parties'&&<AdminParties api={api} busy={busy} onNotice={setNotice} onError={setError} onSelectUser={uid=>{setAccount(null);setAccountNote('');setQuery(uid);setPage('users');void run(async()=>{setAccount(await api('user',{query:uid}));});}}/>}
 {page==='reports'&&<div className="reports-layout"><section className="panel"><div className="panel-heading"><h2>รายการรายงาน <span className="count">{reports.length}</span></h2><select aria-label="กรองสถานะในรายการที่โหลด" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">ทุกสถานะที่โหลด</option>{Object.entries(statuses).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></div><p className="small muted">โหลดครั้งละ 30 รายการ เรียงตามรหัสรายงาน · ตัวกรองใช้กับรายการที่โหลดแล้ว</p>{reports.filter(r=>filter==='all'||r.status===filter).map(r=><button className={'report-row '+(selected?.id===r.id?'selected':'')} key={r.id} disabled={busy} onClick={()=>void run(async()=>{setSelected(null);setDetail(null);const d=await api('reportDetail',{id:r.id});setDetail(d);setSelected(d.report);setStatus(d.report.status||'pending');setNote(d.report.reviewNote||'');})}><div className="report-symbol"><Flag size={18}/></div><div><strong>{r.reason||'ไม่ระบุเหตุผล'}</strong><span>{r.details||'ไม่มีรายละเอียดเพิ่มเติม'}</span><small>{date(r.createdAt)}</small></div><span className={'badge '+r.status}>{statuses[r.status]||r.status}</span></button>)}{reports.length===0&&!busy&&<div className="empty"><Flag/><h3>ยังไม่มีรายงาน</h3><p>รายงานจากแอปจะปรากฏที่นี่</p></div>}{cursor&&<button disabled={busy} onClick={()=>void run(async()=>{const r=await api('reports',{cursor});setReports([...reports,...r.rows]);setCursor(r.cursor);})}>โหลดรายการเพิ่มเติม</button>}</section><section className="panel detail">{selected?<><p className="eyebrow">REPORT DETAILS</p><h2>{selected.reason}</h2><dl>{[['รหัสรายงาน',selected.id],['ผู้รายงาน',selected.reporterId],['ผู้ถูกรายงาน',selected.reportedUserId],['ห้องสนทนา',selected.conversationId],['ข้อความ',selected.messageText],['รายละเอียด',selected.details],['สร้างเมื่อ',date(selected.createdAt)],['อัปเดตเมื่อ',date(selected.updatedAt)]].map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v||'—'}</dd></React.Fragment>)}</dl>{selected.moderation?.mediaState==='deleted'?<div className="info">ไฟล์สื่อที่แนบในรายงานถูกลบโดยผู้ดูแลแล้ว</div>:<ReportMedia key={selected.id} url={selected.mediaUrl}/>}<label>สถานะ<select value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>ผลการตรวจสอบ<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="บันทึกเหตุผลและผลการดำเนินการ"/></label><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await api('review',{id:selected.id,revision:selected.revision,status,note});const r=await api('reports');setReports(r.rows);setCursor(r.cursor);setSelected(null);setNotice('บันทึกผลการตรวจสอบแล้ว');})}>บันทึกผลการตรวจสอบ</button>{detail&&<AdminReportDetails detail={detail} busy={busy} note={note} onAccount={uid=>{setAccount(null);setAccountNote('');setQuery(uid);setPage('users');void run(async()=>{setAccount(await api('user',{query:uid}));});}} onModerate={action=>void run(async()=>{if(!note.trim())throw new Error('กรุณากรอกผลการตรวจสอบเพื่อใช้เป็นข้อความเตือนก่อนดำเนินการ');const result=await api('moderateReport',{id:selected.id,revision:selected.revision,action,note});const d=await api('reportDetail',{id:selected.id});setSelected(d.report);setDetail(d);setStatus(d.report.status);const list=await api('reports');setReports(list.rows);setCursor(list.cursor);if(!result.success)throw new Error('บันทึกคำเตือนแล้ว แต่ลบไฟล์สื่อไม่สำเร็จ กรุณาลองลบสื่ออีกครั้ง');setNotice('ดำเนินการแล้วและบันทึกคำเตือนผู้ใช้ · '+(result.notification?.state==='accepted'?'ระบบ Push รับคำเตือนแล้ว':result.notification?.state==='no-device'?'ไม่มีอุปกรณ์รับ Push ที่ลงทะเบียน':'ส่ง Push ไม่สำเร็จ คำเตือนยังถูกบันทึกในบัญชี'));})}/>}</>:<div className="empty"><Flag/><h3>เลือกรายงานเพื่อดูรายละเอียด</h3><p>ตรวจข้อมูลก่อนบันทึกผลการดำเนินการ</p></div>}</section></div>}
  {page==='users'&&<>
    <UserDirectory api={api} busy={busy} refreshKey={directoryRefresh} onSelect={uid=>void run(async()=>{setAccount(null);setAccountNote('');setQuery(uid);setAccount(await api('user',{query:uid}));})}/>
    <section className="panel">
      <h2>ค้นหาบัญชีผู้ใช้</h2>
      <form className="search-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setAccount(null);setAccountNote('');setAccount(await api('user',{query}));});}}>
        <input aria-label="อีเมลหรือ UID" placeholder="อีเมล หรือ UID ของบัญชี" value={query} onChange={e=>setQuery(e.target.value)} required/>
        <button className="primary" disabled={busy}><Search size={16}/>ค้นหา & เปิดโปรไฟล์</button>
      </form>
    </section>
    {account&&<AdminUserModal account={account} api={api} busy={busy} accountNote={accountNote} setAccountNote={setAccountNote} onClose={()=>setAccount(null)} onUpdateAccount={updated=>setAccount(updated)} onDeleted={()=>{setAccount(null);setQuery('');setDirectoryRefresh(v=>v+1);setNotice('ลบบัญชีออกจากระบบแล้ว');}} onNotify={uid=>{setNotificationUid(uid);setPage('notifications');}} onNotice={setNotice} onError={setError}/>}
  </>}
 {page==='notifications'&&<AdminNotifications refreshKey={notificationRefresh} api={api} initialUid={notificationUid} onNotice={setNotice}/>}
 {page==='settings'&&settings&&<><section className="panel"><div className="panel-heading"><div><h2>เวอร์ชันแอปและการแจ้งอัปเดต</h2><p className="muted">มีผลกับแอปที่อ่าน app_config/version</p></div></div><div className="form-grid">{field('latestVersion','เวอร์ชันล่าสุด')}{field('minVersion','เวอร์ชันขั้นต่ำ')}{field('title','หัวข้อแจ้งเตือน')}{field('snoozeHours','พักแจ้งเตือน (ชั่วโมง)','number')}{field('playStoreUrl','ลิงก์เปิดแอป Google Play (market://)')}{field('playStoreWebUrl','ลิงก์ Google Play')}{field('appStoreUrl','ลิงก์ App Store')}</div><label>ข้อความแจ้งเตือน<textarea value={version.message||''} onChange={e=>setVersion({...version,message:e.target.value})}/></label><label>รายละเอียดอัปเดต<textarea value={version.releaseNotes||''} onChange={e=>setVersion({...version,releaseNotes:e.target.value})}/></label><div className="toggles">{toggle('enabled','เปิดแจ้งอัปเดต')}{toggle('playStorePublished','เผยแพร่บน Google Play แล้ว')}{toggle('forceUpdate','บังคับอัปเดต')}</div><button disabled={busy} className="primary" onClick={()=>{if(window.confirm('บันทึกการตั้งค่าเวอร์ชันสำหรับผู้ใช้จริงหรือไม่?'))void run(async()=>{const keys=['enabled','latestVersion','minVersion','forceUpdate','playStorePublished','snoozeHours','title','message','releaseNotes','playStoreUrl','playStoreWebUrl','appStoreUrl'];await api('saveVersion',{version:Object.fromEntries(Object.entries(version).filter(([k])=>keys.includes(k))),revision:settings.revision});const r=await api('settings');setSettings(r);setVersion(r.version);setFeatures(r.features);setNotice('บันทึกการตั้งค่าเวอร์ชันแล้ว');});}}>บันทึกการตั้งค่าเวอร์ชัน</button></section><section className="panel"><h2>ฟีเจอร์และผู้ทดสอบ</h2><p className="muted">การเปลี่ยนค่าใช้เวลาตามรอบรีเฟรช Remote Config ของแอป เงื่อนไขเฉพาะกลุ่มเดิมยังมีผล</p><div className="two-columns">{[['call','การโทร'],['spotify','Spotify']].map(([key,label])=><div className="feature-card" key={key}><h3>{label}</h3><label className="toggle"><span>เปิดให้ผู้ใช้ทุกคน</span><input type="checkbox" checked={features['enable_feature_'+key]==='true'} onChange={e=>setFeatures({...features,['enable_feature_'+key]:String(e.target.checked)})}/></label><FeatureTesterPicker api={api} feature={key} label={label} features={features} onChange={setFeatures} busy={busy}/></div>)}</div><button disabled={busy} className="primary" onClick={()=>{if(window.confirm('เผยแพร่การตั้งค่าฟีเจอร์สำหรับแอปจริงหรือไม่?'))void run(async()=>{await api('saveFeatures',{features,etag:settings.etag});const r=await api('settings');setSettings(r);setFeatures(r.features);setNotice('เผยแพร่การตั้งค่าฟีเจอร์แล้ว');});}}>เผยแพร่การตั้งค่าฟีเจอร์</button></section><section className="panel"><h2>Remote Config ทั้งหมด</h2><div className="table-scroll"><table><thead><tr><th>พารามิเตอร์</th><th>ค่าปริยาย</th><th>เงื่อนไขเฉพาะกลุ่ม</th></tr></thead><tbody>{settings.remoteParameters.map((p:Row)=><tr key={p.key}><td>{p.key}<small>{p.description}</small></td><td>{p.value??'ใช้ค่าภายในแอป'}</td><td>{p.conditional?'มี':'ไม่มี'}</td></tr>)}</tbody></table></div><p className="small muted">ค่าที่แอปรองรับเปิดให้แก้ด้านบน ส่วนรหัสลับ SMTP, R2 และบริการสมาชิกจัดการผ่านระบบเซิร์ฟเวอร์</p></section><AdvancedSettings settings={settings} api={api} busy={busy} onNotice={setNotice} onRefresh={async()=>{const r=await api('settings');setSettings(r);setVersion(r.version);setFeatures(r.features);}}/></>}
 {page==='audit'&&<section className="panel"><h2>ประวัติการจัดการ</h2><div className="table-scroll"><table><thead><tr><th>เวลา</th><th>คำสั่ง / เป้าหมาย</th><th>ผู้ดำเนินการ</th><th>รายละเอียด</th></tr></thead><tbody>{audit.map(r=><tr key={r.id}><td>{date(r.createdAt)}</td><td>{r.action}<small>{r.target}</small><span className="badge">{r.state||'completed'}</span></td><td className="uid">{r.actor}</td><td><details><summary>ดูการเปลี่ยนแปลง</summary><pre>{JSON.stringify({before:r.before,after:r.after,note:r.note,moderationAction:r.moderationAction,mediaState:r.mediaState,notification:r.notification},null,2)}</pre></details></td></tr>)}</tbody></table></div>{!audit.length&&!busy&&<div className="empty"><History/><h3>ยังไม่มีการดำเนินการ</h3><p>การแก้ไขจากแอดมินจะถูกบันทึกที่นี่</p></div>}{auditCursor&&<button disabled={busy} onClick={()=>void run(async()=>{const r=await api('audit',{cursor:auditCursor});setAudit([...audit,...r.rows]);setAuditCursor(r.cursor);})}>โหลดประวัติเพิ่มเติม</button>}</section>}
 <footer>CampusMate Admin · ข้อมูลจริงจาก Firebase · เวลาแสดงตามประเทศไทย</footer></main></div></div>;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CampusMate Admin ErrorBoundary]', error, errorInfo);
  }

  handleClearCacheAndSignOut = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      await signOut(auth);
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="login">
          <div className="login-card" style={{ maxWidth: 520, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444', marginBottom: 12 }}>
              <AlertTriangle size={28} />
              <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>เกิดข้อผิดพลาดในการโหลดแดชบอร์ด</h1>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              ระบบพบข้อผิดพลาดขณะแสดงผลหน้าจอแดชบอร์ด กรุณากดปุ่มด้านล่างเพื่อโหลดใหม่หรือรีเซ็ตเซสชัน
            </p>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, maxHeight: 140, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', color: '#dc2626' }}>
              <strong>{this.state.error?.name}: </strong>{this.state.error?.message}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => window.location.reload()}>
                <RefreshCw size={15} /> โหลดหน้าเว็บใหม่
              </button>
              <button onClick={this.handleClearCacheAndSignOut}>
                <LogOut size={15} /> ล้างแคช & เข้าสู่ระบบใหม่
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
