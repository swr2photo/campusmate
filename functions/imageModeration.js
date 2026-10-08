import { evaluateSafeSearchResults } from './imageModerationPolicy.js';
export { evaluateSafeSearchResults } from './imageModerationPolicy.js';

/**
 * Perform SafeSearch detection using Google Cloud Vision REST API or Node Client.
 * @param {string} imageBase64 - Clean base64 string of the image
 * @param {Object} options - { visionClient, apiKey, fetchImpl }
 * @returns {Promise<{ isSafe: boolean, reason?: string, message?: string, scores: Object }>}
 */
export async function detectSafeSearch(imageBase64, { visionClient, apiKey, fetchImpl = fetch } = {}) {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new Error('กรุณาระบุข้อมูลรูปภาพให้ถูกต้อง');
  }

  // Strip possible data URI scheme prefix (e.g. data:image/jpeg;base64,...)
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '').trim();

  // 1. If visionClient instance is provided, use it
  if (visionClient && typeof visionClient.safeSearchDetection === 'function') {
    const [result] = await visionClient.safeSearchDetection({
      image: { content: cleanBase64 },
    });
    if (result?.error) throw new Error('Vision image analysis failed');
    const annotation = result?.safeSearchAnnotation;
    return evaluateSafeSearchResults(annotation);
  }

  // 2. Fallback to Google Cloud Vision REST API
  const key = apiKey || process.env.GOOGLE_VISION_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!key) {
    throw new Error('ไม่พบการตั้งค่า Google Vision API Key หรือ Client');
  }

  const response = await fetchImpl(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: cleanBase64,
          },
          features: [
            {
              type: 'SAFE_SEARCH_DETECTION',
              maxResults: 1,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloud Vision API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  if (json?.responses?.[0]?.error) throw new Error('Vision image analysis failed');
  const annotation = json?.responses?.[0]?.safeSearchAnnotation;
  return evaluateSafeSearchResults(annotation);
}

