/** Compare profile photo URLs by origin and path. Download tokens are not part of the object. */
export function sameProfilePhoto(left, right) {
  const canonical = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const url = new URL(trimmed);
      const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
      return `${url.origin}${path}`;
    } catch {
      return trimmed;
    }
  };
  const first = canonical(left);
  const second = canonical(right);
  return first.length > 0 && first === second;
}

/** The server has published this exact photo and marked the profile verified. */
export function isCommittedProfilePhoto(profile, photoUri) {
  return profile?.isFaceVerified === true && sameProfilePhoto(profile.avatarUri, photoUri);
}
