import { useState, useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Shield,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Bell,
  Sparkles,
  Copy,
  Check,
  Flag,
  MessageSquare,
  FileText,
  Ban,
  ShieldCheck,
  Crown,
} from 'lucide-react';
import { AdminUserIdentity, AdminEmailActions } from './admin-user-tools';
import { DeleteAccount } from './admin-delete-account';
import { ProfileValue } from './admin-profile-values';
import { ReportMedia } from './report-media';
import type { AdminApi } from './admin-users';

type Row = Record<string, any>;

interface AdminUserModalProps {
  account: Row;
  api: AdminApi;
  busy: boolean;
  accountNote: string;
  setAccountNote: (note: string) => void;
  onClose: () => void;
  onUpdateAccount: (updated: Row) => void;
  onDeleted: () => void;
  onNotify: (uid: string) => void;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

const date = (v: any) =>
  v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '—';

const labels: Row = {
  name: 'ชื่อ',
  nickname: 'ชื่อเล่น',
  studentId: 'รหัสนักศึกษา',
  campusEmail: 'อีเมลมหาวิทยาลัย',
  age: 'อายุ',
  gender: 'เพศ',
  faculty: 'คณะ',
  major: 'สาขาวิชา',
  year: 'ชั้นปี',
  bio: 'แนะนำตัว',
  activity: 'กิจกรรมหลัก',
  activities: 'กิจกรรมทั้งหมด',
  activityLabel: 'ชื่อกิจกรรม',
  activityDetails: 'รายละเอียดกิจกรรม',
  skill: 'ระดับทักษะ',
  pace: 'เพซ',
  availability: 'เวลาที่สะดวก',
  availabilitySlots: 'ช่วงเวลาที่เลือก',
  tags: 'แท็ก',
  interests: 'ความสนใจ',
  favoriteTracks: 'เพลงโปรด',
  phone: 'เบอร์โทรศัพท์',
  instagram: 'Instagram',
  lineId: 'LINE ID',
  dormitory: 'หอพัก',
  photoUrl: 'รูปโปรไฟล์',
  avatarUrl: 'รูปโปรไฟล์',
  isDiscoverable: 'แสดงในการค้นหาเพื่อน',
  notificationsEnabled: 'เปิดแจ้งเตือน',
  privacy: 'ความเป็นส่วนตัว',
  matchingPreferences: 'เงื่อนไขค้นหาเพื่อน',
  locationEnabled: 'อนุญาตตำแหน่ง',
  consentAcceptedAt: 'ยอมรับข้อตกลงเมื่อ',
  consentVersion: 'เวอร์ชันข้อตกลง',
  createdAt: 'สร้างโปรไฟล์เมื่อ',
  updatedAt: 'แก้ไขโปรไฟล์เมื่อ',
  lastActiveAt: 'กิจกรรมล่าสุด',
  canCall: 'สิทธิ์โทร',
  isCallTester: 'ผู้ทดสอบการโทร',
  isTester: 'ผู้ทดสอบ',
};

export function AdminUserModal({
  account,
  api,
  busy,
  accountNote,
  setAccountNote,
  onClose,
  onUpdateAccount,
  onDeleted,
  onNotify,
  onNotice,
  onError,
}: AdminUserModalProps) {
  const [tab, setTab] = useState<'profile' | 'email' | 'security' | 'logs'>('profile');
  const [copied, setCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(account.uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleStatusChange = async () => {
    if (!accountNote.trim()) {
      onError('กรุณากรอกเหตุผลการเปลี่ยนสถานะก่อนระงับหรือเปิดบัญชี');
      return;
    }
    const willDisable = !account.disabled;
    if (window.confirm(`${willDisable ? 'ระงับ' : 'เปิดใช้งาน'}บัญชี ${account.email || account.uid} หรือไม่?`)) {
      setActionBusy(true);
      onError('');
      try {
        await api('accountStatus', {
          uid: account.uid,
          disabled: willDisable,
          note: accountNote,
        });
        const updated = await api('user', { query: account.uid });
        onUpdateAccount(updated);
        setAccountNote('');
        onNotice(willDisable ? 'ระงับบัญชีผู้ใช้แล้ว' : 'เปิดใช้งานบัญชีผู้ใช้แล้ว');
      } catch (e: any) {
        onError(e.message || 'เปลี่ยนสถานะบัญชีไม่สำเร็จ');
      } finally {
        setActionBusy(false);
      }
    }
  };

  const rawProfile = account.profile || {};
  const isPlus = account.membership?.activeUntil && account.membership.activeUntil > Date.now();
  const totalLogsCount = (account.auditLogs?.length || 0) + (account.faceSessions?.length || 0);

  // Merged profile that falls back to top-level account properties
  const mergedProfile: Row = {
    name: rawProfile.name || account.name || '—',
    nickname: rawProfile.nickname || account.nickname || '—',
    studentId: rawProfile.studentId || account.studentId || '—',
    campusEmail: rawProfile.campusEmail || account.email || '—',
    faculty: rawProfile.faculty || account.faculty || '—',
    major: rawProfile.major || account.major || '—',
    year: rawProfile.year || '—',
    gender: rawProfile.gender || '—',
    age: rawProfile.age || '—',
    bio: rawProfile.bio || '—',
    activity: rawProfile.activity || '—',
    activities: rawProfile.activities?.length ? rawProfile.activities : [],
    skill: rawProfile.skill || '—',
    pace: rawProfile.pace || '—',
    availability: rawProfile.availability || '—',
    availabilitySlots: rawProfile.availabilitySlots?.length ? rawProfile.availabilitySlots : [],
    interests: rawProfile.interests?.length ? rawProfile.interests : [],
    tags: rawProfile.tags?.length ? rawProfile.tags : [],
    favoriteTracks: rawProfile.favoriteTracks?.length ? rawProfile.favoriteTracks : [],
    phone: rawProfile.phone || '—',
    instagram: rawProfile.instagram || '—',
    lineId: rawProfile.lineId || '—',
    dormitory: rawProfile.dormitory || '—',
    isDiscoverable: rawProfile.isDiscoverable ?? true,
    notificationsEnabled: rawProfile.notificationsEnabled ?? true,
    locationEnabled: rawProfile.locationEnabled ?? false,
    createdAt: rawProfile.createdAt || account.createdAt,
    updatedAt: rawProfile.updatedAt || account.updatedAt,
    lastActiveAt: rawProfile.lastActiveAt || account.lastSignIn,
  };

  for (const [k, v] of Object.entries(rawProfile)) {
    if (k !== 'gallery' && !(k in mergedProfile)) {
      mergedProfile[k] = v;
    }
  }

  return (
    <div className="user-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="user-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="user-modal-header">
          <div className="user-modal-identity">
            <AdminUserIdentity account={account} />
            <div className="user-modal-quick-badges">
              <span className={'badge ' + (account.disabled ? 'dismissed' : 'resolved')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {account.disabled ? <><Ban size={13} /> บัญชีถูกระงับ</> : <><CheckCircle2 size={13} /> ใช้งานได้ปกติ</>}
              </span>
              <span className={'badge ' + (account.emailVerified ? 'resolved' : 'pending')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {account.emailVerified ? <><CheckCircle2 size={13} /> ยืนยันอีเมลแล้ว</> : <><Clock size={13} /> รอการยืนยันอีเมล</>}
              </span>
              {account.isFaceVerified ? (
                <span className="badge resolved" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ShieldCheck size={13} /> ยืนยันใบหน้าแล้ว {account.faceMatchScore ? `(${account.faceMatchScore}%)` : ''}
                </span>
              ) : (
                <span className="badge pending" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={13} /> ยังไม่ยืนยันใบหน้า
                </span>
              )}
              {account.isAdmin && (
                <span className="badge reviewing" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={13} /> ผู้ดูแลระบบ
                </span>
              )}
              {isPlus && (
                <span className="badge" style={{ background: '#fef3c7', color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Crown size={13} /> CampusMate Plus
                </span>
              )}
            </div>
          </div>
          <button className="user-modal-close" onClick={onClose} aria-label="ปิดหน้าต่าง">
            <X size={20} />
          </button>
        </div>

        {/* UID Pill Bar */}
        <div className="user-modal-uid-bar">
          <div className="user-uid-pill" onClick={copyUid} title="กดเพื่อคัดลอก UID">
            <span className="uid-label">UID:</span>
            <code>{account.uid}</code>
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} color="#94a3b8" />}
          </div>
          <div className="user-meta-item">
            <Calendar size={14} /> สมัครเมื่อ {date(account.createdAt)}
          </div>
          <div className="user-meta-item">
            <Clock size={14} /> เข้าสู่ระบบล่าสุด {date(account.lastSignIn)}
          </div>
        </div>

        {/* Modal Tabs Navigation */}
        <div className="user-modal-tabs">
          <button
            type="button"
            className={'user-tab-btn ' + (tab === 'profile' ? 'active' : '')}
            onClick={() => setTab('profile')}
          >
            <User size={16} />
            <span>โปรไฟล์เต็ม</span>
            <span className="badge" style={{ fontSize: 11, padding: '2px 7px' }}>
              {account.profileExists ? 'มีโปรไฟล์' : 'ข้อมูลตั้งต้น'}
            </span>
          </button>
          <button
            type="button"
            className={'user-tab-btn ' + (tab === 'logs' ? 'active' : '')}
            onClick={() => setTab('logs')}
          >
            <FileText size={16} />
            <span>บันทึกระบบ & ประวัติ</span>
            <span className="badge" style={{ fontSize: 11, padding: '2px 7px' }}>
              {totalLogsCount}
            </span>
          </button>
          <button
            type="button"
            className={'user-tab-btn ' + (tab === 'email' ? 'active' : '')}
            onClick={() => setTab('email')}
          >
            <Mail size={16} />
            <span>จัดการและส่งอีเมล</span>
          </button>
          <button
            type="button"
            className={'user-tab-btn ' + (tab === 'security' ? 'active' : '')}
            onClick={() => setTab('security')}
          >
            <Shield size={16} />
            <span>สถานะบัญชี & ความปลอดภัย</span>
            {account.disabled && (
              <span className="badge dismissed" style={{ fontSize: 11, padding: '2px 7px' }}>
                ระงับ
              </span>
            )}
          </button>
        </div>

        {/* Modal Body / Tab Content */}
        <div className="user-modal-body">
          {/* TAB 1: Profile & Gallery */}
          {tab === 'profile' && (
            <div className="user-tab-content">
              {/* Quick Actions Bar */}
              <div className="modal-actions-bar">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => {
                      onNotify(account.uid);
                      onClose();
                    }}
                  >
                    <Bell size={15} /> ส่งการแจ้งเตือน (Push)
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setTab('logs')}
                  >
                    <FileText size={15} /> ดูบันทึกระบบ & ประวัติ ({totalLogsCount})
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setTab('email')}
                  >
                    <Mail size={15} /> จัดการและส่งอีเมล
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setTab('security')}
                  >
                    <Shield size={15} /> สถานะบัญชี & ความปลอดภัย
                  </button>
                </div>
              </div>

              {/* Face Verification Info Card */}
              <div
                style={{
                  background: account.isFaceVerified ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${account.isFaceVerified ? '#bbf7d0' : '#e2e8f0'}`,
                  borderRadius: 14,
                  padding: '14px 18px',
                  marginBottom: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: account.isFaceVerified ? '#dcfce7' : '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                    }}
                  >
                    {account.isFaceVerified ? (
                      <ShieldCheck size={24} color="#15803d" />
                    ) : (
                      <Clock size={24} color="#64748b" />
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: account.isFaceVerified ? '#15803d' : '#334155' }}>
                      {account.isFaceVerified ? 'ยืนยันใบหน้าผ่านแล้ว (Face Verified)' : 'ยังไม่ยืนยันตัวตนด้วยใบหน้า'}
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                      สถานะระบบ: <strong>{account.faceVerificationStatus || (account.isFaceVerified ? 'verified' : 'unverified')}</strong>
                      {account.faceVerifiedAt && ` · วันที่ยืนยัน: ${date(account.faceVerifiedAt)}`}
                    </div>
                  </div>
                </div>
                {typeof account.faceMatchScore === 'number' && (
                  <div style={{ textAlign: 'right', background: '#ffffff', padding: '6px 14px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>คะแนนความเหมือนใบหน้า</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>
                      {account.faceMatchScore}%
                    </div>
                  </div>
                )}
              </div>

              {/* Activity Stats Cards */}
              <div className="profile-stats">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                    <Flag size={15} /> <span>รายงานที่ส่ง</span>
                  </div>
                  <strong>{account.stats?.reportsMade ?? 0}</strong>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                    <AlertTriangle size={15} /> <span>รายงานที่ได้รับ</span>
                  </div>
                  <strong>{account.stats?.reportsReceived ?? 0}</strong>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                    <MessageSquare size={15} /> <span>ห้องสนทนา</span>
                  </div>
                  <strong>{account.stats?.conversations ?? 0}</strong>
                </div>
              </div>

              {/* CampusMate Plus Card */}
              {account.membership?.activeUntil ? (
                <div className="plus-membership-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={18} color="#d97706" />
                    <strong>สมาชิก CampusMate Plus</strong>
                    <span className={'badge ' + (isPlus ? 'resolved' : 'dismissed')}>
                      {isPlus ? 'กำลังใช้งาน' : 'หมดอายุ'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10, fontSize: 13 }}>
                    <div>
                      <span className="muted">หมดอายุ:</span> {date(account.membership.activeUntil)}
                    </div>
                    <div>
                      <span className="muted">แพ็กเกจ:</span> {account.membership.productId || '—'}
                    </div>
                    <div>
                      <span className="muted">แหล่งซื้อ:</span> {account.membership.source || '—'}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Profile Details List */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
                <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <User size={16} color="#2563eb" /> ข้อมูลโปรไฟล์ทั้งหมด
                </h3>
                <span className={'badge ' + (account.profileExists ? 'resolved' : 'pending')} style={{ fontSize: 12 }}>
                  {account.profileExists ? 'มีข้อมูลในแอป' : 'ยังไม่ตั้งค่าในแอป'}
                </span>
              </div>

              {!account.profileExists && (
                <div className="info" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={15} />
                  <span>ผู้ใช้นี้ยังไม่ได้กรอกโปรไฟล์เพิ่มเติมในแอป (แสดงข้อมูลตั้งต้นจากระบบบัญชีผู้ใช้)</span>
                </div>
              )}

              <dl className="modal-profile-dl">
                {Object.entries(mergedProfile).map(([key, value]) => {
                  // If profile doesn't exist in app, hide irrelevant empty values like empty arrays or dashes
                  if (!account.profileExists && (value === '—' || value === '' || (Array.isArray(value) && !value.length))) {
                    return null;
                  }
                  return (
                    <div key={key} className="modal-profile-row">
                      <dt>{labels[key] || key}</dt>
                      <dd>
                        <ProfileValue value={value} field={key} />
                      </dd>
                    </div>
                  );
                })}
              </dl>

              {/* Profile Gallery Section */}
              <h3 style={{ margin: '24px 0 12px', fontSize: 15 }}>
                รูปภาพในแกลเลอรี ({rawProfile.gallery?.length || 0} รูป)
              </h3>
              {rawProfile.gallery?.length ? (
                <div className="profile-gallery">
                  {rawProfile.gallery.map((url: string, i: number) => (
                    <ReportMedia key={url + i} url={url} />
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>ไม่มีรูปภาพแกลเลอรีเพิ่มเติม</p>
              )}
            </div>
          )}

          {/* TAB 2: Email Actions & Logs */}
          {tab === 'email' && (
            <div className="user-tab-content">
              <AdminEmailActions
                account={account}
                busy={busy || actionBusy}
                onCheck={async () => {
                  setActionBusy(true);
                  try {
                    const r = await api('emailHealth');
                    onNotice(`เชื่อมต่อ SMTP สำเร็จ · ผู้ส่ง ${r.sender}`);
                  } catch (e: any) {
                    onError(e.message || 'ตรวจ SMTP ไม่สำเร็จ');
                  } finally {
                    setActionBusy(false);
                  }
                }}
                onSend={async (kind, requestId) => {
                  setActionBusy(true);
                  try {
                    const r = await api('sendEmail', { uid: account.uid, kind, requestId });
                    const updated = await api('user', { query: account.uid });
                    onUpdateAccount(updated);
                    onNotice(`ส่งอีเมลไปที่ ${r.to} เรียบร้อยแล้ว`);
                  } catch (e: any) {
                    onError(e.message || 'ส่งอีเมลไม่สำเร็จ');
                  } finally {
                    setActionBusy(false);
                  }
                }}
              />

              <h3 style={{ margin: '24px 0 12px', fontSize: 15 }}>ประวัติและบันทึกเวลาการส่งอีเมล</h3>
              <div className="email-logs-list">
                {[
                  ['verification', 'อีเมลยืนยันบัญชี'],
                  ['change', 'เปลี่ยนอีเมลมหาวิทยาลัย'],
                  ['passwordReset', 'คำขอตั้งรหัสผ่านใหม่'],
                ].map(([key, label]) => (
                  <div className="mail-row" key={key}>
                    <div>
                      <strong>{label}</strong>
                      {key === 'verification' && (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          สถานะ: {account.emailVerified ? 'ยืนยันแล้ว' : 'รอการยืนยัน'}
                        </div>
                      )}
                    </div>
                    <span>
                      {account.emails?.[key]?.sentAt
                        ? date(account.emails[key].sentAt)
                        : 'ไม่มีบันทึกเวลาส่งในระบบ'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="info" style={{ marginTop: 20 }}>
                การยืนยันบัญชีตรวจจาก Firebase Authentication โดยตรง บัญชีที่เข้าผ่าน Google จะได้รับการยืนยันทันทีโดยไม่มีบันทึกเวลาส่งของ SMTP
              </div>
            </div>
          )}

          {/* TAB 3: Security & Moderation */}
          {tab === 'security' && (
            <div className="user-tab-content">
              {/* Account Information Metadata */}
              <div className="security-summary-card">
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>ข้อมูลสิทธิ์และสถานะบัญชี</h3>
                <dl style={{ margin: 0, gap: '10px 14px' }}>
                  <dt>UID</dt>
                  <dd><code>{account.uid}</code></dd>
                  <dt>ช่องทางเข้าสู่ระบบ</dt>
                  <dd>
                    {(account.providers || [])
                      .map((p: string) => (p === 'password' ? 'อีเมลและรหัสผ่าน' : p === 'google.com' ? 'Google' : p))
                      .join(', ') || 'ไม่ระบุ'}
                  </dd>
                  <dt>โหมดการแสดงตัว</dt>
                  <dd>{account.visibility?.mode === 'incognito' ? 'โหมดไม่ระบุตัวตน (Incognito)' : 'ปกติ (สาธารณะ)'}</dd>
                  <dt>สถานะบัญชี</dt>
                  <dd>
                    <span className={'badge ' + (account.disabled ? 'dismissed' : 'resolved')}>
                      {account.disabled ? 'ระงับการเข้าสู่ระบบ' : 'เปิดใช้งานปกติ'}
                    </span>
                  </dd>
                </dl>
              </div>

              {/* Warnings and Suspensions */}
              {account.restriction?.suspensionReason && (
                <div className="error" style={{ margin: '16px 0' }}>
                  <strong>เหตุผลที่ระงับ:</strong> {account.restriction.suspensionReason}
                </div>
              )}
              {account.restriction?.latestWarning && (
                <div className="info" style={{ margin: '16px 0' }}>
                  <strong>คำเตือนล่าสุด:</strong> {account.restriction.latestWarning.message}
                </div>
              )}

              {/* Suspension Toggle Form */}
              <div className="suspension-form-panel">
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
                  {account.disabled ? 'เปิดใช้งานบัญชีอีกครั้ง' : 'ระงับการเข้าใช้งานบัญชี'}
                </h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
                  {account.disabled
                    ? 'การเปิดใช้งานจะอนุญาตให้ผู้ใช้ลงชื่อเข้าสู่ระบบได้ตามปกติ'
                    : 'การระงับจะปิดการเข้าสู่ระบบและยกเลิก refresh token ทันที โดยไม่ลบประวัติและข้อมูล'}
                </p>
                <label>
                  เหตุผลการเปลี่ยนสถานะ (จำเป็น)
                  <textarea
                    maxLength={2000}
                    value={accountNote}
                    onChange={e => setAccountNote(e.target.value)}
                    placeholder="กรอกเหตุผลเพื่อบันทึกในประวัติการจัดการ..."
                  />
                </label>
                <button
                  disabled={busy || actionBusy || account.isAdmin}
                  className={account.disabled ? 'primary' : 'danger'}
                  onClick={handleStatusChange}
                >
                  {actionBusy
                    ? 'กำลังดำเนินการ…'
                    : account.disabled
                    ? 'เปิดใช้งานบัญชีนี้'
                    : 'ระงับการใช้งานบัญชีนี้'}
                </button>
              </div>

              {/* Danger Zone: Delete Account */}
              <div style={{ marginTop: 24 }}>
                <DeleteAccount
                  account={account}
                  api={api}
                  onDeleted={() => {
                    onClose();
                    onDeleted();
                  }}
                />
              </div>
            </div>
          )}

          {/* TAB 4: System Logs & Audit */}
          {tab === 'logs' && (
            <div className="user-tab-content">
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#2563eb" />
                  บันทึกระบบและประวัติการทำงาน (System Logs & Audit)
                </h3>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  ตรวจสอบประวัติการทำรายการของผู้ใช้ กิจกรรมของแอดมิน และผลการสแกนยืนยันใบหน้า
                </p>
              </div>

              {/* Log Stats Pills */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', flex: '1 1 180px' }}>
                  <span className="muted" style={{ fontSize: 12 }}>ประวัติการสแกนใบหน้า</span>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                    {account.faceSessions?.length || 0} ครั้ง
                  </div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', flex: '1 1 180px' }}>
                  <span className="muted" style={{ fontSize: 12 }}>บันทึกการจัดการโดยแอดมิน</span>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                    {account.auditLogs?.length || 0} รายการ
                  </div>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', flex: '1 1 180px' }}>
                  <span className="muted" style={{ fontSize: 12 }}>สถานะใบหน้าปัจจุบัน</span>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                    {account.isFaceVerified ? (
                      <span className="badge resolved" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ShieldCheck size={12} /> ยืนยันแล้ว ({account.faceMatchScore}%)
                      </span>
                    ) : (
                      <span className="badge pending" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> ยังไม่ยืนยัน
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 1: Face Verification Sessions */}
              <div style={{ marginBottom: 26 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', fontSize: 14, color: '#1e293b' }}>
                  <Shield size={16} color="#059669" /> ประวัติการสแกนใบหน้า (Face Verification Sessions) ({account.faceSessions?.length || 0})
                </h4>
                {account.faceSessions?.length ? (
                  <div className="table-scroll" style={{ border: '1px solid #e2e8f0', borderRadius: 10 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>เวลาทำรายการ</th>
                          <th>Session ID</th>
                          <th>สถานะ</th>
                          <th>คะแนนความเหมือน</th>
                          <th>เหตุผล / ผลการตรวจสอบ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.faceSessions.map((session: Row) => (
                          <tr key={session.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{date(session.createdAt || session.updatedAt)}</td>
                            <td><code style={{ fontSize: 11 }}>{session.id}</code></td>
                            <td>
                              <span className={'badge ' + (session.status === 'VERIFIED' ? 'resolved' : session.status === 'PENDING' ? 'pending' : 'dismissed')}>
                                {session.status === 'VERIFIED' ? 'ผ่านการยืนยัน' : session.status === 'PENDING' ? 'กำลังประมวลผล' : session.status || 'ไม่ผ่าน'}
                              </span>
                            </td>
                            <td>
                              {typeof session.similarity === 'number' ? (
                                <strong style={{ color: session.similarity >= 80 ? '#16a34a' : '#dc2626' }}>
                                  {session.similarity}%
                                </strong>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{session.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '18px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                    ไม่มีประวัติการส่งสแกนใบหน้าในระบบ
                  </div>
                )}
              </div>

              {/* Section 2: Admin Operations Audit Logs */}
              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', fontSize: 14, color: '#1e293b' }}>
                  <FileText size={16} color="#2563eb" /> บันทึกการจัดการจากผู้ดูแลระบบ (Admin Audit Logs) ({account.auditLogs?.length || 0})
                </h4>
                {account.auditLogs?.length ? (
                  <div className="table-scroll" style={{ border: '1px solid #e2e8f0', borderRadius: 10 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>เวลาดำเนินการ</th>
                          <th>ผู้ดำเนินการ (Actor)</th>
                          <th>คำสั่ง (Action)</th>
                          <th>รายละเอียด / หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.auditLogs.map((log: Row) => (
                          <tr key={log.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{date(log.createdAt)}</td>
                            <td style={{ fontSize: 12 }}>{log.actor || 'ระบบอัตโนมัติ'}</td>
                            <td>
                              <span className="badge reviewing" style={{ fontSize: 11 }}>
                                {log.action}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: '#475569' }}>
                              {log.note && <div><strong>หมายเหตุ:</strong> {log.note}</div>}
                              {log.after && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>ผลลัพธ์: {JSON.stringify(log.after)}</div>}
                              {log.kind && <div>ประเภทอีเมล: {log.kind} ({log.provider || 'smtp'})</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '18px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                    ยังไม่มีบันทึกการระงับ ปลดแบน หรือจัดการใดๆ ต่อผู้ใช้นี้
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
