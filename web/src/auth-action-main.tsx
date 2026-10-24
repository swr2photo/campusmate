import { mountApp } from './mount';
import { AuthActionPage, readActionToken } from './auth-action-page';

// Read and strip the one-time token before the first render.
const token = readActionToken();
const action = window.location.pathname.startsWith('/auth/reset-password') ? 'reset' : 'verify';
document.title = `${action === 'reset' ? 'ตั้งรหัสผ่านใหม่' : 'ยืนยันอีเมล'} | CampusMate`;

mountApp(<AuthActionPage action={action} token={token} />);
