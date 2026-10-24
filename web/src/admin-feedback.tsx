import React, { useCallback, useEffect, useState } from 'react';
import { Bug, Image as ImageIcon, Inbox, Lightbulb, Smartphone, User as UserIcon } from 'lucide-react';

type Row = Record<string, any>;

interface Props {
  api: (op: string, data?: Row) => Promise<Row>;
  busy: boolean;
  refreshKey: number;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onSelectUser: (uid: string) => void;
}

const STATUSES: Row = { new: 'ใหม่', triaged: 'กำลังดูแล', resolved: 'แก้ไขแล้ว', dismissed: 'ปิดโดยไม่ดำเนินการ' };
const KINDS: Row = { bug: 'รายงานบัค', feedback: 'ข้อเสนอแนะ' };
const PLATFORMS: Row = { ios: 'iOS', android: 'Android', web: 'เว็บ' };
const date = (value: any) => (value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '—');
const device = (r: Row) => [PLATFORMS[r.platform] || r.platform, r.osVersion, r.appVersion && `แอป ${r.appVersion}${r.appBuild ? ` (${r.appBuild})` : ''}`].filter(Boolean).join(' · ');

/** Bug reports and suggestions sent from the app (shake to report). */
export function AdminFeedback({ api, busy, refreshKey, onNotice, onError, onSelectUser }: Props) {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('new');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [nextStatus, setNextStatus] = useState('triaged');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const list = useCallback(async (more?: string | null) => {
    setLoading(true);
    try {
      const result = await api('feedback', { kind, status, ...(more ? { cursor: more } : {}) });
      const page: Row[] = Array.isArray(result?.rows) ? result.rows : [];
      setRows((current) => (more ? [...current, ...page] : page));
      setCursor(result?.cursor || null);
    } catch (error: any) {
      onError(error?.message || 'โหลดรายงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [api, kind, status, onError]);

  useEffect(() => { setDetail(null); void list(); }, [list, refreshKey]);

  const open = async (id: string) => {
    try {
      const result = await api('feedbackDetail', { id });
      setDetail(result);
      const current = result.feedback?.status;
      setNextStatus(current === 'new' ? 'triaged' : current);
      setNote(result.feedback?.adminNote || '');
    } catch (error: any) {
      onError(error?.message || 'เปิดรายงานไม่สำเร็จ');
    }
  };

  const save = async () => {
    const item = detail?.feedback;
    if (!item) return;
    const closing = ['resolved', 'dismissed'].includes(nextStatus);
    if (closing && item.hasScreenshot && !window.confirm('ปิดรายงานนี้แล้วภาพหน้าจอจะถูกลบถาวร ยืนยันหรือไม่?')) return;
    setSaving(true);
    try {
      await api('updateFeedback', { id: item.id, status: nextStatus, note });
      onNotice('บันทึกสถานะรายงานแล้ว');
      await open(item.id);
      await list();
    } catch (error: any) {
      onError(error?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const item = detail?.feedback;
  const reporter = detail?.reporter;
  return (
    <div className="reports-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>รายงานจากแอป <span className="count">{rows.length}{cursor ? '+' : ''}</span></h2>
          <div className="fb-filters">
            <select aria-label="ประเภท" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">ทุกประเภท</option>
              {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">ทุกสถานะ</option>
              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <p className="small muted">ผู้ใช้ส่งจากเมนูเขย่าเครื่องหรือหน้าตั้งค่า · ใหม่สุดก่อน ครั้งละ 30 รายการ</p>
        {rows.map((r) => (
          <button key={r.id} className={`report-row ${item?.id === r.id ? 'selected' : ''}`} disabled={busy || loading} onClick={() => void open(r.id)}>
            <div className={`report-symbol fb-${r.kind}`}>{r.kind === 'bug' ? <Bug size={18} /> : <Lightbulb size={18} />}</div>
            <div>
              <strong className="fb-message">{r.message}</strong>
              <span>{KINDS[r.kind]}{r.screen ? ` · หน้า ${r.screen}` : ''}{r.hasScreenshot ? ' · มีภาพหน้าจอ' : ''}</span>
              <small>{date(r.createdAt)} · {device(r) || 'ไม่ทราบอุปกรณ์'}</small>
            </div>
            <span className={`badge fb-${r.status}`}>{STATUSES[r.status] || r.status}</span>
          </button>
        ))}
        {!rows.length && !loading && <div className="empty"><Inbox /><h3>ไม่มีรายงานในตัวกรองนี้</h3><p>เมื่อผู้ใช้เขย่าเครื่องแล้วส่งรายงาน จะปรากฏที่นี่</p></div>}
        {cursor && <button disabled={loading} onClick={() => void list(cursor)}>โหลดรายการเพิ่มเติม</button>}
      </section>

      <section className="panel detail">
        {item ? (
          <>
            <p className="eyebrow">{item.kind === 'bug' ? 'BUG REPORT' : 'FEEDBACK'}</p>
            <h2>{KINDS[item.kind]}</h2>
            <p className="fb-body">{item.message}</p>
            <dl>
              {[
                ['สถานะ', STATUSES[item.status] || item.status],
                ['ส่งเมื่อ', date(item.createdAt)],
                ['หน้าที่เปิดอยู่', item.screen],
                ['อุปกรณ์', device(item)],
                ['รหัสรายงาน', item.id],
              ].map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></React.Fragment>)}
            </dl>
            <div className="fb-reporter">
              <UserIcon size={18} />
              <div>
                <strong>{reporter?.missing ? 'บัญชีถูกลบแล้ว' : reporter?.details?.nickname || reporter?.name || item.userId}</strong>
                <span className="muted small">{reporter?.email || item.userId}</span>
              </div>
              {!reporter?.missing && <button onClick={() => onSelectUser(item.userId)}>ดูบัญชี</button>}
            </div>
            {item.screenshot ? (
              <figure className="fb-shot">
                <a href={item.screenshot} target="_blank" rel="noreferrer"><img src={item.screenshot} alt="ภาพหน้าจอที่ผู้ใช้แนบมา" /></a>
                <figcaption className="small muted"><ImageIcon size={13} /> ผู้ใช้เลือกแนบเอง · ลบอัตโนมัติเมื่อปิดรายงาน</figcaption>
              </figure>
            ) : <div className="info"><Smartphone size={14} /> {['resolved', 'dismissed'].includes(item.status) ? 'ภาพหน้าจอ (ถ้ามี) ถูกลบเมื่อปิดรายงานแล้ว' : 'ผู้ใช้ไม่ได้แนบภาพหน้าจอ'}</div>}
            <label>สถานะ<select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>บันทึกของทีม<textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น สาเหตุ เวอร์ชันที่แก้ หรือเหตุผลที่ปิด" /></label>
            <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          </>
        ) : <div className="empty"><Bug /><h3>เลือกรายงานเพื่อดูรายละเอียด</h3><p>ดูข้อความ อุปกรณ์ และภาพหน้าจอที่ผู้ใช้แนบมา</p></div>}
      </section>
    </div>
  );
}
