import { HttpsError } from 'firebase-functions/v2/https';

// Forward the already validated caller token only to the established avatar
// Worker. Reject redirects so a Worker response cannot send it elsewhere.
export async function deleteLegacyAvatar(request, fetchFn = fetch) {
  const authorization = request.rawRequest?.headers?.authorization;
  if (!request.auth?.uid || typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) {
    throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบอีกครั้ง');
  }
  try {
    const response = await fetchFn(`https://campusmate-upload.comcamp.workers.dev/avatar/${encodeURIComponent(request.auth.uid)}`, {
      method: 'DELETE', headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) throw new Error('Avatar cleanup failed');
  } catch {
    throw new HttpsError('unavailable', 'ยังลบรูปโปรไฟล์ไม่ได้ บัญชียังไม่ถูกลบ กรุณาลองใหม่');
  }
}
