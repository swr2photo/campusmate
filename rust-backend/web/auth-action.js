(() => {
  'use strict';
  const form = document.getElementById('action-form');
  const button = document.getElementById('submit');
  const status = document.getElementById('status');
  const password = document.getElementById('password');
  const confirmation = document.getElementById('confirmation');
  const reset = document.body.dataset.action === 'reset-password';
  let token = /^#token=([0-9a-f]{64})$/.exec(location.hash)?.[1] || '';
  // Fragment secrets never reach the HTTP server. Remove them from history
  // before any user interaction and never write them to browser storage.
  history.replaceState(null, '', location.pathname);
  window.addEventListener('hashchange', () => location.reload());
  if (!/^[0-9a-f]{64}$/.test(token)) {
    token = '';
    status.textContent = 'ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากแอป';
    return;
  }
  button.disabled = false;
  status.textContent = reset ? 'กรอกรหัสผ่านใหม่เพื่อดำเนินการ' : 'พร้อมยืนยันอีเมล';
  let pending = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !token) return;
    const body = { token };
    if (reset) {
      password.removeAttribute('aria-invalid'); confirmation.removeAttribute('aria-invalid');
      const length = Array.from(password.value).length;
      if (length < 12 || length > 128 || new TextEncoder().encode(password.value).length > 512) {
        status.textContent = 'ใช้รหัสผ่าน 12–128 ตัวอักษร'; password.setAttribute('aria-invalid', 'true'); password.focus(); return;
      }
      if (password.value !== confirmation.value) {
        status.textContent = 'รหัสผ่านทั้งสองช่องต้องตรงกัน'; confirmation.setAttribute('aria-invalid', 'true'); confirmation.focus(); return;
      }
      body.password = password.value;
    }
    pending = true; button.disabled = true; form.setAttribute('aria-busy', 'true');
    status.textContent = 'กำลังดำเนินการ…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(reset ? '/v1/auth/reset-password' : '/v1/auth/verify-email', {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (response.redirected || new URL(response.url).origin !== location.origin) throw new Error('network');
      // Public challenge responses are tiny. Bound the body before parsing.
      const raw = await response.text();
      if (raw.length > 8192) throw new Error('network');
      const result = JSON.parse(raw);
      if (!response.ok || result.ok !== true) {
        status.textContent = response.status >= 500
          ? 'เซิร์ฟเวอร์ไม่พร้อม กรุณาลองอีกครั้งในภายหลัง'
          : response.status === 429
          ? 'คำขอมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง'
          : 'ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาขอลิงก์ใหม่จากแอป';
        return;
      }
      token = '';
      if (reset) { password.value = ''; confirmation.value = ''; }
      status.textContent = reset ? 'บันทึกรหัสผ่านแล้ว กลับเข้าสู่ระบบในแอปได้เลย' : 'ยืนยันอีเมลแล้ว กลับเข้าสู่ระบบในแอปได้เลย';
    } catch {
      status.textContent = 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
    } finally {
      clearTimeout(timeout); pending = false; button.disabled = !token; form.removeAttribute('aria-busy');
    }
  });
})();
