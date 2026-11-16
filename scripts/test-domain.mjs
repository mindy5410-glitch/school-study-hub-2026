import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {makeFixture} from './synthetic-fixture.mjs';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const domainUrl=url(compile(await fs.readFile('lib/domain.ts','utf8'))),domain=await import(domainUrl);
const operatingDays=makeFixture(domain).days;
const defaultDateCases=[
  ['2026-11-17T03:00:00Z','2026-11-30'],
  ['2026-11-29T14:59:59.999Z','2026-11-30'],
  ['2026-11-29T15:00:00Z','2026-11-30'],
  ['2026-11-30T14:59:59.999Z','2026-11-30'],
  ['2026-11-30T15:00:00Z','2026-12-01'],
  ['2026-12-02T03:00:00Z','2026-12-02'],
  ['2026-12-04T15:00:00Z','2026-12-07'],
  ['2026-12-06T03:00:00Z','2026-12-07'],
  ['2026-12-10T15:00:00Z','2026-12-14'],
  ['2026-12-24T03:00:00Z','2026-12-24'],
  ['2026-12-24T15:00:00Z','2026-12-28'],
  ['2026-12-26T03:00:00Z','2026-12-28'],
  ['2026-12-28T15:00:00Z','2026-12-29'],
  ['2026-12-29T14:59:59.999Z','2026-12-29'],
  ['2026-12-29T15:00:00Z','2026-12-29'],
  ['2027-01-01T03:00:00Z','2026-12-29'],
];
for(const [now,expected]of defaultDateCases)assert.equal(domain.defaultSchoolDate(operatingDays,new Date(now)),expected,`Korean date default at ${now}`);
const reversedDays=[...operatingDays].reverse(),unmodifiedOrder=reversedDays.map(d=>d.date);
for(const day of operatingDays)assert.equal(domain.defaultSchoolDate(reversedDays,new Date(`${day.date}T03:00:00Z`)),day.date);
assert.deepEqual(reversedDays.map(d=>d.date),unmodifiedOrder);
assert.equal(domain.defaultSchoolDate([],new Date('2026-12-01T03:00:00Z')),'2026-11-30');
const source=compile((await fs.readFile('lib/mutations.ts','utf8')).replace("from './domain'","from '"+domainUrl+"'"));
const {applyMutation}=await import(url(source));
const attendanceForm=await import(url(compile((await fs.readFile('lib/attendance-form.ts','utf8')).replace("from './domain'","from '"+domainUrl+"'"))));
const date='2026-11-30',state={schemaVersion:1,students:[{id:'1-1',classNo:1,number:1,name:'예시 학생1',originalName:'예시 학생1'},{id:'2-1',classNo:2,number:1,name:'예시 학생2',originalName:'예시 학생2'}],days:[{date,weekday:'월',periods:6}],participants:[{studentId:'1-1',date,room:1,leavePeriod:5},{studentId:'2-1',date,room:2,leavePeriod:null}],teachers:['A','B','C','D'].map(id=>({id,name:id,minDuties:id==='A'?2:0,maxDuties:id==='A'?3:null,preferredDuties:3})),assignments:[],blocked:[{teacherId:'A',weekday:'월',period:4,grade:1,classNo:1,subject:'예시',sourceCell:'예시'}],attendance:{},settings:{roomNames:{1:'A반',2:'B반'},leaveStartPeriod:5,leaveStartTime:'14:00',excludedTeachers:['제외 교사'],sourceVersion:'test',weeklyTimetableRepeats:true,wednesday56NoRegularLessons:true}};
for(const room of [1,2])for(let p=1;p<=6;p++)state.assignments.push({id:`${date}-${room}-${p}`,date,room,period:p,teacherId:(room===1?['A','B']:['C','D'])[(p-1)%2]});
// Keep a pupil present in period five so all fixture duty slots operate.
state.participants.push({studentId:'1-2',date,room:1,leavePeriod:null});state.students.push({id:'1-2',classNo:1,number:2,name:'예시 학생3',originalName:'예시 학생3'});
assert.deepEqual(domain.scheduleErrors(state,state.assignments),[]);
assert.equal(domain.expectedStatus(state,'1-1',date,4),'present');assert.equal(domain.expectedStatus(state,'1-1',date,5),'experience');
const snapshot={state,revision:0,updatedAt:'2026-11-13T00:00:00.000Z',history:[]};
assert.deepEqual(attendanceForm.attendanceInput(state,'1-1',date,4),{status:'absent',note:''});
assert.deepEqual(attendanceForm.attendanceInput(state,'1-1',date,5),{status:'absent',note:''});
assert.deepEqual(attendanceForm.attendanceOptions,['present','absent']);
const defaultChanges=attendanceForm.attendanceChanges(state,date,1,4);
assert.deepEqual(defaultChanges,[{studentId:'1-1',status:'absent',note:''},{studentId:'1-2',status:'absent',note:''}]);
assert.deepEqual(attendanceForm.attendanceChanges(state,date,1,5),[{studentId:'1-1',status:'absent',note:''},{studentId:'1-2',status:'absent',note:''}]);
assert.equal(domain.roomRoster(state,date,1).length,2,'Half-day pupils remain on the roster after departure');
const halfDayOverride=attendanceForm.attendanceChanges(state,date,1,5,{'1-1':{status:'present',note:'다시 등교'}});
assert.deepEqual(halfDayOverride,[{studentId:'1-1',status:'present',note:'다시 등교'},{studentId:'1-2',status:'absent',note:''}]);
for(const [legacy,normalized] of [['present','present'],['late','present'],['early','present'],['absent','absent'],['experience','absent']]){
  const legacyState=structuredClone(state),key=domain.recordKey(date,'1-1',4);
  legacyState.attendance[key]={studentId:'1-1',date,period:4,status:legacy,note:'기존 메모 유지',updatedAt:snapshot.updatedAt,updatedBy:'검증'};
  assert.deepEqual(attendanceForm.attendanceInput(legacyState,'1-1',date,4),{status:normalized,note:'기존 메모 유지'});
  assert.equal(legacyState.attendance[key].status,legacy,'Opening the form must not rewrite stored records');
  assert.ok(attendanceForm.attendanceChanges(legacyState,date,1,4).every(c=>attendanceForm.attendanceOptions.includes(c.status)));
}
assert.deepEqual(attendanceForm.attendanceChanges(state,date,1,4,{'1-1':{status:'present',note:'등교 확인'},'2-1':{status:'absent',note:'다른 관리반'}}),[{studentId:'1-1',status:'present',note:'등교 확인'},{studentId:'1-2',status:'absent',note:''}]);
assert.equal(Object.keys(state.attendance).length,0,'Selecting defaults must not write attendance');
const defaultsSaved=applyMutation(snapshot,{kind:'attendance',date,room:1,period:4,changes:defaultChanges,baseRevision:0},'검증');
assert.deepEqual(attendanceForm.attendanceChanges(defaultsSaved.state,date,1,4),[]);
assert.equal(Object.keys(defaultsSaved.state.attendance).length,2);
for(const studentId of ['1-1','1-2'])assert.equal(domain.getRecord(defaultsSaved.state,studentId,date,4).status,'absent','Confirming defaults must save absent');
assert.equal(domain.getRecord(defaultsSaved.state,'1-1',date,5),undefined,'Confirmation must affect only the selected period');
assert.equal(domain.getRecord(defaultsSaved.state,'2-1',date,4),undefined,'Confirmation must affect only the selected room');
const previouslyMarked=structuredClone(state);
previouslyMarked.attendance[domain.recordKey(date,'1-1',4)]={studentId:'1-1',date,period:4,status:'absent',note:'이미 확인한 결석',updatedAt:'2026-11-13T00:00:00.000Z',updatedBy:'검증'};
assert.deepEqual(attendanceForm.attendanceInput(previouslyMarked,'1-1',date,4),{status:'absent',note:'이미 확인한 결석'});
assert.deepEqual(attendanceForm.attendanceChanges(previouslyMarked,date,1,4),[{studentId:'1-2',status:'absent',note:''}]);
assert.deepEqual(attendanceForm.attendanceResetChanges(state,date,1,4),[],'Default selections are not saved records');
assert.deepEqual(attendanceForm.attendanceResetChanges(previouslyMarked,date,1,4),[{studentId:'1-1',status:null,note:''}],'Partial saves reset only saved pupils');
const resetFixture=structuredClone(defaultsSaved.state);
const otherDate='2026-12-01';resetFixture.days.push({date:otherDate,weekday:'화',periods:7});
resetFixture.participants.push({studentId:'1-1',date:otherDate,room:1,leavePeriod:null});
for(const [recordDate,studentId,recordPeriod,status,note] of [[date,'1-1',4,'absent','결석 메모'],[date,'2-1',4,'late','다른 반'],[date,'1-1',3,'early','다른 교시'],[otherDate,'1-1',4,'present','다른 날짜']])resetFixture.attendance[domain.recordKey(recordDate,studentId,recordPeriod)]={studentId,date:recordDate,period:recordPeriod,status,note,updatedAt:snapshot.updatedAt,updatedBy:'검증'};
const resetBefore=structuredClone(resetFixture),resetChanges=attendanceForm.attendanceResetChanges(resetFixture,date,1,4);
const resetResult=applyMutation({...snapshot,state:resetFixture,revision:10},{kind:'attendance',date,room:1,period:4,changes:resetChanges,baseRevision:10},'검증');
assert.equal(resetChanges.length,2);
for(const studentId of ['1-1','1-2'])assert.equal(domain.getRecord(resetResult.state,studentId,date,4),undefined);
for(const [recordDate,studentId,recordPeriod] of [[date,'2-1',4],[date,'1-1',3],[otherDate,'1-1',4]])assert.deepEqual(domain.getRecord(resetResult.state,studentId,recordDate,recordPeriod),domain.getRecord(resetBefore,studentId,recordDate,recordPeriod));
assert.deepEqual(resetFixture,resetBefore,'Reset must not mutate its input snapshot');
assert.deepEqual(attendanceForm.attendanceResetChanges(resetResult.state,date,1,4),[]);
assert.deepEqual(attendanceForm.attendanceInput(resetResult.state,'1-1',date,4),{status:'absent',note:''},'Default absent remains unsaved after reset');
const resetUndo=resetChanges.map(c=>{const r=domain.getRecord(resetBefore,c.studentId,date,4);return {studentId:c.studentId,status:r.status,note:r.note};});
const resetUndone=applyMutation({...snapshot,state:resetResult.state,revision:11},{kind:'attendance',date,room:1,period:4,changes:resetUndo,baseRevision:11},'검증');
for(const c of resetUndo)assert.deepEqual(attendanceForm.attendanceInput(resetUndone.state,c.studentId,date,4),{status:c.status,note:c.note});
assert.throws(()=>applyMutation({...snapshot,state:resetBefore,revision:11},{kind:'attendance',date,room:1,period:4,changes:resetChanges,baseRevision:10},'검증'),e=>e.status===409,'A stale reset must never overwrite a newer change');
const schedule={kind:'schedule',assignmentId:`${date}-1-1`,teacherId:'C',swapId:`${date}-2-1`,baseRevision:0};
const changed=applyMutation(snapshot,schedule,'검증');assert.equal(changed.state.assignments[0].teacherId,'C');assert.equal(state.assignments[0].teacherId,'A');
assert.throws(()=>applyMutation(snapshot,{...schedule,swapId:undefined},'검증'),e=>e.status===422);
assert.throws(()=>applyMutation(snapshot,{kind:'schedule',assignmentId:`${date}-1-4`,teacherId:'A',baseRevision:0},'검증'),e=>e.status===422);
assert.throws(()=>applyMutation(snapshot,{...schedule,teacherId:'제외 교사',swapId:undefined},'검증'),e=>e.status===422);
const attendance={kind:'attendance',date,room:1,period:4,changes:[{studentId:'1-1',status:'present',note:'확인'}],baseRevision:0};
let result=applyMutation(snapshot,attendance,'검증');assert.equal(result.state.attendance[`${date}|1-1|4`].status,'present');assert.equal(Object.keys(state.attendance).length,0);
const next={...snapshot,state:result.state,revision:1};result=applyMutation(next,{...attendance,changes:[{studentId:'1-1',status:'late',note:'수정'}],baseRevision:1},'검증');assert.equal(result.state.attendance[`${date}|1-1|4`].note,'수정');
assert.throws(()=>applyMutation(next,attendance,'검증'),e=>e.status===409);
for(const change of [{date:'2026-12-11'},{period:7},{changes:[{studentId:'2-1',status:'present',note:''}]},{changes:[{studentId:'1-1',status:'present',note:'x'.repeat(301)}]}])assert.throws(()=>applyMutation(snapshot,{...attendance,...change},'검증'),e=>e.status===400);
const extraState=structuredClone(state);extraState.students.push({id:'3-1',classNo:3,number:1,name:'예시 학생4',originalName:'예시 학생4'});
const extraSnapshot={...snapshot,state:extraState};
const add={kind:'roster',action:'add',date,room:1,studentId:'3-1',startPeriod:3,endPeriod:5,baseRevision:0};
const added=applyMutation(extraSnapshot,add,'검증');const addedSnapshot={...extraSnapshot,state:added.state,revision:1};
assert.equal(extraState.additionalParticipants,undefined,'Adding a pupil must not mutate the original snapshot');
assert.equal(added.state.participants.length,extraState.participants.length,'Original field-trip plan must remain unchanged');
assert.ok(domain.roomRoster(added.state,date,1).some(s=>s.id==='3-1'));
assert.equal(domain.dayParticipants(added.state,date).find(p=>p.studentId==='3-1').room,1,'Original-class view uses the same effective roster');
for(const [p,status] of [[2,'experience'],[3,'present'],[5,'present'],[6,'experience']])assert.equal(domain.expectedStatus(added.state,'3-1',date,p),status);
assert.throws(()=>applyMutation(addedSnapshot,{...add,room:2,baseRevision:1},'검증'),e=>e.status===400);
for(const patch of [{studentId:'1-1'},{studentId:'missing'},{date:'2026-12-11'},{startPeriod:0},{endPeriod:7},{startPeriod:5,endPeriod:2},{room:'1'}])assert.throws(()=>applyMutation(extraSnapshot,{...add,...patch},'검증'),e=>e.status===400);
const undone=applyMutation(addedSnapshot,{...add,action:'remove',baseRevision:1},'검증');assert.deepEqual(undone.state.additionalParticipants,[]);
const extraRecorded=applyMutation(addedSnapshot,{kind:'attendance',date,room:1,period:3,changes:[{studentId:'3-1',status:'present',note:'추가 등교'}],baseRevision:1},'검증');
assert.equal(domain.getRecord(extraRecorded.state,'3-1',date,3).status,'present');
const extraReset=applyMutation({...addedSnapshot,state:extraRecorded.state,revision:2},{kind:'attendance',date,room:1,period:3,changes:attendanceForm.attendanceResetChanges(extraRecorded.state,date,1,3),baseRevision:2},'검증');
assert.equal(domain.getRecord(extraReset.state,'3-1',date,3),undefined);
assert.deepEqual(extraReset.state.additionalParticipants,extraRecorded.state.additionalParticipants,'Reset must retain added pupils');
assert.ok(domain.roomRoster(extraReset.state,date,1).some(s=>s.id==='3-1'));
assert.throws(()=>applyMutation({...addedSnapshot,state:extraRecorded.state,revision:2},{...add,action:'remove',baseRevision:2},'검증'),e=>e.status===422);
assert.throws(()=>applyMutation(addedSnapshot,{...add,action:'remove'},'검증'),e=>e.status===409);
const batchState=structuredClone(extraState);
batchState.days.push({date:'2026-12-01',weekday:'화',periods:7},{date:'2026-12-02',weekday:'수',periods:6});
const batchSnapshot={...snapshot,state:batchState},batchBefore=structuredClone(batchState);
const batchEntries=[{date,room:2,startPeriod:2,endPeriod:6},{date:'2026-12-01',room:2,startPeriod:2,endPeriod:7},{date:'2026-12-02',room:1,startPeriod:2,endPeriod:6}];
const batchBody={kind:'roster-batch',action:'add',studentId:'3-1',entries:batchEntries,baseRevision:0};
const batchAdded=applyMutation(batchSnapshot,batchBody,'검증');
assert.deepEqual(batchState,batchBefore,'A multi-day mutation must not change its input');
assert.equal(batchAdded.state.additionalParticipants.length,3);
for(const e of batchEntries){const p=batchAdded.state.additionalParticipants.find(p=>p.date===e.date);assert.deepEqual(p,{studentId:'3-1',...e,addedRevision:1});assert.ok(domain.roomRoster(batchAdded.state,e.date,e.room).some(s=>s.id==='3-1'));}
const batchAddedSnapshot={...batchSnapshot,state:batchAdded.state,revision:1};
assert.deepEqual(applyMutation(batchAddedSnapshot,{...batchBody,action:'remove',baseRevision:1},'검증').state.additionalParticipants,[]);
assert.throws(()=>applyMutation({...batchAddedSnapshot,revision:2},{...batchBody,action:'remove',baseRevision:2},'검증'),e=>e.status===422);
for(const patch of [{entries:[]},{entries:[...batchEntries,batchEntries[0]]},{entries:[batchEntries[0],{...batchEntries[1],date:'2026-12-11'}]},{entries:[{...batchEntries[0],endPeriod:7}]},{entries:[{...batchEntries[2],room:2}]},{entries:[{...batchEntries[0],extra:true}]},{entries:Array.from({length:21},()=>batchEntries[0])},{studentId:'missing'},{studentId:'1-1'}])assert.throws(()=>applyMutation(batchSnapshot,{...batchBody,...patch},'검증'),e=>e.status===400);
assert.deepEqual(batchState,batchBefore,'A failure on any date must leave every date unchanged');
assert.throws(()=>applyMutation(batchAddedSnapshot,{...batchBody,baseRevision:1},'검증'),e=>e.status===400);
const batchRecorded=applyMutation(batchAddedSnapshot,{kind:'attendance',date:'2026-12-01',room:2,period:2,changes:[{studentId:'3-1',status:'present',note:'확정 출석'}],baseRevision:1},'검증');
assert.throws(()=>applyMutation({...batchAddedSnapshot,state:batchRecorded.state,revision:2},{...batchBody,action:'remove',baseRevision:2},'검증'),e=>e.status===422);
const future='2026-12-07',coverageState=structuredClone(extraState);
coverageState.days.push({date:future,weekday:'월',periods:6});
coverageState.additionalParticipants=[{studentId:'3-1',date:future,room:1,startPeriod:3,endPeriod:4,addedRevision:1}];
assert.equal(domain.expectedCount(coverageState,future,1,2),0);assert.equal(domain.expectedCount(coverageState,future,1,3),1);assert.equal(domain.expectedCount(coverageState,future,1,5),0);
assert.equal(domain.expectedCount(added.state,date,1,3),3);assert.equal(domain.expectedCount(added.state,date,1,6),1);
assert.deepEqual(domain.missingDuties(coverageState),[{date:future,room:1,period:3},{date:future,room:1,period:4}]);
const coverageSnapshot={...snapshot,state:coverageState},coverageBody={kind:'coverage',date:future,room:1,period:3,teacherId:'B',baseRevision:0};
const covered=applyMutation(coverageSnapshot,coverageBody,'검증');assert.equal(domain.missingDuties(covered.state).length,1);assert.equal(covered.state.assignments.find(a=>a.id===`${future}-1-3`).extra,true);
assert.deepEqual(domain.scheduleErrors(covered.state,covered.state.assignments,{requireCoverage:false}),[]);
assert.throws(()=>applyMutation(coverageSnapshot,{...coverageBody,period:4,teacherId:'A'},'검증'),e=>e.status===422);
assert.throws(()=>applyMutation(coverageSnapshot,{...coverageBody,date,period:1},'검증'),e=>e.status===400);
assert.throws(()=>applyMutation(coverageSnapshot,{...coverageBody,room:2},'검증'),e=>e.status===400);
const capped=structuredClone(covered.state);capped.teachers.find(t=>t.id==='B').maxDuties=4;
assert.throws(()=>applyMutation({...snapshot,state:capped,revision:1},{...coverageBody,period:4,baseRevision:1},'검증'),e=>e.status===422,'Original and extra duties share one maximum');
const cleared=applyMutation({...snapshot,state:covered.state,revision:1},{...coverageBody,teacherId:'',baseRevision:1},'검증');assert.equal(domain.missingDuties(cleared.state).length,2);
const quota=structuredClone(covered.state);quota.teachers.find(t=>t.id==='B').minDuties=4;
assert.throws(()=>applyMutation({...snapshot,state:quota,revision:1},{...coverageBody,teacherId:'',baseRevision:1},'검증'),e=>e.status===422,'Removing an extra duty cannot bypass a minimum');

