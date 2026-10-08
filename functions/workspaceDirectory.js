import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DIRECTORY_USERS_URL = 'https://admin.googleapis.com/admin/directory/v1/users/';
export const GOOGLE_WORKSPACE_DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
const TOKEN_CACHE_SKEW_MS = 60_000;

let accessTokenCache = null;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getRawServiceAccountJson(env) {
  const encoded = String(env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_B64 || '')
    .replace(/\s/g, '')
    .trim();
  if (encoded) {
    try {
      return Buffer.from(encoded, 'base64').toString('utf8');
    } catch (error) {
      throw Object.assign(new Error('Google Workspace service account JSON is not valid base64'), {
        code: 'workspace/invalid-config',
        cause: error,
      });
    }
  }
  return String(env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON || '').trim();
}

export function getWorkspaceDirectoryConfig(env = process.env) {
  const adminEmail = String(env.GOOGLE_WORKSPACE_ADMIN_EMAIL || '').trim().toLowerCase();
  const rawJson = getRawServiceAccountJson(env);
  if (!adminEmail || !rawJson) return null;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawJson);
  } catch (error) {
    throw Object.assign(new Error('Google Workspace service account JSON is invalid'), {
      code: 'workspace/invalid-config',
      cause: error,
    });
  }

  const clientEmail = String(serviceAccount.client_email || '').trim();
  const privateKey = String(serviceAccount.private_key || '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw Object.assign(new Error('Google Workspace service account JSON is missing client_email or private_key'), {
      code: 'workspace/invalid-config',
    });
  }

  return { adminEmail, clientEmail, privateKey };
}

export function isWorkspaceDirectoryConfigured(env = process.env) {
  try {
    return Boolean(getWorkspaceDirectoryConfig(env));
  } catch (_) {
    return false;
  }
}

async function getAccessToken(config) {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now + TOKEN_CACHE_SKEW_MS) {
    return accessTokenCache.token;
  }

  const issuedAt = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(JSON.stringify({
    iss: config.clientEmail,
    scope: GOOGLE_WORKSPACE_DIRECTORY_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
    sub: config.adminEmail,
  }));
  const unsignedToken = `${header}.${claim}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(config.privateKey, 'base64url');
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Google Workspace token request failed (${response.status})`), {
      code: 'workspace/token-error',
      status: response.status,
      detail: detail.slice(0, 500),
    });
  }

  const token = await response.json();
  if (!token.access_token) {
    throw Object.assign(new Error('Google Workspace token response did not include an access token'), {
      code: 'workspace/token-error',
    });
  }
  accessTokenCache = {
    token: token.access_token,
    expiresAt: now + Number(token.expires_in || 3600) * 1000,
  };
  return token.access_token;
}

export async function lookupWorkspaceUser(email, env = process.env) {
  const config = getWorkspaceDirectoryConfig(env);
  if (!config) return { configured: false, exists: false };

  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `${GOOGLE_DIRECTORY_USERS_URL}${encodeURIComponent(String(email || '').trim().toLowerCase())}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 404) return { configured: true, exists: false };
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Google Workspace directory lookup failed (${response.status})`), {
      code: 'workspace/directory-error',
      status: response.status,
      detail: detail.slice(0, 500),
    });
  }

  const user = await response.json();
  return {
    configured: true,
    exists: user.suspended !== true && user.archived !== true,
  };
}
