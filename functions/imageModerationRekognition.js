import { DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { getRekognitionClient } from './faceVerification.js';

export const REKOGNITION_POLICY_VERSION = 2;

// หมวดหมู่ที่ไม่อนุญาตเด็ดขาดสำหรับแอปนักศึกษา
const EXPLICIT_NUDITY_MIN_CONFIDENCE = 60;
const VIOLENCE_MIN_CONFIDENCE = 65;

/**
 * ประเมินผลลัพธ์ Moderation Labels จาก Amazon Rekognition
 * 
 * ข้อดีเหนือ Google SafeSearch:
 * - แยกแยะ 'Explicit Nudity' (โป๊เปลือยอนาจาร) ออกจาก 'Suggestive / Swimwear' (ชุดว่ายน้ำ/ชุดออกกำลังกาย) ได้แม่นยำ
 * - รูปนักศึกษาไปเที่ยวทะเล ใส่ชุดว่ายน้ำ หรือเข้าฟิตเนส จะไม่โดนบล็อกมั่ว (Zero False-Positive บนชุดลำลอง/ว่ายน้ำ)
 */
export function evaluateRekognitionModerationLabels(labels = []) {
  const safeLabels = Array.isArray(labels) ? labels : [];

  for (const label of safeLabels) {
    const name = label?.Name || '';
    const parent = label?.ParentName || '';
    const confidence = Number(label?.Confidence) || 0;

    // 1. ตรวจจับภาพโป๊เปลือยชัดเจน (Explicit Nudity)
    if (
      (parent === 'Explicit Nudity' || name === 'Explicit Nudity') &&
      confidence >= EXPLICIT_NUDITY_MIN_CONFIDENCE
    ) {
      return {
        isSafe: false,
        status: 'blocked',
        reason: 'adult',
        message: 'ระบบประเมินว่าภาพนี้อาจมีเนื้อหาโป๊เปลือย จึงยังใช้ภาพนี้ไม่ได้',
        policyVersion: REKOGNITION_POLICY_VERSION,
        detectedLabel: { name, parent, confidence },
      };
    }

    // 2. ตรวจจับภาพความรุนแรง (Violence) - ยกเว้นอาวุธทั่วไป (Weapons) ที่อาจเป็นคอสเพลย์/อุปกรณ์กีฬา
    if (
      (parent === 'Violence' || name === 'Violence') &&
      name !== 'Weapons' &&
      confidence >= VIOLENCE_MIN_CONFIDENCE
    ) {
      return {
        isSafe: false,
        status: 'blocked',
        reason: 'violence',
        message: 'ระบบประเมินว่าภาพนี้อาจมีเนื้อหาความรุนแรง จึงยังใช้ภาพนี้ไม่ได้',
        policyVersion: REKOGNITION_POLICY_VERSION,
        detectedLabel: { name, parent, confidence },
      };
    }
  }

  // ไม่มีรายการที่เข้าข่ายละเมิดความปลอดภัย
  return {
    isSafe: true,
    status: 'allowed',
    reason: null,
    policyVersion: REKOGNITION_POLICY_VERSION,
    detectedLabelsCount: safeLabels.length,
  };
}

/**
 * เรียกใช้ Amazon Rekognition DetectModerationLabels
 * @param {string} imageBase64 - base64 string ของรูปภาพ
 * @param {Object} options - { rekognitionClient, minConfidence }
 */
export async function detectModerationWithRekognition(
  imageBase64,
  { rekognitionClient, minConfidence = 50 } = {}
) {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new Error('กรุณาระบุข้อมูลรูปภาพให้ถูกต้อง');
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '').trim();
  const client = rekognitionClient || getRekognitionClient({ env: process.env });

  if (!client) {
    throw new Error('Amazon Rekognition client is not configured');
  }

  const imageBytes = Buffer.from(cleanBase64, 'base64');
  const command = new DetectModerationLabelsCommand({
    Image: { Bytes: imageBytes },
    MinConfidence: minConfidence,
  });

  const response = await client.send(command);
  const labels = response?.ModerationLabels || [];

  return evaluateRekognitionModerationLabels(labels);
}
