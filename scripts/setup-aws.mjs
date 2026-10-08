import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../functions/.env');

function askQuestion(rl, query, isPassword = false) {
  return new Promise((resolve) => {
    if (!isPassword) {
      rl.question(query, (ans) => resolve(ans.trim()));
    } else {
      process.stdout.write(query);
      const stdin = process.stdin;
      const oldRaw = stdin.isRaw;
      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      stdin.resume();

      let input = '';
      const onData = (char) => {
        const charStr = char.toString('utf8');
        if (charStr === '\n' || charStr === '\r' || charStr === '\u0004') {
          if (stdin.isTTY) {
            stdin.setRawMode(oldRaw || false);
          }
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input.trim());
        } else if (charStr === '\u0008' || charStr === '\x7f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (charStr === '\u0003') {
          process.exit(1);
        } else {
          input += charStr;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    }
  });
}

async function main() {
  console.log('==============================================');
  console.log('CampusMate - AWS Rekognition Connection Setup');
  console.log('==============================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const accessKeyId = await askQuestion(rl, 'กรุณากรอก AWS_ACCESS_KEY_ID: ');
  if (!accessKeyId) {
    console.error('ข้อผิดพลาด: ต้องระบุ AWS_ACCESS_KEY_ID');
    rl.close();
    process.exit(1);
  }

  const secretAccessKey = await askQuestion(rl, 'กรุณากรอก AWS_SECRET_ACCESS_KEY (ซ่อนตัวอักษร): ', true);
  if (!secretAccessKey) {
    console.error('ข้อผิดพลาด: ต้องระบุ AWS_SECRET_ACCESS_KEY');
    rl.close();
    process.exit(1);
  }

  const regionInput = await askQuestion(rl, 'กรุณากรอก AWS_REGION [กด Enter เพื่อใช้ค่า ap-southeast-1]: ');
  const region = regionInput || 'ap-southeast-1';

  const bucketInput = await askQuestion(rl, 'กรุณากรอก AWS_LIVENESS_TEMP_BUCKET [กด Enter เพื่อใช้ campusmate-liveness-temp]: ');
  const bucketName = bucketInput || 'campusmate-liveness-temp';

  rl.close();

  console.log('\nกำลังบันทึกลงใน functions/.env ...');

  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const vars = {
    AWS_REGION: region,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_LIVENESS_TEMP_BUCKET: bucketName,
    CAMPUSMATE_AWS_SECRETS_ENABLED: 'false',
  };

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
  console.log('บันทึกค่าลง functions/.env เรียบร้อยแล้ว');

  console.log('\nกำลังทดสอบเชื่อมต่อกับ AWS Rekognition...');
  const client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    // 1x1 1-pixel transparent PNG byte payload for authentication handshake
    const testBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    await client.send(
      new DetectFacesCommand({
        Image: { Bytes: testBuffer },
        Attributes: ['DEFAULT'],
      })
    );
    console.log('ผลการเชื่อมต่อ: สำเร็จ เชื่อมต่อ AWS Rekognition เรียบร้อยแล้ว');
  } catch (err) {
    if (err.name === 'InvalidImageFormatException' || err.message?.includes('image bytes') || err.message?.includes('cannot be empty')) {
      // Rekognition rejected the dummy image format, meaning authentication itself succeeded!
      console.log('ผลการเชื่อมต่อ: สำเร็จ (ตรวจสอบสิทธิ์ IAM กับ AWS ผ่านแล้ว)');
    } else if (err.name === 'UnrecognizedClientException' || err.name === 'InvalidSignatureException') {
      console.error('ผลการเชื่อมต่อ: ไม่ผ่าน (รหัส Access Key หรือ Secret Key ไม่ถูกต้อง)');
    } else if (err.name === 'AccessDeniedException') {
      console.error('ผลการเชื่อมต่อ: สิทธิ์ไม่เพียงพอ (IAM User ขาดสิทธิ์ Rekognition)');
    } else {
      console.warn('ผลการเชื่อมต่อ: มีข้อความตอบกลับจาก AWS:', err.message);
    }
  }

  console.log('\nคำแนะนำขั้นตอนต่อไป:');
  console.log('รันคำสั่งดีพลอยขึ้น Firebase Cloud Functions:');
  console.log('pnpm deploy:face-verification\n');
}

main().catch((err) => {
  console.error('เกิดข้อผิดพลาด:', err.message);
  process.exit(1);
});
