'use client';
import {useMemo} from 'react';
import {Save,Loader2,Search,UserPlus,RotateCcw} from 'lucide-react';
import type {Room,Snapshot} from '../../lib/types';
import {expectedStatus,getRecord,roomRoster,sameAttendance,schoolDate} from '../../lib/domain';
import {attendanceInput,attendanceChanges,attendanceResetChanges,type AttendanceValue,type AttendanceDrafts} from '../../lib/attendance-form';
import {DatePicker,EmptyState,StatusBadge} from './ui';

export type Drafts=AttendanceDrafts;
export function AttendanceView({snapshot,date,room,period,onDate,onRoom,onPeriod,drafts,onDrafts,onSave,onAddStudent,onReset,saving,search,onSearch}:{snapshot:Snapshot;date:string;room:Room;period:number;onDate:(d:string)=>void;onRoom:(r:Room)=>void;onPeriod:(p:number)=>void;drafts:Drafts;onDrafts:(d:Drafts)=>void;onSave:()=>void;onAddStudent:()=>void;onReset:()=>void;saving:boolean;search:string;onSearch:(s:string)=>void}){
  const {state}=snapshot;const day=state.days.find(d=>d.date===date)!;
  const all=useMemo(()=>roomRoster(state,date,room),[state,date,room]);
  const roster=all.filter(s=>`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.toLowerCase()));
  const changes=attendanceChanges(state,date,room,period,drafts),edited=Object.keys(drafts).length>0;
  const savedCount=attendanceResetChanges(state,date,room,period).length;
  const current=(id:string)=>drafts[id]??attendanceInput(state,id,date,period);
  const update=(id:string,change:Partial<AttendanceValue>)=>{
    const next={...drafts,[id]:{...current(id),...change}};
    if(sameAttendance(attendanceInput(state,id,date,period),next[id]))delete next[id];
    onDrafts(next);
  };
  return <>
    <section className="panel"><div className="panel-toolbar"><DatePicker days={state.days} date={date} onChange={onDate}/><div className="room-tabs"><button className={room===1?'selected':''} onClick={()=>onRoom(1)}>기간1반 <small>3반</small></button><button disabled={date>'2026-12-01'} className={room===2?'selected':''} onClick={()=>onRoom(2)}>기간2반 <small>4반</small></button></div></div>
      <div className="period-toolbar"><span className="control-label">교시 선택</span><div className="period-tabs">{Array.from({length:day.periods},(_,i)=><button key={i} className={period===i+1?'selected':''} onClick={()=>onPeriod(i+1)}>{i+1}교시</button>)}</div></div>
      <div className="table-caption"><p><strong>기간{room}반 출석 명단</strong></p><div className="toolbar-right"><label className="search-box"><Search size={16}/><input aria-label="출석 명단 학생 검색" placeholder="이름 또는 원반 검색" value={search} onChange={e=>onSearch(e.target.value)}/></label><button className="button secondary compact" disabled={saving} onClick={onAddStudent}><UserPlus size={17}/>학생 추가</button><button className="button secondary compact" disabled={saving||savedCount===0} title={savedCount===0?'저장된 기록이 없습니다':undefined} onClick={onReset}><RotateCcw size={17}/>저장 전으로 복원</button></div></div>
      {!all.length?<EmptyState title="출석 예정 학생이 없습니다"/>:!roster.length?<EmptyState title="검색한 학생이 없습니다"/>:<div className="table-scroll"><table className="attendance-table"><thead><tr><th scope="col">원반</th><th scope="col">번호</th><th scope="col">학생</th><th scope="col">해당 교시 예정</th><th scope="col">출석 상태</th><th scope="col">메모</th></tr></thead><tbody>{roster.map(s=>{
        const r=getRecord(state,s.id,date,period),v=current(s.id),planned=expectedStatus(state,s.id,date,period),dirty=!!drafts[s.id],additional=state.additionalParticipants?.some(p=>p.studentId===s.id&&p.date===date);
        return <tr key={s.id} className={dirty?'draft-row':''}><td><span className="class-pill">{s.classNo}반</span></td><td>{s.number}</td><th scope="row" className="student-name" title={s.originalName}>{s.name}{additional&&<small className="added-label">추가</small>}{dirty&&<small className="draft-label">저장 전</small>}</th><td><StatusBadge status={planned} planned/></td><td><button type="button" role="switch" className={`attendance-switch ${v.status==='present'?'is-present':'is-absent'}`} aria-label={`${s.name} 출석 상태`} aria-checked={v.status==='present'} disabled={saving} onClick={()=>update(s.id,{status:v.status==='present'?'absent':'present'})}><span className="attendance-switch-track" aria-hidden="true"><span className="attendance-switch-thumb"/></span><span aria-hidden="true">{v.status==='present'?'출석':'결석'}</span></button></td><td><input className="note-input" aria-label={`${s.name} 출석 메모`} maxLength={300} value={v.note} disabled={!v.status||saving} placeholder={v.status?'메모 추가':'상태 선택 후 메모'} title={r?`${r.updatedBy} · ${r.updatedAt}`:undefined} onChange={e=>update(s.id,{note:e.target.value})}/></td></tr>;
      })}</tbody></table></div>}
    </section>
    {changes.length>0&&<div className="save-bar"><div><strong>{changes.length}명 저장 예정</strong><span>{schoolDate(date)} 기간{room}반 · {period}교시</span></div><div>{edited&&<button className="button secondary" disabled={saving} onClick={()=>onDrafts({})}>변경 취소</button>}<button className="button primary" disabled={saving} onClick={onSave}>{saving?<Loader2 size={17} className="spin"/>:<Save size={17}/>}출석 기록 저장</button></div></div>}
  </>;
}
