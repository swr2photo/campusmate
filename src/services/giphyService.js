import Constants from 'expo-constants';

// GIPHY API Key can be provided via EXPO_PUBLIC_GIPHY_API_KEY in .env or app config
const GIPHY_API_KEY =
  process.env.EXPO_PUBLIC_GIPHY_API_KEY ||
  Constants?.expoConfig?.extra?.giphyApiKey ||
  'IWRleHlFc8NBXT5rOq9s3C5xPAUMARnF';

const GIPHY_BASE_URL = 'https://api.giphy.com/v1/gifs';
const GIPHY_STICKERS_URL = 'https://api.giphy.com/v1/stickers';

// High-quality curated fallback GIFs across popular reaction categories
// Ensures smooth, instant experience even offline, without an API key, or on rate-limits
const CURATED_GIFS = {
  trending: [
    {
      id: 'trending_1',
      title: 'Happy Dance Excited',
      url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/blSTtZehjAZ8I/200w.gif',
      width: 480,
      height: 360,
      aspectRatio: 1.33,
    },
    {
      id: 'trending_2',
      title: 'Cat Cute Vibes',
      url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/200w.gif',
      width: 400,
      height: 300,
      aspectRatio: 1.33,
    },
    {
      id: 'trending_3',
      title: 'Thumbs Up Cool',
      url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/111ebonMs90YLu/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'trending_4',
      title: 'Popcorn Watching',
      url: 'https://media.giphy.com/media/gl0mkIZOW6Nwc/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/gl0mkIZOW6Nwc/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'trending_5',
      title: 'Celebration Confetti Party',
      url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'trending_6',
      title: 'Heart Love Heart Eyes',
      url: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/200w.gif',
      width: 480,
      height: 480,
      aspectRatio: 1.0,
    },
    {
      id: 'trending_7',
      title: 'OMG Shocked No Way',
      url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/5VKbvrjxpVJCM/200w.gif',
      width: 400,
      height: 225,
      aspectRatio: 1.77,
    },
    {
      id: 'trending_8',
      title: 'Applause Clapping Bravo',
      url: 'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
  ],
  love: [
    {
      id: 'love_1',
      title: 'Love Hug Cute',
      url: 'https://media.giphy.com/media/l4pTdcifPZLpDjL1e/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/l4pTdcifPZLpDjL1e/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'love_2',
      title: 'Flying Kisses Heart',
      url: 'https://media.giphy.com/media/gDfteqLchLcRTtjAD7/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/gDfteqLchLcRTtjAD7/200w.gif',
      width: 480,
      height: 480,
      aspectRatio: 1.0,
    },
    {
      id: 'love_3',
      title: 'Cute Cat Hug Love',
      url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/200w.gif',
      width: 500,
      height: 388,
      aspectRatio: 1.28,
    },
    {
      id: 'love_4',
      title: 'Heart Sparkling Love',
      url: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
  ],
  happy: [
    {
      id: 'happy_1',
      title: 'Laughing Out Loud LOL',
      url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/10JhviFuU2gWD6/200w.gif',
      width: 480,
      height: 360,
      aspectRatio: 1.33,
    },
    {
      id: 'happy_2',
      title: 'Dance Happy Excited',
      url: 'https://media.giphy.com/media/DhstvI3CH03y8/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/DhstvI3CH03y8/200w.gif',
      width: 500,
      height: 375,
      aspectRatio: 1.33,
    },
    {
      id: 'happy_3',
      title: 'Dog Big Smile Happy',
      url: 'https://media.giphy.com/media/3ndAvMC5lfPNMCzq7m/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/3ndAvMC5lfPNMCzq7m/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'happy_4',
      title: 'Snoopy Happy Dance',
      url: 'https://media.giphy.com/media/o75ajIFH0QnQC3nCeD/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/o75ajIFH0QnQC3nCeD/200w.gif',
      width: 480,
      height: 360,
      aspectRatio: 1.33,
    },
  ],
  sad: [
    {
      id: 'sad_1',
      title: 'Crying Tears Sad',
      url: 'https://media.giphy.com/media/L95W4wvxxB1G8/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/L95W4wvxxB1G8/200w.gif',
      width: 480,
      height: 360,
      aspectRatio: 1.33,
    },
    {
      id: 'sad_2',
      title: 'Rain Window Sad',
      url: 'https://media.giphy.com/media/OPU6wzx8JrHna/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/OPU6wzx8JrHna/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
  ],
  clap: [
    {
      id: 'clap_1',
      title: 'Standing Ovation Great Job',
      url: 'https://media.giphy.com/media/fnK0JeA8vJSX2nuf5r/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/fnK0JeA8vJSX2nuf5r/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'clap_2',
      title: 'Leonardo DiCaprio Toast Cheers',
      url: 'https://media.giphy.com/media/GCLlQnV7dXZ2E/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/GCLlQnV7dXZ2E/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
  ],
  pets: [
    {
      id: 'pets_1',
      title: 'Cat Typing Fast Keyboard',
      url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/200w.gif',
      width: 400,
      height: 300,
      aspectRatio: 1.33,
    },
    {
      id: 'pets_2',
      title: 'Dog Confused Head Tilt',
      url: 'https://media.giphy.com/media/3o7527pa7qs9kCG78A/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/3o7527pa7qs9kCG78A/200w.gif',
      width: 480,
      height: 270,
      aspectRatio: 1.77,
    },
    {
      id: 'pets_3',
      title: 'Cat High Five',
      url: 'https://media.giphy.com/media/5fQyd7jM58m5y/giphy.gif',
      previewUrl: 'https://media.giphy.com/media/5fQyd7jM58m5y/200w.gif',
      width: 480,
      height: 360,
      aspectRatio: 1.33,
    },
  ],
};

function formatGiphyItem(item) {
  if (!item) return null;
  const images = item.images || {};
  const downsized = images.downsized_medium || images.downsized || images.fixed_width || images.original;
  const preview = images.fixed_width_small || images.fixed_width || images.preview_gif || downsized;

  const width = parseInt(downsized?.width || '300', 10);
  const height = parseInt(downsized?.height || '200', 10);
  const aspectRatio = width > 0 && height > 0 ? width / height : 1.33;

  return {
    id: item.id || `gif_${Date.now()}_${Math.random()}`,
    title: item.title || 'GIF',
    url: downsized?.url || item.url,
    previewUrl: preview?.url || downsized?.url || item.url,
    width,
    height,
    aspectRatio: Math.min(Math.max(aspectRatio, 0.65), 2.2),
  };
}

/**
 * Fetch Trending GIFs from GIPHY
 * @param {number} limit 
 * @param {number} offset 
 */
export async function fetchTrendingGifs(limit = 24, offset = 0) {
  if (!GIPHY_API_KEY) {
    // Return curated trending GIFs with slice for simulated pagination
    const all = [
      ...CURATED_GIFS.trending,
      ...CURATED_GIFS.happy,
      ...CURATED_GIFS.love,
      ...CURATED_GIFS.clap,
      ...CURATED_GIFS.pets,
    ];
    return {
      data: all.slice(offset, offset + limit),
      pagination: { total_count: all.length, count: limit, offset },
      isCurated: true,
    };
  }

  try {
    const url = `${GIPHY_BASE_URL}/trending?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&limit=${limit}&offset=${offset}&rating=g`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`GIPHY API error status: ${res.status}`);
    }
    const json = await res.json();
    const formatted = (json.data || []).map(formatGiphyItem).filter(Boolean);
    return {
      data: formatted,
      pagination: json.pagination || { total_count: formatted.length, count: formatted.length, offset },
      isCurated: false,
    };
  } catch (err) {
    console.warn('[giphyService] Trending fetch failed, using fallback:', err?.message || err);
    return {
      data: CURATED_GIFS.trending,
      pagination: { total_count: CURATED_GIFS.trending.length, count: CURATED_GIFS.trending.length, offset: 0 },
      isCurated: true,
    };
  }
}

/**
 * Search GIFs on GIPHY
 * @param {string} query 
 * @param {number} limit 
 * @param {number} offset 
 */
export async function searchGifs(query, limit = 24, offset = 0) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) {
    return fetchTrendingGifs(limit, offset);
  }

  // Check category match in curated list if no API key
  if (!GIPHY_API_KEY) {
    let matched = [];
    if (trimmed.includes('love') || trimmed.includes('รัก') || trimmed.includes('heart')) {
      matched = CURATED_GIFS.love;
    } else if (trimmed.includes('happy') || trimmed.includes('สุข') || trimmed.includes('lol') || trimmed.includes('ขำ')) {
      matched = CURATED_GIFS.happy;
    } else if (trimmed.includes('sad') || trimmed.includes('เศร้า') || trimmed.includes('cry') || trimmed.includes('ร้อง')) {
      matched = CURATED_GIFS.sad;
    } else if (trimmed.includes('clap') || trimmed.includes('ยินดี') || trimmed.includes('cheer')) {
      matched = CURATED_GIFS.clap;
    } else if (trimmed.includes('cat') || trimmed.includes('dog') || trimmed.includes('แมว') || trimmed.includes('หมา') || trimmed.includes('pet')) {
      matched = CURATED_GIFS.pets;
    } else {
      // General filter across all curated
      const all = [
        ...CURATED_GIFS.trending,
        ...CURATED_GIFS.happy,
        ...CURATED_GIFS.love,
        ...CURATED_GIFS.clap,
        ...CURATED_GIFS.pets,
        ...CURATED_GIFS.sad,
      ];
      matched = all.filter((g) => g.title.toLowerCase().includes(trimmed));
      if (matched.length === 0) matched = all;
    }

    return {
      data: matched.slice(offset, offset + limit),
      pagination: { total_count: matched.length, count: limit, offset },
      isCurated: true,
    };
  }

  try {
    const url = `${GIPHY_BASE_URL}/search?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&q=${encodeURIComponent(trimmed)}&limit=${limit}&offset=${offset}&rating=g&lang=th`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`GIPHY Search API error status: ${res.status}`);
    }
    const json = await res.json();
    const formatted = (json.data || []).map(formatGiphyItem).filter(Boolean);
    return {
      data: formatted,
      pagination: json.pagination || { total_count: formatted.length, count: formatted.length, offset },
      isCurated: false,
    };
  } catch (err) {
    console.warn('[giphyService] Search fetch failed, fallback to curated:', err?.message || err);
    return {
      data: CURATED_GIFS.trending,
      pagination: { total_count: CURATED_GIFS.trending.length, count: CURATED_GIFS.trending.length, offset: 0 },
      isCurated: true,
    };
  }
}

