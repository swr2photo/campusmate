import { resolve } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';

async function updateDns() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error('CLOUDFLARE_API_TOKEN environment variable is required.');
    process.exit(1);
  }

  const zoneId = process.env.CLOUDFLARE_ZONE_ID || '3dd0f976f772d6bfb28fc82710a63a9c';

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  console.log(`Checking DNS records for zone ${zoneId}...`);
  const listRes = await fetch(`${API}/zones/${zoneId}/dns_records?per_page=100`, { headers });
  const listData = await listRes.json();

  if (!listData.success) {
    console.error('Failed to list DNS records:', listData.errors);
    process.exit(1);
  }

  const records = listData.result;

  // 1. Add TXT hosting-site=campusmate-7f1ab
  const existingTxt = records.find(r => r.type === 'TXT' && (r.name === 'getcampusmate.app' || r.name === '@') && r.content.includes('hosting-site=campusmate-7f1ab'));
  if (existingTxt) {
    console.log('✓ TXT ownership record already exists.');
  } else {
    console.log('Adding TXT ownership record...');
    const createRes = await fetch(`${API}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'TXT',
        name: '@',
        content: 'hosting-site=campusmate-7f1ab',
        ttl: 1
      })
    });
    const createData = await createRes.json();
    if (createData.success) {
      console.log('✓ TXT ownership record added successfully!');
    } else {
      console.error('Failed to add TXT record:', createData.errors);
    }
  }

  // 2. Update A record for getcampusmate.app -> 199.36.158.100 (DNS only)
  const rootARecords = records.filter(r => r.type === 'A' && (r.name === 'getcampusmate.app' || r.name === '@'));
  for (const aRec of rootARecords) {
    if (aRec.content === '192.64.119.50' || aRec.content.includes('192.64')) {
      console.log(`Updating A record ${aRec.id} from ${aRec.content} to 199.36.158.100 (DNS only)...`);
      const updateRes = await fetch(`${API}/zones/${zoneId}/dns_records/${aRec.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          content: '199.36.158.100',
          proxied: false,
          ttl: 1
        })
      });
      const updateData = await updateRes.json();
      if (updateData.success) {
        console.log('✓ Root A record updated to 199.36.158.100 (DNS only)!');
      } else {
        console.error('Failed to update A record:', updateData.errors);
      }
    }
  }

  // 3. Update www CNAME -> getcampusmate.app (DNS only)
  const wwwRecords = records.filter(r => (r.type === 'CNAME' || r.type === 'A') && r.name.startsWith('www'));
  for (const wwwRec of wwwRecords) {
    console.log(`Updating www record ${wwwRec.id} (${wwwRec.type}) to CNAME getcampusmate.app (DNS only)...`);
    const updateRes = await fetch(`${API}/zones/${zoneId}/dns_records/${wwwRec.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        type: 'CNAME',
        name: 'www',
        content: 'getcampusmate.app',
        proxied: false,
        ttl: 1
      })
    });
    const updateData = await updateRes.json();
    if (updateData.success) {
      console.log('✓ www CNAME record updated to getcampusmate.app (DNS only)!');
    } else {
      console.error('Failed to update www record:', updateData.errors);
    }
  }

  console.log('DNS updates completed!');
}

updateDns().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
