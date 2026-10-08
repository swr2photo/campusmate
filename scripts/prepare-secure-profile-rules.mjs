import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const original = readFileSync(new URL('firestore.rules', root), 'utf8');
function replaceBlock(source, collection, transform) {
  const marker = `    match /${collection}/{${collection === 'decisions' ? 'decisionId' : 'userId'}} {`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error(`Expected one ${collection} rule`);
  const next = source.indexOf('\n    match /', start + marker.length);
  if (next < 0) throw new Error(`Missing rule after ${collection}`);
  return source.slice(0, start) + transform(source.slice(start, next)) + source.slice(next);
}
let staged = replaceBlock(original, 'profiles', (block) => block.replace('allow read: if signedIn();', 'allow get: if isOwner(userId);\n      allow list: if false;'));
staged = replaceBlock(staged, 'discoveryProfiles', (block) => block.replace('allow read: if signedIn();', 'allow read: if false;'));
staged = replaceBlock(staged, 'decisions', () => `    match /decisions/{decisionId} {
      // Outgoing state and accepted matches remain readable. Pending incoming
      // identities and all mutations are served by authenticated server APIs.
      allow read: if signedIn() && (
        resource.data.fromUserId == request.auth.uid
        || (resource.data.toUserId == request.auth.uid
          && resource.data.type == 'like' && resource.data.status == 'accepted')
      );
      allow write: if false;
    }
`);
const digest = createHash('sha256').update(original).digest('hex');
// Preserve server verification metadata during ordinary owner edits, while
// rejecting client creation, mutation or removal of those fields.
const verificationFields = "'isFaceVerified', 'faceVerifiedAt', 'faceMatchScore', 'faceVerificationStatus'";
staged = staged.replaceAll("'spotifyTopArtists', 'spotifyTopGenres'", `'spotifyTopArtists', 'spotifyTopGenres', ${verificationFields}`);
for (const collection of ['users', 'profiles']) {
  staged = replaceBlock(staged, collection, (block) => block
    .replace('allow create: if isOwner(userId)', `allow create: if isOwner(userId)\n        && !request.resource.data.keys().hasAny([${verificationFields}])`)
    .replace('allow update: if isOwner(userId)', `allow update: if isOwner(userId)\n        && !request.resource.data.diff(resource.data).affectedKeys().hasAny([${verificationFields}])`));
}
writeFileSync(new URL('firestore.secure.rules', root), `// STAGED ONLY. Source firestore.rules SHA256: ${digest}\n// Deploy after API/client/migration/store rollout gates are verified.\n${staged}`);
console.log('Prepared staged rules; firebase.json continues to use the compatible rules.');
