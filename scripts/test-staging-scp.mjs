// Read-only IAM simulation of the proposed organization policy boundary.
// The companion Allow policy makes Deny-only SCP restrictions observable.
// This does not establish effective permissions from every live policy layer.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'docs/face-verification/scp');
const before = JSON.parse(readFileSync(join(directory, '2026-10-13-live-region-policy.json'), 'utf8'));
const after = JSON.parse(readFileSync(join(directory, '2026-10-13-proposed-staging-secrets.json'), 'utf8'));
assert.equal(JSON.stringify(after).length <= 5120, true, 'SCP minified size exceeds quota');
assert.deepEqual(after.Statement.slice(0, 2), before.Statement.slice(0, 2));
const original = before.Statement[2];
assert.equal(original.Sid, 'ThailandFaceLivenessOnly');
assert.deepEqual({ ...after.Statement[2], NotAction: original.NotAction }, original);
assert.equal(after.Statement.every(s => s.Effect === 'Deny'), true);

const role = 'arn:aws:iam::502731779521:role/managed/AccountFullAccessRole';
const secret = 'arn:aws:secretsmanager:ap-southeast-7:502731779521:secret:campusmate/staging/services/api-Ab12Cd';
const production = secret.replace('/staging/', '/production/');
const context = { 'aws:RequestedRegion': 'ap-southeast-7', 'aws:PrincipalArn': role };
const kmsContext = { 'kms:ViaService': 'secretsmanager.ap-southeast-7.amazonaws.com',
                     'kms:EncryptionContext:SecretARN': secret };
const cases = [];
function add(name, action, decision, resource = secret, extra = {}) {
  cases.push({ name, action, decision, resource, context: { ...context, ...extra } });
}
for (const action of ['CreateSecret', 'DescribeSecret', 'PutSecretValue', 'TagResource']) {
  add(`staging-${action}`, `secretsmanager:${action}`, 'allowed');
}
add('staging-runtime-read', 'secretsmanager:GetSecretValue', 'allowed', secret, { 'aws:ViaAWSMCPService': 'true' });
add('direct-read', 'secretsmanager:GetSecretValue', 'explicitDeny');
add('production-read', 'secretsmanager:GetSecretValue', 'explicitDeny', production, { 'aws:ViaAWSMCPService': 'true' });
add('lookalike-name', 'secretsmanager:CreateSecret', 'explicitDeny', secret.replace('api-Ab12Cd', 'api-extra-Ab12Cd'));
add('workload-role', 'secretsmanager:DescribeSecret', 'explicitDeny', secret, { 'aws:PrincipalArn': 'arn:aws:iam::502731779521:role/campusmate-backend' });
add('other-project-role', 'secretsmanager:DescribeSecret', 'explicitDeny', secret, { 'aws:PrincipalArn': role.replace('502731779521', '341169625074') });
add('other-project-resource', 'secretsmanager:CreateSecret', 'explicitDeny', secret.replace('502731779521', '341169625074'));
for (const action of ['GenerateDataKey', 'Decrypt']) {
  add(`staging-kms-${action}`, `kms:${action}`, 'allowed', '*', kmsContext);
}
add('direct-kms', 'kms:Decrypt', 'explicitDeny', '*', { 'kms:EncryptionContext:SecretARN': secret });
add('kms-wrong-service', 'kms:Decrypt', 'explicitDeny', '*', { ...kmsContext, 'kms:ViaService': 's3.ap-southeast-7.amazonaws.com' });
add('kms-missing-context', 'kms:Decrypt', 'explicitDeny', '*', { 'kms:ViaService': kmsContext['kms:ViaService'] });
add('kms-production-context', 'kms:Decrypt', 'explicitDeny', '*', { ...kmsContext, 'kms:EncryptionContext:SecretARN': production });
add('kms-other-principal', 'kms:Decrypt', 'explicitDeny', '*', { ...kmsContext, 'aws:PrincipalArn': 'arn:aws:iam::502731779521:role/campusmate-backend' });
add('list-still-denied', 'secretsmanager:ListSecrets', 'explicitDeny', '*');
add('delete-still-denied', 'secretsmanager:DeleteSecret', 'explicitDeny');
add('lambda-still-denied', 'lambda:CreateFunction', 'explicitDeny', '*');
add('liveness-unchanged', 'rekognition:CreateFaceLivenessSession', 'allowed', '*');
add('sts-unchanged', 'sts:AssumeRole', 'allowed', '*');
add('unapproved-region-unchanged', 'secretsmanager:CreateSecret', 'explicitDeny', '*', { 'aws:RequestedRegion': 'eu-west-1' });

if (process.argv.length !== 3 || process.argv[2] !== '--live') {
  console.log(JSON.stringify({ status: 'STRUCTURE_OK', cases: cases.length,
    liveSimulation: false, minifiedBytes: JSON.stringify(after).length }));
  process.exit(process.argv.length === 2 ? 0 : 1);
}
const temp = mkdtempSync(join(tmpdir(), 'campusmate-scp-simulation-'));
const allow = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] };
let failed = 0;
try {
  for (const [index, test] of cases.entries()) {
    const input = { PolicyInputList: [JSON.stringify(after), JSON.stringify(allow)],
      ActionNames: [test.action], ResourceArns: [test.resource],
      ContextEntries: Object.entries(test.context).map(([key, value]) => ({
        ContextKeyName: key, ContextKeyValues: [value],
        ContextKeyType: key === 'aws:ViaAWSMCPService' ? 'boolean' : 'string',
      })) };
    const file = join(temp, `${index}.json`);
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    const result = spawnSync('aws', ['iam', 'simulate-custom-policy', '--profile', 'campusmate-admin',
      '--region', 'ap-southeast-2', '--cli-input-json', `file://${file}`, '--output', 'json', '--no-cli-pager'],
      { encoding: 'utf8', timeout: 45000, windowsHide: true });
    let decision = 'SIMULATION_FAILED';
    if (result.status === 0) {
      try { decision = JSON.parse(result.stdout).EvaluationResults[0].EvalDecision; } catch {}
    }
    const pass = decision === test.decision;
    if (!pass) failed++;
    console.log(JSON.stringify({ case: test.name, expected: test.decision, actual: decision, pass }));
  }
} finally {
  // Only this exact mkdtemp directory is removed; it contains synthetic inputs.
  rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: failed ? 'FAILED' : 'PASSED', cases: cases.length, failed,
  proposedPolicyApplied: false }));
process.exitCode = failed ? 1 : 0;
