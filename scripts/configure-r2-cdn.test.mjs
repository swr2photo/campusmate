import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaCacheRules, mergeUploadCors, planR2Cdn, runR2CdnSetup } from './configure-r2-cdn.mjs';

const config = { accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32),
  domain: 'media.getcampusmate.app', bucket: 'campusmate-chat-media', mode: 'chat' };
const zone = { account: { id: config.accountId }, status: 'active', name: 'getcampusmate.app' };

test('chat rules cache only encrypted media using origin metadata and bypass plaintext', () => {
  const [encrypted, plaintext] = mediaCacheRules(config);
  assert.match(encrypted.expression, /ends_with.*\.enc/);
  assert.equal(encrypted.action_parameters.edge_ttl.mode, 'bypass_by_default');
  assert.equal(encrypted.action_parameters.edge_ttl.status_code_ttl[0].value, -1);
  assert.equal(plaintext.action_parameters.cache, false);
  assert.match(plaintext.expression, /not ends_with/);
});

test('avatars retain short origin TTL instead of forcing a year on mutable keys', () => {
  const [rule] = mediaCacheRules({ domain: 'images.getcampusmate.app', mode: 'avatars' });
  assert.equal(rule.action_parameters.edge_ttl.mode, 'respect_origin');
  assert.equal(rule.action_parameters.edge_ttl.default, undefined);
});

test('CORS merge preserves origins, methods, unrelated rules and input data', () => {
  const current = { rules: [
    { id: 'read', allowed: { origins: ['https://public.example.test'], methods: ['GET'] } },
    { id: 'upload', allowed: { origins: ['https://app.getcampusmate.app'], methods: ['PUT'], headers: ['content-type'] }, maxAgeSeconds: 60 },
  ] };
  const before = structuredClone(current);
  const merged = mergeUploadCors(current);
  assert.deepEqual(current, before);
  assert.deepEqual(merged.rules[0], current.rules[0]);
  assert.deepEqual(merged.rules[1].allowed.origins, current.rules[1].allowed.origins);
  assert.deepEqual(merged.rules[1].allowed.methods, ['PUT']);
  assert.deepEqual(merged.rules[1].allowed.headers, ['content-type', 'Cache-Control']);
  assert.equal(merged.rules[1].maxAgeSeconds, 3600);
  assert.deepEqual(mergeUploadCors(merged), merged);
  assert.deepEqual(mergeUploadCors({ rules: [] }), { rules: [] });
});

test('setup appends managed rules without replacing an existing zone ruleset', () => {
  const unrelated = { id: 'existing', ref: 'other_app', expression: 'true' };
  const state = { zone, domain: { domain: config.domain, enabled: true, zoneId: config.zoneId },
    ruleset: { id: 'set', rules: [unrelated] }, cors: { rules: [] } };
  const operations = planR2Cdn(config, state);
  assert.equal(operations.length, 2);
  assert.ok(operations.every((operation) => operation.method === 'POST' && operation.path.endsWith('/set/rules')));
  assert.deepEqual(state.ruleset.rules, [unrelated]);
  state.ruleset.rules.push(...mediaCacheRules(config).map((rule, index) => ({ ...rule, id: `managed${index}` })));
  assert.deepEqual(planR2Cdn(config, state), []);
  state.ruleset.rules[1].action_parameters = {
    origin_cache_control: true, edge_ttl: state.ruleset.rules[1].action_parameters.edge_ttl, cache: true,
  };
  assert.deepEqual(planR2Cdn(config, state), []);
});

test('foreign or inactive zones prevent every planned mutation', () => {
  for (const invalidZone of [{ ...zone, account: { id: 'other' } }, { ...zone, status: 'pending' }, { ...zone, name: 'foreign.test' }]) {
    assert.throws(() => planR2Cdn(config, { zone: invalidZone }), /active zone/);
  }
});

test('dry run reads config and never exposes token or sends a mutation', async () => {
  const calls = [];
  const logs = [];
  const token = 'DO_NOT_PRINT_PRIVATE_CLOUDFLARE_TOKEN';
  const operations = await runR2CdnSetup({ env: { CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: config.accountId, CLOUDFLARE_ZONE_ID: config.zoneId },
    args: [], log: (value) => logs.push(value), request: async (url, options) => {
      calls.push(options.method);
      if (url.endsWith(`/zones/${config.zoneId}`)) return { ok: true, status: 200, json: async () => ({ success: true, result: zone }) };
      return { ok: false, status: 404 };
    } });
  assert.ok(calls.every((method) => method === 'GET'));
  assert.equal(operations.length, 2);
  assert.equal(logs.join('').includes(token), false);
});
