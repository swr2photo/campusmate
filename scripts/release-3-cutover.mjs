import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, deleteApp } from '../functions/node_modules/firebase-admin/lib/esm/app/index.js';
import { getFirestore, FieldValue } from '../functions/node_modules/firebase-admin/lib/esm/firestore/index.js';
import { buildPublicProfile, buildDiscoveryProfile } from '../functions/discoveryProfile.js';
import { migrateLegacyUser } from '../functions/matchingMigration.js';
const mode=process.argv[2]||'inspect';
if(!['inspect','migrate','projections'].includes(mode))throw Error('Unknown cutover step');
const credential={getAccessToken:async()=>{const c=JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE,'.config/configstore/firebase-tools.json'),'utf8'));return {access_token:c.tokens.access_token,expires_in:3600};}};
const app=initializeApp({projectId:'campusmate-7f1ab',credential});
const db=getFirestore(app);const summary={mode,users:0,verified:0,planned:0,written:0,secureStarted:0,discoveryRemoved:0};
try {
 let cursor;do{let q=db.collection('users').orderBy('__name__').limit(100);if(cursor)q=q.startAfter(cursor);let page=await q.get();
 for(const owner of page.docs){summary.users++;const data=owner.data();if(data.isFaceVerified===true)summary.verified++;
 if(mode==='inspect'||mode==='migrate'){const state=(await db.doc(`discoveryState/${owner.id}`).get()).data();if(state?.secureActionsStarted===true){summary.secureStarted++;continue;}const r=await migrateLegacyUser(db,owner.id,{apply:mode==='migrate',serverTimestamp:FieldValue.serverTimestamp});summary.planned+=r.planned;summary.written+=r.written;}
 if(mode==='projections'){const pub=buildPublicProfile(owner.id,data),projection=buildDiscoveryProfile(owner.id,pub);const batch=db.batch();batch.set(db.doc(`profiles/${owner.id}`),pub);if(projection)batch.set(db.doc(`discoveryProfiles/${owner.id}`),projection);else{batch.delete(db.doc(`discoveryProfiles/${owner.id}`));summary.discoveryRemoved++;}await batch.commit();}
 }cursor=page.size===100?page.docs.at(-1):null;}while(cursor);
 if(mode==='projections')await db.doc('app_config/discoveryRevision').set({updatedAt:FieldValue.serverTimestamp()},{merge:true});
 console.log(JSON.stringify(summary));
}finally{await db.terminate();await deleteApp(app);}
