import type {Timestamp} from 'firebase/firestore';
import type {AdditionalParticipant,AttendanceRecord,AttendanceStatus,Room,SchoolState} from './types';
import {scheduleErrors,teacherLoad} from './domain';
import {INITIAL_DATA_DIGEST} from './initial-data-digest';

export interface CloudConfig<TTime=Timestamp> {
  schemaVersion:1;master:string;slotCount:number;teacherCount:number;
  allowed:Record<string,Record<string,boolean>>;parallels:Record<string,string>;
  slots:Record<string,{date:string;room:Room;period:number}>;
  limits:Record<string,{min:number;max:number}>;teacherNames:Record<string,string>;
  groups:Record<string,Record<string,boolean>>;days:Record<string,number>;studentIds:Record<string,boolean>;
  createdAt:TTime;createdBy:string;
}
export interface CloudSchedule<TTime=Timestamp> {assignments:Record<string,string>;counts:Record<string,number>;revision:number;updatedAt:TTime;updatedBy:string}
export interface CloudHead {revision:number;updatedAt:Timestamp;updatedBy:string;lastLog:string}
export interface CloudAttendance extends Omit<AttendanceRecord,'updatedAt'|'updatedBy'|'status'> {status:AttendanceStatus|'unrecorded';room:Room;updatedAt:Timestamp;updatedBy:string;actorName:string;revision:number}
export interface CloudHistory {revision:number;kind:'schedule'|'attendance'|'roster'|'roster-batch';date:string;room:Room;period:number;actorUid:string;actorName:string;createdAt:Timestamp;assignmentId?:string;fromTeacher?:string;toTeacher?:string;swapId?:string;reason?:string;firstStudentId?:string;studentId?:string;action?:'add'|'remove';endPeriod?:number;entries?:Record<string,string>}
export interface CloudRoster<TTime=Timestamp> {date:string;students:Record<string,{room:Room;startPeriod:number;endPeriod:number;addedRevision:number}>;revision:number;updatedAt:TTime;updatedBy:string;actorName:string;lastStudentId:string;lastAction:'add'|'remove'}
export function rosterParticipants(rosters:CloudRoster[]):AdditionalParticipant[]{
  return rosters.flatMap(r=>Object.entries(r.students).map(([studentId,p])=>({studentId,date:r.date,room:p.room,startPeriod:p.startPeriod,endPeriod:p.endPeriod,addedRevision:p.addedRevision})));
}
export function cloudRoster<TTime>(state:SchoolState,date:string,studentId:string,action:'add'|'remove',uid:string,actorName:string,at:TTime,revision:number):CloudRoster<TTime>{
  const students=Object.fromEntries((state.additionalParticipants??[]).filter(p=>p.date===date).map(p=>[p.studentId,{room:p.room,startPeriod:p.startPeriod,endPeriod:p.endPeriod,addedRevision:p.addedRevision}]));
  return {date,students,revision,updatedAt:at,updatedBy:uid,actorName,lastStudentId:studentId,lastAction:action};
}

export async function decodeInitialData(raw:string):Promise<SchoolState>{
  let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('제공된 운영 자료 파일을 선택해 주세요.');}
  if(parsed.format!=='school-study-hub-initial-data'||parsed.version!==1||!parsed.state)throw new Error('공동 운영실용 초기 자료 파일을 선택해 주세요.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parsed.state)));
  const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==INITIAL_DATA_DIGEST)throw new Error('현재 운영 계획과 다른 파일입니다. 제공된 최신 초기 자료 파일을 선택해 주세요.');
  const state=parsed.state as SchoolState;const errors=scheduleErrors(state,state.assignments);if(errors.length)throw new Error(errors[0]);
  return state;
}
export function buildCloudConfig<TTime>(state:SchoolState,uid:string,at:TTime):CloudConfig<TTime>{
  const allowed:CloudConfig['allowed']={},parallels:CloudConfig['parallels']={},slots:CloudConfig['slots']={};
  for(const a of state.assignments){
    const day=state.days.find(d=>d.date===a.date)!;
    allowed[a.id]=Object.fromEntries(state.teachers.filter(t=>!state.blocked.some(b=>b.teacherId===t.id&&b.weekday===day.weekday&&b.period===a.period)).map(t=>[t.id,true]));
    parallels[a.id]=state.assignments.find(s=>s.date===a.date&&s.period===a.period&&s.room!==a.room)?.id??'';
    slots[a.id]={date:a.date,room:a.room,period:a.period};
  }
  const groups:CloudConfig['groups']={};for(const p of state.participants){const k=`${p.date}-${p.room}`;(groups[k]??={})[p.studentId]=true;}
  return {schemaVersion:1,master:JSON.stringify(state),slotCount:state.assignments.length,teacherCount:state.teachers.length,allowed,parallels,slots,
    limits:Object.fromEntries(state.teachers.map(t=>[t.id,{min:t.minDuties,max:t.maxDuties??state.assignments.length}])),
    teacherNames:Object.fromEntries(state.teachers.map(t=>[t.id,t.name])),studentIds:Object.fromEntries(state.students.map(s=>[s.id,true])),groups,days:Object.fromEntries(state.days.map(d=>[d.date,d.periods])),createdAt:at,createdBy:uid};
}
export function cloudSchedule<TTime>(state:SchoolState,uid:string,at:TTime,revision=0):CloudSchedule<TTime>{
  return {assignments:Object.fromEntries(state.assignments.map(a=>[a.id,a.teacherId])),counts:Object.fromEntries(state.teachers.map(t=>[t.id,teacherLoad(state,t.id)])),revision,updatedAt:at,updatedBy:uid};
}
export function stateWithSchedule(config:CloudConfig,schedule:CloudSchedule):SchoolState{
  const state=JSON.parse(config.master) as SchoolState;
  state.assignments=state.assignments.map(a=>{const teacherId=schedule.assignments[a.id];if(!teacherId)throw new Error('임장 자료를 다시 확인해 주세요.');return {...a,teacherId};});
  state.attendance={};state.additionalParticipants=[];return state;
}
