import {changedSchedule,periodKey,recordKey,roomLabel,roomRoster,scheduleErrors,schoolDate,slotKey,statusOptions} from './domain';
import type {AttendanceStatus,Room,Snapshot} from './types';
export class MutationError extends Error {constructor(public status:number,message:string){super(message);}}
export function applyMutation(snapshot:Snapshot,body:Record<string,unknown>,actor:string,now=new Date().toISOString()){
  if(!Number.isInteger(body.baseRevision))throw new MutationError(400,'최신 운영 자료를 다시 불러와 주세요.');
  if(body.baseRevision!==snapshot.revision)throw new MutationError(409,'다른 변경이 먼저 저장되었습니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.');
  const state=structuredClone(snapshot.state);let summary='';let details:unknown;
  if(body.kind==='schedule'){
    if(typeof body.assignmentId!=='string'||typeof body.teacherId!=='string'||(body.swapId!==undefined&&typeof body.swapId!=='string'))throw new MutationError(400,'변경할 교사를 선택해 주세요.');
    const original=state.assignments.find(a=>a.id===body.assignmentId);if(!original)throw new MutationError(404,'임장 일정을 찾지 못했습니다.');
    if(original.extra||state.assignments.some(a=>a.id===body.swapId&&a.extra))throw new MutationError(400,'추가 임장은 해당 교시의 추가 임장 변경에서 수정해 주세요.');
    if(original.teacherId===body.teacherId)throw new MutationError(400,'현재 교사와 다른 교사를 선택해 주세요.');
    let assignments;try{assignments=changedSchedule(state,body.assignmentId,body.teacherId,body.swapId as string|undefined);}catch(error){throw new MutationError(400,(error as Error).message);}
    const errors=scheduleErrors(state,assignments,{requireCoverage:false});if(errors.length)throw new MutationError(422,errors[0]);
    state.assignments=assignments;
    summary=`${schoolDate(original.date)} ${roomLabel(original.room)} ${original.period}교시 ${original.teacherId} → ${body.teacherId}${body.swapId?' (맞교환)':''}`;
    details={assignmentId:body.assignmentId,previousTeacher:original.teacherId,teacherId:body.teacherId,swapId:body.swapId??null,reason:typeof body.reason==='string'?body.reason.trim().slice(0,300):''};
  }else if(body.kind==='coverage'){
    const day=state.days.find(d=>d.date===body.date),room=body.room,period=body.period,teacherId=body.teacherId;
    if(!day||![1,2].includes(Number(room))||typeof room!=='number'||(day.date>'2026-12-01'&&room!==1)||!Number.isInteger(period)||Number(period)<1||Number(period)>day.periods||typeof teacherId!=='string')throw new MutationError(400,'추가 임장 날짜·반·교시를 확인해 주세요.');
    const id=slotKey(day.date,room as Room,Number(period)),source=state.assignments.find(a=>a.id===id);
    if(source&&!source.extra)throw new MutationError(400,'기존 임장표는 교사 변경에서 수정해 주세요.');
    if((source?.teacherId??'')===teacherId)throw new MutationError(400,'변경할 담당 교사를 선택해 주세요.');
    if(teacherId&&!state.teachers.some(t=>t.id===teacherId))throw new MutationError(400,'배정 대상 교사를 선택해 주세요.');
    state.assignments=state.assignments.filter(a=>a.id!==id);
    if(teacherId)state.assignments.push({id,date:day.date,room:room as Room,period:Number(period),teacherId,extra:true});
    const errors=scheduleErrors(state,state.assignments,{requireCoverage:false});if(errors.length)throw new MutationError(422,errors[0]);
    summary=`${schoolDate(day.date)} ${roomLabel(room as Room)} ${period}교시 추가 임장 ${source?.teacherId??'미배정'} → ${teacherId||'미배정'}`;
    details={date:day.date,room,period,assignmentId:id,fromTeacher:source?.teacherId??'',teacherId};
  }else if(body.kind==='roster-manage'){
    const day=state.days.find(d=>d.date===body.date),studentId=body.studentId,room=body.room,start=body.startPeriod,end=body.endPeriod;
    if(!day||typeof studentId!=='string'||!state.students.some(s=>s.id===studentId)||![1,2].includes(Number(room))||typeof room!=='number'||(day.date>'2026-12-01'&&room!==1)||!Number.isInteger(start)||!Number.isInteger(end)||Number(start)<1||Number(end)>day.periods||Number(start)>Number(end))throw new MutationError(400,'추가 일정의 학생·날짜·반·교시를 확인해 주세요.');
    const additions=state.additionalParticipants??[],previous=additions.find(p=>p.studentId===studentId&&p.date===day.date);
    if(!previous||state.participants.some(p=>p.studentId===studentId&&p.date===day.date))throw new MutationError(400,'직접 추가한 등교 일정만 수정할 수 있습니다.');
    if(body.action==='update'){
      if(previous.room!==room&&(snapshot.attendanceLocks?.[`${day.date}|${studentId}`]||Object.values(state.attendance).some(r=>r.studentId===studentId&&r.date===day.date)))throw new MutationError(422,'저장 이력이 있는 날짜는 관리반을 바꿀 수 없습니다. 등교 교시는 수정할 수 있습니다.');
      if(previous.room===room&&previous.startPeriod===start&&previous.endPeriod===end)throw new MutationError(400,'변경된 등교 교시가 없습니다.');
      state.additionalParticipants=additions.map(p=>p===previous?{...p,room:room as Room,startPeriod:Number(start),endPeriod:Number(end)}:p);
    }else if(body.action==='remove'){
      if(previous.room!==room||previous.startPeriod!==start||previous.endPeriod!==end)throw new MutationError(409,'추가 일정이 변경되었습니다. 다시 확인해 주세요.');
      state.additionalParticipants=additions.filter(p=>p!==previous);
    }else throw new MutationError(400,'올바른 일정 변경을 선택해 주세요.');
    summary=`${schoolDate(day.date)} ${roomLabel(room as Room)} 추가 등교 일정 ${body.action==='update'?'수정':'취소'}`;
    details={date:day.date,studentId,room,startPeriod:start,endPeriod:end,action:body.action==='update'?'update':'cancel'};
  }else if(body.kind==='roster-batch'){
    if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>20)throw new MutationError(400,'추가할 운영 날짜를 1일 이상 선택해 주세요.');
    const dates=new Set<string>();
    for(const raw of body.entries){
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==4||!['date','room','startPeriod','endPeriod'].every(key=>Object.hasOwn(raw,key)))throw new MutationError(400,'추가할 날짜와 교시를 확인해 주세요.');
      const entry=raw as Record<string,unknown>;
      if(typeof entry.date!=='string'||dates.has(entry.date))throw new MutationError(400,'선택한 날짜가 중복되었거나 올바르지 않습니다.');
      dates.add(entry.date);
      // Validate every date before the shared client writes anything. The same
      // revision makes all selected additions one operation, including undo.
      const result=applyMutation({...snapshot,state},{kind:'roster',action:body.action,studentId:body.studentId,...entry,baseRevision:body.baseRevision},actor,now);
      state.additionalParticipants=result.state.additionalParticipants;
    }
    const student=state.students.find(s=>s.id===body.studentId)!;
    summary=`${student.name} ${dates.size}일 출석 명단 ${body.action==='add'?'추가':'추가 취소'}`;
    details={studentId:body.studentId,action:body.action,entries:body.entries};
  }else if(body.kind==='roster'){
    const day=state.days.find(d=>d.date===body.date),room=body.room,studentId=body.studentId;
    const student=state.students.find(s=>s.id===studentId);
    if(!day||!student||![1,2].includes(Number(room))||typeof room!=='number'||(day.date>'2026-12-01'&&room!==1))throw new MutationError(400,'추가할 학생과 운영 날짜·관리반을 확인해 주세요.');
    const startPeriod=body.startPeriod,endPeriod=body.endPeriod;
    if(!Number.isInteger(startPeriod)||!Number.isInteger(endPeriod)||Number(startPeriod)<1||Number(endPeriod)>day.periods||Number(startPeriod)>Number(endPeriod))throw new MutationError(400,'등교 교시를 확인해 주세요.');
    if(state.participants.some(p=>p.studentId===studentId&&p.date===day.date))throw new MutationError(400,'이미 해당 날짜의 출석 명단에 등록된 학생입니다.');
    const additions=state.additionalParticipants??[];
    const previous=additions.find(p=>p.date===day.date&&p.studentId===studentId);
    if(body.action==='add'){
      if(previous)throw new MutationError(400,'이미 해당 날짜의 출석 명단에 추가된 학생입니다.');
      const lockedRoom=snapshot.attendanceLocks?.[`${day.date}|${studentId}`]??Object.values(state.attendance).find(r=>r.studentId===studentId&&r.date===day.date)?.room;
      if(lockedRoom&&lockedRoom!==room)throw new MutationError(422,'출석 저장 이력이 있는 날짜는 기존 관리반으로 다시 추가해 주세요.');
      state.additionalParticipants=[...additions,{studentId:student.id,date:day.date,room:room as Room,startPeriod:Number(startPeriod),endPeriod:Number(endPeriod),addedRevision:snapshot.revision+1}];
    }else if(body.action==='remove'){
      if(!previous||previous.room!==room||previous.startPeriod!==startPeriod||previous.endPeriod!==endPeriod)throw new MutationError(400,'취소할 추가 명단을 확인해 주세요.');
      if(previous.addedRevision!==snapshot.revision||Object.values(state.attendance).some(r=>r.studentId===studentId&&r.date===day.date))throw new MutationError(422,'추가 후 다른 기록이 저장되어 명단 추가를 취소할 수 없습니다.');
      state.additionalParticipants=additions.filter(p=>p!==previous);
    }else throw new MutationError(400,'지원하지 않는 명단 변경입니다.');
    summary=`${schoolDate(day.date)} ${roomLabel(room as Room)} ${student.classNo}반 ${student.number}번 ${student.name} ${body.action==='add'?'추가':'추가 취소'}`;
    details={date:day.date,room,studentId:student.id,startPeriod,endPeriod,action:body.action};
  }else if(body.kind==='attendance'||body.kind==='attendance-undo'){
    const day=state.days.find(d=>d.date===body.date),period=body.period,room=body.room;
    if(!day||!Number.isInteger(period)||Number(period)<1||Number(period)>day.periods||![1,2].includes(Number(room))||(day.date>'2026-12-01'&&room!==1))throw new MutationError(400,'운영 날짜와 교시를 확인해 주세요.');
    const undo=body.kind==='attendance-undo'?snapshot.attendanceUndo?.[periodKey(day.date,room as Room,Number(period))]:undefined;
    if(body.kind==='attendance-undo'&&(!undo||undo.revision!==body.undoRevision))throw new MutationError(409,'취소할 직전 저장이 변경되었습니다. 최신 내용을 확인해 주세요.');
    const changes=undo?.changes??body.changes;
    if(!Array.isArray(changes)||!changes.length||changes.length>100)throw new MutationError(400,'저장할 출석 기록을 확인해 주세요.');
    if(body.action!==undefined&&!['save','reset'].includes(String(body.action)))throw new MutationError(400,'올바른 출석 작업을 선택해 주세요.');
    const roster=new Set(roomRoster(state,day.date,room as Room,Number(period)).map(s=>s.id)),undoIds=new Set(undo?.changes.map(c=>c.studentId)??[]),seen=new Set<string>();const previous:unknown[]=[];
    for(const raw of changes){
      if(!raw||typeof raw!=='object')throw new MutationError(400,'출석 기록 형식을 확인해 주세요.');
      const c=raw as {studentId:unknown;status:unknown;note:unknown};
      if(typeof c.studentId!=='string'||(!roster.has(c.studentId)&&!undoIds.has(c.studentId))||!state.students.some(s=>s.id===c.studentId)||seen.has(c.studentId))throw new MutationError(400,'명단에 없는 학생이거나 기록이 중복되었습니다.');
      if(c.status!==null&&!statusOptions.includes(c.status as AttendanceStatus))throw new MutationError(400,'올바른 출석 상태를 선택해 주세요.');
      if(typeof c.note!=='string'||c.note.length>300)throw new MutationError(400,'메모는 300자 이내로 입력해 주세요.');
      seen.add(c.studentId);const key=recordKey(day.date,c.studentId,Number(period));previous.push({studentId:c.studentId,record:state.attendance[key]??null});
      if(c.status===null)delete state.attendance[key];else state.attendance[key]={studentId:c.studentId,date:day.date,period:Number(period),room:room as Room,status:c.status as AttendanceStatus,note:c.note.trim(),updatedAt:now,updatedBy:actor};
    }
    summary=`${schoolDate(day.date)} ${roomLabel(room as Room)} ${period}교시 ${changes.length}명 ${undo?'직전 저장 취소':body.action==='reset'?'기록 초기화':'출석 기록'}`;
    details={date:day.date,period,room,previous,changes,action:undo?'undo':body.action??'save'};
  }else throw new MutationError(400,'지원하지 않는 변경입니다.');
  return {state,summary,details,kind:String(body.kind)};
}
