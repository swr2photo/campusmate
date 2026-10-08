import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRekognitionModerationLabels,
  detectModerationWithRekognition,
} from './imageModerationRekognition.js';

test('Rekognition: allows clean images with no labels', () => {
  const result = evaluateRekognitionModerationLabels([]);
  assert.equal(result.isSafe, true);
  assert.equal(result.status, 'allowed');
  assert.equal(result.reason, null);
  assert.equal(result.policyVersion, 2);
});

test('Rekognition: allows swimwear and suggestive beach photos (prevents false positives)', () => {
  const beachLabels = [
    { Name: 'Suggestive', ParentName: '', Confidence: 82.5 },
    { Name: 'Female Swimwear Or Underwear', ParentName: 'Suggestive', Confidence: 88.0 },
    { Name: 'Barechested Male', ParentName: 'Non-Explicit Nudity', Confidence: 91.2 },
  ];
  const result = evaluateRekognitionModerationLabels(beachLabels);
  assert.equal(result.isSafe, true);
  assert.equal(result.status, 'allowed');
  assert.equal(result.reason, null);
});

test('Rekognition: blocks Explicit Nudity', () => {
  const unsafeLabels = [
    { Name: 'Graphic Female Nudity', ParentName: 'Explicit Nudity', Confidence: 85.0 },
  ];
  const result = evaluateRekognitionModerationLabels(unsafeLabels);
  assert.equal(result.isSafe, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'adult');
  assert.equal(result.policyVersion, 2);
});

test('Rekognition: blocks Graphic Violence', () => {
  const violenceLabels = [
    { Name: 'Graphic Violence Or Gore', ParentName: 'Violence', Confidence: 92.4 },
  ];
  const result = evaluateRekognitionModerationLabels(violenceLabels);
  assert.equal(result.isSafe, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'violence');
});

test('Rekognition: allows harmless props / sports weapons with low threat', () => {
  const cosplayLabels = [
    { Name: 'Weapons', ParentName: 'Violence', Confidence: 75.0 },
  ];
  const result = evaluateRekognitionModerationLabels(cosplayLabels);
  assert.equal(result.isSafe, true);
  assert.equal(result.status, 'allowed');
});

test('Rekognition: detectModerationWithRekognition strips prefix and calls client', async () => {
  let calledWith = null;
  const mockClient = {
    send: async (command) => {
      calledWith = command;
      return {
        ModerationLabels: [
          { Name: 'Explicit Nudity', ParentName: '', Confidence: 99.0 },
        ],
      };
    },
  };

  const dummyBase64 = 'data:image/jpeg;base64,aGVsbG8=';
  const result = await detectModerationWithRekognition(dummyBase64, {
    rekognitionClient: mockClient,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'adult');
  assert.deepEqual(calledWith.input.Image.Bytes, Buffer.from('aGVsbG8=', 'base64'));
});
