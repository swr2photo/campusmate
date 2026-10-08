import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const API = 'https://api.cloudflare.com/client/v4';

export function mediaCacheRules({ domain, mode = 'chat' }) {
  if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('Invalid delivery hostname');
  const readRequest = `(http.host eq "${domain}" and http.request.method in {"GET" "HEAD"})`;
  const ttl = { mode: mode === 'chat' ? 'bypass_by_default' : 'respect_origin',
    status_code_ttl: [{ status_code_range: { from: 400, to: 599 }, value: -1 }] };
  const cacheRule = { ref: `campusmate_${mode}_media_cache_v1`,
    description: `CampusMate ${mode} media: respect origin cache privacy`,
    action: 'set_cache_settings', enabled: true,
    expression: mode === 'chat'
      ? `${readRequest} and starts_with(http.request.uri.path, "/chat_media/") and ends_with(http.request.uri.path, ".enc")`
      : `${readRequest} and (ends_with(http.request.uri.path, ".jpg") or ends_with(http.request.uri.path, ".jpeg") or ends_with(http.request.uri.path, ".png") or ends_with(http.request.uri.path, ".webp") or ends_with(http.request.uri.path, ".avif"))`,
    action_parameters: { cache: true, edge_ttl: ttl, origin_cache_control: true } };
  return mode === 'chat' ? [cacheRule, {
    ref: 'campusmate_chat_plaintext_bypass_v1',
    description: 'CampusMate legacy plaintext chat: bypass shared cache',
    action: 'set_cache_settings', enabled: true,
    expression: `${readRequest} and starts_with(http.request.uri.path, "/chat_media/") and not ends_with(http.request.uri.path, ".enc")`,
    action_parameters: { cache: false },
  }] : [cacheRule];
}

// The Cloudflare CORS endpoint replaces the whole document. Only merge headers
// into already-authorized PUT rules; never add an origin, method, or wildcard.
export function mergeUploadCors(current = { rules: [] }) {
  const next = structuredClone(current);
  next.rules = next.rules || [];
  for (const rule of next.rules) {
    if (!rule.allowed?.methods?.includes('PUT')) continue;
    const headers = rule.allowed.headers || [];
    if (!headers.includes('*')) {
      rule.allowed.headers = [...headers];
      for (const header of ['Content-Type', 'Cache-Control']) {
        if (!headers.some((value) => value.toLowerCase() === header.toLowerCase())) rule.allowed.headers.push(header);
      }
    }
    rule.exposeHeaders = rule.exposeHeaders || [];
    if (!rule.exposeHeaders.some((header) => header.toLowerCase() === 'etag')) rule.exposeHeaders.push('ETag');
    rule.maxAgeSeconds = Math.max(rule.maxAgeSeconds || 0, 3600);
  }
  return next;
}

function sameManagedRule(existing, desired) {
  return ['ref', 'description', 'action', 'enabled', 'expression', 'action_parameters']
    .every((key) => isDeepStrictEqual(existing[key], desired[key]));
}

export function planR2Cdn(config, state) {
  const { accountId, zoneId, domain, bucket, mode } = config;
  if (state.zone?.account?.id !== accountId || state.zone?.status !== 'active'
    || !(domain.endsWith(`.${state.zone.name}`))) {
    throw new Error('The active zone and R2 bucket must belong to the configured account');
  }
  if (state.domain && (state.domain.domain !== domain || (state.domain.zoneId && state.domain.zoneId !== zoneId))) {
    throw new Error('Existing bucket domain does not match the configured zone');
  }
  const bucketBase = `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}`;
  const operations = [];
  if (!state.domain) operations.push({ label: 'attach_domain', method: 'POST', path: `${bucketBase}/domains/custom`,
    body: { domain, enabled: true, zoneId } });
  else if (!state.domain.enabled) operations.push({ label: 'enable_domain', method: 'PUT',
    path: `${bucketBase}/domains/custom/${domain}`, body: { enabled: true } });
  const desiredRules = mediaCacheRules({ domain, mode });
  if (!state.ruleset) {
    operations.push({ label: 'create_cache_ruleset', method: 'POST', path: `/zones/${zoneId}/rulesets`,
      body: { name: 'CampusMate media cache', kind: 'zone', phase: 'http_request_cache_settings', rules: desiredRules } });
  } else {
    for (const rule of desiredRules) {
      const matches = (state.ruleset.rules || []).filter((current) => current.ref === rule.ref);
      if (matches.length > 1) throw new Error('Duplicate managed cache rule references require review');
      const existing = matches[0];
      if (existing && sameManagedRule(existing, rule)) continue;
      operations.push({ label: existing ? 'update_managed_cache_rule' : 'append_managed_cache_rule',
        method: existing ? 'PATCH' : 'POST',
        path: `/zones/${zoneId}/rulesets/${state.ruleset.id}/rules${existing ? `/${existing.id}` : ''}`,
        body: rule });
    }
  }
  const cors = mergeUploadCors(state.cors || { rules: [] });
  if (JSON.stringify(cors) !== JSON.stringify(state.cors || { rules: [] })) operations.push({ label: 'merge_existing_put_cors_headers',
    method: 'PUT', path: `${bucketBase}/cors`, body: cors, previous: state.cors || { rules: [] } });
  return operations;
}

