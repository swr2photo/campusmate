// One decision policy for SDK and REST responses; no colour-based heuristics.
export const POLICY_VERSION = 2;
export const LIKELIHOOD_LEVELS = {
  UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5,
};

export function evaluateSafeSearchResults(annotation) {
  const scores = {};
  for (const field of ['adult', 'racy', 'violence', 'spoof', 'medical']) {
    const value = annotation?.[field];
    scores[field] = Number.isInteger(value)
      ? Object.keys(LIKELIHOOD_LEVELS).find(key => LIKELIHOOD_LEVELS[key] === value) || 'UNKNOWN'
      : Object.hasOwn(LIKELIHOOD_LEVELS, value) ? value : 'UNKNOWN';
  }
  const adult = LIKELIHOOD_LEVELS[scores.adult];
  const racy = LIKELIHOOD_LEVELS[scores.racy];
  const violence = LIKELIHOOD_LEVELS[scores.violence];
  // Racy, medical, spoof, skin colour and lighting alone do not establish nudity.
  const reason = adult === 5 || (adult >= 4 && racy >= 4)
    ? 'adult' : violence >= 4 ? 'violence' : null;
  if (reason) {
    return {
      isSafe: false, status: 'blocked', reason, scores, policyVersion: POLICY_VERSION,
      message: reason === 'adult'
        ? 'ระบบประเมินว่าภาพนี้อาจมีเนื้อหาโป๊เปลือย จึงยังใช้ภาพนี้ไม่ได้'
        : 'ระบบประเมินว่าภาพนี้อาจมีเนื้อหาความรุนแรง จึงยังใช้ภาพนี้ไม่ได้',
    };
  }
  if (!adult || !racy || !violence) {
    return { isSafe: null, status: 'unavailable', reason: 'incomplete_result', scores, policyVersion: POLICY_VERSION };
  }
  return { isSafe: true, status: 'allowed', reason: null, scores, policyVersion: POLICY_VERSION };
}
