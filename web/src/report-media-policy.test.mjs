import test from 'node:test';
import assert from 'node:assert/strict';
import {reportMediaSource} from './report-media-policy.mjs';
test('does not attempt to render ciphertext including Storage encoded paths',()=>{
  assert.equal(reportMediaSource('https://pub-50c04ae03d1b4222b7402a2b1ff02c62.r2.dev/chat_media/image.enc?token=abc').state,'encrypted');
  assert.equal(reportMediaSource('https://firebasestorage.googleapis.com/v0/b/bucket/o/chat%2Fimage%2Eenc?alt=media').state,'encrypted');
});
test('renders supported image without altering signed query strings',()=>{
  const url='https://firebasestorage.googleapis.com/v0/b/bucket/o/chat%2Fimage.jpg?alt=media&token=abc';
  assert.deepEqual(reportMediaSource(url),{state:'image',url});
});
test('rejects untrusted URLs, injected schemes and unsupported media',()=>{
  for(const url of ['javascript:alert(1)','file:///tmp/image.jpg','data:image/svg+xml;base64,aaaa','https://evil.example/image.jpg','https://x@y@storage.googleapis.com/file.jpg','https://storage.googleapis.com:8443/file.jpg'])assert.notEqual(reportMediaSource(url).state,'image');
  assert.equal(reportMediaSource('https://storage.googleapis.com/video.mp4').state,'not-image');
});
