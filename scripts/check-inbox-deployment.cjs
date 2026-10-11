const fs = require('node:fs');
const crypto = require('node:crypto');
const cli = 'C:/Users/This PC/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const auth = require(cli + 'auth');
auth.setActiveAccount({}, auth.getProjectDefaultAccount(process.cwd()));
const rules = require(cli + 'gcp/rules');
const functions = require(cli + 'gcp/cloudfunctionsv2');
const project = 'campusmate-7f1ab';
const names = ['notifyOnLikeCreated', 'notifyOnMatchCreated', 'notifyOnMessageCreated', 'notifyOnGroupMessageCreated', 'ensureNotificationInbox', 'syncFaceNotificationInbox', 'notifyPartyRequestInbox', 'notifyPartyStatusInbox', 'notifyAppointmentInbox', 'cleanExpiredNotificationInbox', 'markAllNotificationInboxRead', 'adminConsole', 'deleteUserData', 'getConversationEncryptionProfiles'];
(async () => {
  const ruleset = await rules.getLatestRulesetName(project, 'cloud.firestore');
  const files = await rules.getRulesetContent(ruleset);
  const live = files.find(file => file.name === 'firestore.rules')?.content || files[0].content;
  const hash = value => crypto.createHash('sha256').update(value.split('\r\n').join('\n').trim()).digest('hex');
  const ruleResult = { ruleset, matchesLocal: hash(live) === hash(fs.readFileSync('firestore.rules', 'utf8')), sha256: hash(live) };
  fs.writeFileSync('artifacts/ui-inbox/post-deploy-rules.json', JSON.stringify(ruleResult, null, 2));
  const rows = [];
  for (const name of names) {
    const result = await functions.getFunction(project, 'asia-southeast1', name);
    rows.push({ name, state: result.state, updateTime: result.updateTime,
      ...(name === 'getConversationEncryptionProfiles' ? { secureEnabled: result.serviceConfig?.environmentVariables?.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true' } : {}) });
  }
  fs.writeFileSync('artifacts/ui-inbox/post-deploy-functions.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ rulesMatch: ruleResult.matchesLocal, activeFunctions: rows.filter(row => row.state === 'ACTIVE').length, totalFunctions: rows.length }));
  if (!ruleResult.matchesLocal || rows.some(row => row.state !== 'ACTIVE' || row.secureEnabled === false)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
