import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-campusmate',firestore:{rules:readFileSync('firestore.rules','utf8')}});
try{
 const alice=env.authenticatedContext('restriction-alice').firestore(),bob=env.authenticatedContext('restriction-bob').firestore();
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users','restriction-alice'),{id:'restriction-alice',name:'Alice'});await setDoc(doc(db,'accountRestrictions','restriction-alice'),{latestWarning:{id:'notice',message:'test'}});});
 await assertSucceeds(getDoc(doc(alice,'users','restriction-alice')));
 await assertSucceeds(getDoc(doc(alice,'accountRestrictions','restriction-alice')));
 await assertFails(getDoc(doc(bob,'accountRestrictions','restriction-alice')));
 await assertFails(setDoc(doc(alice,'accountRestrictions','restriction-alice'),{suspended:false}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'accountRestrictions','restriction-alice'),{suspended:true}));
 await assertFails(getDoc(doc(alice,'users','restriction-alice')));
 await assertSucceeds(getDoc(doc(alice,'accountRestrictions','restriction-alice')));
 await assertFails(updateDoc(doc(alice,'users','restriction-alice'),{name:'Escape'}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'accountRestrictions','restriction-alice'),{suspended:false}));
 await assertSucceeds(getDoc(doc(alice,'users','restriction-alice')));
 console.log('PASS restrictions: owner warning access, other-user denial, immutable restrictions, suspension with old token, restoration');
}finally{await env.cleanup();}