function argument(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}

export async function runR2CdnSetup({ args = process.argv.slice(2), env = process.env, request = fetch, log = console.log } = {}) {
  const allowed = new Set(['--apply', '--mode', '--domain', '--bucket']);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index])) throw new Error('Unsupported command argument');
    if (args[index] !== '--apply') index += 1;
  }
  const mode = argument(args, '--mode', 'chat');
  if (!['chat', 'avatars'].includes(mode)) throw new Error('Mode must be chat or avatars');
  if (mode === 'avatars' && !args.includes('--bucket')) throw new Error('Avatar bucket must be specified explicitly');
  const config = { accountId: env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_R2_ACCOUNT_ID,
    zoneId: env.CLOUDFLARE_ZONE_ID,
    domain: argument(args, '--domain', mode === 'chat' ? 'media.getcampusmate.app' : 'images.getcampusmate.app'),
    bucket: argument(args, '--bucket', 'campusmate-chat-media'), mode };
  if (!/^[a-f0-9]{32}$/.test(config.accountId || '') || !/^[a-f0-9]{32}$/.test(config.zoneId || '')
    || !env.CLOUDFLARE_API_TOKEN || !/^[a-z0-9][a-z0-9._-]{1,62}$/.test(config.bucket)) {
    throw new Error('Set a Cloudflare API token, account ID, zone ID and valid bucket name in the environment');
  }
  const api = async (path, { method = 'GET', body, allowNotFound = false } = {}) => {
    let response;
    try {
      response = await request(`${API}${path}`, { method,
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    } catch { throw new Error('Cloudflare request failed or timed out'); }
    if (allowNotFound && response.status === 404) return null;
    let data;
    try { data = await response.json(); } catch { throw new Error(`Cloudflare returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || data.success === false) throw new Error(`Cloudflare API rejected request (HTTP ${response.status}; codes ${(data.errors || []).map((error) => error.code).join(',')})`);
    return data.result;
  };
  const bucketBase = `/accounts/${config.accountId}/r2/buckets/${encodeURIComponent(config.bucket)}`;
  const [zone, domain, ruleset, cors] = await Promise.all([
    api(`/zones/${config.zoneId}`),
    api(`${bucketBase}/domains/custom/${config.domain}`, { allowNotFound: true }),
    api(`/zones/${config.zoneId}/rulesets/phases/http_request_cache_settings/entrypoint`, { allowNotFound: true }),
    api(`${bucketBase}/cors`, { allowNotFound: true }),
  ]);
  const operations = planR2Cdn(config, { zone, domain, ruleset, cors });
  log(JSON.stringify({ apply: args.includes('--apply'), domain: config.domain, bucket: config.bucket, mode,
    operations: operations.map(({ label, method, body }) => ({ label, method,
      ruleRefs: label.includes('cache') ? body.rules?.map((rule) => rule.ref) || (body.ref ? [body.ref] : undefined) : undefined,
      corsRuleCount: body.rules && label.includes('cors') ? body.rules.length : undefined })),
    existingPutCorsRules: (cors?.rules || []).filter((rule) => rule.allowed?.methods?.includes('PUT')).length }, null, 2));
  if (!args.includes('--apply')) return operations;
  for (const operation of operations) {
    if (operation.previous) {
      const latest = await api(`${bucketBase}/cors`, { allowNotFound: true });
      if (JSON.stringify(latest || { rules: [] }) !== JSON.stringify(operation.previous)) throw new Error('CORS changed during setup; rerun dry run before applying');
    }
    await api(operation.path, operation);
    log(JSON.stringify({ completed: operation.label }));
  }
  log(JSON.stringify({ configured: true, domain: config.domain,
    next: 'Verify TLS, object delivery and repeated GET cache hits before changing application URLs.' }));
  return operations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runR2CdnSetup().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
