import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { createProfileGalleryUploader } from './profileGallery.js';
import { detectSafeSearch } from './imageModeration.js';

let vision;
export const uploadProfileGalleryImage = onCall({ region: 'asia-southeast1', maxInstances: 10, timeoutSeconds: 60 },
  createProfileGalleryUploader({
    getBucket: () => getStorage().bucket('campusmate-7f1ab.firebasestorage.app'),
    // Vision is loaded on first use so other functions' cold starts skip it.
    moderate: async (imageBase64) => {
      vision ||= new (await import('@google-cloud/vision')).ImageAnnotatorClient();
      return detectSafeSearch(imageBase64, { visionClient: vision });
    },
  }));
