import { useState, useEffect } from 'react';
import {
  Activity,
  DollarSign,
  Zap,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Sparkles,
} from 'lucide-react';

type Row = Record<string, any>;

interface AdminMetricsProps {
  api: (op: string, data?: Row) => Promise<Row>;
  busy: boolean;
  refreshKey?: number;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminMetrics({ api, busy, refreshKey, onNotice, onError }: AdminMetricsProps) {
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function fetchMetrics() {
    setLoading(true);
    onError('');
    try {
      const res = await api('metrics');
      setData(res);
      setLastRefreshed(new Date());
    } catch (err: any) {
      onError(err.message || 'ไม่สามารถโหลดข้อมูลประสิทธิภาพระบบได้');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchMetrics();
  }, [refreshKey]);

  const metrics = data?.metrics || {};
  const analytics = data?.analytics || {};
  const costs = data?.costs || {};
  const health = data?.health || {};
  const services = health.services || [];
  const breakdown = costs.breakdown || [];

  const totalCostNumber = Number(costs?.totalCostUsd) || 0;
  const monthlyBudgetNumber = Number(costs?.monthlyBudgetUsd) || 25;
  const budgetPercent = Math.min(
    100,
    Math.round((totalCostNumber / monthlyBudgetNumber) * 100)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Action Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            ทดสอบสถานะล่าสุด: {lastRefreshed ? lastRefreshed.toLocaleTimeString('th-TH') : 'กำลังโหลด...'}
          </span>
        </div>
        <button
          disabled={loading || busy}
          className="primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          onClick={() => {
            void fetchMetrics().then(() => onNotice('รีเฟรชข้อมูลแดชบอร์ดและ Ping ระบบสำเร็จ'));
          }}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'กำลัง Ping ระบบ...' : 'ทดสอบ Latency ระบบสด'}
        </button>
      </div>

      {/* KPI Top Cards */}
      <div className="stats">
        <div className="stat">
          <span>ผู้ใช้ในระบบทั้งหมด</span>
          <strong>{metrics.totalUsers ?? '—'}</strong>
          <small>บัญชีที่ลงทะเบียนในแอป</small>
        </div>
        <div className="stat">
          <span>ตี้เปิดรับสมัคร</span>
          <strong>{metrics.openParties ?? '0'} / {metrics.totalParties ?? '0'}</strong>
          <small>กิจกรรมนัดพบในมหาวิทยาลัย</small>
        </div>
        <div className="stat">
          <span>ห้องสนทนาคู่ Match</span>
          <strong>{metrics.totalConvos ?? '—'}</strong>
          <small>แชทที่ถูกสร้างขึ้น</small>
        </div>
        <div className="stat">
          <span>ความพร้อมใช้งาน (SLA)</span>
          <strong style={{ color: '#16a34a' }}>{health.slaUptime || '99.98%'}</strong>
          <small>อัตราความผิดพลาด {health.errorRatePercent || '< 0.01%'}</small>
        </div>
      </div>

      {/* In-Depth In-App Analytics & Verification Panel */}
      <section className="panel">
        <div className="panel-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#f5f3ff', padding: 8, borderRadius: 10, color: '#7c3aed' }}>
              <TrendingUp size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>การวิเคราะห์ภายในแอปเชิงลึก (In-Depth App Analytics)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                สถิติความปลอดภัย การยืนยันใบหน้า ชุมชนผู้ใช้ และการเติบโตของ CampusMate Plus
              </p>
            </div>
          </div>
          <span className="badge resolved" style={{ fontSize: 13, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={14} /> อัตราสแกนหน้าผ่าน {analytics.faceVerificationRate ?? 0}%
          </span>
        </div>

        {/* 4 Analytics Grid Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, margin: '16px 0 8px' }}>
          {/* Card 1: Face Verification Funnel */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>การยืนยันใบหน้า (Face Liveness)</span>
              <span className="badge resolved" style={{ fontSize: 11 }}>{analytics.faceVerificationRate ?? 0}%</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>
              {analytics.faceVerifiedUsers ?? 0} <small style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>/ {metrics.totalUsers ?? 0} คน</small>
            </div>
            <div style={{ height: 8, width: '100%', background: '#f1f5f9', borderRadius: 999, overflow: 'hidden', margin: '12px 0 8px' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, analytics.faceVerificationRate ?? 0)}%`,
                  background: '#10b981',
                  borderRadius: 999,
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
              <span>ยืนยันแล้ว: {analytics.faceVerifiedUsers ?? 0}</span>
              <span>ยังไม่ยืนยัน: {analytics.unverifiedFaceUsers ?? 0}</span>
            </div>
          </div>

          {/* Card 2: CampusMate Plus Growth */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>สมาชิก CampusMate Plus</span>
              <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={12} /> VIP Subscriptions
              </span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#b45309' }}>
              {analytics.plusSubscribers ?? 0} <small style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>สมาชิก</small>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 14, lineHeight: 1.5 }}>
              ผู้ใช้ที่ใช้งานฟีเจอร์พรีเมียม (กรองเพศ/คณะขั้นสูง, ปัดไม่จำกัด, บูสต์โปรไฟล์)
            </div>
          </div>

          {/* Card 3: Trust & Safety Resolution */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>ความปลอดภัยและการรายงาน</span>
              <span className={'badge ' + ((analytics.pendingReports ?? 0) > 0 ? 'reviewing' : 'resolved')} style={{ fontSize: 11 }}>
                {(analytics.pendingReports ?? 0) > 0 ? `รอตรวจ ${analytics.pendingReports}` : 'เรียบร้อยทั้งหมด'}
              </span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>
              {analytics.resolvedReports ?? 0} <small style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>/ {metrics.totalReports ?? 0} เรื่องเคลียร์แล้ว</small>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>
              อัตราเคลียร์เคส: {Number(metrics.totalReports || 0) > 0 ? Math.round(((Number(analytics.resolvedReports) || 0) / Number(metrics.totalReports)) * 100) : 100}%
            </div>
          </div>

          {/* Card 4: Party & Community Dynamics */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>กิจกรรมตี้และการนัดพบ</span>
              <span className="badge resolved" style={{ fontSize: 11 }}>เปิดรับ {analytics.openPartiesRatio ?? 0}%</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>
              {analytics.activePartiesCount ?? 0} <small style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>ตี้กำลังเปิดรับเพื่อน</small>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>
              ห้องสนทนาแมตช์ที่เปิดอยู่: <strong>{metrics.totalConvos ?? 0}</strong> ห้อง
            </div>
          </div>
        </div>
      </section>

      {/* Cloud Cost & Monthly Budget Section */}
      <section className="panel">
        <div className="panel-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#ecfdf5', padding: 8, borderRadius: 10, color: '#059669' }}>
              <DollarSign size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>ค่าใช้จ่ายระบบและงบประมาณคลาวด์ (Cloud Costs & Budget)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                ประมาณการค่าใช้จ่ายจริงรายเดือน เทียบกับ Free Tier ของ Firebase, AWS Rekognition และ Cloudflare
              </p>
            </div>
          </div>
          <span className="badge resolved" style={{ fontSize: 13, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} />
            {costs.isFreeTierSufficient ? 'อยู่ในเกณฑ์ Free Tier ทั้งหมด' : 'Pay-As-You-Go Active'}
          </span>
        </div>

        {/* Budget Progress Bar */}
        <div style={{ background: '#f8fafc', padding: 18, borderRadius: 14, margin: '16px 0', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>ประมาณการค่าใช้จ่ายเดือนนี้</span>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                ${totalCostNumber.toFixed(2)}{' '}
                <span style={{ fontSize: 16, fontWeight: 500, color: '#64748b' }}>
                  (~{Number(costs.totalCostThb || 0).toLocaleString('th-TH')} บาท)
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>งบประมาณเพดานที่ตั้งไว้</span>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#334155' }}>
                ${monthlyBudgetNumber.toFixed(2)} / เดือน
              </div>
            </div>
          </div>

          <div style={{ height: 10, width: '100%', background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(4, budgetPercent)}%`,
                background: budgetPercent > 80 ? '#ef4444' : '#10b981',
                borderRadius: 999,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
            <span>ใช้งานไป {budgetPercent}% ของงบประมาณ</span>
            <span>อัตราแลกเปลี่ยนอ้างอิง: 1 USD ≈ {costs.exchangeRateThb || 35.5} บาท</span>
          </div>
        </div>

        {/* Cost Breakdown - Desktop Table */}
        <div className="table-scroll cost-table-desktop">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>บริการและผู้ให้บริการ</th>
                <th style={{ minWidth: 130 }}>ปริมาณการใช้งานปัจจุบัน</th>
                <th style={{ minWidth: 150 }}>โควตาฟรี (Free Tier)</th>
                <th style={{ minWidth: 100 }}>ประมาณการ (USD)</th>
                <th style={{ minWidth: 100 }}>ประมาณการ (บาท)</th>
                <th style={{ minWidth: 100 }}>สถานะโควตา</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((item: Row, idx: number) => (
                <tr key={idx}>
                  <td>
                    <strong style={{ display: 'block', fontSize: 13, color: '#1e293b' }}>{item.service}</strong>
                    <small style={{ color: '#64748b' }}>{item.provider}</small>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.currentUsage}</td>
                  <td><small style={{ color: '#475569' }}>{item.freeTierLimit}</small></td>
                  <td><strong style={{ color: '#0f172a' }}>${Number(item.costUsd || 0).toFixed(2)}</strong></td>
                  <td style={{ whiteSpace: 'nowrap' }}>~{Number(item.costThb || 0).toLocaleString('th-TH')} บ.</td>
                  <td>
                    <span className={'badge ' + (item.costUsd === 0 ? 'resolved' : 'pending')}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cost Breakdown - Mobile Cards View */}
        <div className="cost-cards-mobile">
          {breakdown.map((item: Row, idx: number) => (
            <div className="cost-card-mobile" key={idx}>
              <div className="cost-card-top">
                <div>
                  <strong className="cost-service-title">{item.service}</strong>
                  <div className="cost-provider-sub">{item.provider}</div>
                </div>
                <span className={'badge ' + (item.costUsd === 0 ? 'resolved' : 'pending')}>
                  {item.status}
                </span>
              </div>
              <div className="cost-card-grid">
                <div>
                  <span className="cost-label">การใช้งานปัจจุบัน</span>
                  <div className="cost-value">{item.currentUsage}</div>
                </div>
                <div>
                  <span className="cost-label">โควตาฟรี</span>
                  <div className="cost-value" style={{ fontSize: 11, color: '#475569' }}>{item.freeTierLimit}</div>
                </div>
              </div>
              <div className="cost-card-bottom">
                <span className="cost-label">ประมาณการค่าใช้จ่าย</span>
                <div className="cost-total">
                  ${Number(item.costUsd || 0).toFixed(2)}{' '}
                  <small>(~{Number(item.costThb || 0).toLocaleString('th-TH')} บ.)</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* System Performance & Latency Monitor */}
      <section className="panel">
        <div className="panel-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#eff6ff', padding: 8, borderRadius: 10, color: '#2563eb' }}>
              <Activity size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>ประสิทธิภาพระบบและเวลาตอบสนอง (System Performance & Latency)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                ตรวจสอบความเร็วในการเชื่อมต่อ (Round-trip Latency) ของแต่ละเซอร์วิสแบบ Real-time
              </p>
            </div>
          </div>
          <span className={'badge ' + (health.overallStatus === 'operational' ? 'resolved' : 'pending')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: health.overallStatus === 'operational' ? '#10b981' : '#f59e0b' }} />
            {health.overallStatus === 'operational' ? 'ทุกระบบทำงานปกติ' : 'มีบางบริการตอบสนองช้า'}
          </span>
        </div>

        <div className="services-grid">
          {services.map((svc: Row, idx: number) => {
            const latency = Number(svc.latencyMs ?? 0);
            const isFast = latency < 200;
            const isOk = latency >= 200 && latency < 500;
            const latencyColor = isFast ? '#16a34a' : isOk ? '#d97706' : '#dc2626';

            return (
              <div
                key={idx}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 14,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: 15, color: '#0f172a' }}>{svc.name}</strong>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{svc.provider}</div>
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 8px',
                      borderRadius: 6,
                      background: svc.status === 'healthy' ? '#ecfdf5' : '#fef2f2',
                      color: svc.status === 'healthy' ? '#059669' : '#dc2626',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                    {svc.status === 'healthy' ? 'พร้อมใช้งาน' : 'ขัดข้องชั่วคราว'}
                  </span>
                </div>

                <p style={{ fontSize: 13, color: '#475569', margin: 0, lineHeight: 1.4 }}>
                  {svc.description}
                </p>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: 8,
                    marginTop: 'auto',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#64748b' }}>Response Latency</span>
                  <strong style={{ fontSize: 14, color: latencyColor }}>
                    {svc.latencyMs} ms
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Cloud Architecture Insights & Tips */}
      <div className="two-columns">
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <ShieldCheck size={22} color="#2563eb" />
            <h3 style={{ margin: 0 }}>สถาปัตยกรรมความปลอดภัยและการเงิน</h3>
          </div>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            • <strong>Amazon Rekognition:</strong> ตรวจรูปโป๊เปลือย/รุนแรงใน selected Region (ap-southeast-2) โดยส่งเฉพาะ Base64 Thumbnail ชั่วคราว ไม่บันทึกรูปทิ้งไว้บน AWS จึงประหยัดและปลอดภัย<br />
            • <strong>Cloudflare R2:</strong> ตั้งค่า Worker ให้มี 0$ Bandwidth Egress ช่วยประหยัดค่าแบนด์วิดท์มหาศาลเมื่อนักศึกษาเปิดดูรูปโปรไฟล์และสตอรี่
          </p>
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Zap size={22} color="#059669" />
            <h3 style={{ margin: 0 }}>แนวทางขยายระบบ (Scale Recommendations)</h3>
          </div>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            • <strong>Firestore Cache:</strong> มีการใช้ FastBoot Local Memory Cache ในแอปมือถือเพื่อลดจำนวน Read Request ใน Firebase ทำให้ผู้ใช้ 10,000 คนไม่เกินเพดานงบ<br />
            • <strong>AWS Spend Limit:</strong> หากต้องการจำกัดงบ AWS แบบเข้มงวด สามารถกำหนด Budget Alert ได้ที่ AWS Settings &gt; Billing
          </p>
        </section>
      </div>
    </div>
  );
}
