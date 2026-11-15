import fs from 'node:fs/promises';
let config;try{config=JSON.parse(await fs.readFile('public/project-config.json','utf8'));}catch{}
const uid=config?.ownerUid;
const sharedUid=config?.sharedAccountUid;
if(typeof uid!=='string'||!uid||typeof sharedUid!=='string'||!sharedUid){
  await fs.writeFile('firestore.rules',"rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read,write: if false; } } }\n");
  console.log('Owner setup incomplete: retained deny-all rules.');
}else{
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid))throw new Error('Invalid owner UID');
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(sharedUid)||sharedUid===uid)throw new Error('Invalid shared account UID');
  const template=await fs.readFile('rules/school.rules.template','utf8');
  await fs.writeFile('firestore.rules',template.replaceAll('__OWNER_UID__',uid).replaceAll('__SHARED_UID__',sharedUid));
  console.log('Generated rules for the owner and dedicated password identity.');
}
