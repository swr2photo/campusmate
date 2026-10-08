import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export const DEFAULT_QUICK_REACTIONS = ['🤍', '😂', '😮', '😢', '😆', '😉'];
export const MAX_QUICK_REACTIONS = 6;

export const DEFAULT_RECENT_EMOJIS = [
  '🌙', '😉', '😭', '😆', '🍀', '🥺',
  '🫧', '🧸', '🎀', '🪭', '🗝️', '🗺️',
  '🍒', '🪐', '🌍', '💫', '👀', '🦦',
  '🌅', '😢', '😅', '🔥', '✨', '❤️',
];

const STORAGE_KEY_CUSTOM_REACTIONS = '@campusmate_top_quick_reactions_v2';
const STORAGE_KEY_LEGACY_REACTIONS = '@campusmate_top_quick_reactions_v1';
const STORAGE_KEY_REACTION_COUNTS = '@campusmate_reaction_usage_counts_v1';
const STORAGE_KEY_RECENT_EMOJIS = '@campusmate_recent_reactions_v1';

let cachedQuickReactions = null;
let cachedUsageCounts = null;
let cachedRecentEmojis = null;
const quickReactionListeners = new Set();
const recentReactionListeners = new Set();

export function subscribeQuickReactions(listener) {
  if (typeof listener === 'function') {
    quickReactionListeners.add(listener);
    return () => {
      quickReactionListeners.delete(listener);
    };
  }
  return () => {};
}

function notifyQuickReactionListeners(emojis) {
  quickReactionListeners.forEach((listener) => {
    try {
      listener(emojis);
    } catch (err) {
      console.warn('subscribeQuickReactions listener error:', err);
    }
  });
}

export function subscribeRecentEmojis(listener) {
  if (typeof listener === 'function') {
    recentReactionListeners.add(listener);
    return () => {
      recentReactionListeners.delete(listener);
    };
  }
  return () => {};
}

function notifyRecentReactionListeners(emojis) {
  recentReactionListeners.forEach((listener) => {
    try {
      listener(emojis);
    } catch (err) {
      console.warn('subscribeRecentEmojis listener error:', err);
    }
  });
}

// Warm cache in background
void loadCustomQuickReactions();
void loadRecentEmojis();

export function getMessageReactionEntries(reactions) {
  if (!reactions || typeof reactions !== 'object' || Array.isArray(reactions)) return [];

  return Object.entries(reactions)
    .map(([userId, value]) => ({
      emoji: typeof value === 'string' ? value.trim() : '',
      userId: typeof userId === 'string' ? userId.trim() : '',
    }))
    .filter(({ emoji, userId }) => Boolean(userId && emoji));
}

export function getMessageReactionSummary(reactions) {
  const entries = getMessageReactionEntries(reactions);
  const uniqueEmojis = Array.from(new Set(entries.map(({ emoji }) => emoji)));

  return {
    count: entries.length,
    uniqueEmojis,
  };
}

/**
 * Returns the currently configured top 6 quick reactions synchronously (if cached) or defaults.
 */
export function getQuickReactionsSync() {
  if (Array.isArray(cachedQuickReactions) && cachedQuickReactions.length === MAX_QUICK_REACTIONS) {
    return cachedQuickReactions;
  }
  return DEFAULT_QUICK_REACTIONS;
}

/**
 * Returns recent emojis synchronously (if cached) or defaults.
 */
export function getRecentEmojisSync() {
  if (Array.isArray(cachedRecentEmojis) && cachedRecentEmojis.length > 0) {
    return cachedRecentEmojis;
  }
  return DEFAULT_RECENT_EMOJIS;
}

/**
 * Returns the primary (first slot) quick reaction emoji synchronously.
 */
export function getDefaultMessageReaction() {
  const list = getQuickReactionsSync();
  return (Array.isArray(list) && list[0]) ? list[0] : DEFAULT_QUICK_REACTIONS[0];
}

/**
 * React hook to listen to quick reaction changes reactively across screens.
 */
export function useQuickReactions() {
  const [reactions, setReactions] = useState(() => getQuickReactionsSync());

  useEffect(() => {
    const current = getQuickReactionsSync();
    if (current !== reactions) {
      setReactions(current);
    }
    loadCustomQuickReactions().then((loaded) => {
      if (Array.isArray(loaded) && loaded.length === MAX_QUICK_REACTIONS) {
        setReactions(loaded);
      }
    });
    return subscribeQuickReactions((updated) => {
      if (Array.isArray(updated) && updated.length === MAX_QUICK_REACTIONS) {
        setReactions(updated);
      }
    });
  }, []);

  return reactions;
}

/**
 * React hook to listen to the primary default message reaction (slot 1) reactively.
 */
export function useDefaultMessageReaction() {
  const reactions = useQuickReactions();
  return (Array.isArray(reactions) && reactions[0]) ? reactions[0] : DEFAULT_QUICK_REACTIONS[0];
}

