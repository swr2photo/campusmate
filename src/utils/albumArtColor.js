import jpeg from 'jpeg-js';

const colorCache = new Map();

function toThumbUri(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  // Apple artwork URLs support size suffixes; shrink for fast sampling.
  return uri
    .replace(/\/\d+x\d+bb/i, '/40x40bb')
    .replace(/\/\d+x\d+cw/i, '/40x40cw')
    .slice(0, 2000);
}

function rgbToCss(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Darken + slight desaturate so white title text stays readable on the mini card. */
function toneForCard(r, g, b) {
  const mix = 0.42; // blend toward black
  let nr = r * (1 - mix);
  let ng = g * (1 - mix);
  let nb = b * (1 - mix);
  // Keep a bit of chroma so card still feels like the artwork.
  const avg = (nr + ng + nb) / 3;
  const punch = 1.18;
  nr = clamp(avg + (nr - avg) * punch, 0, 255);
  ng = clamp(avg + (ng - avg) * punch, 0, 255);
  nb = clamp(avg + (nb - avg) * punch, 0, 255);
  // Floor lightness so very dark covers don't become pure black.
  const luma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  if (luma < 38) {
    const lift = (38 - luma) / 255;
    nr = clamp(nr + lift * 70, 0, 255);
    ng = clamp(ng + lift * 70, 0, 255);
    nb = clamp(nb + lift * 70, 0, 255);
  }
  return rgbToCss(nr, ng, nb);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleDominantRgb(pixels, width, height) {
  // Weighted average preferring saturated mid-bright pixels (skip near-white/black).
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let weightSum = 0;
  const step = Math.max(1, Math.floor((width * height) / 256));

  for (let i = 0; i < width * height; i += step) {
    const idx = i * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    const a = pixels[idx + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const bright = (r + g + b) / (3 * 255);
    if (bright < 0.08 || bright > 0.92) continue;
    const weight = 0.35 + sat * 1.4 + (1 - Math.abs(bright - 0.45)) * 0.4;
    sumR += r * weight;
    sumG += g * weight;
    sumB += b * weight;
    weightSum += weight;
  }

  if (weightSum < 0.001) {
    // Fallback: plain average of every Nth pixel.
    let count = 0;
    sumR = 0;
    sumG = 0;
    sumB = 0;
    for (let i = 0; i < width * height; i += step) {
      const idx = i * 4;
      sumR += pixels[idx];
      sumG += pixels[idx + 1];
      sumB += pixels[idx + 2];
      count += 1;
    }
    if (!count) return { r: 40, g: 50, b: 70 };
    return { r: sumR / count, g: sumG / count, b: sumB / count };
  }

  return {
    r: sumR / weightSum,
    g: sumG / weightSum,
    b: sumB / weightSum,
  };
}

/**
 * Extract a card-friendly background color from album artwork.
 * Returns CSS rgb() string. Cached per URL.
 */
export async function getAlbumCardColor(albumArtUrl, fallback = '#1A2333') {
  const uri = typeof albumArtUrl === 'string' ? albumArtUrl.trim() : '';
  if (!uri) return fallback;
  if (colorCache.has(uri)) return colorCache.get(uri);

  try {
    const thumb = toThumbUri(uri);
    const response = await fetch(thumb);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // jpeg-js only; Apple thumbs are JPEG. Non-JPEG falls back.
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    if (!isJpeg) {
      colorCache.set(uri, fallback);
      return fallback;
    }

    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    if (!decoded?.data?.length || !decoded.width || !decoded.height) {
      colorCache.set(uri, fallback);
      return fallback;
    }

    const { r, g, b } = sampleDominantRgb(decoded.data, decoded.width, decoded.height);
    const color = toneForCard(r, g, b);
    colorCache.set(uri, color);
    return color;
  } catch (_) {
    colorCache.set(uri, fallback);
    return fallback;
  }
}
