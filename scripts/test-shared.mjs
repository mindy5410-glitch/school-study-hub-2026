import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocFromServer,getDocs,writeBatch,setDoc,deleteDoc,serverTimestamp,setLogLevel} from 'firebase/firestore';
import {makeFixture} from './synthetic-fixture.mjs';

// Run ONLY against the local demo project. No production project or roster read.
const projectId=`demo-school-hub-${Date.now()}`;
const out=path.resolve('.sites-runtime/test-compiled/lib');
await fs.mkdir(out,{recursive:true});
for(const name of ['domain','attendance-form','mutations','initial-data-digest','cloud-model','firebase-runtime','shared-client','teacher-access']){
  const source=await fs.readFile(`lib/${name}.ts`,'utf8');
  let compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
  await fs.writeFile(path.join(out,name+'.mjs'),compiled);
}
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')).href);
const domain=await load('domain'),{buildCloudConfig,cloudSchedule}=await load('cloud-model'),{createSharedClient}=await load('shared-client');
const {attendanceChanges,attendanceResetChanges}=await load('attendance-form');
const {watchWorkspaceAccess}=await load('teacher-access');
globalThis.window={dispatchEvent(){}};
setLogLevel('silent');
const rules=(await fs.readFile('rules/school.rules.template','utf8')).replaceAll('__OWNER_UID__','owner-test').replaceAll('__SHARED_UID__','shared-test');
const emulatorPort=Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').pop()??8180);
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:emulatorPort,rules}});
const token=email=>({email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const owner=env.authenticatedContext('owner-test',token('owner@example.test')).firestore();
const passwordToken={email:'shared@example.test',email_verified:false,auth_time:100,firebase:{sign_in_provider:'password'}};
const teacher=env.authenticatedContext('shared-test',passwordToken).firestore();
const clients=[];let checks=0,stopAccess=()=>{};
async function ok(label,fn){await fn();checks++;console.log('PASS '+label);}
const state=makeFixture(domain);
async function read(db,p){return (await getDoc(doc(db,p))).data();}
async function rawAttendance(overrides={},options={}){
  const target=options.db??owner,uid=options.uid??'owner-test',actorName=options.actorName??'관리자';
  const h=await read(owner,'school/live'),at=serverTimestamp(),logRef=doc(collection(target,'history'));
  const d={studentId:'1-1',date:'2026-11-30',period:2,room:1,status:'present',note:'',updatedAt:at,updatedBy:uid,actorName,revision:h.revision+1,...overrides};
  const log={revision:d.revision,kind:'attendance',date:d.date,room:d.room,period:d.period,firstStudentId:d.studentId,actorUid:uid,actorName,createdAt:at,...options.log};
  const batch=writeBatch(target);batch.set(doc(target,'attendance',`${d.date}|${d.studentId}|${d.period}`),d);batch.set(logRef,log);batch.update(doc(target,'school/live'),{revision:h.revision+1,updatedAt:at,updatedBy:uid,lastLog:logRef.id});return batch.commit();
}
async function rawSchedule(id,to,extra={}){
  const h=await read(owner,'school/live'),s=await read(owner,'school/schedule'),at=serverTimestamp(),logRef=doc(collection(owner,'history'));
  const from=s.assignments[id],slot=state.assignments.find(a=>a.id===id),counts={...s.counts,[from]:s.counts[from]-1,[to]:s.counts[to]+1};
  const batch=writeBatch(owner);batch.set(doc(owner,'school/schedule'),{...s,assignments:{...s.assignments,[id]:to},counts,revision:h.revision+1,updatedAt:at,updatedBy:'owner-test',...extra});
  batch.set(logRef,{revision:h.revision+1,kind:'schedule',date:slot.date,room:slot.room,period:slot.period,assignmentId:id,fromTeacher:from,toTeacher:to,swapId:'',reason:'가상 검증',actorUid:'owner-test',actorName:'관리자',createdAt:at});
  batch.update(doc(owner,'school/live'),{revision:h.revision+1,updatedAt:at,updatedBy:'owner-test',lastLog:logRef.id});return batch.commit();
}
async function rawRoster(input={},options={}){
  const target=options.db??owner,uid=options.uid??'owner-test',actorName=options.actorName??'관리자';
  const date=input.date??'2026-11-30',studentId=input.studentId??state.students.find(s=>!state.participants.some(p=>p.studentId===s.id)).id,room=input.room??1,startPeriod=input.startPeriod??1,endPeriod=input.endPeriod??6,action=input.action??'add';
  const h=await read(owner,'school/live'),previous=await read(owner,`dailyRosters/${date}`),at=serverTimestamp(),logRef=doc(collection(target,'history'));
  const students={...previous?.students};if(action==='add')students[studentId]={room,startPeriod,endPeriod,addedRevision:h.revision+1,...options.entry};else delete students[studentId];
  const record={date,students,revision:h.revision+1,updatedAt:at,updatedBy:uid,actorName,lastStudentId:studentId,lastAction:action,...options.document};
  const log={revision:h.revision+1,kind:'roster',date,room,period:startPeriod,endPeriod,studentId,action,actorUid:uid,actorName,createdAt:at,...options.log};
  const batch=writeBatch(target);batch.set(doc(target,'dailyRosters',options.docId??date),record);batch.set(logRef,log);batch.update(doc(target,'school/live'),{revision:h.revision+1,updatedAt:at,updatedBy:uid,lastLog:logRef.id});return batch.commit();
}
async function rawRosterBatch(studentId,entries,options={}){
  const target=options.db??owner,uid=options.uid??'owner-test',actorName=options.actorName??'관리자',action=options.action??'add';
  const h=await read(owner,'school/live'),at=serverTimestamp(),logRef=doc(collection(target,'history')),anchor=entries[0],batch=writeBatch(target);
  const old=await Promise.all(entries.map(e=>read(owner,`dailyRosters/${e.date}`)));
  entries.forEach((e,i)=>{const students={...old[i]?.students};if(action==='add')students[studentId]={room:e.room,startPeriod:e.startPeriod,endPeriod:e.endPeriod,addedRevision:h.revision+1};else delete students[studentId];batch.set(doc(target,'dailyRosters',e.date),{date:e.date,students,revision:h.revision+1,updatedAt:at,updatedBy:uid,actorName,lastStudentId:studentId,lastAction:action,...options.document});});
  batch.set(logRef,{revision:h.revision+1,kind:'roster-batch',date:anchor.date,room:anchor.room,period:anchor.startPeriod,endPeriod:anchor.endPeriod,studentId,action,entries:Object.fromEntries(entries.map(e=>[e.date,`${e.room}:${e.startPeriod}:${e.endPeriod}`])),actorUid:uid,actorName,createdAt:at,...options.log});
  batch.update(doc(target,'school/live'),{revision:h.revision+1,updatedAt:at,updatedBy:uid,lastLog:logRef.id});return batch.commit();
}
async function snapshot(c){const r=await c.request('/api/state');assert.equal(r.status,200,await r.clone().text());return r.json();}
async function waitRevision(c,revision){const until=Date.now()+12000;while(Date.now()<until){if(c.snapshot()?.revision>=revision)return c.snapshot();await new Promise(r=>setTimeout(r,25));}throw new Error('Second client did not receive committed revision');}
const post=(c,body)=>c.request('/api/mutate',{method:'POST',body:JSON.stringify(body)});
try{
  await ok('owner bootstrap uses real rules',async()=>{
    const at=serverTimestamp(),batch=writeBatch(owner);
    batch.set(doc(owner,'security/shared'),{enabled:true,validAfter:0,updatedAt:at,updatedBy:'owner-test'});
    batch.set(doc(owner,'school/config'),buildCloudConfig(state,'owner-test',at));
    batch.set(doc(owner,'school/schedule'),cloudSchedule(state,'owner-test',at));
    batch.set(doc(owner,'school/live'),{revision:0,updatedAt:at,updatedBy:'owner-test',lastLog:''});
    await assertSucceeds(batch.commit());
  });
  await ok('anonymous, unregistered, unverified and wrong provider denied',async()=>{
    const contexts=[env.unauthenticatedContext(),env.authenticatedContext('stranger',token('stranger@example.test')),env.authenticatedContext('owner-test',{...token('owner@example.test'),email_verified:false}),env.authenticatedContext('another-password-user',passwordToken),env.authenticatedContext('shared-test',token('shared@example.test')),env.authenticatedContext('shared-test',{...passwordToken,firebase:{sign_in_provider:'anonymous'}}),env.authenticatedContext('owner-test',passwordToken)];
    for(const c of contexts){const db=c.firestore();await assertFails(getDoc(doc(db,'school/config')));await assertFails(getDocs(collection(db,'attendance')));await assertFails(getDocs(collection(db,'dailyRosters')));}
  });
  await ok('dedicated password account reads school data without an email grant',async()=>{
    await assertSucceeds(getDocFromServer(doc(teacher,'school/config')));
    await assertSucceeds(getDoc(doc(teacher,'security/shared')));
    await assertFails(getDocs(collection(teacher,'access')));
    await assertFails(getDoc(doc(teacher,'access/owner@example.test')));
    await assertFails(setDoc(doc(teacher,'access/stranger@example.test'),{enabled:true,isAdmin:true}));
    await assertFails(setDoc(doc(teacher,'security/shared'),{enabled:true,validAfter:0,updatedAt:serverTimestamp(),updatedBy:'shared-test'}));
    await assertFails(setDoc(doc(owner,'security/shared'),{enabled:true,validAfter:0,updatedAt:serverTimestamp(),updatedBy:'owner-test',isAdmin:true}));
  });
  const syntheticToken='e30.'+Buffer.from(JSON.stringify({auth_time:100,iat:100,exp:4102444800,firebase:{sign_in_provider:'password'}})).toString('base64url')+'.synthetic';
  const ownUser={uid:'owner-test',email:'owner@example.test'},teacherUser={uid:'shared-test',email:'shared@example.test',emailVerified:false,providerData:[{providerId:'password'}],getIdToken:async()=>syntheticToken};
  const first=createSharedClient(owner,{currentUser:ownUser},ownUser,'관리자',true,()=>{}),second=createSharedClient(teacher,{currentUser:teacherUser},teacherUser,'공용 접속',false,()=>{});clients.push(first,second);
  // Match App's gate watcher: suspending access discards the shared client.
  stopAccess=watchWorkspaceAccess(teacher,teacherUser,{ownerUid:'owner-test',sharedAccountUid:'shared-test'},role=>{if(!role)second.dispose();},()=>second.dispose());
  await ok('both actual shared clients initialize from server',async()=>{assert.equal((await snapshot(first)).revision,0);assert.equal((await snapshot(second)).revision,0);});
  await ok('attendance edit broadcasts and reversible clear uses tombstone',async()=>{
    let s=await snapshot(first);let r=await post(first,{kind:'attendance',date:'2026-11-30',room:1,period:1,changes:[{studentId:'1-1',status:'present',note:'가상 확인'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());
    s=await r.json();await waitRevision(second,s.revision);assert.equal(second.snapshot().state.attendance['2026-11-30|1-1|1'].status,'present');
    r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:1,changes:[{studentId:'1-1',status:'late',note:'가상 수정'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    r=await post(first,{kind:'attendance',date:'2026-11-30',room:1,period:1,changes:[{studentId:'1-1',status:null,note:''}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(second,s.revision);assert.equal(second.snapshot().state.attendance['2026-11-30|1-1|1'],undefined);assert.equal((await read(owner,'attendance/2026-11-30|1-1|1')).status,'unrecorded');
  });
  await ok('whole class of 28 attendance records saves atomically',async()=>{
    const s=await snapshot(second),changes=s.state.participants.filter(p=>p.date==='2026-11-30'&&p.room===1).map(p=>({studentId:p.studentId,status:'present',note:''}));assert.equal(changes.length,28);
    const r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:3,changes,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());await waitRevision(first,(await r.json()).revision);assert.equal(Object.values(first.snapshot().state.attendance).filter(a=>a.period===3).length,28);
  });
  await ok('absent defaults keep half-day pupils and share an explicit present choice',async()=>{
    const s=await snapshot(second),date='2026-11-30';
    assert.ok(attendanceChanges(s.state,date,1,5).every(c=>c.status==='absent'));
    const changes=attendanceChanges(s.state,date,1,5,{'3-1':{status:'present',note:'등교 확인'}});
    assert.equal(changes.length,28);assert.ok(changes.every(c=>['present','absent'].includes(c.status)));
    assert.equal(changes.find(c=>c.studentId==='1-1').status,'absent');assert.equal(changes.find(c=>c.studentId==='3-1').status,'present');
    const r=await post(second,{kind:'attendance',date,room:1,period:5,changes,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());const next=await r.json();await waitRevision(first,next.revision);
    for(const client of [first,second]){const n=client.snapshot().state;assert.equal(domain.getRecord(n,'1-1',date,5).status,'absent');assert.equal(domain.getRecord(n,'3-1',date,5).status,'present');assert.equal(domain.getRecord(n,'3-1',date,5).note,'등교 확인');assert.equal(domain.expectedStatus(n,'1-1',date,5),'experience');assert.equal(domain.roomRoster(n,date,1).length,28);assert.deepEqual(attendanceChanges(n,date,1,5),[]);}
  });
  await ok('whole-period reset clears 28 statuses and notes, broadcasts, and can be undone',async()=>{
    let s=await snapshot(second);
    let r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:3,changes:[{studentId:'1-1',status:'absent',note:'가상 결석 메모'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'attendance',date:'2026-11-30',room:2,period:3,changes:[{studentId:'2-1',status:'late',note:'다른 반 보존'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    const changes=attendanceResetChanges(s.state,'2026-11-30',1,3);assert.equal(changes.length,28);
    const ids=new Set(changes.map(c=>domain.recordKey('2026-11-30',c.studentId,3))),unaffected=Object.entries(s.state.attendance).filter(([id])=>!ids.has(id));
    const previous=changes.map(c=>{const a=domain.getRecord(s.state,c.studentId,'2026-11-30',3);return {studentId:c.studentId,status:a.status,note:a.note};});
    r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:3,changes,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const id of ids){assert.equal(s.state.attendance[id],undefined);assert.equal(first.snapshot().state.attendance[id],undefined);}
    for(const [id,a] of unaffected)assert.deepEqual(s.state.attendance[id],a);
    for(const c of changes){const raw=await read(owner,`attendance/2026-11-30|${c.studentId}|3`);assert.equal(raw.status,'unrecorded');assert.equal(raw.note,'');assert.equal(raw.revision,s.revision);}
    assert.deepEqual(attendanceResetChanges(s.state,'2026-11-30',1,3),[]);
    r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:3,changes:previous,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const c of previous){const a=domain.getRecord(first.snapshot().state,c.studentId,'2026-11-30',3);assert.equal(a.status,c.status);assert.equal(a.note,c.note);}
  });
  await ok('a whole-period reset and a concurrent edit cannot overwrite each other',async()=>{
    const s=await snapshot(first);await waitRevision(second,s.revision);
    const context={kind:'attendance',date:'2026-11-30',room:1,period:3,baseRevision:s.revision},changes=attendanceResetChanges(s.state,context.date,1,3);assert.equal(changes.length,28);
    const responses=await Promise.all([post(first,{...context,changes}),post(second,{...context,changes:[{studentId:'1-1',status:'late',note:'가상 동시 변경'}]})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);await waitRevision(first,s.revision+1);await waitRevision(second,s.revision+1);
    const stale=await post(first,{...context,changes});assert.equal(stale.status,409);
    if(responses[0].ok)assert.equal(attendanceResetChanges(first.snapshot().state,context.date,1,3).length,0);else assert.equal(domain.getRecord(first.snapshot().state,'1-1',context.date,3).note,'가상 동시 변경');
  });
  await ok('simultaneous saves keep one commit and return 409 to the other',async()=>{
    const s=await snapshot(first);await waitRevision(second,s.revision);const body={kind:'attendance',date:'2026-11-30',room:1,period:2,changes:[{studentId:'3-1',status:'present',note:''}],baseRevision:s.revision};
    const results=await Promise.all([post(first,body),post(second,{...body,changes:[{studentId:'1-1',status:'late',note:''}]})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(await Promise.all(results.map(async r=>({status:r.status,error:(await r.clone().json()).error})))));await waitRevision(first,s.revision+1);await waitRevision(second,s.revision+1);assert.equal(first.snapshot().revision,s.revision+1);
  });
  await ok('valid timetable swap commits without changing teacher load',async()=>{
    const s=await snapshot(first);let choice;
    for(const a of s.state.assignments){for(const b of s.state.assignments){if(a.id===b.id||a.teacherId===b.teacherId)continue;const next=s.state.assignments.map(x=>x.id===a.id?{...x,teacherId:b.teacherId}:x.id===b.id?{...x,teacherId:a.teacherId}:x);if(!domain.scheduleErrors(s.state,next).length){choice={a,b};break;}}if(choice)break;}
    assert.ok(choice);const r=await post(first,{kind:'schedule',assignmentId:choice.a.id,teacherId:choice.b.teacherId,swapId:choice.b.id,reason:'가상 맞교환',baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());const n=await r.json();await waitRevision(second,n.revision);assert.equal(second.snapshot().state.assignments.find(a=>a.id===choice.a.id).teacherId,choice.b.teacherId);
  });
  await ok('two browsers using the same password identity cannot overwrite each other',async()=>{
    const anotherDb=env.authenticatedContext('shared-test',passwordToken).firestore();
    const third=createSharedClient(anotherDb,{currentUser:teacherUser},teacherUser,'공용 접속',false,()=>{});
    try{
      await snapshot(third);const s=await snapshot(second);await waitRevision(third,s.revision);
      const body={kind:'attendance',date:'2026-11-30',room:1,period:6,changes:[{studentId:'3-1',status:'present',note:''}],baseRevision:s.revision};
      const results=await Promise.all([post(second,body),post(third,{...body,changes:[{studentId:'1-1',status:'experience',note:''}]})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);await waitRevision(first,s.revision+1);await waitRevision(second,s.revision+1);
    }finally{third.dispose();}
  });
  await ok('valid single timetable change commits with correct counts',async()=>{
    const s=await snapshot(first);let choice;
    for(const a of s.state.assignments){for(const t of s.state.teachers){if(a.teacherId===t.id||!a.teacherId.match(/teacher(0[5-9]|1[0-3])/))continue;const next=s.state.assignments.map(x=>x.id===a.id?{...x,teacherId:t.id}:x);if(!domain.scheduleErrors(s.state,next).length){choice={a,t};break;}}if(choice)break;}
    assert.ok(choice);const r=await post(first,{kind:'schedule',assignmentId:choice.a.id,teacherId:choice.t.id,reason:'가상 변경',baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());await waitRevision(second,(await r.json()).revision);
  });
  await ok('server rejects lesson overlap, simultaneous duty and quota overflow',async()=>{
    const s=await read(owner,'school/schedule');
    const blockedSlot=state.assignments.find(a=>state.days.find(d=>d.date===a.date).weekday==='수'&&a.period===2&&s.assignments[a.id]!=='teacher06');assert.ok(blockedSlot);await assertFails(rawSchedule(blockedSlot.id,'teacher06'));
    const a=state.assignments.find(x=>x.room===1&&x.date==='2026-11-30'),parallel=state.assignments.find(x=>x.date===a.date&&x.period===a.period&&x.room===2);await assertFails(rawSchedule(a.id,s.assignments[parallel.id]));
    const slot=state.assignments.find(x=>s.assignments[x.id]!=='teacher01');await assertFails(rawSchedule(slot.id,'teacher01'));
  });
  await ok('server rejects excluded day, wrong period, pupil, field, note and identity',async()=>{
    for(const patch of [{date:'2026-12-11'},{period:7},{studentId:'2-1'},{note:'x'.repeat(301)},{status:'forged'},{isAdmin:true},{updatedBy:'teacher-test'},{actorName:'다른 교사'},{revision:999}])await assertFails(rawAttendance(patch));
    await assertFails(rawAttendance({},{log:{firstStudentId:'13-24'}}));
  });
  await ok('password holder cannot impersonate administrator in saved records',async()=>{
    await assertFails(rawAttendance({actorName:'관리자'},{db:teacher,uid:'shared-test',actorName:'공용 접속'}));
  });
  const newPupils=state.students.filter(s=>!state.participants.some(p=>p.studentId===s.id)).slice(0,8);
  const extraBody=(studentId,date='2026-11-30',room=1)=>({kind:'roster',action:'add',date,room,studentId,startPeriod:2,endPeriod:6});
  await ok('additional pupil broadcasts to both clients without changing the original plan',async()=>{
    const s=await snapshot(second),r=await post(second,{...extraBody(newPupils[0].id),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());const n=await r.json();await waitRevision(first,n.revision);
    const p=first.snapshot().state.additionalParticipants.find(p=>p.studentId===newPupils[0].id&&p.date==='2026-11-30');assert.equal(p.room,1);assert.equal(p.startPeriod,2);assert.equal(p.endPeriod,6);
    assert.ok(domain.roomRoster(first.snapshot().state,'2026-11-30',1).some(s=>s.id===newPupils[0].id));assert.equal(domain.expectedStatus(first.snapshot().state,newPupils[0].id,'2026-11-30',1),'experience');assert.equal(domain.expectedStatus(first.snapshot().state,newPupils[0].id,'2026-11-30',2),'present');
    assert.equal(first.snapshot().state.participants.length,state.participants.length);assert.equal(domain.dayParticipants(first.snapshot().state,'2026-11-30').find(p=>p.studentId===newPupils[0].id).room,1);
  });
  await ok('added pupil attendance saves and a later undo cannot hide confirmed records',async()=>{
    let s=await snapshot(first);let r=await post(first,{kind:'attendance',date:'2026-11-30',room:1,period:2,changes:[{studentId:newPupils[0].id,status:'present',note:'가상 추가 출석'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(second,s.revision);assert.equal(domain.getRecord(second.snapshot().state,newPupils[0].id,'2026-11-30',2).status,'present');
    r=await post(second,{...extraBody(newPupils[0].id),action:'remove',baseRevision:s.revision});assert.equal(r.status,422,await r.text());await assertFails(rawRoster({...extraBody(newPupils[0].id),action:'remove'}));
  });
  await ok('whole-period reset keeps additional pupils on both attendance and original-class rosters',async()=>{
    let s=await snapshot(second);const additions=structuredClone(s.state.additionalParticipants);
    const changes=attendanceResetChanges(s.state,'2026-11-30',1,2);assert.ok(changes.some(c=>c.studentId===newPupils[0].id));
    const r=await post(second,{kind:'attendance',date:'2026-11-30',room:1,period:2,changes,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const client of [first,second]){const next=client.snapshot().state;assert.equal(domain.getRecord(next,newPupils[0].id,'2026-11-30',2),undefined);assert.deepEqual(next.additionalParticipants,additions);assert.ok(domain.roomRoster(next,'2026-11-30',1).some(p=>p.id===newPupils[0].id));assert.equal(domain.dayParticipants(next,'2026-11-30').find(p=>p.studentId===newPupils[0].id).room,1);}
  });
  await ok('immediate roster undo and attendance on an initially empty school day work',async()=>{
    let s=await snapshot(second);let r=await post(second,{...extraBody(newPupils[1].id,'2026-12-17'),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    r=await post(first,{...extraBody(newPupils[1].id,'2026-12-17'),action:'remove',baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(second,s.revision);assert.ok(!second.snapshot().state.additionalParticipants.some(p=>p.studentId===newPupils[1].id));
    r=await post(second,{...extraBody(newPupils[1].id,'2026-12-17'),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    r=await post(first,{kind:'attendance',date:'2026-12-17',room:1,period:2,changes:[{studentId:newPupils[1].id,status:'present',note:''}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(second,s.revision);assert.equal(domain.getRecord(second.snapshot().state,newPupils[1].id,'2026-12-17',2).status,'present');
  });
  await ok('concurrent additions cannot place the same pupil in two rooms',async()=>{
    const s=await snapshot(first);await waitRevision(second,s.revision);const body={...extraBody(newPupils[2].id),baseRevision:s.revision};const results=await Promise.all([post(first,body),post(second,{...body,room:2})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);await waitRevision(first,s.revision+1);await waitRevision(second,s.revision+1);assert.equal(first.snapshot().state.additionalParticipants.filter(p=>p.date===body.date&&p.studentId===body.studentId).length,1);
    const r=await post(first,{...body,baseRevision:s.revision+1});assert.equal(r.status,400,await r.text());
  });
  await ok('server rejects malformed, duplicate, unknown and forged roster updates',async()=>{
    const id=newPupils[3].id;
    for(const patch of [{studentId:'missing'},{studentId:'1-1'},{studentId:newPupils[0].id},{date:'2026-12-11'},{date:'2026-12-17',room:2},{room:3},{startPeriod:0},{endPeriod:7},{startPeriod:6,endPeriod:2},{startPeriod:'1'}])await assertFails(rawRoster({studentId:id,...patch}));
    await assertFails(rawRoster({studentId:id},{entry:{isAdmin:true}}));await assertFails(rawRoster({studentId:id},{document:{isAdmin:true}}));await assertFails(rawRoster({studentId:id},{entry:{addedRevision:0}}));await assertFails(rawRoster({studentId:id},{log:{studentId:newPupils[4].id}}));await assertFails(rawRoster({studentId:id},{docId:'2026-11-29'}));
    await assertFails(rawRoster({studentId:id},{db:teacher,uid:'shared-test',actorName:'관리자'}));
    const old=(await read(owner,'dailyRosters/2026-11-30')).students,h=await read(owner,'school/live');await assertFails(rawRoster({studentId:id},{document:{students:{...old,[id]:{room:1,startPeriod:1,endPeriod:6,addedRevision:h.revision+1},[newPupils[4].id]:{room:1,startPeriod:1,endPeriod:6,addedRevision:h.revision+1}}}}));
    await assertFails(rawAttendance({studentId:newPupils[5].id}));await assertFails(deleteDoc(doc(owner,'dailyRosters/2026-11-30')));
  });
  const batchPupils=state.students.filter(s=>!state.participants.some(p=>p.studentId===s.id)).slice(-4);
  const entriesFor=dates=>dates.map(date=>({date,room:date<='2026-12-01'?2:1,startPeriod:1,endPeriod:state.days.find(d=>d.date===date).periods}));
  const batchDays=[{date:'2026-11-30',room:2,startPeriod:2,endPeriod:4},{date:'2026-12-01',room:2,startPeriod:5,endPeriod:7},{date:'2026-12-17',room:1,startPeriod:1,endPeriod:3}];
  const batchBody=(id,entries=batchDays)=>({kind:'roster-batch',action:'add',studentId:id,entries});
  await ok('multiple roster dates share one revision, both clients, and immediate whole-batch undo',async()=>{
    let s=await snapshot(second),r=await post(second,{...batchBody(batchPupils[0].id),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());let next=await r.json();assert.equal(next.revision,s.revision+1);await waitRevision(first,next.revision);
    for(const client of [first,second])for(const e of batchDays){const n=client.snapshot().state,p=n.additionalParticipants.find(p=>p.studentId===batchPupils[0].id&&p.date===e.date);assert.deepEqual(p,{studentId:batchPupils[0].id,...e,addedRevision:next.revision});assert.ok(domain.dayParticipants(n,e.date).some(p=>p.studentId===batchPupils[0].id&&p.room===e.room));assert.equal(domain.expectedStatus(n,batchPupils[0].id,e.date,e.startPeriod),'present');assert.equal(domain.expectedStatus(n,batchPupils[0].id,e.date,e.endPeriod),'present');if(e.startPeriod>1)assert.equal(domain.expectedStatus(n,batchPupils[0].id,e.date,e.startPeriod-1),'experience');if(e.endPeriod<state.days.find(d=>d.date===e.date).periods)assert.equal(domain.expectedStatus(n,batchPupils[0].id,e.date,e.endPeriod+1),'experience');}
    const head=await read(owner,'school/live'),log=await read(owner,`history/${head.lastLog}`);assert.equal(log.kind,'roster-batch');assert.deepEqual(log.entries,Object.fromEntries(batchDays.map(e=>[e.date,`${e.room}:${e.startPeriod}:${e.endPeriod}`])));
    r=await post(first,{...batchBody(batchPupils[0].id),action:'remove',baseRevision:next.revision});assert.equal(r.status,200,await r.clone().text());next=await r.json();await waitRevision(second,next.revision);assert.ok(!second.snapshot().state.additionalParticipants.some(p=>p.studentId===batchPupils[0].id));
  });
  await ok('an invalid or already registered date cannot leave a partial multi-day addition',async()=>{
    let s=await snapshot(first),r=await post(first,{...extraBody(batchPupils[0].id,'2026-12-17'),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(first,{...batchBody(batchPupils[0].id),baseRevision:s.revision});assert.equal(r.status,400,await r.text());assert.equal(first.snapshot().revision,s.revision);assert.ok(!first.snapshot().state.additionalParticipants.some(p=>p.studentId===batchPupils[0].id&&p.date==='2026-11-30'));
    r=await post(first,{...batchBody(batchPupils[3].id,[batchDays[0],{...batchDays[1],date:'2026-12-11'}]),baseRevision:s.revision});assert.equal(r.status,400,await r.text());assert.ok(!first.snapshot().state.additionalParticipants.some(p=>p.studentId===batchPupils[3].id));
  });
  await ok('all 20 selected dates add and undo atomically with the shared password identity',async()=>{
    let s=await snapshot(second);await waitRevision(second,first.snapshot().revision);s=await snapshot(second);const entries=entriesFor(state.days.map(d=>d.date)),body=batchBody(batchPupils[1].id,entries);
    let r=await post(second,{...body,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    const added=s.state.additionalParticipants.filter(p=>p.studentId===batchPupils[1].id);assert.equal(added.length,20);assert.ok(added.every(p=>p.addedRevision===s.revision));
    r=await post(second,{...body,action:'remove',baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);assert.ok(!first.snapshot().state.additionalParticipants.some(p=>p.studentId===batchPupils[1].id));
    r=await post(second,{...body,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'attendance',date:'2026-12-17',room:1,period:1,changes:[{studentId:batchPupils[1].id,status:'present',note:'다중 날짜 출석'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    r=await post(second,{...body,action:'remove',baseRevision:s.revision});assert.equal(r.status,422,await r.text());assert.equal(second.snapshot().state.additionalParticipants.filter(p=>p.studentId===batchPupils[1].id).length,20);assert.equal(domain.getRecord(second.snapshot().state,batchPupils[1].id,'2026-12-17',1).note,'다중 날짜 출석');
  });
  await ok('simultaneous multi-day additions never split or overwrite one another',async()=>{
    const s=await snapshot(first);await waitRevision(second,s.revision);const a=batchBody(batchPupils[2].id),b=batchBody(batchPupils[2].id,entriesFor(['2026-12-02','2026-12-18']));
    const responses=await Promise.all([post(first,{...a,baseRevision:s.revision}),post(second,{...b,baseRevision:s.revision})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);await waitRevision(first,s.revision+1);await waitRevision(second,s.revision+1);
    const wanted=(responses[0].ok?a:b).entries.map(e=>e.date).sort(),actual=first.snapshot().state.additionalParticipants.filter(p=>p.studentId===batchPupils[2].id).map(p=>p.date).sort();assert.deepEqual(actual,wanted);
  });
  await ok('raw batch rules reject malformed non-anchor metadata and forged writes without partial effects',async()=>{
    const id=batchPupils[3].id,s=await snapshot(first),valid=Object.fromEntries(batchDays.map(e=>[e.date,`${e.room}:${e.startPeriod}:${e.endPeriod}`]));
    for(const entries of [{...valid,'2026-12-17':'1:0:6'},{...valid,'2026-12-17':'2:1:6'},{...valid,'2026-12-11':'1:1:6'},{...valid,'2026-12-17':{room:1,startPeriod:1,endPeriod:6}}])await assertFails(rawRosterBatch(id,batchDays,{log:{entries}}));
    await assertFails(rawRosterBatch(id,batchDays,{log:{actorName:'공용 접속'}}));await assertFails(rawRosterBatch(id,batchDays,{document:{isAdmin:true}}));
    assert.equal((await read(owner,'school/live')).revision,s.revision);for(const e of batchDays)assert.ok(!(await read(owner,`dailyRosters/${e.date}`)).students[id]);
  });
  await ok('added ranges change duty counts and missing coverage can be filled incrementally',async()=>{
    let s=await snapshot(second);const date='2026-12-18',studentId=newPupils[6].id,beforeCount=domain.expectedCount(s.state,date,1,2),beforeThird=domain.expectedCount(s.state,date,1,3);
    let r=await post(second,{kind:'roster',action:'add',date,room:1,studentId,startPeriod:3,endPeriod:4,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const client of [first,second]){const n=client.snapshot().state;assert.equal(domain.expectedCount(n,date,1,2),beforeCount);assert.equal(domain.expectedCount(n,date,1,3),beforeThird+1);assert.ok(domain.missingDuties(n).some(x=>x.date===date&&x.period===3));}
    const teacherId=s.state.teachers.find(t=>!domain.scheduleErrors(s.state,[...s.state.assignments,{id:`${date}-1-3`,date,room:1,period:3,teacherId:t.id,extra:true}],{requireCoverage:false}).length)?.id;assert.ok(teacherId);
    r=await post(second,{kind:'coverage',date,room:1,period:3,teacherId,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    assert.equal(first.snapshot().state.assignments.find(a=>a.id===`${date}-1-3`).extra,true);assert.ok(!domain.missingDuties(s.state).some(x=>x.date===date&&x.period===3));assert.ok(domain.missingDuties(s.state).some(x=>x.date===date&&x.period===4));
    const original=await read(owner,'school/schedule'),extra=await read(owner,'school/extraSchedule');assert.equal(original.assignments[`${date}-1-3`],undefined);assert.equal(extra.assignments[`${date}-1-3`],teacherId);
    r=await post(second,{kind:'coverage',date:'2026-12-23',room:1,period:2,teacherId:'teacher06',baseRevision:s.revision});assert.equal(r.status,422,await r.text());
    r=await post(second,{kind:'coverage',date,room:1,period:4,teacherId:'teacher01',baseRevision:s.revision});assert.equal(r.status,422,await r.text());
    r=await post(second,{kind:'coverage',date,room:1,period:3,teacherId:'',baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);assert.ok(!first.snapshot().state.assignments.some(a=>a.id===`${date}-1-3`));
  });
  await ok('per-period undo survives reload and unrelated revisions, then cannot run twice',async()=>{
    let s=await snapshot(second);const context={date:'2026-12-01',room:1,period:6},key=domain.periodKey(context.date,1,6),changes=[{studentId:'3-1',status:'present',note:'보존할 메모'},{studentId:'1-1',status:'absent',note:'결석 확인'}];
    let r=await post(second,{kind:'attendance',action:'save',...context,changes,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();const firstRevision=s.revision;
    assert.equal(s.attendanceUndo[key].revision,firstRevision);assert.deepEqual(s.attendanceUndo[key].changes.map(c=>c.studentId),['3-1','1-1'],'The non-alphabetical anchor must stay first');
    r=await post(second,{kind:'attendance',...context,changes:[{studentId:'1-1',status:'present',note:'새 메모'},{studentId:'3-1',status:'absent',note:'변경'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();const undoRevision=s.revision;
    r=await post(second,{kind:'attendance',date:'2026-12-01',room:1,period:5,changes:[{studentId:'1-1',status:'present',note:'다른 교시'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    const anotherDb=env.authenticatedContext('shared-test',passwordToken).firestore(),reloaded=createSharedClient(anotherDb,{currentUser:teacherUser},teacherUser,'공용 접속',false,()=>{});
    try{
      const loaded=await snapshot(reloaded);assert.equal(loaded.attendanceUndo[key].revision,undoRevision);
      r=await post(reloaded,{kind:'attendance-undo',...context,undoRevision,baseRevision:loaded.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);await waitRevision(second,s.revision);
      for(const c of changes){const a=domain.getRecord(s.state,c.studentId,context.date,context.period);assert.equal(a.status,c.status);assert.equal(a.note,c.note);}
      assert.equal(s.attendanceUndo[key],undefined);assert.equal(domain.getRecord(s.state,'1-1',context.date,5).note,'다른 교시');
      const marker=await read(owner,`attendancePeriods/${key}`);assert.equal(marker.undoable,false);assert.equal(marker.action,'undo');assert.equal(marker.firstStudentId,'1-1');assert.equal(marker.count,2);
      r=await post(reloaded,{kind:'attendance-undo',...context,undoRevision,baseRevision:s.revision});assert.equal(r.status,409,await r.text());
    }finally{reloaded.dispose();}
  });
  await ok('reset has its own persistent undo and stale same-period undo is rejected',async()=>{
    let s=await snapshot(first);const context={date:'2026-12-01',room:1,period:6},key=domain.periodKey(context.date,1,6),previous=structuredClone(s.state.attendance);
    let r=await post(first,{kind:'attendance',action:'reset',...context,changes:attendanceResetChanges(s.state,context.date,1,6),baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();const resetRevision=s.revision;await waitRevision(second,s.revision);assert.equal(s.attendanceUndo[key].revision,resetRevision);
    r=await post(second,{kind:'attendance-undo',...context,undoRevision:resetRevision,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const id of ['1-1','3-1']){const recordKey=domain.recordKey(context.date,id,6);assert.equal(s.state.attendance[recordKey].status,previous[recordKey].status);assert.equal(s.state.attendance[recordKey].note,previous[recordKey].note);}
    r=await post(first,{kind:'attendance',...context,changes:[{studentId:'1-1',status:'present',note:'첫 변경'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();const stale=s.revision;
    r=await post(first,{kind:'attendance',...context,changes:[{studentId:'1-1',status:'absent',note:'최신 변경'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(first,{kind:'attendance-undo',...context,undoRevision:stale,baseRevision:s.revision});assert.equal(r.status,409,await r.text());assert.equal(domain.getRecord(first.snapshot().state,'1-1',context.date,6).note,'최신 변경');await waitRevision(second,s.revision);
  });
  await ok('later roster management preserves factual records and forbids room changes after tombstones',async()=>{
    let s=await snapshot(second);const date='2026-11-30',studentId=newPupils[7].id;
    let r=await post(second,{kind:'roster',action:'add',date,room:1,studentId,startPeriod:2,endPeriod:4,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'roster-manage',action:'update',date,studentId,room:2,startPeriod:3,endPeriod:5,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'attendance',date,room:2,period:3,changes:[{studentId,status:'present',note:'취소 후에도 남는 사실'}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'roster-manage',action:'update',date,studentId,room:1,startPeriod:1,endPeriod:6,baseRevision:s.revision});assert.equal(r.status,422,await r.text());
    r=await post(second,{kind:'roster-manage',action:'update',date,studentId,room:2,startPeriod:1,endPeriod:4,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'roster-manage',action:'remove',date,studentId,room:2,startPeriod:1,endPeriod:4,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    for(const client of [first,second]){const n=client.snapshot().state;assert.ok(!n.additionalParticipants.some(p=>p.studentId===studentId&&p.date===date));assert.ok(domain.dayParticipants(n,date).find(p=>p.studentId===studentId).historical);assert.ok(domain.roomRoster(n,date,2,3).some(p=>p.id===studentId));assert.ok(!domain.roomRoster(n,date,2,4).some(p=>p.id===studentId));assert.equal(domain.getRecord(n,studentId,date,3).note,'취소 후에도 남는 사실');}
    r=await post(second,{kind:'attendance',date,room:2,period:4,changes:[{studentId,status:'present',note:'새 사실 만들기 금지'}],baseRevision:s.revision});assert.equal(r.status,400,await r.text());
    r=await post(second,{kind:'attendance',date,room:2,period:3,changes:[{studentId,status:null,note:''}],baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();await waitRevision(first,s.revision);
    assert.equal(s.attendanceLocks[`${date}|${studentId}`],2);assert.ok(!domain.dayParticipants(s.state,date).some(p=>p.studentId===studentId));
    r=await post(second,{kind:'roster',action:'add',date,studentId,room:1,startPeriod:1,endPeriod:6,baseRevision:s.revision});assert.equal(r.status,422,await r.text());
    r=await post(second,{kind:'roster',action:'add',date,studentId,room:2,startPeriod:1,endPeriod:6,baseRevision:s.revision});assert.equal(r.status,200,await r.clone().text());s=await r.json();
    r=await post(second,{kind:'roster-manage',action:'update',date,studentId,room:1,startPeriod:1,endPeriod:6,baseRevision:s.revision});assert.equal(r.status,422,await r.text());await waitRevision(first,s.revision);
  });
  await ok('master and history immutable; orphan writes and record deletes denied',async()=>{
    const h=await read(owner,'school/live');await assertFails(setDoc(doc(owner,'school/live'),{...h,revision:h.revision+1,updatedAt:serverTimestamp()}));
    const logs=await getDocs(collection(owner,'history'));await assertFails(setDoc(logs.docs[0].ref,{forged:true}));
    await assertFails(deleteDoc(doc(owner,'attendance/2026-11-30|1-1|1')));
    await assertFails(setDoc(doc(owner,'school/config'),{forged:true}));
  });
  await ok('shared access suspension blocks reads and discards the live cache',async()=>{
    const gate=await read(owner,'security/shared');await setDoc(doc(owner,'security/shared'),{...gate,enabled:false,updatedAt:serverTimestamp(),updatedBy:'owner-test'});
    const fresh=env.authenticatedContext('shared-test',{...passwordToken,auth_time:101}).firestore();
    await assertFails(getDocFromServer(doc(fresh,'school/config')));await assertFails(setDoc(doc(teacher,'attendance/forged'),{status:'present'}));
    const until=Date.now()+5000;while(second.snapshot()&&Date.now()<until)await new Promise(r=>setTimeout(r,25));assert.ok(second.snapshot()===null,'Suspended password access must discard its live cache');
  });
  await ok('session cutoff rejects old sessions and allows a fresh password login',async()=>{
    await setDoc(doc(owner,'security/shared'),{enabled:true,validAfter:200,updatedAt:serverTimestamp(),updatedBy:'owner-test'});
    const old=env.authenticatedContext('shared-test',{...passwordToken,auth_time:199}).firestore();
    const fresh=env.authenticatedContext('shared-test',{...passwordToken,auth_time:201}).firestore();
    await assertFails(getDocFromServer(doc(old,'school/config')));await assertSucceeds(getDocFromServer(doc(fresh,'school/config')));
  });
  console.log(JSON.stringify({checks,passed:true,fixture:'fully synthetic',projectId,productionWrites:0}));
}finally{stopAccess();for(const c of clients)c.dispose();await env.cleanup();}
