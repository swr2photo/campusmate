// Utility script to verify AWS Rekognition configuration and environment variables
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAwsRekognitionConfig, getRekognitionClient } from './faceVerification.js';
import { DetectFacesCommand } from '@aws-sdk/client-rekognition';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

// Parse .env manually if dotenv is not loaded
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const config = getAwsRekognitionConfig(process.env);
const maskKey = (key) => (key && key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : (key ? '****' : '(not set)'));

console.log('--- AWS Rekognition Configuration Status ---');
console.log(`Region: ${config.region}`);
console.log(`Profile: ${config.profile || '(default/none)'}`);
console.log(`Access Key ID: ${maskKey(config.accessKeyId)}`);
console.log(`Secret Access Key: ${config.secretAccessKey ? 'Configured (hidden)' : '(not set)'}`);
console.log(`Liveness Temp Bucket: ${config.bucketName || '(not set)'}`);
console.log(`Configured Ready: ${config.isConfigured ? 'YES' : 'NO (Missing AWS credentials or profile)'}`);

const client = getRekognitionClient({ env: process.env });
if (!client) {
  console.log('\n[Status] Rekognition client is offline. Functions will return service_unavailable until AWS keys or profile are provided.');
} else {
  console.log('\n[Status] Rekognition client successfully initialized.');
  console.log('Testing live connection to AWS Rekognition API...');
  try {
    const dummyBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    const res = await client.send(new DetectFacesCommand({ Image: { Bytes: dummyBytes } }));
    console.log('[Live Test] SUCCESS: Connected to AWS Rekognition API (Status 200, Request ID:', res.$metadata?.requestId, ')');
  } catch (err) {
    console.error('[Live Test] FAILED:', err.name, '-', err.message);
  }
}
