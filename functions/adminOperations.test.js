import test from 'node:test';
import assert from 'node:assert/strict';
import {safeProfile,userSummary,validateOperations,effectiveOperations,validateNotification,validateRemotePatch,remoteParameters,remoteParameterMap,remoteParameterTarget} from './adminOperations.js';
test('profile projection keeps detailed form data and excludes credentials, coordinates and E2EE keys',()=>{
 const result=safeProfile({name:'QA',bio:'bio',gallery:['https://example.test/photo.jpg'],favoriteTracks:[{name:'track',accessToken:'secret'}],privacy:{showAge:false,secret:'hidden'},latitude:7,longitude:100,publicKey:'key',password:'pw',spotifyTokens:{accessToken:'no'}});
 assert.equal(result.name,'QA');assert.equal(result.privacy.showAge,false);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal('latitude' in result,false);assert.equal('spotifyTokens' in result,false);
 const summary=userSummary({uid:'qa',email:'qa@example.test',emailVerified:true,disabled:false,metadata:{creationTime:'now'},passwordHash:'hash',customClaims:{admin:true}},{});assert.equal(summary.isAdmin,true);assert.equal('passwordHash' in summary,false);assert.equal(summary.profileExists,false);
});
test('grouped Remote Config values retain their group and conditional overrides',()=>{
 const template={parameters:{main:{defaultValue:{value:'hello'}}},parameterGroups:{group:{parameters:{}}}};
 template.parameterGroups.group.parameters.count={valueType:'NUMBER',defaultValue:{value:'2'},conditionalValues:{qa:{value:'3'}}};
 assert.equal(remoteParameters(template).find(p=>p.key==='count').group,'group');const patch=validateRemotePatch(remoteParameterMap(template),{count:'4'}),target=remoteParameterTarget(template,'count');target.count={...target.count,defaultValue:{value:patch.count}};assert.equal(template.parameterGroups.group.parameters.count.defaultValue.value,'4');assert.equal(target.count.conditionalValues.qa.value,'3');assert.equal(template.parameters.count,undefined);
});
test('operational policy validates supported bounds and rejects unknown/prototype properties',()=>{
 assert.equal(validateOperations({maxNotificationRecipients:1000}).maxNotificationRecipients,1000);
 for(const input of [{maxNotificationRecipients:1001},{notificationCooldownSeconds:0},{adminEmailCooldownSeconds:59},{customNotificationsEnabled:'true'},{toString:'x'},{unknown:1}])assert.throws(()=>validateOperations(input));
 assert.equal(effectiveOperations({maxNotificationRecipients:-1}).maxNotificationRecipients,500);
});
test('custom announcements require content, scope, valid accounts and internal routes',()=>{
 assert.deepEqual(validateNotification({title:' QA ',body:' Body ',audience:'selected',uids:['alice','alice'],route:'/home'}).uids,['alice']);
 for(const bad of [{title:''},{body:'x'.repeat(1001)},{uids:[]},{uids:['../alice']},{route:'https://evil.test'},{audience:'arbitrary'}])assert.throws(()=>validateNotification({title:'QA',body:'Body',audience:'selected',uids:['alice'],...bad}));
 assert.equal(validateNotification({title:'QA',body:'Body',audience:'all'}).uids.length,0);
});
test('remote defaults are typed, secret-free and cannot mutate unknown fields or prototypes',()=>{
 const parameters={toggle:{valueType:'BOOLEAN',conditionalValues:{test:{value:'true'}},defaultValue:{value:'false'}},count:{valueType:'NUMBER'},schema:{valueType:'JSON'},allowed_emails_call:{},smtp_password:{}};
 assert.deepEqual(validateRemotePatch(parameters,{toggle:'true',count:'5',schema:'{"a":1}'}),{toggle:'true',count:'5',schema:'{"a":1}'});
 for(const patch of [{toggle:'yes'},{count:'NaN'},{schema:'{'},{allowed_emails_call:'bad'},{smtp_password:'secret'},{missing:'x'},{toString:'x'}])assert.throws(()=>validateRemotePatch(parameters,patch));
 assert.equal(remoteParameters({parameters}).some(p=>p.key==='smtp_password'),false);assert.equal(parameters.toggle.conditionalValues.test.value,'true');
});
