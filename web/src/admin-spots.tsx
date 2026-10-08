import { useState, useEffect } from 'react';
import { MapPin, Search, Edit3, ExternalLink, Image, X, RefreshCw, Star } from 'lucide-react';

type Row = Record<string, any>;

interface AdminSpotsProps {
  api: (op: string, data?: Row) => Promise<Row>;
  busy: boolean;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'sports', label: 'สนามกีฬา' },
  { id: 'chill', label: 'โซนนั่งเล่น' },
  { id: 'cafe', label: 'คาเฟ่' },
  { id: 'study', label: 'โซนอ่านหนังสือ' },
];

const LICENSES = [
  { value: 'owned', label: 'ต้นฉบับ / ลิขสิทธิ์ของแอป (owned)' },
  { value: 'permission', label: 'ได้รับอนุญาตจากมหาวิทยาลัย (permission)' },
  { value: 'CC-BY-4.0', label: 'Creative Commons Attribution 4.0 (CC-BY-4.0)' },
  { value: 'CC-BY-SA-4.0', label: 'Creative Commons ShareAlike 4.0 (CC-BY-SA-4.0)' },
  { value: 'CC0-1.0', label: 'สาธารณสมบัติ / สิทธิ์เสรี (CC0-1.0)' },
];

export function AdminSpots({ api, busy, onNotice, onError }: AdminSpotsProps) {
  const [spots, setSpots] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingSpot, setEditingSpot] = useState<Row | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // Form states for editing
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formCategoryLabel, setFormCategoryLabel] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formEmoji, setFormEmoji] = useState('');
  const [formRating, setFormRating] = useState('');
  const [formBusyTime, setFormBusyTime] = useState('');
  const [formPhotoUrl, setFormPhotoUrl] = useState('');
  const [formThumbnailUrl, setFormThumbnailUrl] = useState('');
  const [formCredit, setFormCredit] = useState('');
  const [formSourceUrl, setFormSourceUrl] = useState('');
  const [formLicense, setFormLicense] = useState('owned');

  async function loadSpots() {
    setLoading(true);
    try {
      const res = await api('spots');
      setSpots(res.rows || []);
    } catch (e: any) {
      onError(e.message || 'โหลดข้อมูลสถานที่ล้มเหลว');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSpots();
  }, []);

  function handleStartEdit(spot: Row) {
    setEditingSpot(spot);
    setLocalPreviewUrl(null);
    setFormName(spot.name || '');
    setFormDescription(spot.description || '');
    setFormCategory(spot.category || 'sports');
    setFormCategoryLabel(spot.categoryLabel || '');
    setFormGroup(spot.group || '');
    setFormEmoji(spot.emoji || '');
    setFormRating(spot.rating || '4.8');
    setFormBusyTime(spot.busyTime || '');

    const photo = spot.placePhoto || {};
    setFormPhotoUrl(photo.url || '');
    setFormThumbnailUrl(photo.thumbnailUrl || photo.url || '');
    setFormCredit(photo.credit || 'CampusMate');
    setFormSourceUrl(photo.sourceUrl || 'https://getcampusmate.app');
    setFormLicense(photo.license || 'owned');
  }

  async function handleSaveSpot(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSpot || saving) return;
    if (!formName.trim()) {
      onError('กรุณาระบุชื่อสถานที่');
      return;
    }

    const trimmedPhotoUrl = formPhotoUrl.trim();
    if (trimmedPhotoUrl.startsWith('data:')) {
      onError('ไม่อนุญาตให้ใช้ Data URL โดยตรง กรุณาระบุเป็นลิงก์รูปภาพ HTTPS (เช่น https://photos.getcampusmate.app/... หรือลิงก์รูปภาพสาธารณะ) เพื่อให้แอปโหลดภาพได้อย่างรวดเร็ว');
      return;
    }
    if (trimmedPhotoUrl && !trimmedPhotoUrl.startsWith('https://')) {
      onError('URL ของรูปภาพต้องเป็นลิงก์ HTTPS เท่านั้น');
      return;
    }

    setSaving(true);
    try {
      const payload: Row = {
        id: editingSpot.id,
        name: formName.trim(),
        description: formDescription.trim(),
        category: formCategory,
        categoryLabel: formCategoryLabel.trim(),
        group: formGroup.trim(),
        emoji: formEmoji.trim(),
        rating: formRating.trim(),
        busyTime: formBusyTime.trim(),
      };

      if (trimmedPhotoUrl) {
        payload.placePhoto = {
          url: trimmedPhotoUrl,
          thumbnailUrl: formThumbnailUrl.trim() || trimmedPhotoUrl,
          credit: formCredit.trim() || 'CampusMate',
          sourceUrl: formSourceUrl.trim() || 'https://getcampusmate.app',
          license: formLicense,
        };
      }

      const res = await api('saveSpot', payload);
      if (res.success) {
        onNotice(`บันทึกข้อมูลสถานที่ ${formName} เรียบร้อยแล้ว`);
        setEditingSpot(null);
        setLocalPreviewUrl(null);
        await loadSpots();
      }
    } catch (err: any) {
      onError(err.message || 'บันทึกสถานที่ล้มเหลว');
    } finally {
      setSaving(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      onError('ขนาดไฟล์ต้องไม่เกิน 10 MB');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);
    onNotice(`เลือกไฟล์ ${file.name} สำหรับแสดงตัวอย่างแล้ว กรุณานำไฟล์ขึ้น Cloudflare R2 หรือระบบโฮสต์ แล้วนำลิงก์ HTTPS มาใส่ในช่อง URL ด้านล่างเพื่อบันทึก`);
  }

  const filteredSpots = spots.filter((spot) => {
    const matchesSearch =
      !search ||
      spot.name?.toLowerCase().includes(search.toLowerCase()) ||
      spot.description?.toLowerCase().includes(search.toLowerCase()) ||
      spot.id?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      categoryFilter === 'all' || spot.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="spots-manager">
      <div className="panel-heading" style={{ marginBottom: 16 }}>
        <div>
          <h2>จัดการสถานที่และรูปภาพทั้งหมด ({spots.length} จุด)</h2>
          <p className="muted">
            ตรวจพิกัด แก้ไขคำอธิบาย และอัปเดตรูปภาพสถานที่ ม.อ. สำหรับแสดงผลบนแผนที่และระบบนัดพบ
          </p>
        </div>
        <button disabled={busy || loading} onClick={loadSpots}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> รีเฟรช
        </button>
      </div>

      {/* Filters */}
      <section className="panel" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="input-icon" style={{ flex: '1 1 240px' }}>
            <Search size={16} />
            <input
              placeholder="ค้นหาชื่อสถานที่, คำอธิบาย หรือ Spot ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={categoryFilter === cat.id ? 'primary' : ''}
                style={{ padding: '8px 14px', fontSize: 12 }}
                onClick={() => setCategoryFilter(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Spots Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 18,
          marginBottom: 30,
        }}
      >
        {filteredSpots.map((spot) => {
          const photo = spot.placePhoto || {};
          const hasPhoto = !!photo.url;

          return (
            <div
              key={spot.id}
              className="panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 16,
                margin: 0,
                position: 'relative',
              }}
            >
              {/* Image Preview Area */}
              <div
                style={{
                  height: 190,
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: '#f0edf9',
                  position: 'relative',
                  marginBottom: 14,
                  cursor: hasPhoto ? 'pointer' : 'default',
                }}
                onClick={() => hasPhoto && setPreviewImage(photo.url)}
              >
                {hasPhoto ? (
                  <img
                    src={photo.thumbnailUrl || photo.url}
                    alt={spot.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#9c95cb',
                      gap: 8,
                    }}
                  >
                    <Image size={36} />
                    <span style={{ fontSize: 12 }}>ยังไม่มีรูปภาพ</span>
                  </div>
                )}
                <span
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    fontSize: 20,
                    background: 'rgba(255,255,255,0.9)',
                    borderRadius: 8,
                    padding: '2px 8px',
                  }}
                >
                  <MapPin size={14} color="#0f172a" />
                </span>
                <span
                  className={'badge ' + (spot.category || 'sports')}
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    left: 10,
                    background: 'rgba(255,255,255,0.92)',
                    fontWeight: 600,
                  }}
                >
                  {spot.categoryLabel || spot.category}
                </span>
              </div>

              {/* Title & Info */}
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16, lineHeight: 1.4 }}>
                  {spot.name}
                </h3>
                <p
                  className="muted small"
                  style={{
                    margin: '0 0 10px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {spot.description}
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    fontSize: 11,
                    color: '#6e778b',
                    marginBottom: 12,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Star size={12} color="#f59e0b" fill="#f59e0b" />
                    {spot.rating || '4.8'}
                  </span>
                  <span>•</span>
                  <span>{spot.busyTime || 'ช่วงเวลาคนเยอะ'}</span>
                </div>

                {/* Photo Attribution Info */}
                {hasPhoto && (
                  <div
                    style={{
                      background: '#f8f9fc',
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 11,
                      color: '#717a8e',
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <strong>ผู้ถ่าย/สิทธิ์:</strong> {photo.credit || 'CampusMate'}
                    </div>
                    <div>
                      <strong>ประเภทสิทธิ์:</strong>{' '}
                      <span className="badge" style={{ fontSize: 9 }}>
                        {photo.license || 'owned'}
                      </span>
                    </div>
                    {photo.sourceUrl && (
                      <div style={{ marginTop: 4 }}>
                        <a
                          href={photo.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#635bdc',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          เปิดลิงก์แหล่งที่มา <ExternalLink size={10} />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid #f0f2f6',
                  paddingTop: 12,
                  marginTop: 6,
                }}
              >
                <a
                  href={`https://www.google.com/maps?q=${spot.latitude},${spot.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    color: '#635bdc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    textDecoration: 'none',
                  }}
                >
                  <MapPin size={13} /> พิกัดแผนที่
                </a>

                <button
                  className="primary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => handleStartEdit(spot)}
                >
                  <Edit3 size={13} /> แก้ไขสถานที่และรูป
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Drawer / Modal */}
      {editingSpot && (
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
              maxWidth: 620,
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 0,
              padding: 26,
              boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div>
                <p className="eyebrow">EDIT CAMPUS SPOT</p>
                <h2 style={{ margin: 0, fontSize: 18 }}>แก้ไข: {editingSpot.name}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={busy || saving}
                onClick={() => { setEditingSpot(null); setLocalPreviewUrl(null); }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSpot}>
              <div className="form-grid">
                <label>
                  ชื่อสถานที่
                  <input
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </label>
                <label>
                  สัญลักษณ์หรือไอคอนประจำจุด
                  <input
                    value={formEmoji}
                    onChange={(e) => setFormEmoji(e.target.value)}
                    placeholder="เช่น Sports, Cafe, Library"
                  />
                </label>
              </div>

              <label>
                คำอธิบายสถานที่
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                />
              </label>

              <div className="form-grid">
                <label>
                  หมวดหมู่หลัก
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                  >
                    <option value="sports">สนามกีฬา (sports)</option>
                    <option value="chill">โซนนั่งเล่น (chill)</option>
                    <option value="cafe">คาเฟ่ (cafe)</option>
                    <option value="study">โซนอ่านหนังสือ (study)</option>
                    <option value="running">วิ่งออกกำลัง (running)</option>
                    <option value="gym">ยิม/ฟิตเนส (gym)</option>
                  </select>
                </label>
                <label>
                  ป้ายกำกับหมวดหมู่ (ภาษาไทย)
                  <input
                    value={formCategoryLabel}
                    onChange={(e) => setFormCategoryLabel(e.target.value)}
                    placeholder="เช่น สนามกีฬาในร่ม, คาเฟ่ริมอ่างน้ำ"
                  />
                </label>
              </div>

              <div className="form-grid">
                <label>
                  คะแนนรีวิว
                  <input
                    value={formRating}
                    onChange={(e) => setFormRating(e.target.value)}
                    placeholder="เช่น 4.8"
                  />
                </label>
                <label>
                  ช่วงเวลาคนเยอะ
                  <input
                    value={formBusyTime}
                    onChange={(e) => setFormBusyTime(e.target.value)}
                    placeholder="เช่น คนเยอะช่วง 16:30–20:30"
                  />
                </label>
              </div>

              {/* Photo Management Section */}
              <div
                style={{
                  borderTop: '1px solid #e9ebf2',
                  marginTop: 18,
                  paddingTop: 16,
                }}
              >
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>
                  รูปภาพสถานที่และการให้เครดิต
                </h3>
                <p className="muted small" style={{ marginBottom: 12 }}>
                  ระบุ URL รูปภาพ (HTTPS) หรือเลือกไฟล์เพื่อดูตัวอย่างก่อนนำลิงก์มาบันทึก
                </p>

                {(localPreviewUrl || formPhotoUrl) && (
                  <div
                    style={{
                      height: 160,
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: '#f1edf9',
                      marginBottom: 14,
                      position: 'relative',
                    }}
                  >
                    <img
                      src={localPreviewUrl || formPhotoUrl}
                      alt="ตัวอย่างรูปภาพ"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        right: 8,
                        background: 'rgba(0,0,0,0.65)',
                        color: 'white',
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 6,
                      }}
                    >
                      {localPreviewUrl ? 'ตัวอย่างจากเครื่อง (ต้องบันทึกเป็นลิงก์ URL)' : 'ตัวอย่างรูปภาพ'}
                    </span>
                  </div>
                )}

                <label>
                  เลือกไฟล์ภาพจากเครื่อง (สำหรับดูตัวอย่าง)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy || saving}
                    onChange={handleFileSelect}
                  />
                </label>
                <p className="muted small" style={{ marginTop: 2, marginBottom: 12 }}>
                  คำแนะนำ: รูปภาพสถานที่ควรเป็นลิงก์ HTTPS จาก Cloudflare R2 (เช่น https://photos.getcampusmate.app/places/...) หรือเว็บไซต์ทางการของมหาวิทยาลัย เพื่อการโหลดที่รวดเร็ว
                </p>

                <label>
                  URL ของรูปภาพ (HTTPS เท่านั้น)
                  <input
                    required
                    value={formPhotoUrl}
                    disabled={busy || saving}
                    onChange={(e) => {
                      setFormPhotoUrl(e.target.value);
                      if (!formThumbnailUrl) setFormThumbnailUrl(e.target.value);
                    }}
                    placeholder="https://photos.getcampusmate.app/places/... หรือลิงก์ HTTPS"
                  />
                </label>

                <div className="form-grid">
                  <label>
                    เจ้าของภาพ / เครดิต (Credit)
                    <input
                      required
                      value={formCredit}
                      disabled={busy || saving}
                      onChange={(e) => setFormCredit(e.target.value)}
                      placeholder="เช่น CampusMate / swr2photo หรือ ศูนย์กีฬา ม.อ."
                    />
                  </label>
                  <label>
                    ประเภทลิขสิทธิ์ / สิทธิ์การใช้ (License)
                    <select
                      value={formLicense}
                      disabled={busy || saving}
                      onChange={(e) => setFormLicense(e.target.value)}
                    >
                      {LICENSES.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label>
                  ลิงก์แหล่งที่มาของภาพ (Source URL)
                  <input
                    value={formSourceUrl}
                    disabled={busy || saving}
                    onChange={(e) => setFormSourceUrl(e.target.value)}
                    placeholder="https://sportscenter.psu.ac.th หรือ https://commons.wikimedia.org/..."
                  />
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  marginTop: 22,
                  borderTop: '1px solid #eef0f6',
                  paddingTop: 16,
                }}
              >
                <button
                  type="button"
                  disabled={busy || saving}
                  onClick={() => { setEditingSpot(null); setLocalPreviewUrl(null); }}
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={busy || saving} className="primary">
                  {saving ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูลและรูปภาพ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Image Preview Modal */}
      {previewImage && (
        <div
          className="report-image-dialog"
          onClick={() => setPreviewImage(null)}
        >
          <div>
            <button
              className="icon-button"
              style={{ background: 'white', color: '#202a40' }}
              onClick={() => setPreviewImage(null)}
            >
              <X size={18} /> ปิด
            </button>
            <img
              src={previewImage}
              alt="ดูรูปภาพขนาดเต็ม"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
