const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const headers = { Authorization: `Bearer ${config.tokens.access_token}`, 'Content-Type': 'application/json' };
  const secret = await fetch('https://secretmanager.googleapis.com/v1/projects/campusmate-7f1ab/secrets/REVENUECAT_SECRET_API_KEY/versions/latest:access', { headers });
  console.log('Secret access:', secret.status);
  if (!secret.ok) return;
  const key = Buffer.from((await secret.json()).payload.data, 'base64').toString().trim();
  const rc = await fetch('https://api.revenuecat.com/v1/subscribers/diagnostic-read-only', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  const data = await rc.json();
  console.log('Subscriber API:', rc.status, 'code:', data.code, 'message:', data.message);
  const projects = await fetch('https://api.revenuecat.com/v2/projects', { headers: { Authorization: `Bearer ${key}` } });
  const projectData = await projects.json();
  console.log('V2 projects:', projects.status, JSON.stringify(projectData));
  const project = projectData.items?.find(p => p.name === 'CampusMate');
  if (project) {
    const entitlements = await fetch(`https://api.revenuecat.com/v2/projects/${project.id}/entitlements`, { headers: { Authorization: `Bearer ${key}` } });
    const entitlementData = await entitlements.json();
    console.log('Entitlements:', entitlements.status, entitlementData.items?.map(e => ({ id: e.id, lookup_key: e.lookup_key })));
    const customers = await fetch(`https://api.revenuecat.com/v2/projects/${project.id}/customers?limit=100`, { headers: { Authorization: `Bearer ${key}` } });
    const customerData = await customers.json();
    console.log('Customers:', customers.status, 'count:', customerData.items?.length);
    const { fetchRevenueCatSubscriber, entitlementFromSubscriber, isPlusActive } = await import('../functions/plusEntitlements.js');
    let synchronize, adminAuth;
    if (process.argv.includes('--sync')) {
      const { initializeApp } = await import('../functions/node_modules/firebase-admin/lib/esm/app/index.js');
      const { getAuth } = await import('../functions/node_modules/firebase-admin/lib/esm/auth/index.js');
      initializeApp({ projectId: 'campusmate-7f1ab', credential: { getAccessToken: async () => ({ access_token: config.tokens.access_token, expires_in: 3600 }) } });
      adminAuth = getAuth();
      synchronize = async (uid) => {
        const url = `https://firestore.googleapis.com/v1/projects/campusmate-7f1ab/databases/(default)/documents/entitlements/${encodeURIComponent(uid)}`;
        const before = await fetch(url, { headers });
        if (!before.ok && before.status !== 404) throw new Error(`Entitlement read failed: ${before.status}`);
        const document = before.ok ? await before.json() : null;
        const verified = entitlementFromSubscriber(await fetchRevenueCatSubscriber(uid, key, fetch, project.id), Date.now(), true);
        verified.syncGeneration = Number(document?.fields?.syncGeneration?.integerValue || 0) + 1;
        const fields = Object.fromEntries(Object.entries(verified).map(([k,v]) => [k, v === null ? { nullValue: null } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }]));
        const query = new URLSearchParams(document ? { 'currentDocument.updateTime': document.updateTime } : { 'currentDocument.exists': 'false' });
        for (const field of Object.keys(fields)) query.append('updateMask.fieldPaths', field);
        const saved = await fetch(`${url}?${query}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
        if (!saved.ok) throw new Error(`Concurrent update or write failure: ${saved.status}`);
        return { plus: isPlusActive(verified) };
      };
    }
    for (const customer of customerData.items || []) {
      const payload = await fetchRevenueCatSubscriber(customer.id, key, fetch, project.id);
      const record = entitlementFromSubscriber(payload, Date.now(), true);
      console.log('Verified customer:', 'active:', isPlusActive(record), 'environment:', record.environment, 'store:', record.store);
      if (isPlusActive(record) && !customer.id.startsWith('$RCAnonymousID:')) {
        const profile = await fetch(`https://firestore.googleapis.com/v1/projects/campusmate-7f1ab/databases/(default)/documents/users/${encodeURIComponent(customer.id)}`, { headers });
        if (profile.ok) {
          const fields = (await profile.json()).fields;
          const gallery = fields?.gallery?.arrayValue?.values || [];
          console.log('Saved gallery count:', gallery.length);
          for (const value of gallery) {
            const uri = value.stringValue;
            if (uri?.startsWith('https://firebasestorage.googleapis.com/')) {
              const image = await fetch(uri, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
              console.log('Saved gallery image HTTP:', image.status);
            }
          }
        }
      }
      if (synchronize && isPlusActive(record)) {
        try { await adminAuth.getUser(customer.id); }
        catch (error) { if (error.code === 'auth/user-not-found') { console.log('Skipped customer without Firebase identity'); continue; } throw error; }
        const verified = await synchronize(customer.id);
        console.log('Synchronized existing purchase:', verified.plus);
      }
    }
  }
  const logs = await fetch('https://logging.googleapis.com/v2/entries:list', { method: 'POST', headers,
    body: JSON.stringify({ resourceNames: ['projects/campusmate-7f1ab'], filter: 'resource.type="cloud_run_revision" AND resource.labels.service_name="syncmembership" AND severity>=ERROR', orderBy: 'timestamp desc', pageSize: 4 }) });
  console.log('Logs status:', logs.status);
  if (logs.ok) for (const e of (await logs.json()).entries || []) console.log(e.timestamp, (e.textPayload || e.jsonPayload?.message || '').slice(0,700));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
