import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWorkspaceDirectoryConfig,
  isWorkspaceDirectoryConfigured,
} from './workspaceDirectory.js';
import { isExpiredUnverifiedCampusUser } from './unverifiedAccountCleanup.js';

const nowMs = Date.parse('2026-09-22T00:00:00.000Z');

test('workspace directory requires an admin subject and service account JSON', () => {
  assert.equal(isWorkspaceDirectoryConfigured({}), false);
  assert.equal(isWorkspaceDirectoryConfigured({
    GOOGLE_WORKSPACE_ADMIN_EMAIL: 'admin@psu.ac.th',
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_B64: Buffer.from(JSON.stringify({
      client_email: 'service@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
    })).toString('base64'),
  }), true);
});

test('workspace directory config normalizes the admin email and private key', () => {
  const config = getWorkspaceDirectoryConfig({
    GOOGLE_WORKSPACE_ADMIN_EMAIL: ' Admin@PSU.AC.TH ',
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'service@example.iam.gserviceaccount.com',
      private_key: 'line-1\\nline-2',
    }),
  });
  assert.equal(config.adminEmail, 'admin@psu.ac.th');
  assert.equal(config.privateKey, 'line-1\nline-2');
});

test('cleanup targets only old unverified PSU password accounts', () => {
  const oldUser = {
    email: 'student@psu.ac.th',
    emailVerified: false,
    metadata: { creationTime: '2026-09-20T23:59:00.000Z' },
    providerData: [{ providerId: 'password' }],
  };
  assert.equal(isExpiredUnverifiedCampusUser(oldUser, nowMs), true);
  assert.equal(isExpiredUnverifiedCampusUser({ ...oldUser, emailVerified: true }, nowMs), false);
  assert.equal(isExpiredUnverifiedCampusUser({ ...oldUser, email: 'student@gmail.com' }, nowMs), false);
  assert.equal(isExpiredUnverifiedCampusUser({ ...oldUser, metadata: { creationTime: '2026-09-21T12:00:00.000Z' } }, nowMs), false);
});
