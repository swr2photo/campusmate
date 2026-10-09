import test from 'node:test';
import assert from 'node:assert/strict';
import {requireAdmin,validateReview,validateVersion,isSuperAdminEmail,SUPER_ADMIN_EMAILS} from './adminPolicy.js';
test('admin requires authenticated, verified, explicit server claim or superadmin email',()=>{
 for(const request of [{},{auth:{uid:'x',token:{admin:true}}},{auth:{uid:'x',token:{email_verified:true,role:'admin'}}},{auth:{uid:'x',token:{email_verified:true,admin:'true'}}}])assert.throws(()=>requireAdmin(request));
 assert.equal(requireAdmin({auth:{uid:'admin',token:{admin:true,email_verified:true}}}),'admin');
 assert.equal(isSuperAdminEmail('6710210317@psu.ac.th'), true);
 assert.equal(isSuperAdminEmail('other@psu.ac.th'), false);
 assert.equal(requireAdmin({auth:{uid:'superadmin',token:{email:'6710210317@psu.ac.th',email_verified:true}}}),'superadmin');
 assert.throws(()=>requireAdmin({auth:{uid:'superadmin',token:{email:'6710210317@psu.ac.th',email_verified:false}}}));
});
test('report closure requires reason and rejects unsupported states',()=>{
 assert.throws(()=>validateReview({status:'resolved',note:'  '}));assert.throws(()=>validateReview({status:'deleted',note:'reason'}));
 assert.deepEqual(validateReview({status:'resolved',note:' Reviewed '}),{status:'resolved',reviewNote:'Reviewed'});
});
test('version rejects unsupported writes, invalid URLs and unsafe force update',()=>{
 for(const config of [{admin:true},{latestVersion:'v2'},{snoozeHours:0},{playStoreWebUrl:'javascript:alert(1)'},{appStoreUrl:'https://example.com/app'},{forceUpdate:true},{latestVersion:'2.1.0',minVersion:'2.2.0'}])assert.throws(()=>validateVersion(config));
 assert.deepEqual(validateVersion({enabled:true,forceUpdate:true,playStorePublished:true,latestVersion:'2.1.7',minVersion:'2.1.0'}),{enabled:true,forceUpdate:true,playStorePublished:true,latestVersion:'2.1.7',minVersion:'2.1.0'});
});
