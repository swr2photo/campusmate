/**
 * Device Performance Tiering Engine
 *
 * Dynamically provides performance presets based on platform and hardware capability.
 * Helps low-end Android devices avoid frame drops (Jank) and OOM kills, while letting
 * high-end iOS ProMotion / flagship devices render at maximum 120 FPS fidelity.
 */

export const DeviceTier = {
  LOW: 'low',
  MID: 'mid',
  HIGH: 'high',
};

let cachedTier = null;

function getPlatform() {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'unknown';
  } catch {
    return 'node';
  }
}

function getDimensions() {
  try {
    const { Dimensions } = require('react-native');
    return Dimensions?.get?.('screen') || { width: 375, height: 812, scale: 2 };
  } catch {
    return { width: 375, height: 812, scale: 2 };
  }
}

export function getDeviceTier() {
  if (cachedTier) return cachedTier;

  const platform = getPlatform();

  // On Web or Node, use standard mid-to-high tier
  if (platform === 'web' || platform === 'node' || platform === 'unknown') {
    cachedTier = DeviceTier.MID;
    return cachedTier;
  }

  const { width, height, scale } = getDimensions();

  // iOS: iPhones generally have high-end SoCs with unified memory.
  // Pro models (120Hz ProMotion) and recent iPhones classify as HIGH.
  if (platform === 'ios') {
    const isSmallScreen = Math.min(width, height) < 375; // e.g., iPhone SE
    cachedTier = isSmallScreen ? DeviceTier.MID : DeviceTier.HIGH;
    return cachedTier;
  }

  // Android: Heuristics based on screen dimensions and scale
  // Screen area and pixel ratio give good indicators of device tier when native RAM API is unavailable.
  const screenArea = width * height;
  const isBudgetAndroid = screenArea < 600 * 800 || (scale && scale < 2.5);

  cachedTier = isBudgetAndroid ? DeviceTier.LOW : DeviceTier.MID;
  return cachedTier;
}

/**
 * Returns optimized configuration for message lists (FlatList / FlashList)
 */
export function getFlatListPerformanceConfig() {
  const tier = getDeviceTier();
  const platform = getPlatform();

  switch (tier) {
    case DeviceTier.LOW:
      return {
        initialNumToRender: 8,
        maxToRenderPerBatch: 5,
        windowSize: 5,
        removeClippedSubviews: true,
        updateCellsBatchingPeriod: 60,
        decryptionBatchSize: 6,
        enableHeavyDecorations: false,
      };
    case DeviceTier.MID:
      return {
        initialNumToRender: 12,
        maxToRenderPerBatch: 8,
        windowSize: 7,
        removeClippedSubviews: platform === 'android',
        updateCellsBatchingPeriod: 40,
        decryptionBatchSize: 15,
        enableHeavyDecorations: true,
      };
    case DeviceTier.HIGH:
    default:
      return {
        initialNumToRender: 16,
        maxToRenderPerBatch: 12,
        windowSize: 11,
        removeClippedSubviews: false,
        updateCellsBatchingPeriod: 30,
        decryptionBatchSize: 30,
        enableHeavyDecorations: true,
      };
  }
}
