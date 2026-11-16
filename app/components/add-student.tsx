import {useMemo,useState} from 'react';
import {Loader2,Search,UserPlus,X} from 'lucide-react';
import type {Room,RosterDateEntry,Snapshot} from '../../lib/types';
import {dayParticipants,schoolDate} from '../../lib/domain';
import {CalendarGrid,EmptyState,Modal} from './ui';

export interface RosterMutation {kind:'roster-batch';action:'add'|'remove';studentId:string;entries:RosterDateEntry[];baseRevision:number}
export function AddStudentModal({snapshot,date,room,period,onClose,onSave}:{snapshot:Snapshot;date:string;room:Room;period:number;onClose:()=>void;onSave:(change:RosterMutation)=>Promise<void>}){
  const {state}=snapshot;
  const [classNo,setClassNo]=useState(0),[search,setSearch]=useState(''),[selected,setSelected]=useState('');
  const [dates,setDates]=useState([date]),[month,setMonth]=useState(date.slice(0,7));
  const [startPeriod,setStartPeriod]=useState(period),[endPeriod,setEndPeriod]=useState<number|'last'>('last');
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const registered=useMemo(()=>new Map(state.days.map(d=>[d.date,new Set(dayParticipants(state,d.date).map(p=>p.studentId))])),[state]);
  const candidates=state.students.filter(s=>(classNo===0||s.classNo===classNo)&&`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
  const student=state.students.find(s=>s.id===selected),selectedDays=state.days.filter(d=>dates.includes(d.date));
  const maxPeriod=selectedDays.length?Math.min(...selectedDays.map(d=>d.periods)):7;
  const disabledDates=Object.fromEntries(state.days.filter(d=>selected&&registered.get(d.date)?.has(selected)).map(d=>[d.date,'이미 출석 명단에 등록된 날짜']));
  const conflicts=selectedDays.filter(d=>registered.get(d.date)?.has(selected));
  const changeDates=(next:string[])=>{
    const ordered=state.days.filter(d=>next.includes(d.date)),maximum=ordered.length?Math.min(...ordered.map(d=>d.periods)):7;
    setDates(ordered.map(d=>d.date));setStartPeriod(p=>Math.min(p,maximum));setEndPeriod(p=>p==='last'?p:Math.min(p,maximum));setError('');
  };
  const chooseStudent=(id:string)=>{setSelected(id);changeDates(dates.filter(d=>!registered.get(d)?.has(id)));};
  const save=async()=>{
    if(!student||!selectedDays.length||conflicts.length||saving)return;setSaving(true);setError('');
    const entries:RosterDateEntry[]=selectedDays.map(d=>({date:d.date,room:d.date>'2026-12-01'?1:room,startPeriod,endPeriod:endPeriod==='last'?d.periods:endPeriod}));
    try{await onSave({kind:'roster-batch',action:'add',studentId:student.id,entries,baseRevision:snapshot.revision});}
    catch(e){setError(e instanceof Error?e.message:'학생을 추가하지 못했습니다.');}finally{setSaving(false);}
  };
  return <Modal title="출석 학생 추가" onClose={()=>{if(!saving)onClose();}} wide className="student-add-modal">
    <div className="student-add-layout"><section>
      <div className="student-picker-query">
        <label className="field"><span>원반</span><select value={classNo} disabled={saving} onChange={e=>{setClassNo(Number(e.target.value));setSelected('');setError('');}}><option value={0}>전체 원반</option>{Array.from({length:13},(_,i)=><option value={i+1} key={i}>{i+1}반</option>)}</select></label>
        <label className="field"><span>학생 검색</span><span className="search-box"><Search size={18}/><input aria-label="추가할 학생 검색" value={search} disabled={saving} placeholder="이름 또는 반·번호" onChange={e=>{setSearch(e.target.value);setSelected('');setError('');}}/></span></label>
      </div>
      <div className="student-picker-list" role="radiogroup" aria-label="추가할 학생">
        {!candidates.length?<EmptyState title="검색한 학생이 없습니다"/>:candidates.map(s=><label key={s.id} className={selected===s.id?'selected':''}><input type="radio" name="additional-student" disabled={saving} checked={selected===s.id} onChange={()=>chooseStudent(s.id)}/><span>{s.classNo}반 {s.number}번</span><strong title={s.originalName}>{s.name}</strong></label>)}
      </div>
      <div className="student-period-range">
        <label className="field"><span>등교 시작 교시</span><select value={startPeriod} disabled={saving} onChange={e=>{const p=Number(e.target.value);setStartPeriod(p);setEndPeriod(v=>v==='last'?v:Math.max(v,p));setError('');}}>{Array.from({length:maxPeriod},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></label>
        <label className="field"><span>마지막 교시</span><select value={endPeriod} disabled={saving} onChange={e=>{const p=e.target.value==='last'?'last':Number(e.target.value);setEndPeriod(p);if(p!=='last')setStartPeriod(v=>Math.min(v,p));setError('');}}><option value="last">해당일 마지막 교시</option>{Array.from({length:maxPeriod},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></label>
      </div>
    </section><section className="student-add-dates" aria-label="추가할 날짜 설정">
      <div className="student-dates-heading"><h3>추가할 날짜 <span aria-live="polite">{dates.length}일</span></h3><div><button className="button secondary compact" disabled={saving} onClick={()=>changeDates(state.days.filter(d=>!selected||!registered.get(d.date)?.has(selected)).map(d=>d.date))}>모두 선택</button><button className="button secondary compact" disabled={saving||!dates.length} onClick={()=>changeDates([])}>선택 해제</button></div></div>
      <CalendarGrid days={state.days} month={month} onMonth={setMonth} selectedDates={dates} onSelect={next=>changeDates(dates.includes(next)?dates.filter(d=>d!==next):[...dates,next])} multiple disabled={saving} disabledDates={disabledDates}/>
      <div className="student-date-selection" aria-label="선택한 날짜">{selectedDays.map(d=><button key={d.date} disabled={saving} aria-label={`${schoolDate(d.date,true)} 선택 해제`} onClick={()=>changeDates(dates.filter(value=>value!==d.date))}><span>{schoolDate(d.date)} · 기간{d.date>'2026-12-01'?1:room}반</span><X size={14}/></button>)}</div>
    </section></div>
    {(error||conflicts.length>0)&&<div className="inline-alert error" role="alert">{error||`${conflicts.map(d=>schoolDate(d.date)).join(', ')}은 이미 출석 명단에 등록되어 있습니다. 해당 날짜를 선택 해제해 주세요.`}</div>}
    <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={!student||!dates.length||conflicts.length>0||saving} onClick={save}>{saving?<Loader2 className="spin" size={18}/>:<UserPlus size={18}/>}선택한 {dates.length}일에 추가</button></div>
  </Modal>;
}
