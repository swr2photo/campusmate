import { signOutUser } from './authService';
import { clearOfflineDataForUser } from './offlineStorage';
import { clearEncryptionIdentity } from './chatEncryptionService';
import { clearActiveUser, removeSavedAccount } from './accountStorage';
import { clearFastBootData } from './fastBootService';
import { callFunction } from './callableClient';

export async function deleteAccountData(userId, email = null) {
  if (!userId) throw new Error('ไม่พบ User ID');
  // Keep all client state intact until the server authorizes and confirms deletion.
  const result = await callFunction('deleteUserData', {}, {
    timeout: 300000, retries: 0,
    fallback: 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  });
  if (result?.deleted !== true || (result.userId && result.userId !== userId)) {
    throw new Error('เซิร์ฟเวอร์ยังไม่ยืนยันการลบบัญชี กรุณาลองใหม่อีกครั้ง');
  }
  // One cache failure must not prevent the other cleanup steps or sign-out.
  let localCleanupPending = false;
  const cleanup = [
    () => removeSavedAccount(userId),
    ...(email ? [() => removeSavedAccount(email)] : []),
    () => clearActiveUser(),
    () => clearFastBootData(),
    () => clearOfflineDataForUser(userId),
    () => clearEncryptionIdentity(userId),
  ];
  for (const action of cleanup) {
    try { await action(); }
    catch { localCleanupPending = true; console.warn('[DeleteAccount] Local cleanup needs retry.'); }
  }
  try { await signOutUser(); }
  catch (cause) {
    throw Object.assign(new Error('บัญชีถูกลบแล้ว แต่ออกจากระบบบนเครื่องนี้ไม่สำเร็จ กรุณาปิดแอปแล้วเปิดใหม่'), {
      accountDeleted: true, cause,
    });
  }
  return { deleted: true, localCleanupPending };
}
