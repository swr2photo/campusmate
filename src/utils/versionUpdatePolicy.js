const validVersion = (value) => typeof value === 'string' && /^v?\d+\.\d+\.\d+$/i.test(value.trim());

export function compareSemver(left, right) {
  if (!left || !right) return 0;
  const parts = (value) => String(value).trim().replace(/^v/i, '').split('.').map((part) => parseInt(part, 10) || 0);
  const a = parts(left), b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

export function normalizeNativeBuild(value, platform) {
  const text = String(value ?? '').trim();
  return (platform === 'android' ? /^\d+$/ : /^\d+(?:\.\d+){0,2}$/).test(text) ? text : '';
}

export function compareNativeBuild(left, right) {
  const a = String(left).split('.').map(BigInt), b = String(right).split('.').map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0n) !== (b[index] || 0n)) return (a[index] || 0n) > (b[index] || 0n) ? 1 : -1;
  }
  return 0;
}

/** A platform entry owns its release state and minimums; Android publication cannot unlock iOS. */
export function evaluateVersionPolicy(config, { platform, currentVersion, currentBuild, expoGo = false } = {}) {
  const base = { needsUpdate: false, currentVersion, currentBuild };
  if (expoGo || !['android', 'ios'].includes(platform) || !config || config.enabled === false) return base;
  const entry = config.platforms?.[platform];
  const release = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : config;
  if (release.enabled === false) return base;
  const published = release !== config && Object.prototype.hasOwnProperty.call(release, 'storePublished')
    ? release.storePublished === true
    : release[platform === 'android' ? 'playStorePublished' : 'appStorePublished'] === true;
  const latestVersion = release.latestVersion || release.version;
  const latestBuild = normalizeNativeBuild(release.latestBuild, platform);
  const installedBuild = normalizeNativeBuild(currentBuild, platform);
  const minBuild = normalizeNativeBuild(release.minBuild, platform);
  const minVersion = release.minVersion;
  const appStoreUrl = release.appStoreUrl || config.appStoreUrl;
  // An unpublished release or an iOS release with no usable store destination must never lock the app.
  if (!published || !validVersion(latestVersion) || !validVersion(currentVersion)
    || (platform === 'ios' && !/^https:\/\/(?:apps|itunes)\.apple\.com\//i.test(String(appStoreUrl || '')))) return base;
  // Reject unreachable minimums instead of demanding a build that users cannot download.
  if ((minVersion && (!validVersion(minVersion) || compareSemver(minVersion, latestVersion) > 0))
    || (release.minBuild != null && (!minBuild || !latestBuild || compareNativeBuild(minBuild, latestBuild) > 0))
    || (platform === 'ios' && minBuild && minVersion && compareSemver(minVersion, latestVersion) !== 0)
    || (release.latestBuild != null && !latestBuild)) return { ...base, invalidConfig: true };
  const versionDifference = compareSemver(latestVersion, currentVersion);
  const newerBuild = latestBuild && installedBuild && compareNativeBuild(latestBuild, installedBuild) > 0;
  if (platform === 'android' && latestBuild && installedBuild && compareNativeBuild(latestBuild, installedBuild) < 0) {
    return { ...base, latestVersion, latestBuild };
  }
  if (versionDifference < 0 || (versionDifference === 0 && !newerBuild)) return { ...base, latestVersion, latestBuild };
  const isForce = release.forceUpdate === true
    || Boolean(minVersion && compareSemver(currentVersion, minVersion) < 0)
    || Boolean(minBuild && installedBuild && (platform === 'android' || versionDifference === 0)
      && compareNativeBuild(installedBuild, minBuild) < 0);
  return {
    ...base, needsUpdate: true, isForce, latestVersion, latestBuild,
    updateKey: `${platform}:${latestVersion}:${latestBuild}`,
    snoozeHours: Math.max(1, Math.min(Number(release.snoozeHours ?? config.snoozeHours) || 24, 168)),
    title: release.title || config.title || 'มีเวอร์ชันใหม่พร้อมใช้งาน',
    message: release.message || `CampusMate เวอร์ชัน ${latestVersion} พร้อมให้อัปเดตแล้ว`,
    releaseNotes: release.releaseNotes || config.releaseNotes || '• ปรับปรุงประสิทธิภาพและความเสถียรของแอพพลิเคชัน',
    playStoreUrl: release.playStoreUrl || config.playStoreUrl,
    playStoreWebUrl: release.playStoreWebUrl || config.playStoreWebUrl,
    appStoreUrl,
  };
}
