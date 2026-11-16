import {useMemo,useState} from 'react';
import {Loader2,Search,UserPlus,X} from 'lucide-react';
import type {Room,RosterDateEntry,SchoolDay,Snapshot} from '../../lib/types';
import {dayParticipants,roomLabel,schoolDate} from '../../lib/domain';
import {CalendarGrid,EmptyState,Modal} from './ui';

export interface RosterMutation {kind:'roster-batch';action:'add'|'remove';studentId:string;entries:RosterDateEntry[];baseRevision:number}
export function AddStudentModal({snapshot,date,room,period,onClose,onSave}:{snapshot:Snapshot;date:string;room:Room;period:number;onClose:()=>void;onSave:(change:RosterMutation)=>Promise<void>}){
  const {state}=snapshot;
  const [classNo,setClassNo]=useState(0),[search,setSearch]=useState(''),[selected,setSelected]=useState('');
  const [dates,setDates]=useState([date]),[month,setMonth]=useState(date.slice(0,7));
  const [ranges,setRanges]=useState<Record<string,{startPeriod:number;endPeriod:number}>>({[date]:{startPeriod:period,endPeriod:state.days.find(d=>d.date===date)!.periods}});
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const registered=useMemo(()=>new Map(state.days.map(d=>[d.date,new Set(dayParticipants(state,d.date).map(p=>p.studentId))])),[state]);
  const candidates=state.students.filter(s=>(classNo===0||s.classNo===classNo)&&`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
  const student=state.students.find(s=>s.id===selected),selectedDays=state.days.filter(d=>dates.includes(d.date));
  const rangeFor=(day:SchoolDay)=>ranges[day.date]??{startPeriod:Math.min(period,day.periods),endPeriod:day.periods};
  const disabledDates=Object.fromEntries(state.days.filter(d=>selected&&registered.get(d.date)?.has(selected)).map(d=>[d.date,'이미 출석 명단에 등록된 날짜']));
  const conflicts=selectedDays.filter(d=>registered.get(d.date)?.has(selected));
  const changeDates=(next:string[])=>{
    const ordered=state.days.filter(d=>next.includes(d.date));
    setDates(ordered.map(d=>d.date));setRanges(previous=>{const values={...previous};for(const day of ordered)values[day.date]??={startPeriod:Math.min(period,day.periods),endPeriod:day.periods};return values;});setError('');
  };
  const changeRange=(day:SchoolDay,edge:'start'|'end',value:number)=>{
    const previous=rangeFor(day);
    const next=edge==='start'?{startPeriod:value,endPeriod:Math.max(previous.endPeriod,value)}:{startPeriod:Math.min(previous.startPeriod,value),endPeriod:value};
    setRanges(values=>({...values,[day.date]:next}));setError('');
  };
  const applyFirstRange=()=>{
    if(!selectedDays.length)return;const first=rangeFor(selectedDays[0]);
    setRanges(previous=>{const values={...previous};for(const day of selectedDays)values[day.date]={startPeriod:Math.min(first.startPeriod,day.periods),endPeriod:Math.min(first.endPeriod,day.periods)};return values;});setError('');
  };
  const chooseStudent=(id:string)=>{setSelected(id);changeDates(dates.filter(d=>!registered.get(d)?.has(id)));};
  const save=async()=>{
    if(!student||!selectedDays.length||conflicts.length||saving)return;setSaving(true);setError('');
    const entries:RosterDateEntry[]=selectedDays.map(d=>({date:d.date,room:d.date>'2026-12-01'?1:room,...rangeFor(d)}));
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
      <section className="student-range-editor" aria-label="날짜별 등교 교시 설정"><div className="student-range-heading"><h3>날짜별 등교 교시</h3>{selectedDays.length>1&&<button className="button secondary compact" disabled={saving} onClick={applyFirstRange}>첫 날짜 교시로 전체 적용</button>}</div>
        {!selectedDays.length?<p className="student-ranges-empty">달력에서 날짜를 선택해 주세요.</p>:<div className="student-date-ranges"><table className="student-date-range-table"><thead><tr><th scope="col">날짜·관리반</th><th scope="col">등교 시작</th><th scope="col">마지막</th><th scope="col"><span className="sr-only">날짜 제외</span></th></tr></thead><tbody>{selectedDays.map(day=>{
          const range=rangeFor(day);
          return <tr key={day.date}><th scope="row"><strong>{schoolDate(day.date)} ({day.weekday})</strong><span>{roomLabel(day.date>'2026-12-01'?1:room)}</span></th><td><select aria-label={`${schoolDate(day.date,true)} 등교 시작 교시`} value={range.startPeriod} disabled={saving} onChange={e=>changeRange(day,'start',Number(e.target.value))}>{Array.from({length:day.periods},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></td><td><select aria-label={`${schoolDate(day.date,true)} 마지막 교시`} value={range.endPeriod} disabled={saving} onChange={e=>changeRange(day,'end',Number(e.target.value))}>{Array.from({length:day.periods},(_,i)=><option value={i+1} key={i}>{i+1}교시</option>)}</select></td><td><button className="icon-button" aria-label={`${schoolDate(day.date,true)} 날짜 제외`} disabled={saving} onClick={()=>changeDates(dates.filter(value=>value!==day.date))}><X size={17}/></button></td></tr>;
        })}</tbody></table></div>}
      </section>
    </section><section className="student-add-dates" aria-label="추가할 날짜 설정">
      <div className="student-dates-heading"><h3>추가할 날짜 <span aria-live="polite">{dates.length}일</span></h3><div><button className="button secondary compact" disabled={saving} onClick={()=>changeDates(state.days.filter(d=>!selected||!registered.get(d.date)?.has(selected)).map(d=>d.date))}>모두 선택</button><button className="button secondary compact" disabled={saving||!dates.length} onClick={()=>changeDates([])}>선택 해제</button></div></div>
      <CalendarGrid days={state.days} month={month} onMonth={setMonth} selectedDates={dates} onSelect={next=>changeDates(dates.includes(next)?dates.filter(d=>d!==next):[...dates,next])} multiple disabled={saving} disabledDates={disabledDates}/>
      <div className="student-date-selection" aria-label="선택한 날짜와 등교 교시">{selectedDays.map(d=>{const range=rangeFor(d);return <button key={d.date} disabled={saving} aria-label={`${schoolDate(d.date,true)} 선택 해제`} onClick={()=>changeDates(dates.filter(value=>value!==d.date))}><span>{schoolDate(d.date)} · <strong>{range.startPeriod}~{range.endPeriod}교시</strong> · {roomLabel(d.date>'2026-12-01'?1:room)}</span><X size={14}/></button>;})}</div>
    </section></div>
    {(error||conflicts.length>0)&&<div className="inline-alert error" role="alert">{error||`${conflicts.map(d=>schoolDate(d.date)).join(', ')}은 이미 출석 명단에 등록되어 있습니다. 해당 날짜를 선택 해제해 주세요.`}</div>}
    <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={!student||!dates.length||conflicts.length>0||saving} onClick={save}>{saving?<Loader2 className="spin" size={18}/>:<UserPlus size={18}/>}선택한 {dates.length}일에 추가</button></div>
  </Modal>;
}
