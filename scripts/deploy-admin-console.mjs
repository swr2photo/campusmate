import {cpSync,existsSync,mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),stage=path.join(root,'artifacts/admin-server-staging');
if(process.argv.slice(2).some(a=>a!=='--deploy'))throw new Error('Use --deploy or no argument');
mkdirSync(stage,{recursive:true});
for(const name of ['adminEntry.js','adminAccountDeletion.js','adminFunctions.js','adminPolicy.js','adminEmail.js','adminModeration.js','adminOperations.js','adminNotifications.js','notificationInbox.js','pushMessage.js','campusEmailMailer.js','brand-icon.png','package-lock.json','faceVerification.js'])cpSync(path.join(root,'functions',name),path.join(stage,name));
const manifest=JSON.parse(readFileSync(path.join(root,'functions/package.json'),'utf8'));manifest.main='adminEntry.js';
writeFileSync(path.join(stage,'package.json'),JSON.stringify(manifest,null,2));
if(!existsSync(path.join(stage,'node_modules')))symlinkSync(path.join(root,'functions/node_modules'),path.join(stage,'node_modules'),'junction');
writeFileSync(path.join(stage,'firebase.json'),JSON.stringify({functions:{source:'.',codebase:'default',runtime:'nodejs22',ignore:['node_modules','.git','firebase.json','*-debug.log']}},null,2));
console.log('Admin console staged.');
if(process.argv.includes('--deploy')){
 const args=['deploy','--config','artifacts/admin-server-staging/firebase.json','--only','functions:adminConsole','--project','campusmate-7f1ab','--non-interactive'];
 const result=process.platform==='win32'?spawnSync('cmd.exe',['/d','/s','/c',`firebase ${args.join(' ')}`],{cwd:root,stdio:'inherit'}):spawnSync('firebase',args,{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;process.exitCode=result.status===0?0:1;
}
