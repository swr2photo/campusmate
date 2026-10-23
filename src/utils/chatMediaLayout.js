// Per phone size class (Small < 375, Standard 375–412, Large > 412).
function sizeClassMax(windowWidth, small, standard, large) {
  if (windowWidth < 375) return small;
  return windowWidth > 412 ? large : standard;
}

export function chatImageSize(screenWidth, aspectRatio = 1, isPreview = false) {
  if (isPreview) return { width: 140, height: 140, orientation: 'square' };
  const windowWidth = Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : 360;
  const limit = Math.min(windowWidth * 0.55, sizeClassMax(windowWidth, 180, 210, 230));
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const width = Math.min(limit, 260 * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio), orientation: ratio < 0.85 ? 'portrait' : ratio > 1.15 ? 'landscape' : 'square' };
}

export function chatTrackWidth(screenWidth, isPreview = false) {
  const windowWidth = Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : 360;
  if (isPreview) return Math.min(windowWidth * 0.6, 225);
  return Math.min(windowWidth * 0.68, sizeClassMax(windowWidth, 210, 240, 260));
}

export function isGifMessage(item) {
  return item?.mediaType === 'gif' || String(item?.text || '').trim().toUpperCase() === '[GIF]'
    || /(?:giphy\.com|\.gif(?:[?#]|$))/i.test(item?.mediaUrl || '');
}

export function isChatMediaPlaceholder(text) {
  return ['[GIF]', '[รูปภาพ]', '[ข้อความเสียง]', '[วิดีโอ]'].includes(String(text || '').trim().toUpperCase());
}
