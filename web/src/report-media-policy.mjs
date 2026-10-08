const MEDIA_HOSTS = new Set([
  'pub-50c04ae03d1b4222b7402a2b1ff02c62.r2.dev',
  'pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'media.getcampusmate.app',
  'cdn.getcampusmate.app',
  'campusmate-7f1ab.web.app',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
]);
export function reportMediaSource(value) {
  if (!value) return { state: 'absent' };
  let url;
  try { url = new URL(value); } catch { return { state: 'invalid' }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !MEDIA_HOSTS.has(url.hostname)) return { state: 'unsupported' };
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return { state: 'invalid' }; }
  if (/\.enc$/i.test(pathname)) return { state: 'encrypted' };
  if (/\.(mp4|mov|webm|m4a|mp3|wav|ogg)$/i.test(pathname)) return { state: 'not-image' };
  return { state: 'image', url: url.toString() };
}
