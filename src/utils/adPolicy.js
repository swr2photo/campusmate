// These pure checks run before importing/initializing the native Ads SDK.
export function mayRequestNativeAd({ enabled, platformConfigured, membershipReady, serverConfirmed, plus }) {
  return enabled === true && platformConfigured === true && membershipReady === true && serverConfirmed === true && plus === false;
}
export function isDiscoveryAdDue(actionCount) {
  return Number.isSafeInteger(actionCount) && actionCount > 0 && actionCount % 10 === 0;
}
export function insertActivityAdSlots(items) {
  const result = [];
  items.forEach((item, index) => {
    result.push(item);
    if ((index + 1) % 6 === 0) result.push({ kind: 'native-ad', id: `activity-ad-after-${item.id || index}` });
  });
  return result;
}
