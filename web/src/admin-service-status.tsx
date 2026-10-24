import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, Inbox, Power, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';

type Row = Record<string, any>;

interface Props {
  api: (op: string, data?: Row) => Promise<Row>;
  refreshKey: number;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onOpenFeedback: () => void;
}

const REFRESH_MS = 15_000;
const LEVELS: Record<string, { label: string; hint: string; tone: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'ระบบทำงานปกติ', hint: 'ไม่มีข้อผิดพลาดฝั่งเซิร์ฟเวอร์ที่น่ากังวลใน 5 นาทีล่าสุด', tone: 'ok', Icon: CheckCircle2 },
  degraded: { label: 'เริ่มมีปัญหา', hint: 'มีข้อผิดพลาดหรือความช้าเกินปกติ ควรตรวจสอบ', tone: 'warn', Icon: AlertTriangle },
  down: { label: 'ระบบขัดข้อง', hint: 'คำขอล้มเหลวจำนวนมาก หรือฐานข้อมูลตอบไม่ได้', tone: 'down', Icon: ShieldAlert },
  quiet: { label: 'ยังไม่มีการใช้งานพอให้ประเมิน', hint: 'มีคำขอน้อยกว่า 10 ครั้งใน 5 นาทีล่าสุด', tone: 'quiet', Icon: Activity },
};

const time = (value: any) => (value ? new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '—');
// datetime-local (Bangkok wall clock) <-> RFC 3339 with the Bangkok offset.
const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? `${value}:00+07:00` : '');

