import { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  MapPin,
  Calendar,
  Clock,
  User,
  Users,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Ban,
  X,
  MessageSquare,
} from 'lucide-react';

type Row = Record<string, any>;

interface AdminPartiesProps {
  api: (op: string, data?: Row) => Promise<Row>;
  busy: boolean;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onSelectUser: (uid: string) => void;
}

const STATUS_MAP: Record<string, { label: string; class: string }> = {
  open: { label: 'เปิดรับสมาชิก', class: 'resolved' },
  full: { label: 'สมาชิกเต็มแล้ว', class: 'pending' },
  cancelled: { label: 'ยกเลิกแล้ว', class: 'dismissed' },
  expired: { label: 'หมดเวลาแล้ว', class: 'dismissed' },
};

function formatThaiDate(dateStr?: string) {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = Number(parts[0]) + 543;
      return `${parts[2]}/${parts[1]}/${year}`;
    }
  } catch {}
  return dateStr;
}

function formatDate(val: any) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    return d.toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    });
  } catch {
    return '—';
  }
}

export function AdminParties({
  api,
  busy,
  onNotice,
  onError,
  onSelectUser,
}: AdminPartiesProps) {
  const [parties, setParties] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [cancellingParty, setCancellingParty] = useState<Row | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  async function loadParties() {
    setLoading(true);
    try {
      const res = await api('parties', { status: statusFilter });
      setParties(res.rows || []);
    } catch (e: any) {
      onError(e.message || 'โหลดข้อมูลระบบตี้ล้มเหลว');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadParties();
  }, [statusFilter]);

  async function handleConfirmCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancellingParty || cancelling) return;
    if (!cancelReason.trim()) {
      onError('กรุณาระบุเหตุผลในการยกเลิกตี้');
      return;
    }

    setCancelling(true);
    try {
      const res = await api('cancelParty', {
        id: cancellingParty.id,
        note: cancelReason.trim(),
      });
      if (res.success) {
        onNotice(`ยกเลิกตี้รหัส ${cancellingParty.id} เรียบร้อยแล้ว`);
        setCancellingParty(null);
        setCancelReason('');
        await loadParties();
      }
    } catch (err: any) {
      onError(err.message || 'ยกเลิกตี้ไม่สำเร็จ');
    } finally {
      setCancelling(false);
    }
  }

  const filteredParties = parties.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const locName = p.location?.name || '';
    const hostName = p.host?.name || '';
    const hostId = p.hostId || '';
    const msg = p.schedule?.message || '';
    return (
      locName.toLowerCase().includes(q) ||
      hostName.toLowerCase().includes(q) ||
      hostId.toLowerCase().includes(q) ||
      msg.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    );
  });

  const counts = {
    all: parties.length,
    open: parties.filter((p) => p.status === 'open').length,
    full: parties.filter((p) => p.status === 'full').length,
    cancelled: parties.filter((p) => p.status === 'cancelled').length,
    expired: parties.filter((p) => p.status === 'expired').length,
  };

  return (
    <div className="parties-manager">
      <div className="panel-heading" style={{ marginBottom: 16 }}>
        <div>
          <h2>ระบบตี้ / กิจกรรมนัดพบ ({parties.length} รายการ)</h2>
          <p className="muted">
            ตรวจสอบกิจกรรมนัดพบ หาเพื่อนทำกิจกรรม และจัดการตี้ที่ไม่เหมาะสมในมหาวิทยาลัย
          </p>
        </div>
        <button disabled={busy || loading} onClick={loadParties}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> รีเฟรช
        </button>
      </div>

      {/* Stats row */}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 20 }}>
        <div className="stat" style={{ padding: 16 }}>
          <span>ตี้ทั้งหมด</span>
          <strong style={{ fontSize: 24, margin: '8px 0 4px' }}>{counts.all}</strong>
          <small>ในรายการที่โหลด</small>
        </div>
        <div className="stat" style={{ padding: 16 }}>
          <span style={{ color: '#2b8463' }}>เปิดรับสมาชิก</span>
          <strong style={{ fontSize: 24, margin: '8px 0 4px', color: '#2b8463' }}>
            {counts.open}
          </strong>
          <small>กำลังรอคนเข้าร่วม</small>
        </div>
        <div className="stat" style={{ padding: 16 }}>
          <span style={{ color: '#af872c' }}>สมาชิกเต็มแล้ว</span>
          <strong style={{ fontSize: 24, margin: '8px 0 4px', color: '#af872c' }}>
            {counts.full}
          </strong>
          <small>คนครบพร้อมนัด</small>
        </div>
        <div className="stat" style={{ padding: 16 }}>
          <span style={{ color: '#a33f4d' }}>ยกเลิกแล้ว</span>
          <strong style={{ fontSize: 24, margin: '8px 0 4px', color: '#a33f4d' }}>
            {counts.cancelled}
          </strong>
          <small>ยกเลิกโดยโฮสต์/แอดมิน</small>
        </div>
        <div className="stat" style={{ padding: 16 }}>
          <span>หมดเวลา</span>
          <strong style={{ fontSize: 24, margin: '8px 0 4px' }}>{counts.expired}</strong>
          <small>ผ่านเวลานัดแล้ว</small>
        </div>
      </div>

      {/* Filters */}
      <section className="panel" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="input-icon" style={{ flex: '1 1 260px' }}>
            <Search size={16} />
            <input
              placeholder="ค้นหาชื่อสถานที่, ชื่อโฮสต์, ข้อความ หรือ UID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'open', label: 'เปิดรับ' },
              { id: 'full', label: 'เต็มแล้ว' },
              { id: 'cancelled', label: 'ยกเลิก' },
              { id: 'expired', label: 'หมดเวลา' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={statusFilter === f.id ? 'primary' : ''}
                style={{ padding: '8px 14px', fontSize: 12 }}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Parties List */}
      <div style={{ display: 'grid', gap: 14 }}>
        {filteredParties.map((p) => {
          const statusInfo = STATUS_MAP[p.status] || {
            label: p.status || 'unknown',
            class: '',
          };
          const loc = p.location || {};
          const sched = p.schedule || {};
          const isCancelled = p.status === 'cancelled';
          const canCancel = p.status === 'open' || p.status === 'full';

          return (
            <div
              key={p.id}
              className="panel"
              style={{
                padding: 20,
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.3fr) auto',
                gap: 20,
                alignItems: 'center',
              }}
            >
              {/* Left Column: Location & Schedule */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className={`badge ${statusInfo.class}`}>{statusInfo.label}</span>
                  <span className="small muted">รหัสตี้: {p.id}</span>
                </div>

                <h3
                  style={{
                    margin: '4px 0 8px',
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MapPin size={16} color="#635bdc" />
                  {loc.name || (loc.kind === 'pin' ? 'หมุดบนแผนที่' : 'สถานที่ ม.อ.')}
                </h3>

                {loc.latitude && loc.longitude && (
                  <div style={{ marginBottom: 8 }}>
                    <a
                      href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 11,
                        color: '#635bdc',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      เปิดดูพิกัดบนแผนที่ <ExternalLink size={10} />
                    </a>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    fontSize: 12,
                    color: '#555e70',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={13} /> {formatThaiDate(sched.date)}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={13} /> {sched.startTime || '—'} – {sched.endTime || '—'} น.
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={13} /> {p.memberCount || 1}/{p.maxPeople || 2} คน
                  </span>
                </div>

                {sched.message ? (
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: 12,
                      background: '#f8f9fc',
                      padding: '8px 12px',
                      borderRadius: 8,
                      color: '#424c61',
                    }}
                  >
                    <MessageSquare size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                    {sched.message}
                  </p>
                ) : null}

                {/* Cancel info */}
                {isCancelled && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: '#a33f4d',
                      background: '#fff0f0',
                      padding: '6px 10px',
                      borderRadius: 6,
                    }}
                  >
                    <strong>เหตุผลที่ยกเลิก:</strong> {p.cancelReason || 'โฮสต์ยกเลิกการนัด'}
                    {p.cancelledByAdmin && ' (ยกเลิกโดยแอดมิน)'} • {formatDate(p.cancelledAt)}
                  </div>
                )}
              </div>

              {/* Middle Column: Host & Members */}
              <div style={{ borderLeft: '1px solid #f0f2f6', paddingLeft: 18 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  <strong>โฮสต์ (ผู้สร้างตี้):</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: '#eeecff',
                      color: '#635bdc',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {p.host?.name ? p.host.name[0] : <User size={16} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.host?.name || 'ไม่ระบุชื่อ'}
                    </div>
                    <button
                      type="button"
                      style={{
                        padding: 0,
                        border: 0,
                        background: 'transparent',
                        color: '#635bdc',
                        fontSize: 11,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onClick={() => onSelectUser(p.hostId)}
                    >
                      ดูโปรไฟล์ (UID: {p.hostId?.slice(0, 10)}...)
                    </button>
                  </div>
                </div>

                <div className="small muted">สร้างเมื่อ: {formatDate(p.createdAt)}</div>
                {p.memberIds && p.memberIds.length > 1 && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    สมาชิก ({p.memberIds.length} คน): {p.memberIds.join(', ')}
                  </div>
                )}
              </div>

              {/* Right Column: Actions */}
              <div>
                {canCancel ? (
                  <button
                    className="danger"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                    onClick={() => {
                      setCancellingParty(p);
                      setCancelReason('');
                    }}
                  >
                    <Ban size={14} /> ยกเลิกตี้ (แอดมิน)
                  </button>
                ) : (
                  <span className="small muted">ไม่สามารถดำเนินการ</span>
                )}
              </div>
            </div>
          );
        })}

        {filteredParties.length === 0 && !loading && (
          <div className="empty">
            <Sparkles size={32} />
            <h3>ไม่พบข้อมูลตี้</h3>
            <p>กิจกรรมนัดพบที่สร้างในแอปจะปรากฏที่นี่</p>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {cancellingParty && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            className="panel"
            style={{
              width: '100%',
              maxWidth: 480,
              margin: 0,
              padding: 24,
              boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b33343' }}>
                <AlertTriangle size={20} />
                <h3 style={{ margin: 0, fontSize: 17 }}>ยกเลิกตี้โดยผู้ดูแลระบบ</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCancellingParty(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#555e70', lineHeight: 1.6, margin: '0 0 14px' }}>
              คุณกำลังจะยกเลิกตี้ที่ <strong>{cancellingParty.location?.name || 'จุดนัดพบ'}</strong>{' '}
              สร้างโดย <strong>{cancellingParty.host?.name || cancellingParty.hostId}</strong>
            </p>

            <form onSubmit={handleConfirmCancel}>
              <label>
                เหตุผลการยกเลิก (จำเป็น)
                <textarea
                  required
                  placeholder="เช่น ฝ่าฝืนกฎชุมชน, มีการเชิญชวนในลักษณะไม่เหมาะสม"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                />
              </label>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  marginTop: 18,
                }}
              >
                <button
                  type="button"
                  disabled={busy || cancelling}
                  onClick={() => setCancellingParty(null)}
                >
                  ย้อนกลับ
                </button>
                <button type="submit" disabled={busy || cancelling} className="danger">
                  {cancelling ? 'กำลังยกเลิกตี้...' : 'ยืนยันการยกเลิกตี้'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
