export const UNVERIFIED_ACCOUNT_TTL_MS = 24 * 60 * 60 * 1000;

export function isExpiredUnverifiedCampusUser(user, nowMs = Date.now()) {
  if (!user?.email || user.emailVerified === true) return false;
  if (!user.providerData?.some((provider) => provider.providerId === 'password')) return false;
  if (!/@psu\.ac\.th$/i.test(String(user.email).trim())) return false;

  const createdAtMs = Date.parse(user.metadata?.creationTime || '');
  return Number.isFinite(createdAtMs)
    && createdAtMs <= nowMs - UNVERIFIED_ACCOUNT_TTL_MS;
}
