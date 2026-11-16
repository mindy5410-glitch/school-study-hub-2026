// Bounded rules-only checks. Every identity and school record is synthetic.
// Start an Enterprise Firestore emulator, then set RULES_TEST_PORT if not 8281.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,writeBatch,serverTimestamp,setLogLevel} from 'firebase/firestore';
import {makeFixture} from './synthetic-fixture.mjs';

setLogLevel('silent');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const domainUri=uri(compile(await fs.readFile('lib/domain.ts','utf8'))),domain=await import(domainUri);
const digestUri=uri(compile(await fs.readFile('lib/initial-data-digest.ts','utf8')));
const cloud=await import(uri(compile((await fs.readFile('lib/cloud-model.ts','utf8'))
  .replace("from './domain'","from '"+domainUri+"'").replace("from './initial-data-digest'","from '"+digestUri+"'"))));
const rules=(await fs.readFile('rules/school.rules.template','utf8'))
  .replaceAll('__OWNER_UID__','owner-test').replaceAll('__SHARED_UID__','shared-test');
const env=await initializeTestEnvironment({projectId:'demo-six-rules-'+Date.now(),firestore:{host:'127.0.0.1',port:Number(process.env.RULES_TEST_PORT??8281),rules}});
const owner=env.authenticatedContext('owner-test',{email:'owner@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const db=env.authenticatedContext('shared-test',{auth_time:100,firebase:{sign_in_provider:'password'}}).firestore();
const outsider=env.unauthenticatedContext().firestore();
const state=makeFixture(domain),first=state.days[0].date,actorName='공용 접속',uid='shared-test';
const unused=state.students.filter(s=>!state.participants.some(p=>p.studentId===s.id)).map(s=>s.id);
const planned=state.participants.filter(p=>p.date===first&&p.room===1).map(p=>p.studentId);
const read=async path=>(await getDoc(doc(owner,path))).data();
let checks=0;
const good=async(label,p)=>{await assertSucceeds(p);checks++;console.log('PASS '+label)};
const bad=async(label,p)=>{await assertFails(p);checks++;console.log('PASS denied '+label)};
async function transaction(make){
  const head=await read('school/live'),revision=head.revision+1,at=serverTimestamp(),batch=writeBatch(db),log=doc(collection(db,'history'));
  const event=await make({batch,revision,at});
  batch.set(log,{revision,...event,actorUid:uid,actorName,createdAt:at});
  batch.update(doc(db,'school/live'),{revision,updatedAt:at,updatedBy:uid,lastLog:log.id});
  await batch.commit();
}
async function coverage(date,period,teacherId,{room=1,mutate}={}){
  const old=await read('school/extraSchedule');
  return transaction(({batch,revision,at})=>{
    const assignmentId=`${date}-${room}-${period}`,assignments={...(old?.assignments??{})};
    const counts={...(old?.counts??Object.fromEntries(state.teachers.map(t=>[t.id,0])))};
    const fromTeacher=assignments[assignmentId]??'';
    if(fromTeacher)counts[fromTeacher]--;
    if(teacherId){assignments[assignmentId]=teacherId;counts[teacherId]=(counts[teacherId]??0)+1}else delete assignments[assignmentId];
    const value={assignments,counts,revision,updatedAt:at,updatedBy:uid,actorName};
    if(mutate)mutate(value);
    batch.set(doc(db,'school/extraSchedule'),value);
    return {kind:'coverage',date,room,period,assignmentId,fromTeacher,toTeacher:teacherId,swapId:'',reason:''};
  });
}
async function originalChange(id,toTeacher){
  const old=await read('school/schedule'),config=await read('school/config'),slot=config.slots[id];
  return transaction(({batch,revision,at})=>{
    const assignments={...old.assignments},counts={...old.counts},fromTeacher=assignments[id];
    assignments[id]=toTeacher;counts[fromTeacher]--;counts[toTeacher]++;
    batch.set(doc(db,'school/schedule'),{assignments,counts,revision,updatedAt:at,updatedBy:uid});
    return {kind:'schedule',...slot,assignmentId:id,fromTeacher,toTeacher,swapId:'',reason:''};
  });
}
async function attend(ids,{date=first,room=1,period=1,action='save',status='present',note='',legacy=false,mutateRecord,mutateMarker,mutateEvent,skipRecords=false}={}){
  const prior=await Promise.all(ids.map(id=>read(`attendance/${date}|${id}|${period}`)));
  const oldMarker=await read(`attendancePeriods/${date}|${room}|${period}`);
  return transaction(({batch,revision,at})=>{
    ids.forEach((id,i)=>{
      const old=prior[i],value={studentId:id,date,room,period,status:action==='undo'?old?.previousStatus:action==='reset'?'unrecorded':status,
        note:action==='undo'?old?.previousNote:action==='reset'?'':note,revision,updatedAt:at,updatedBy:uid,actorName};
      if(!legacy){value.previousStatus=old?.status??'unrecorded';value.previousNote=old?.note??''}
      if(mutateRecord)mutateRecord(value,id);
      if(!skipRecords)batch.set(doc(db,`attendance/${date}|${id}|${period}`),value);
    });
    const event={kind:'attendance',date,room,period,firstStudentId:ids[0]};
    if(!legacy){
      event.action=action;
      const marker={date,room,period,revision,count:action==='undo'?oldMarker?.count:ids.length,
        firstStudentId:action==='undo'?oldMarker?.firstStudentId:ids[0],undoable:action!=='undo',action,updatedAt:at,updatedBy:uid,actorName};
      if(mutateMarker)mutateMarker(marker);
      batch.set(doc(db,`attendancePeriods/${date}|${room}|${period}`),marker);
    }
    if(mutateEvent)mutateEvent(event);
    return event;
  });
}
async function roster(studentId,{date=first,room=1,startPeriod=1,endPeriod=6,action='add',mutate}={}){
  const old=await read('dailyRosters/'+date),prior=old?.students?.[studentId];
  return transaction(({batch,revision,at})=>{
    const students={...(old?.students??{})};
    if(action==='add'||action==='update')students[studentId]={room,startPeriod,endPeriod,addedRevision:action==='add'?revision:prior?.addedRevision};
    else delete students[studentId];
    const value={date,students,revision,updatedAt:at,updatedBy:uid,actorName,lastStudentId:studentId,lastAction:action};
    if(mutate)mutate(value);
    batch.set(doc(db,'dailyRosters/'+date),value);
    const entry=action==='add'||action==='update'?students[studentId]:prior;
    return {kind:'roster',date,room:entry.room,period:entry.startPeriod,endPeriod:entry.endPeriod,studentId,action};
  });
}
async function batchRoster(studentId,action,rooms={}){
  const old=await Promise.all(state.days.map(day=>read('dailyRosters/'+day.date)));
  return transaction(({batch,revision,at})=>{
    const entries={};
    state.days.forEach((day,i)=>{
      const room=rooms[day.date]??1,entry={room,startPeriod:1,endPeriod:day.periods,addedRevision:revision};
      const students={...(old[i]?.students??{})};
      if(action==='add')students[studentId]=entry;else delete students[studentId];
      batch.set(doc(db,'dailyRosters/'+day.date),{date:day.date,students,revision,updatedAt:at,updatedBy:uid,actorName,lastStudentId:studentId,lastAction:action});
      entries[day.date]=`${room}:1:${day.periods}`;
    });
    return {kind:'roster-batch',date:first,room:rooms[first]??1,period:1,endPeriod:6,studentId,action,entries};
  });
}

try{
  const at=serverTimestamp(),boot=writeBatch(owner),config=cloud.buildCloudConfig(state,'owner-test',at);
  boot.set(doc(owner,'school/config'),config);boot.set(doc(owner,'school/schedule'),cloud.cloudSchedule(state,'owner-test',at));
  boot.set(doc(owner,'school/live'),{revision:0,updatedAt:at,updatedBy:'owner-test',lastLog:''});
  boot.set(doc(owner,'security/shared'),{enabled:true,validAfter:0,updatedAt:at,updatedBy:'owner-test'});
  await good('bootstrap synthetic school',boot.commit());

  await good('first proactive additional duty',coverage('2026-12-21',1,'teacher05'));
  await good('incremental coverage with other slots missing',coverage('2026-12-21',2,'teacher06'));
  await good('clear additional duty',coverage('2026-12-21',1,''));
  await bad('canonical weekday regular class',coverage('2026-12-23',2,'teacher06'));
  await bad('overlap with original duty',coverage(first,1,'teacher05'));
  await bad('later room2 duty',coverage('2026-12-21',1,'teacher05',{room:2}));
  await bad('unknown teacher',coverage('2026-12-21',1,'unknown'));
  await bad('combined maximum',coverage('2026-12-21',1,'teacher01'));
  await bad('extra counts type',coverage('2026-12-21',1,'teacher05',{mutate:d=>{d.counts.teacher13=0.5}}));
  await bad('extra schedule schema',coverage('2026-12-21',1,'teacher05',{mutate:d=>{d.unexpected=true}}));
  const cfg=await read('school/config');
  async function transferable(){
    const s=await read('school/schedule');
    for(const [id,teacher] of Object.entries(s.assignments))if(teacher==='teacher01'){
      const to=Object.keys(cfg.allowed[id]).find(t=>!['teacher01','teacher02','teacher03','teacher04'].includes(t)&&s.assignments[cfg.parallels[id]]!==t);
      if(to)return{id,to};
    }
    throw Error('No synthetic transfer');
  }
  const moved=await transferable();
  await good('original count reduced within combined minimum',originalChange(moved.id,moved.to));
  await good('extra count fills teacher quota',coverage('2026-12-21',1,'teacher01'));
  await bad('original edit exceeding combined maximum',originalChange(moved.id,'teacher01'));
  const movedAgain=await transferable();
  await good('original below minimum with extra count preserving total',originalChange(movedAgain.id,movedAgain.to));
  await bad('clear violating combined minimum',coverage('2026-12-21',1,''));

  await good('legacy attendance before first period marker',attend([planned[0]],{legacy:true}));
  await good('modern save captures two prior states',attend(planned.slice(0,2)));
  assert.equal((await read(`attendance/${first}|${planned[1]}|1`)).previousStatus,'unrecorded');
  await bad('forged prior status',attend(planned.slice(0,2),{mutateRecord:d=>{d.previousStatus='experience'}}));
  await bad('forged prior note',attend(planned.slice(0,2),{mutateRecord:d=>{d.previousNote='forged'}}));
  await bad('legacy save after period marker',attend([planned[0]],{legacy:true}));
  await good('save unrelated period',attend([planned[2]],{period:2,status:'absent'}));
  await good('persistent undo after unrelated revision',attend(planned.slice(0,2),{action:'undo'}));
  assert.equal((await read(`attendance/${first}|${planned[0]}|1`)).status,'present');
  assert.equal((await read(`attendance/${first}|${planned[1]}|1`)).status,'unrecorded');
  await bad('duplicate persistent undo',attend(planned.slice(0,2),{action:'undo'}));
  await good('save before reset',attend(planned.slice(0,2),{status:'absent',note:'synthetic'}));
  await good('reset captures saved values',attend(planned.slice(0,2),{action:'reset'}));
  await bad('forged undo restoration',attend(planned.slice(0,2),{action:'undo',mutateRecord:d=>{d.status='experience'}}));
  await good('undo reset restores saved values',attend(planned.slice(0,2),{action:'undo'}));
  await bad('marker without written attendance anchor',attend([planned[0]],{skipRecords:true}));
  await bad('zero marker count',attend([planned[0]],{mutateMarker:d=>{d.count=0}}));
  await bad('oversized marker count',attend([planned[0]],{mutateMarker:d=>{d.count=101}}));
  await bad('marker extra fields',attend([planned[0]],{mutateMarker:d=>{d.unexpected=true}}));
  await bad('marker scope mismatch',attend([planned[0]],{mutateMarker:d=>{d.period=2}}));
  await bad('missing captured values',attend([planned[0]],{mutateRecord:d=>{delete d.previousNote}}));
  await bad('record scope mismatch',attend([planned[0]],{mutateRecord:d=>{d.period=2}}));
  await bad('inactive new attendance record',attend([unused[4]]));
  await good('additional bulk pupil D',roster(unused[3]));
  await good('additional bulk pupil E',roster(unused[4]));
  await good('thirty-record save with captured values',attend([...planned,unused[3],unused[4]]));

  await good('additional pupil A',roster(unused[0]));
  await bad('roster actor differs from validated event',roster(unused[0],{action:'update',startPeriod:2,mutate:d=>{d.actorName='forged'}}));
  await bad('roster UID differs from validated event',roster(unused[0],{action:'update',startPeriod:2,mutate:d=>{d.updatedBy='owner-test'}}));
  await bad('roster stamp differs from validated event',roster(unused[0],{action:'update',startPeriod:2,mutate:d=>{d.updatedAt='forged'}}));
  await good('actual period5 record',attend([unused[0]],{period:5}));
  await good('later range edit after saved attendance',roster(unused[0],{action:'update',startPeriod:2}));
  await bad('room lock in periods5-7',roster(unused[0],{action:'update',room:2,startPeriod:2}));
  await good('managed cancellation retains actual record',roster(unused[0],{action:'cancel'}));
  assert.equal((await read(`attendance/${first}|${unused[0]}|5`)).status,'present');
  await good('undo historical attendance after cancellation',attend([unused[0]],{period:5,action:'undo'}));
  await good('correct existing historical tombstone',attend([unused[0]],{period:5,status:'absent'}));
  await bad('invent inactive period6 record',attend([unused[0]],{period:6}));
  for(const studentId of unused.slice(6,10))await good('populate managed-transfer peer '+studentId,roster(studentId));
  await good('additional pupil B without attendance range2-4',roster(unused[1],{startPeriod:2,endPeriod:4}));
  await good('change room and both range bounds with six peers',roster(unused[1],{action:'update',room:2,startPeriod:3,endPeriod:5}));
  await good('room2 factual record',attend([unused[1]],{room:2,period:1}));
  await good('room2 reset leaves a tombstone',attend([unused[1]],{room:2,period:1,action:'reset'}));
  await bad('tombstone room lock in periods1-4',roster(unused[1],{action:'update',room:1,startPeriod:2}));
  await good('cancel B retaining room2 tombstone',roster(unused[1],{action:'cancel'}));
  await good('re-add B in tombstone room',roster(unused[1],{room:2}));
  await good('cancel B again retaining tombstone',roster(unused[1],{action:'cancel'}));
  await bad('cross-room legacy re-add with only tombstone',roster(unused[1],{room:1}));
  await good('additional pupil C on seven-period day',roster(unused[2],{date:'2026-12-01',endPeriod:7}));
  await good('period7 factual record',attend([unused[2]],{date:'2026-12-01',period:7}));
  await bad('room lock at period7',roster(unused[2],{date:'2026-12-01',endPeriod:7,action:'update',room:2}));
  await bad('changing immutable addedRevision',roster(unused[2],{date:'2026-12-01',endPeriod:6,action:'update',mutate:d=>{d.students[unused[2]].addedRevision=d.revision}}));
  await good('re-add cancelled A in saved room',roster(unused[0]));
  await good('cancel A again retaining history',roster(unused[0],{action:'cancel'}));
  await bad('cross-room legacy re-add with period5 history',roster(unused[0],{room:2}));
  await good('cancel seven-period historical pupil C',roster(unused[2],{date:'2026-12-01',action:'cancel'}));
  await bad('cross-room legacy re-add with period7 history',roster(unused[2],{date:'2026-12-01',room:2,endPeriod:7}));

  // Maximal control-read case: all thirteen possible records already exist on
  // the only two-room dates, then one atomic operation re-adds all20 dates.
  const batchPupil=unused[5];
  for(const date of [first,'2026-12-01']){
    const endPeriod=state.days.find(day=>day.date===date).periods;
    await good('prepare historical batch pupil '+date,roster(batchPupil,{date,endPeriod}));
    for(let period=1;period<=endPeriod;period++)await good(`capture historical batch pupil ${date} period${period}`,attend([batchPupil],{date,period}));
    await good('cancel historical batch pupil '+date,roster(batchPupil,{date,action:'cancel'}));
  }
  await good('all20 same-room re-add with thirteen existing records',batchRoster(batchPupil,'add'));
  await good('all20 immediate undo preserves older attendance',batchRoster(batchPupil,'remove'));
  await bad('all20 cross-room Nov30 re-add',batchRoster(batchPupil,'add',{[first]:2}));
  await bad('all20 cross-room Dec1 re-add',batchRoster(batchPupil,'add',{'2026-12-01':2}));
  for(const path of ['school/extraSchedule',`attendancePeriods/${first}|1|1`])await bad('unauthenticated read '+path,getDoc(doc(outsider,path)));
  await bad('unauthenticated marker query',getDocs(collection(outsider,'attendancePeriods')));
  console.log(JSON.stringify({rulesOnlyChecks:checks,syntheticOnly:true}));
}finally{await env.cleanup()}
