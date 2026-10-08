import { getStorage } from 'firebase-admin/storage';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { onCall } from 'firebase-functions/v2/https';
import { createProfileGalleryUploader } from './profileGallery.js';
import { detectSafeSearch } from './imageModeration.js';

let vision;
export const uploadProfileGalleryImage = onCall({ region: 'asia-southeast1', maxInstances: 10, timeoutSeconds: 60 },
  createProfileGalleryUploader({
    getBucket: () => getStorage().bucket('campusmate-7f1ab.firebasestorage.app'),
    moderate: (imageBase64) => detectSafeSearch(imageBase64, { visionClient: vision ||= new ImageAnnotatorClient() }),
  }));