const manage={kind:'roster-manage',action:'update',date,studentId:'3-1',room:2,startPeriod:1,endPeriod:4,baseRevision:50};
const moved=applyMutation({...addedSnapshot,revision:50},manage,'검증');assert.equal(moved.state.additionalParticipants[0].room,2,'Unrecorded additions remain movable after unrelated changes');
assert.equal(moved.state.additionalParticipants[0].addedRevision,1,'Editing a schedule must retain its original add revision');
const recordedSnapshot={...addedSnapshot,state:extraRecorded.state,revision:50};
assert.throws(()=>applyMutation(recordedSnapshot,manage,'검증'),e=>e.status===422);
const removed=applyMutation(recordedSnapshot,{...manage,action:'remove',room:1,startPeriod:3,endPeriod:5},'검증');
assert.equal(domain.getRecord(removed.state,'3-1',date,3).note,'추가 등교');assert.ok(domain.dayParticipants(removed.state,date).find(p=>p.studentId==='3-1').historical);
assert.ok(domain.roomRoster(removed.state,date,1,3).some(s=>s.id==='3-1'));assert.ok(!domain.roomRoster(removed.state,date,1,4).some(s=>s.id==='3-1'));
const removedSnapshot={...snapshot,state:removed.state,revision:51};
assert.throws(()=>applyMutation(removedSnapshot,{kind:'attendance',date,room:1,period:4,changes:[{studentId:'3-1',status:'present',note:''}],baseRevision:51},'검증'),e=>e.status===400);
assert.throws(()=>applyMutation(removedSnapshot,{...add,room:2,baseRevision:51},'검증'),e=>e.status===422);
assert.ok(applyMutation(removedSnapshot,{...add,baseRevision:51},'검증').state.additionalParticipants.some(p=>p.studentId==='3-1'));
assert.throws(()=>applyMutation({...addedSnapshot,revision:50,attendanceLocks:{[`${date}|3-1`]:1}},manage,'검증'),e=>e.status===422,'Cleared raw records still lock the room');
assert.throws(()=>applyMutation({...removedSnapshot,attendanceLocks:{[`${date}|3-1`]:1},state:extraState},{...add,room:2,baseRevision:51},'검증'),e=>e.status===422);

