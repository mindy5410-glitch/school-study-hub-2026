import {useState} from 'react';
import {AlertCircle,CalendarPlus,Loader2,Pencil,Search,X} from 'lucide-react';
import type {AdditionalParticipant,Room,Snapshot} from '../../lib/types';
import {roomLabel,schoolDate} from '../../lib/domain';
import {EmptyState,Modal} from './ui';

export interface RosterManageMutation {kind:'roster-manage';action:'update'|'remove';date:string;studentId:string;room:Room;startPeriod:number;endPeriod:number;baseRevision:number}
export function RosterManager({snapshot,onClose,onSave,onAddDates}:{snapshot:Snapshot;onClose:()=>void;onSave:(change:RosterManageMutation)=>Promise<void>;onAddDates:(studentId:string)=>void}){
  const {state}=snapshot;
  const [search,setSearch]=useState(''),[editing,setEditing]=useState<AdditionalParticipant|null>(null),[cancelling,setCancelling]=useState<AdditionalParticipant|null>(null);
  const [room,setRoom]=useState<Room>(1),[start,setStart]=useState(1),[end,setEnd]=useState(6),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const studentFor=(id:string)=>state.students.find(s=>s.id===id)!;
  const entries=[...(state.additionalParticipants??[])].filter(p=>{const s=studentFor(p.studentId);return `${s.classNo}반 ${s.number}번 ${s.name} ${schoolDate(p.date)}`.includes(search.trim());}).sort((a,b)=>a.date.localeCompare(b.date)||studentFor(a.studentId).classNo-studentFor(b.studentId).classNo||studentFor(a.studentId).number-studentFor(b.studentId).number);
  const edit=(entry:AdditionalParticipant)=>{setEditing(entry);setCancelling(null);setRoom(entry.room);setStart(entry.startPeriod);setEnd(entry.endPeriod);setError('');};
  const locked=!!editing&&(!!snapshot.attendanceLocks?.[`${editing.date}|${editing.studentId}`]||Object.values(state.attendance).some(r=>r.date===editing.date&&r.studentId===editing.studentId));
  const submit=async(entry:AdditionalParticipant,action:'update'|'remove')=>{
    if(saving)return;setSaving(true);setError('');
    try{await onSave({kind:'roster-manage',action,date:entry.date,studentId:entry.studentId,room:action==='update'?room:entry.room,startPeriod:action==='update'?start:entry.startPeriod,endPeriod:action==='update'?end:entry.endPeriod,baseRevision:snapshot.revision});setEditing(null);setCancelling(null);}
    catch(e){setError(e instanceof Error?e.message:'추가 일정을 변경하지 못했습니다.');if((e as {status?:number}).status===409){setEditing(null);setCancelling(null);}}
    finally{setSaving(false);}
  };
  return <Modal title="추가 등교 일정 관리" onClose={()=>{if(!saving)onClose();}} wide className="roster-manager-modal">
    <label className="search-box roster-manager-search"><Search size={18}/><input aria-label="추가 일정 학생 또는 날짜 검색" placeholder="이름, 원반, 날짜 검색" disabled={saving} value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {editing&&<section className="roster-edit-form" aria-label="추가 등교 일정 수정">
      <h3>{studentFor(editing.studentId).name} · {schoolDate(editing.date,true)}</h3>
      <div className="roster-range-fields"><label className="field"><span>관리반</span><select aria-label="수정할 관리반" value={room} disabled={saving||locked||editing.date>'2026-12-01'} onChange={e=>setRoom(Number(e.target.value)as Room)}><option value={1}>{roomLabel(1)}</option>{editing.date<='2026-12-01'&&<option value={2}>{roomLabel(2)}</option>}</select></label><label className="field"><span>등교 시작</span><select aria-label="수정할 등교 시작 교시" disabled={saving} value={start} onChange={e=>{const v=Number(e.target.value);setStart(v);setEnd(Math.max(end,v));}}>{Array.from({length:state.days.find(d=>d.date===editing.date)!.periods},(_,i)=><option key={i} value={i+1}>{i+1}교시</option>)}</select></label><label className="field"><span>마지막 교시</span><select aria-label="수정할 마지막 교시" disabled={saving} value={end} onChange={e=>{const v=Number(e.target.value);setEnd(v);setStart(Math.min(start,v));}}>{Array.from({length:state.days.find(d=>d.date===editing.date)!.periods},(_,i)=><option key={i} value={i+1}>{i+1}교시</option>)}</select></label></div>
      {locked&&<p className="roster-manage-note">출석 저장 이력이 있어 관리반은 유지됩니다. 등교 교시는 수정할 수 있습니다.</p>}
      <div className="modal-actions"><button className="button secondary compact" disabled={saving} onClick={()=>setEditing(null)}>수정 취소</button><button className="button primary compact" disabled={saving||room===editing.room&&start===editing.startPeriod&&end===editing.endPeriod} onClick={()=>submit(editing,'update')}>{saving&&<Loader2 size={16} className="spin"/>}일정 저장</button></div>
    </section>}
    {cancelling&&<section className="roster-cancel-confirm" aria-label="추가 일정 취소 확인"><h3>{schoolDate(cancelling.date,true)} · {studentFor(cancelling.studentId).name} 일정 취소</h3><p>이 날짜의 추가 등교 일정을 취소할까요? 이미 저장한 출석 상태와 메모는 원반별 출석부와 해당 교시에 남습니다.</p><div className="modal-actions"><button className="button secondary compact" disabled={saving} onClick={()=>setCancelling(null)}>돌아가기</button><button className="button primary compact" disabled={saving} onClick={()=>submit(cancelling,'remove')}>{saving&&<Loader2 size={16} className="spin"/>}이 날짜 일정 취소</button></div></section>}
    {error&&<div className="inline-alert error" role="alert"><AlertCircle size={17}/>{error}</div>}
    {!entries.length?<EmptyState title={state.additionalParticipants?.length?'검색한 추가 일정이 없습니다':'추가한 등교 일정이 없습니다'}/>:<div className="roster-manager-scroll"><table className="roster-manager-table"><thead><tr><th scope="col">날짜</th><th scope="col">학생</th><th scope="col">등교 일정</th><th scope="col">관리</th></tr></thead><tbody>{entries.map(entry=>{const s=studentFor(entry.studentId),context=`${schoolDate(entry.date)} ${s.name}`;return <tr key={`${entry.date}|${entry.studentId}`}><th scope="row">{schoolDate(entry.date)}<small>{state.days.find(d=>d.date===entry.date)!.weekday}요일</small></th><td><strong>{s.name}</strong><small>{s.classNo}반 {s.number}번</small></td><td>{roomLabel(entry.room)}<small>{entry.startPeriod}~{entry.endPeriod}교시</small></td><td><div className="roster-row-actions"><button className="button secondary compact" disabled={saving} aria-label={`${context} 교시 수정`} onClick={()=>edit(entry)}><Pencil size={15}/>수정</button><button className="button secondary compact" disabled={saving} aria-label={`${s.name} 날짜 추가`} onClick={()=>onAddDates(s.id)}><CalendarPlus size={15}/>날짜 추가</button><button className="button secondary compact" disabled={saving} aria-label={`${context} 일정 취소`} onClick={()=>{setCancelling(entry);setEditing(null);setError('');}}><X size={15}/>취소</button></div></td></tr>;})}</tbody></table></div>}
    <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>닫기</button></div>
  </Modal>;
}