/** Live service health, the maintenance switch and auto-protect. */
export function AdminServiceStatus({ api, refreshKey, onNotice, onError, onOpenFeedback }: Props) {
  const [data, setData] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async (resetForm = false) => {
    try {
      const next = await api('serviceStatus');
      setData(next);
      setLoadedAt(new Date());
      if (resetForm) {
        setForm({ enabled: false, autoProtect: false, title: '', message: '', endsAt: '', ...next.maintenance });
        setDirty(false);
      }
    } catch (error: any) {
      onError(error?.message || 'โหลดสถานะระบบไม่สำเร็จ');
    }
  }, [api, onError]);

  useEffect(() => { void load(true); }, [load]);
  // The header's refresh button; unsaved edits stay in the form.
  useEffect(() => { if (refreshKey) void load(false); }, [load, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => { void load(false); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const edit = (patch: Row) => { setForm((current) => ({ ...current, ...patch })); setDirty(true); };

  const save = async (patch: Row = {}) => {
    const next = { ...form, ...patch };
    const enabling = next.enabled && !data?.maintenance?.enabled;
    if (enabling && !window.confirm('เปิดโหมดปิดปรับปรุง: ผู้ใช้ทุกคน (ยกเว้นผู้ดูแล) จะใช้งานแอปไม่ได้จนกว่าจะปิด ยืนยันหรือไม่?')) return;
    setSaving(true);
    try {
      const maintenance = {
        enabled: Boolean(next.enabled),
        autoProtect: Boolean(next.autoProtect),
        title: String(next.title || '').trim(),
        message: String(next.message || '').trim(),
        endsAt: String(next.endsAt || ''),
      };
      await api('saveMaintenance', { maintenance, revision: data?.revision });
      onNotice(maintenance.enabled ? 'เปิดโหมดปิดปรับปรุงแล้ว ผู้ใช้จะเห็นหน้าปิดปรับปรุงภายในไม่กี่วินาที' : 'บันทึกการตั้งค่าแล้ว');
      await load(true);
    } catch (error: any) {
      onError(error?.message || 'บันทึกไม่สำเร็จ');
      await load(false);
    } finally {
      setSaving(false);
    }
  };

  const resetBreaker = async () => {
    if (!window.confirm('ปล่อยให้ผู้ใช้กลับเข้าใช้งานทันที? ถ้าปัญหายังอยู่ ระบบจะปิดรับอัตโนมัติอีกครั้ง')) return;
    try {
      await api('resetAutoProtect');
      onNotice('ปล่อยผู้ใช้กลับเข้าใช้งานแล้ว');
      await load(false);
    } catch (error: any) {
      onError(error?.message || 'ดำเนินการไม่สำเร็จ');
    }
  };

  if (!data) return <section className="panel"><div className="empty"><RefreshCw className="spin" /><h3>กำลังโหลดสถานะระบบ</h3></div></section>;
  const status = data.status || {};
  const level = LEVELS[status.level] || LEVELS.quiet;
  const recent = status.lastFiveMinutes || {};
  const minutes: Row[] = status.minutes || [];
  const peak = Math.max(1, ...minutes.map((m) => m.total || 0));
  const auto = status.autoProtect || {};
  const live = data.maintenance?.enabled;

  return (
    <>
      <section className={`panel svc-hero svc-${live ? 'maint' : level.tone}`}>
        <div className="svc-hero-icon">{live ? <Wrench size={28} /> : <level.Icon size={28} />}</div>
        <div className="svc-hero-copy">
          <p className="eyebrow">SERVICE STATUS</p>
          <h2>{live ? 'กำลังปิดปรับปรุง: ผู้ใช้ใช้งานแอปไม่ได้' : level.label}</h2>
          <p className="muted">{live ? 'ผู้ดูแลยังใช้งานได้ตามปกติเพื่อตรวจสอบระบบ' : level.hint}</p>
        </div>
        <span className="small muted">อัปเดต {loadedAt ? time(loadedAt) : '—'} น.</span>
      </section>

      <div className="stats">
        <div className="stat"><span>คำขอ 5 นาทีล่าสุด</span><strong>{recent.total ?? 0}</strong><small>ทุก RPC จากแอป</small></div>
        <div className="stat"><span>ผิดพลาดฝั่งเซิร์ฟเวอร์</span><strong className={recent.failed ? 'svc-bad' : ''}>{recent.failed ?? 0}</strong><small>{recent.total ? `${Math.round(((recent.failed || 0) * 100) / recent.total)}% ของคำขอ` : 'ยังไม่มีคำขอ'}</small></div>
        <div className="stat"><span>เวลาตอบเฉลี่ย</span><strong>{recent.averageMs ?? 0}<em> ms</em></strong><small>5 นาทีล่าสุด</small></div>
        <div className="stat"><span><Database size={13} /> ฐานข้อมูล</span><strong className={status.database?.ok ? '' : 'svc-bad'}>{status.database?.ok ? `${status.database.latencyMs} ms` : 'ไม่ตอบ'}</strong><small>ตรวจล่าสุด {loadedAt ? time(loadedAt) : '—'} น.</small></div>
      </div>

      <section className="panel">
        <div className="panel-heading"><h2>คำขอ 30 นาทีล่าสุด</h2><span className="small muted">แท่งสีแดงคือคำขอที่ล้มเหลวฝั่งเซิร์ฟเวอร์ · รีเฟรชทุก 15 วินาที</span></div>
        {minutes.length ? (
          <div className="svc-chart" role="img" aria-label="กราฟจำนวนคำขอและข้อผิดพลาดรายนาที">
            {minutes.map((m) => (
              <div className="svc-bar" key={m.at} title={`${time(m.at)} น. · ${m.total} คำขอ · ล้มเหลว ${m.failed} · เฉลี่ย ${m.averageMs} ms`}>
                <div className="svc-bar-total" style={{ height: `${Math.max(4, ((m.total || 0) / peak) * 100)}%` }}>
                  <div className="svc-bar-failed" style={{ height: `${m.total ? ((m.failed || 0) / m.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="muted">ยังไม่มีคำขอนับตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน</p>}
      </section>

      <div className="two-columns">
        <section className={`panel svc-card ${live ? 'svc-card-on' : ''}`}>
          <div className="panel-heading">
            <div><h2><Power size={18} /> โหมดปิดปรับปรุง</h2><p className="muted">ปิดรับผู้ใช้ชั่วคราวระหว่างแก้ไขระบบ แอปจะแสดงหน้าปิดปรับปรุงและกลับมาใช้งานได้เองเมื่อปิดโหมดนี้</p></div>
          </div>
          <label className="toggle"><span>ปิดปรับปรุงอยู่</span><input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => edit({ enabled: e.target.checked })} /></label>
          <div className="form-grid">
            <label>หัวข้อที่ผู้ใช้เห็น<input maxLength={80} placeholder="กำลังปิดปรับปรุงระบบ" value={form.title || ''} onChange={(e) => edit({ title: e.target.value })} /></label>
            <label>คาดว่าจะเสร็จ (เวลาไทย)<input type="datetime-local" value={toLocalInput(form.endsAt)} onChange={(e) => edit({ endsAt: fromLocalInput(e.target.value) })} /></label>
          </div>
          <label>ข้อความถึงผู้ใช้<textarea maxLength={600} placeholder="CampusMate ปิดปรับปรุงชั่วคราวเพื่อให้ใช้งานได้ดีขึ้น กรุณากลับมาใหม่อีกครั้ง" value={form.message || ''} onChange={(e) => edit({ message: e.target.value })} /></label>
          <div className="svc-preview" aria-label="ตัวอย่างที่ผู้ใช้เห็น">
            <small>ตัวอย่างในแอป</small>
            <strong>{form.title || 'กำลังปิดปรับปรุงระบบ'}</strong>
            <span>{form.message || 'CampusMate ปิดปรับปรุงชั่วคราวเพื่อให้ใช้งานได้ดีขึ้น กรุณากลับมาใหม่อีกครั้ง'}</span>
            {form.endsAt ? <em>คาดว่าจะกลับมาใช้งานได้ {new Date(form.endsAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} น.</em> : null}
          </div>
          <div className="settings-actions">
            <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            {live ? <button disabled={saving} onClick={() => void save({ enabled: false })}><ShieldCheck size={16} />เปิดให้ใช้งานตามปกติ</button> : null}
          </div>
        </section>

        <section className={`panel svc-card ${auto.tripped ? 'svc-card-alert' : ''}`}>
          <div className="panel-heading">
            <div><h2><ShieldAlert size={18} /> ตรวจจับเหตุขัดข้องอัตโนมัติ</h2><p className="muted">เมื่อคำขอล้มเหลวเกิน {auto.rule?.errorPercent ?? 50}% จากอย่างน้อย {auto.rule?.minRequests ?? 30} คำขอใน {auto.rule?.windowMinutes ?? 2} นาที ระบบจะปิดรับผู้ใช้ {Math.round((auto.rule?.coolDownSeconds ?? 180) / 60)} นาที แล้วลองเปิดใหม่ ป้องกันไม่ให้ผู้ใช้เจอข้อผิดพลาดซ้ำ ๆ</p></div>
          </div>
          <label className="toggle"><span>เปิดใช้การปิดรับอัตโนมัติ</span><input type="checkbox" checked={Boolean(form.autoProtect)} onChange={(e) => void save({ autoProtect: e.target.checked })} /></label>
          {auto.tripped ? (
            <div className="error">
              <strong>กำลังปิดรับผู้ใช้อัตโนมัติ</strong> ตั้งแต่ {time(auto.trippedAt)} น. ผู้ใช้เห็นหน้า "ระบบขัดข้องชั่วคราว"
              <div style={{ marginTop: 10 }}><button onClick={() => void resetBreaker()}>ปล่อยผู้ใช้กลับเข้าใช้งานทันที</button></div>
            </div>
          ) : <div className="info">{auto.enabled ? 'กำลังเฝ้าดูอัตราข้อผิดพลาด' : 'ปิดอยู่: ระบบจะแสดงสถานะเท่านั้น ไม่ปิดรับผู้ใช้เอง'}{auto.trips ? ` · ปิดรับอัตโนมัติไปแล้ว ${auto.trips} ครั้งตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน` : ''}</div>}
          <div className="svc-feedback">
            <Inbox size={20} />
            <div><strong>{data.feedback?.new ?? 0} รายงานใหม่จากแอป</strong><span className="muted">บัคที่แจ้งในชั่วโมงล่าสุด {data.feedback?.bugsLastHour ?? 0} รายการ</span></div>
            <button onClick={onOpenFeedback}>เปิดกล่องรายงาน</button>
          </div>
        </section>
      </div>
    </>
  );
}
