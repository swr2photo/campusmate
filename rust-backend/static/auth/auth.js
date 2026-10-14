// Email action pages. The one-time token arrives in the URL fragment, which
// browsers never send to the server. Strip it from the address bar and
// history at once, keep it only in memory, and POST it after the person
// confirms — link scanners that open the page cannot consume it.
(function () {
  'use strict';

  var match = /^#token=([0-9a-f]{64})$/.exec(window.location.hash || '');
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  var token = match ? match[1] : null;
  // Opening another email link in this tab only changes the fragment, which
  // does not reload the page. Reload so the new token is read and stripped.
  window.addEventListener('hashchange', function () {
    window.location.reload();
  });

  var page = document.body.getAttribute('data-page');
  var form = document.getElementById('action-form');
  var submit = document.getElementById('submit');
  var statusLine = document.getElementById('status');
  var next = document.getElementById('next');
  var lead = document.getElementById('lead');

  function show(message, tone) {
    statusLine.textContent = message;
    statusLine.className = 'notice' + (tone ? ' ' + tone : '');
    statusLine.hidden = false;
  }

  function finish(message) {
    token = null;
    form.hidden = true;
    lead.hidden = true;
    show(message, 'success');
    next.hidden = false;
  }

  function fail(message) {
    token = null;
    form.hidden = true;
    lead.hidden = true;
    show(message, 'error');
  }

  if (!token) {
    fail('ลิงก์ไม่ครบหรือไม่ถูกต้อง กรุณาเปิดลิงก์จากอีเมลล่าสุด หรือขอลิงก์ใหม่จากแอป CampusMate');
    return;
  }
  form.hidden = false;

  function errorMessage(response, body) {
    var error = (body && body.error) || {};
    var reason = error.details && error.details.reason;
    if (reason === 'INVALID_CHALLENGE') {
      return { message: 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากแอป CampusMate', final: true };
    }
    if (response.status === 429) {
      return { message: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', final: false };
    }
    if (page === 'reset' && error.code === 'invalid-argument') {
      return { message: 'รหัสผ่านต้องมี 12 ถึง 128 ตัวอักษร', final: false };
    }
    return { message: 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', final: false };
  }

  function post(path, payload, onSuccess) {
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    show('กำลังดำเนินการ…');
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (body) {
          if (response.ok) {
            onSuccess();
            return;
          }
          var outcome = errorMessage(response, body);
          if (outcome.final) fail(outcome.message);
          else show(outcome.message, 'error');
        });
      })
      .catch(function () {
        show('เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'error');
      })
      .then(function () {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      });
  }

  if (page === 'verify') {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!token || submit.disabled) return;
      post('/v1/auth/verify-email', { token: token }, function () {
        finish('ยืนยันอีเมลเรียบร้อยแล้ว');
      });
    });
    return;
  }

  // Reset password
  var password = document.getElementById('password');
  var confirm = document.getElementById('confirm');
  var passwordError = document.getElementById('password-error');
  var confirmError = document.getElementById('confirm-error');

  function length(value) {
    return Array.from(value).length; // characters, as the server counts them
  }

  function setFieldError(input, node, message) {
    node.textContent = message || '';
    node.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function validate() {
    var size = length(password.value);
    var passwordProblem = size < 12 ? 'ต้องมีอย่างน้อย 12 ตัวอักษร' : size > 128 ? 'ต้องไม่เกิน 128 ตัวอักษร' : '';
    var confirmProblem = confirm.value && confirm.value !== password.value ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : '';
    if (!confirm.value) confirmProblem = 'กรุณากรอกรหัสผ่านอีกครั้ง';
    setFieldError(password, passwordError, passwordProblem);
    setFieldError(confirm, confirmError, confirmProblem);
    if (passwordProblem) { password.focus(); return false; }
    if (confirmProblem) { confirm.focus(); return false; }
    return true;
  }

  // Validate on leaving a field, not on every keystroke.
  password.addEventListener('blur', function () {
    if (password.value) setFieldError(password, passwordError, length(password.value) < 12 ? 'ต้องมีอย่างน้อย 12 ตัวอักษร' : '');
  });
  confirm.addEventListener('blur', function () {
    if (confirm.value) setFieldError(confirm, confirmError, confirm.value !== password.value ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : '');
  });
  document.getElementById('show').addEventListener('change', function (event) {
    var type = event.target.checked ? 'text' : 'password';
    password.type = type;
    confirm.type = type;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!token || submit.disabled || !validate()) return;
    post('/v1/auth/reset-password', { token: token, password: password.value }, function () {
      password.value = '';
      confirm.value = '';
      finish('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว');
    });
  });
})();
