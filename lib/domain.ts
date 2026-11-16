import type {Assignment,AttendanceRecord,AttendanceStatus,Participant,Room,SchoolState,Student} from './types';

export const STATUS = {
  present:{label:'출석',short:'출석',tone:'present'},late:{label:'지각',short:'지각',tone:'late'},
  early:{label:'조퇴',short:'조퇴',tone:'early'},absent:{label:'결석',short:'결석',tone:'absent'},
  experience:{label:'체험학습',short:'체험',tone:'experience'},
} as const;
export const statusOptions=Object.keys(STATUS) as AttendanceStatus[];
export const recordKey=(date:string,studentId:string,period:number)=>`${date}|${studentId}|${period}`;
export const periodKey=(date:string,room:Room,period:number)=>`${date}|${room}|${period}`;
export const slotKey=(date:string,room:Room,period:number)=>`${date}-${room}-${period}`;
export const roomLabel=(room:Room)=>room===1?'A반':'B반';
export function schoolDate(date:string,long=false){
  const [,m,d]=date.split('-').map(Number);return long?`${m}월 ${d}일`:`${m}/${d}`;
}
export function dayParticipants(state:SchoolState,date:string):Participant[]{
  const active:Participant[]=[...state.participants.filter(p=>p.date===date),...(state.additionalParticipants??[]).filter(p=>p.date===date).map(p=>({studentId:p.studentId,date:p.date,room:p.room,startPeriod:p.startPeriod,leavePeriod:p.endPeriod+1}))];
  const known=new Set(active.map(p=>p.studentId));
  for(const record of Object.values(state.attendance))if(record.date===date&&record.room&&!known.has(record.studentId)){
    active.push({studentId:record.studentId,date,room:record.room,startPeriod:1,leavePeriod:1,historical:true});known.add(record.studentId);
  }
  return active;
}
export function expectedStatus(state:SchoolState,studentId:string,date:string,period:number):'present'|'experience'{
  const p=dayParticipants(state,date).find(x=>x.studentId===studentId);
  return p&&period>=(p.startPeriod??1)&&(!p.leavePeriod||period<p.leavePeriod)?'present':'experience';
}
export function getRecord(state:SchoolState,studentId:string,date:string,period:number):AttendanceRecord|undefined{
  return state.attendance[recordKey(date,studentId,period)];
}
export function roomRoster(state:SchoolState,date:string,room:Room,period?:number):Student[]{
  const ids=new Set(dayParticipants(state,date).filter(p=>p.room===room&&(!p.historical||period===undefined||!!getRecord(state,p.studentId,date,period))).map(p=>p.studentId));
  return state.students.filter(s=>ids.has(s.id)).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
}
export function expectedCount(state:SchoolState,date:string,room:Room,period:number){
  return dayParticipants(state,date).filter(p=>p.room===room&&!p.historical&&period>=(p.startPeriod??1)&&(!p.leavePeriod||period<p.leavePeriod)).length;
}
export function missingDuties(state:SchoolState){
  return state.days.flatMap(day=>(day.date<='2026-12-01'?[1,2]:[1]).flatMap(room=>Array.from({length:day.periods},(_,i)=>i+1).filter(period=>expectedCount(state,day.date,room as Room,period)>0&&!state.assignments.some(a=>a.date===day.date&&a.room===room&&a.period===period)).map(period=>({date:day.date,room:room as Room,period}))));
}
export function teacherLoad(state:SchoolState,teacherId:string){return state.assignments.filter(a=>a.teacherId===teacherId).length;}
export function scheduleErrors(state:SchoolState,assignments:Assignment[],{requireCoverage=true}:{requireCoverage?:boolean}={}):string[]{
  const errors:string[]=[];const people=new Map(state.teachers.map(t=>[t.id,t]));
  const days=new Map(state.days.map(d=>[d.date,d]));const times=new Map<string,string>();const slots=new Set<string>();
  for(const a of assignments){
    const t=people.get(a.teacherId),d=days.get(a.date);
    if(!t){errors.push('배정 대상에 없는 교사입니다.');continue;}
    if(!d||a.period<1||a.period>d.periods||![1,2].includes(a.room)||(a.date>'2026-12-01'&&a.room!==1)||(!a.extra&&!state.participants.some(p=>p.date===a.date&&p.room===a.room&&(!p.leavePeriod||a.period<p.leavePeriod)))){errors.push('운영하지 않는 교시에 교사를 배정할 수 없습니다.');continue;}
    const lesson=state.blocked.find(b=>b.teacherId===a.teacherId&&b.weekday===d.weekday&&b.period===a.period);
    if(lesson)errors.push(`${t.name} 선생님은 ${d.weekday}요일 ${a.period}교시에 ${lesson.grade}학년 ${lesson.classNo}반 수업이 있습니다.`);
    const key=`${a.date}|${a.period}|${a.teacherId}`;
    if(times.has(key))errors.push(`${schoolDate(a.date)} ${a.period}교시에 ${t.name} 선생님의 임장이 겹칩니다.`);else times.set(key,a.id);
    const slot=`${a.date}|${a.room}|${a.period}`;
    if(slots.has(slot))errors.push('같은 관리반·교시에 배정이 중복되어 있습니다.');slots.add(slot);
  }
  for(const t of state.teachers){
    const n=assignments.filter(a=>a.teacherId===t.id).length;
    if(n<t.minDuties||(t.maxDuties!==null&&n>t.maxDuties))errors.push(`${t.name} 선생님은 전체 기간 ${t.minDuties}~${t.maxDuties}교시 범위로 배정해야 합니다. 현재 ${n}교시입니다.`);
  }
  if(requireCoverage)for(const day of state.days)for(const room of(day.date<='2026-12-01'?[1,2]:[1])as Room[])for(let p=1;p<=day.periods;p++){
    if(expectedCount(state,day.date,room,p)>0&&!slots.has(`${day.date}|${room}|${p}`))errors.push('교사가 배정되지 않은 운영 교시가 있습니다.');
  }
  return [...new Set(errors)];
}
export function changedSchedule(state:SchoolState,id:string,teacherId:string,swapId?:string):Assignment[]{
  const source=state.assignments.find(a=>a.id===id);if(!source)throw new Error('수정할 임장 일정을 찾지 못했습니다.');
  const swap=swapId?state.assignments.find(a=>a.id===swapId):undefined;
  if(swapId&&(!swap||swap.id===id||swap.teacherId!==teacherId))throw new Error('맞교환할 일정을 다시 선택해 주세요.');
  return state.assignments.map(a=>a.id===id?{...a,teacherId}:swap&&a.id===swap.id?{...a,teacherId:source.teacherId}:a);
}
export function sameAttendance(a:Pick<AttendanceRecord,'status'|'note'>|undefined,b:{status:AttendanceStatus|null;note:string}){
  return (a?.status??null)===b.status&&(a?.note??'')===b.note;
}
