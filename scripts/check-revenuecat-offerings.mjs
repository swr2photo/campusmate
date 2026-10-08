import { readFileSync, existsSync } from 'node:fs';

if (!existsSync('.env')) {
  console.log('No .env found');
  process.exit(1);
}

const env = readFileSync('.env', 'utf8');
const match = env.match(/EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=(.*)/);
if (!match || !match[1].trim()) {
  console.log('No Android API key found in .env');
  process.exit(1);
}

const key = match[1].trim();

async function testOfferings() {
  console.log('====================================================');
  console.log(' ตรวจสอบ Offerings และ Products ใน RevenueCat สด');
  console.log('====================================================\n');

  try {
    const res = await fetch('https://api.revenuecat.com/v1/subscribers/test-readiness-user/offerings', {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'X-Platform': 'android',
        'X-Platform-Flavor': 'react-native',
        'X-Platform-Version': '34',
        'X-Version': '8.2.0',
        'X-Client-Version': '8.2.0',
      },
    });

    console.log(`HTTP Status: ${res.status}`);
    if (res.status === 200) {
      const data = await res.json();
      console.log(`Current Offering ID: ${data.current_offering_id || 'None'}`);
      
      console.log('Offerings details:');
      console.log(JSON.stringify(data.offerings, null, 2));
    } else {
      console.log('Response:', await res.text());
    }
  } catch (err) {
    console.error('Error fetching offerings:', err.message);
  }

  console.log('\n====================================================\n');
}

testOfferings();