/**
 * Loads recent emojis from storage.
 */
export async function loadRecentEmojis() {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY_RECENT_EMOJIS);
    if (json) {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedRecentEmojis = parsed;
        notifyRecentReactionListeners(cachedRecentEmojis);
        return parsed;
      }
    }
  } catch (error) {
    console.warn('loadRecentEmojis error:', error);
  }
  cachedRecentEmojis = [...DEFAULT_RECENT_EMOJIS];
  return cachedRecentEmojis;
}

/**
 * Prepends an emoji to recent emojis and persists.
 */
export async function recordRecentEmoji(emoji) {
  if (!emoji || typeof emoji !== 'string') return;
  try {
    const current = cachedRecentEmojis || (await loadRecentEmojis());
    const filtered = current.filter((e) => e !== emoji);
    const updated = [emoji, ...filtered].slice(0, 36);
    cachedRecentEmojis = updated;
    notifyRecentReactionListeners(cachedRecentEmojis);
    await AsyncStorage.setItem(STORAGE_KEY_RECENT_EMOJIS, JSON.stringify(updated));
  } catch (error) {
    console.warn('recordRecentEmoji error:', error);
  }
}

/**
 * Loads the customized top 6 quick reactions from storage (migrating 5 to 6 if needed).
 */
export async function loadCustomQuickReactions() {
  try {
    let json = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_REACTIONS);
    if (!json) {
      json = await AsyncStorage.getItem(STORAGE_KEY_LEGACY_REACTIONS);
    }
    if (json) {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        if (parsed.length === MAX_QUICK_REACTIONS) {
          cachedQuickReactions = parsed;
          notifyQuickReactionListeners(cachedQuickReactions);
          return parsed;
        }
        if (parsed.length === 5) {
          const upgraded = [...parsed, DEFAULT_QUICK_REACTIONS[5]];
          cachedQuickReactions = upgraded;
          notifyQuickReactionListeners(cachedQuickReactions);
          await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_REACTIONS, JSON.stringify(upgraded));
          return upgraded;
        }
      }
    }
  } catch (error) {
    console.warn('loadCustomQuickReactions error:', error);
  }
  cachedQuickReactions = [...DEFAULT_QUICK_REACTIONS];
  return cachedQuickReactions;
}

/**
 * Saves a new set of 6 quick reactions to storage.
 */
export async function saveCustomQuickReactions(emojis) {
  if (!Array.isArray(emojis) || emojis.length !== MAX_QUICK_REACTIONS) {
    return cachedQuickReactions || DEFAULT_QUICK_REACTIONS;
  }
  cachedQuickReactions = [...emojis];
  notifyQuickReactionListeners(cachedQuickReactions);
  try {
    await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_REACTIONS, JSON.stringify(emojis));
  } catch (error) {
    console.warn('saveCustomQuickReactions error:', error);
  }
  return cachedQuickReactions;
}

/**
 * Records emoji reaction usage frequency in AsyncStorage and recent emojis.
 */
export async function recordReactionUsage(emoji) {
  if (!emoji || typeof emoji !== 'string') return;
  void recordRecentEmoji(emoji);
  try {
    if (!cachedUsageCounts) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_REACTION_COUNTS);
      cachedUsageCounts = raw ? JSON.parse(raw) : {};
    }
    cachedUsageCounts[emoji] = (cachedUsageCounts[emoji] || 0) + 1;
    await AsyncStorage.setItem(STORAGE_KEY_REACTION_COUNTS, JSON.stringify(cachedUsageCounts));
  } catch (error) {
    console.warn('recordReactionUsage error:', error);
  }
}

/**
 * Gets top N most frequently used reactions from recorded usage.
 */
export async function getTopFrequentReactions(limit = 6) {
  try {
    if (!cachedUsageCounts) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_REACTION_COUNTS);
      cachedUsageCounts = raw ? JSON.parse(raw) : {};
    }
    const entries = Object.entries(cachedUsageCounts || {});
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries.map(([emoji]) => emoji).filter(Boolean);

    // Fill up with defaults if fewer than limit
    const combined = Array.from(new Set([...top, ...DEFAULT_QUICK_REACTIONS]));
    return combined.slice(0, limit);
  } catch {
    return DEFAULT_QUICK_REACTIONS;
  }
}

/**
 * Resets quick reactions to the factory defaults.
 */
export async function resetCustomQuickReactions() {
  cachedQuickReactions = [...DEFAULT_QUICK_REACTIONS];
  notifyQuickReactionListeners(cachedQuickReactions);
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_CUSTOM_REACTIONS);
    await AsyncStorage.removeItem(STORAGE_KEY_LEGACY_REACTIONS);
  } catch (error) {
    console.warn('resetCustomQuickReactions error:', error);
  }
  return cachedQuickReactions;
}