const digestUrl=url(compile(await fs.readFile('lib/initial-data-digest.ts','utf8')));
const cloud=await import(url(compile((await fs.readFile('lib/cloud-model.ts','utf8')).replace("from './domain'","from '"+domainUrl+"'").replace("from './initial-data-digest'","from '"+digestUrl+"'"))));
const originalSchedule=cloud.cloudSchedule(covered.state,'test',null,2),extraSchedule=cloud.cloudExtraSchedule(covered.state,'test','검증',null,2);
assert.equal(originalSchedule.assignments[`${future}-1-3`],undefined);assert.equal(originalSchedule.counts.B,3);assert.equal(extraSchedule.counts.B,1);
assert.equal(cloud.stateWithSchedule(cloud.buildCloudConfig(coverageState,'test',null),originalSchedule,extraSchedule).assignments.filter(a=>a.extra).length,1);
const rawRecords=[{studentId:'1-1',date,room:1,period:3,status:'present',note:'new',revision:60,previousStatus:'absent',previousNote:'old'},{studentId:'3-1',date,room:1,period:3,status:'absent',note:'',revision:60,previousStatus:'unrecorded',previousNote:''}];
const marker={date,room:1,period:3,revision:60,count:2,firstStudentId:'3-1',undoable:true,action:'save'};
const undos=cloud.attendanceUndoFromCloud(rawRecords,[marker]),key=domain.periodKey(date,1,3);
assert.deepEqual(undos[key].changes,[{studentId:'3-1',status:null,note:''},{studentId:'1-1',status:'absent',note:'old'}],'The marker anchor must stay first regardless of query order');
assert.equal(cloud.attendanceUndoFromCloud(rawRecords.slice(0,1),[marker])[key],undefined,'Incomplete prior data must not expose undo');
assert.equal(cloud.attendanceUndoFromCloud(rawRecords,[{...marker,undoable:false}])[key],undefined);
assert.equal(cloud.attendanceUndoFromCloud(rawRecords.map(r=>({...r,previousNote:undefined})),[marker])[key],undefined);
const undoState=structuredClone(extraRecorded.state);undoState.attendance[domain.recordKey(date,'1-1',3)]={studentId:'1-1',date,room:1,period:3,status:'present',note:'new',updatedAt:snapshot.updatedAt,updatedBy:'검증'};
const undoSnapshot={...snapshot,state:undoState,revision:66,attendanceUndo:undos},undoBody={kind:'attendance-undo',date,room:1,period:3,undoRevision:60,baseRevision:66};
const undoneSave=applyMutation(undoSnapshot,undoBody,'검증');assert.equal(domain.getRecord(undoneSave.state,'3-1',date,3),undefined);assert.equal(domain.getRecord(undoneSave.state,'1-1',date,3).note,'old');
assert.throws(()=>applyMutation(undoSnapshot,{...undoBody,undoRevision:59},'검증'),e=>e.status===409);
assert.throws(()=>applyMutation({...undoSnapshot,attendanceUndo:{}},undoBody,'검증'),e=>e.status===409);
console.log(JSON.stringify({checks:'passed',scope:['Korean date defaults and operating-day bounds','lesson exclusion','simultaneous duty','swap','departure boundary','attendance defaults','confirmation scope','persistent undo and anchor order','saved exceptions and notes','stale revision','added duty coverage and combined quotas','later roster editing and cancellation','historical attendance preservation and room locks','multi-day atomic validation and undo','day/period/roster/note validation'],fixture:'synthetic only'}));
