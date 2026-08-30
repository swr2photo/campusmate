import { Storage } from '../utils/storage';

const SAVED_ACCOUNTS_KEY = 'campusmate_saved_accounts_v1';
const ACTIVE_USER_KEY = 'campusmate_active_user_v1';

export async function getSavedAccounts() {
  try {
    const raw = await Storage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const accounts = JSON.parse(raw);
    if (!Array.isArray(accounts)) return [];
    return accounts.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  } catch (error) {
    return [];
  }
}

export async function saveAccount(account) {
  if (!account || (!account.id && !account.email)) return;
  try {
    const existing = await getSavedAccounts();
    const accountId = account.id || account.email;

    // Filter out previous entry for same account id or email
    const filtered = existing.filter(
      (a) => (a.id !== accountId) && (a.email !== account.email)
    );

    const photoURL = account.avatarUri || account.photoURL || account.photos?.[0] || null;

    const updated = {
      id: account.id || accountId,
      email: account.email || '',
      displayName: account.displayName || account.nickname || account.name || account.email?.split('@')[0] || 'ผู้ใช้งาน',
      photoURL: photoURL,
      avatarUri: photoURL,
      faculty: account.faculty || '',
      avatarColor: account.avatarColor || null,
      lastUsedAt: Date.now(),
    };

    const nextList = [updated, ...filtered];
    await Storage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(nextList));
    await Storage.setItem(ACTIVE_USER_KEY, JSON.stringify(updated));
    return nextList;
  } catch (error) {
    console.warn('Failed to save account:', error);
  }
}

export async function enrichSavedAccountsWithFirestore(accounts) {
  if (!accounts || accounts.length === 0) return accounts || [];
  try {
    const { getUserProfile } = require('./firestoreService');
    const updatedAccounts = await Promise.all(
      accounts.map(async (acc) => {
        if (!acc.id) return acc;
        try {
          const profile = await getUserProfile(acc.id);
          if (profile) {
            const photo = profile.avatarUri || profile.photos?.[0] || profile.photoURL || acc.photoURL;
            return {
              ...acc,
              displayName: profile.nickname || profile.name || acc.displayName,
              photoURL: photo,
              avatarUri: photo,
              faculty: profile.faculty || acc.faculty,
              avatarColor: profile.avatarColor || acc.avatarColor,
            };
          }
        } catch (e) {}
        return acc;
      })
    );
    await Storage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updatedAccounts));
    return updatedAccounts;
  } catch (error) {
    return accounts;
  }
}

export async function removeSavedAccount(accountId) {
  try {
    const existing = await getSavedAccounts();
    const nextList = existing.filter((a) => a.id !== accountId && a.email !== accountId);
    await Storage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(nextList));
    return nextList;
  } catch (error) {
    console.warn('Failed to remove saved account:', error);
    return [];
  }
}

export async function getActiveUser() {
  try {
    const raw = await Storage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
