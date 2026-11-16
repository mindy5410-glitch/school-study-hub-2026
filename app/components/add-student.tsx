import {useState} from 'react';
import {Loader2,Search,UserPlus} from 'lucide-react';
import type {Room,Snapshot} from '../../lib/types';
import {dayParticipants,schoolDate} from '../../lib/domain';
import {EmptyState,Modal} from './ui';

export interface RosterMutation {kind:'roster';action:'add'|'remove';date:string;room:Room;studentId:string;startPeriod:number;endPeriod:number;baseRevision:number}
export function AddStudentModal({snapshot,date,room,period,onClose,onSave}:{snapshot:Snapshot;date:string;room:Room;period:number;onClose:()=>void;onSave:(change:RosterMutation)=>Promise<void>}){
  const day=snapshot.state.days.find(d=>d.date===date)!;
  const [classNo,setClassNo]=useState(0),[search,setSearch]=useState(''),[selected,setSelected]=useState('');
  const [startPeriod,setStartPeriod]=useState(period),[endPeriod,setEndPeriod]=useState(day.periods);
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const registered=new Set(dayParticipants(snapshot.state,date).map(p=>p.studentId));
  const candidates=snapshot.state.students.filter(s=>!registered.has(s.id)&&(classNo===0||s.classNo===classNo)&&`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
  const student=candidates.find(s=>s.id===selected);
  const save=async()=>{
    if(!student||saving)return;setSaving(true);setError('');
    try{await onSave({kind:'roster',action:'add',date,room,studentId:student.id,startPeriod,endPeriod,baseRevision:snapshot.revision});}
    catch(e){setError(e instanceof Error?e.message:'학생을 추가하지 못했습니다.');}finally{setSaving(false);}
  };
  return <Modal title="출석 학생 추가" description={`${schoolDate(date,true)} (${day.weekday}) · 기간${room}반(${room+2}반)`} onClose={()=>{if(!saving)onClose();}} wide>
    <div className="student-picker-query">
      <label className="field"><span>원반</span><select value={classNo} disabled={saving} onChange={e=>{setClassNo(Number(e.target.value));setSelected('');setError('');}}><option value={0}>전체 원반</option>{Array.from({length:13},(_,i)=><option value={i+1} key={i}>{i+1}반</option>)}</select></label>
      <label className="field"><span>학생 검색</span><span className="search-box"><Search size={18}/><input aria-label="추가할 학생 검색" value={search} disabled={saving} placeholder="이름 또는 반·번호" onChange={e=>{setSearch(e.target.value);setSelected('');setError('');}}/></span></label>
    </div>
    <div className="student-picker-list" role="radiogroup" aria-label="추가할 학생">
      {!candidates.length?<EmptyState title="추가할 학생이 없습니다"/>:candidates.map(s=><label key={s.id} className={selected===s.id?'selected':''}><input type="radio" name="additional-student" disabled={saving} checked={selected===s.id} onChange={()=>{setSelected(s.id);setError('');}}/><span>{s.classNo}반 {s.number}번</span><strong title={s.originalName}>{s.name}</strong></label>)}
    </div>
    <div className="student-period-range">
      <label className="field"><span>등교 시작 교시</span><select value={startPeriod} disabled={saving} onChange={e=>{const p=Number(e.target.value);setStartPeriod(p);setEndPeriod(v=>Math.max(v,p));}}>{Array.from({length:day.periods},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></label>
      <label className="field"><span>마지막 교시</span><select value={endPeriod} disabled={saving} onChange={e=>{const p=Number(e.target.value);setEndPeriod(p);setStartPeriod(v=>Math.min(v,p));}}>{Array.from({length:day.periods},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></label>
    </div>
    {error&&<div className="inline-alert error" role="alert">{error}</div>}
    <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={!student||saving} onClick={save}>{saving?<Loader2 className="spin" size={18}/>:<UserPlus size={18}/>}출석 명단에 추가</button></div>
  </Modal>;
}
