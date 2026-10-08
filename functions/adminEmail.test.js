import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAdminEmail} from './adminEmail.js';
const firebaseLink=mode=>`https://campusmate-7f1ab.firebaseapp.com/__/auth/action?mode=${mode}&apiKey=test&oobCode=code`;
const calls=[],auth={generateEmailVerificationLink:async email=>{calls.push(['verify',email]);return firebaseLink('verifyEmail');},generatePasswordResetLink:async email=>{calls.push(['reset',email]);return firebaseLink('resetPassword');},generateVerifyAndChangeEmailLink:async(a,b)=>{calls.push(['change',a,b]);return firebaseLink('verifyAndChangeEmail');}};
const user={email:'6910210419@psu.ac.th',disabled:false,providerData:[{providerId:'password'}]};
test('verification resend supports already-verified accounts without changing credentials',async()=>{const message=await prepareAdminEmail({auth,user:{...user,emailVerified:true},kind:'verification'});assert.equal(message.to,user.email);assert.ok(message.html.includes('email-verified.html'));});
test('password reset uses branded hosted reset link',async()=>{const message=await prepareAdminEmail({auth,user,kind:'passwordReset'});assert.ok(message.text.includes('/reset.html?mode=resetPassword'));assert.equal(message.to,user.email);});
test('Google-only account cannot receive misleading password reset or password-account notice',async()=>{
const google={...user,providerData:[{providerId:'google.com'}]};await assert.rejects(prepareAdminEmail({auth,user:google,kind:'passwordReset'}),{code:'failed-precondition'});await assert.rejects(prepareAdminEmail({auth,user,kind:'googleNotice'}),{code:'failed-precondition'});
const notice=await prepareAdminEmail({auth,user:google,kind:'googleNotice'});assert.ok(notice.text.includes('Continue with Google'));
});
test('rejects disabled user, unsupported destination and arbitrary email kind',async()=>{for(const input of [{user:{...user,disabled:true},kind:'verification'},{user:{...user,email:'x@evil.test'},kind:'verification'},{user,kind:'custom'}])await assert.rejects(prepareAdminEmail({auth,...input}));});
test('campus resend only targets existing pending university address',async()=>{
 const gmail={...user,email:'student@gmail.com'};await assert.rejects(prepareAdminEmail({auth,user:gmail,kind:'campusChange'}),{code:'failed-precondition'});
 const message=await prepareAdminEmail({auth,user:gmail,kind:'campusChange',pendingEmail:user.email});assert.equal(message.to,user.email);assert.deepEqual(calls.at(-1),['change',gmail.email,user.email]);
});
