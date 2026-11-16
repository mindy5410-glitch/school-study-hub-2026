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
const {attendanceResetChanges}=await load('attendance-form');
const {watchWorkspaceAccess}=await load('teacher-access');
globalThis.window={dispatchEvent(){}};
setLogLevel('silent');
const rules=(await fs.readFile('rules/school.rules.template','utf8')).replaceAll('__OWNER_UID__','owner-test').replaceAll('__SHARED_UID__','shared-test');
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8180,rules}});
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
