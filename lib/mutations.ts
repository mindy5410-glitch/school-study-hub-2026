import {changedSchedule,recordKey,roomRoster,scheduleErrors,schoolDate,statusOptions} from './domain';
import type {AttendanceStatus,Room,Snapshot} from './types';
export class MutationError extends Error {constructor(public status:number,message:string){super(message);}}
export function applyMutation(snapshot:Snapshot,body:Record<string,unknown>,actor:string,now=new Date().toISOString()){
  if(!Number.isInteger(body.baseRevision))throw new MutationError(400,'최신 운영 자료를 다시 불러와 주세요.');
  if(body.baseRevision!==snapshot.revision)throw new MutationError(409,'다른 변경이 먼저 저장되었습니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.');
  const state=structuredClone(snapshot.state);let summary='';let details:unknown;
  if(body.kind==='schedule'){
    if(typeof body.assignmentId!=='string'||typeof body.teacherId!=='string'||(body.swapId!==undefined&&typeof body.swapId!=='string'))throw new MutationError(400,'변경할 교사를 선택해 주세요.');
    const original=state.assignments.find(a=>a.id===body.assignmentId);if(!original)throw new MutationError(404,'임장 일정을 찾지 못했습니다.');
    if(original.teacherId===body.teacherId)throw new MutationError(400,'현재 교사와 다른 교사를 선택해 주세요.');
    let assignments;try{assignments=changedSchedule(state,body.assignmentId,body.teacherId,body.swapId as string|undefined);}catch(error){throw new MutationError(400,(error as Error).message);}
    const errors=scheduleErrors(state,assignments);if(errors.length)throw new MutationError(422,errors[0]);
    state.assignments=assignments;
    summary=`${schoolDate(original.date)} 기간${original.room}반 ${original.period}교시 ${original.teacherId} → ${body.teacherId}${body.swapId?' (맞교환)':''}`;
    details={assignmentId:body.assignmentId,previousTeacher:original.teacherId,teacherId:body.teacherId,swapId:body.swapId??null,reason:typeof body.reason==='string'?body.reason.trim().slice(0,300):''};
  }else if(body.kind==='attendance'){
    const day=state.days.find(d=>d.date===body.date),period=body.period,room=body.room;
    if(!day||!Number.isInteger(period)||Number(period)<1||Number(period)>day.periods||![1,2].includes(Number(room))||(day.date>'2026-12-01'&&room!==1))throw new MutationError(400,'운영 날짜와 교시를 확인해 주세요.');
    if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)throw new MutationError(400,'저장할 출석 기록을 확인해 주세요.');
    const roster=new Set(roomRoster(state,day.date,room as Room).map(s=>s.id)),seen=new Set<string>();const previous:unknown[]=[];
    for(const raw of body.changes){
      if(!raw||typeof raw!=='object')throw new MutationError(400,'출석 기록 형식을 확인해 주세요.');
      const c=raw as {studentId:unknown;status:unknown;note:unknown};
      if(typeof c.studentId!=='string'||!roster.has(c.studentId)||seen.has(c.studentId))throw new MutationError(400,'명단에 없는 학생이거나 기록이 중복되었습니다.');
      if(c.status!==null&&!statusOptions.includes(c.status as AttendanceStatus))throw new MutationError(400,'올바른 출석 상태를 선택해 주세요.');
      if(typeof c.note!=='string'||c.note.length>300)throw new MutationError(400,'메모는 300자 이내로 입력해 주세요.');
      seen.add(c.studentId);const key=recordKey(day.date,c.studentId,Number(period));previous.push({studentId:c.studentId,record:state.attendance[key]??null});
      if(c.status===null)delete state.attendance[key];else state.attendance[key]={studentId:c.studentId,date:day.date,period:Number(period),status:c.status as AttendanceStatus,note:c.note.trim(),updatedAt:now,updatedBy:actor};
    }
    summary=`${schoolDate(day.date)} 기간${room}반 ${period}교시 ${body.changes.length}명 출석 기록`;
    details={date:day.date,period,room,previous,changes:body.changes};
  }else throw new MutationError(400,'지원하지 않는 변경입니다.');
  return {state,summary,details,kind:String(body.kind)};
}