/**
 * Fetch Trending Stickers from GIPHY
 * @param {number} limit 
 * @param {number} offset 
 */
export async function fetchTrendingStickers(limit = 24, offset = 0) {
  if (!GIPHY_API_KEY) {
    return fetchTrendingGifs(limit, offset);
  }

  try {
    const url = `${GIPHY_STICKERS_URL}/trending?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&limit=${limit}&offset=${offset}&rating=g`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`GIPHY Stickers API error status: ${res.status}`);
    }
    const json = await res.json();
    const formatted = (json.data || []).map(formatGiphyItem).filter(Boolean);
    return {
      data: formatted,
      pagination: json.pagination || { total_count: formatted.length, count: formatted.length, offset },
      isCurated: false,
    };
  } catch (err) {
    console.warn('[giphyService] Trending stickers fetch failed, fallback to trending gifs:', err?.message || err);
    return fetchTrendingGifs(limit, offset);
  }
}

/**
 * Search Stickers on GIPHY
 * @param {string} query 
 * @param {number} limit 
 * @param {number} offset 
 */
export async function searchStickers(query, limit = 24, offset = 0) {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) {
    return fetchTrendingStickers(limit, offset);
  }

  if (!GIPHY_API_KEY) {
    return searchGifs(query, limit, offset);
  }

  try {
    const url = `${GIPHY_STICKERS_URL}/search?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&q=${encodeURIComponent(trimmed)}&limit=${limit}&offset=${offset}&rating=g&lang=th`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`GIPHY Stickers Search API error status: ${res.status}`);
    }
    const json = await res.json();
    const formatted = (json.data || []).map(formatGiphyItem).filter(Boolean);
    return {
      data: formatted,
      pagination: json.pagination || { total_count: formatted.length, count: formatted.length, offset },
      isCurated: false,
    };
  } catch (err) {
    console.warn('[giphyService] Search stickers failed, fallback to search gifs:', err?.message || err);
    return searchGifs(query, limit, offset);
  }
}

