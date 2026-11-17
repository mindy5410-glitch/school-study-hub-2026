'use client';
import {useMemo,useState} from 'react';
import {Pencil,ArrowLeftRight,AlertCircle,Loader2,ChevronLeft,ChevronRight} from 'lucide-react';
import type {Assignment,Room,Snapshot} from '../../lib/types';
import {changedSchedule,expectedCount,missingDuties,roomLabel,scheduleErrors,schoolDate,schoolWeeks,slotKey,teacherLoad} from '../../lib/domain';
import {DatePicker,EmptyState,Modal} from './ui';

export interface ScheduleMutation {kind:'schedule';assignmentId:string;teacherId:string;swapId?:string;reason:string;baseRevision:number}
export function ScheduleView({snapshot,date,onDate,teacher,onTeacher,scope,onScope,onEdit,busy=false}:{snapshot:Snapshot;date:string;onDate:(date:string)=>void;teacher:string;onTeacher:(id:string)=>void;scope:'week'|'day';onScope:(s:'week'|'day')=>void;onEdit:(a:Assignment)=>void;busy?:boolean}){
  const {state}=snapshot;const [showEmpty,setShowEmpty]=useState(false);
  const weeks=useMemo(()=>schoolWeeks(state.days),[state.days]);
  const weekIndex=Math.max(0,weeks.findIndex(week=>week.days.some(day=>day.date===date))),week=weeks[weekIndex];
  const visibleDays=scope==='week'?(week?.days??[]):state.days.filter(day=>day.date===date);
  const columns=visibleDays.flatMap(day=>(day.date<='2026-12-01'?[1,2]:[1]).map(room=>({day,room:room as Room})))
    .filter(({day,room})=>showEmpty||Array.from({length:day.periods},(_,i)=>i+1).some(p=>expectedCount(state,day.date,room,p)>0)||state.assignments.some(a=>a.date===day.date&&a.room===room))
    .filter(({day,room})=>teacher==='all'||state.assignments.some(a=>a.date===day.date&&a.room===room&&a.teacherId===teacher));
  const dateGroups=visibleDays.map(day=>({day,count:columns.filter(column=>column.day.date===day.date).length})).filter(group=>group.count>0);
  const missing=missingDuties(state);
  return <>
    {missing.length>0&&<div className="coverage-warning" role="status"><AlertCircle size={19}/><span>등교 학생이 있지만 임장 교사가 없는 교시가 <strong>{missing.length}개</strong> 있습니다.</span><button className="button secondary compact" disabled={busy} onClick={()=>{onTeacher('all');onScope('week');onDate(missing[0].date);}}>미배정 확인</button></div>}
    <section className="panel"><div className="panel-toolbar schedule-toolbar"><div className="segmented"><button disabled={busy} className={scope==='week'?'selected':''} aria-pressed={scope==='week'} onClick={()=>onScope('week')}>주별 보기</button><button disabled={busy} className={scope==='day'?'selected':''} aria-pressed={scope==='day'} onClick={()=>onScope('day')}>선택일</button></div>
      {scope==='week'&&<div className="week-picker"><button className="icon-button" aria-label="이전 주" disabled={busy||weekIndex<=0} onClick={()=>onDate(weeks[weekIndex-1].days[0].date)}><ChevronLeft size={18}/></button><label className="sr-only" htmlFor="schedule-week">주차 선택</label><select id="schedule-week" value={week?.id??''} disabled={busy||!weeks.length} onChange={e=>{const next=weeks.find(w=>w.id===e.target.value);if(next)onDate(next.days[0].date);}}>{weeks.map(w=><option key={w.id} value={w.id}>{schoolDate(w.days[0].date)}~{schoolDate(w.days[w.days.length-1].date)}</option>)}</select><button className="icon-button" aria-label="다음 주" disabled={busy||weekIndex>=weeks.length-1} onClick={()=>onDate(weeks[weekIndex+1].days[0].date)}><ChevronRight size={18}/></button></div>}
      <div className="toolbar-right">{scope==='day'&&<DatePicker days={state.days} date={date} onChange={onDate} disabled={busy}/>}<label className="sr-only" htmlFor="teacher-filter">교사별 조회</label><select id="teacher-filter" disabled={busy} className="control teacher-filter" value={teacher} onChange={e=>onTeacher(e.target.value)}><option value="all">전체 교사</option>{state.teachers.map(t=><option key={t.id} value={t.id}>{t.name} · 전체 {teacherLoad(state,t.id)}교시</option>)}</select></div></div>
      <div className="table-caption"><p><strong>{teacher==='all'?'반별 임장 시간표':`${teacher} 선생님 임장 시간표`}</strong></p><label className="checkbox-label"><input type="checkbox" disabled={busy} checked={showEmpty} onChange={e=>setShowEmpty(e.target.checked)}/>미운영일 포함</label></div>
      {!columns.length?<EmptyState title={scope==='week'?'선택한 주에 임장 일정이 없습니다':'해당하는 임장 일정이 없습니다'}/>:<div className="table-scroll duty-grid-scroll" role="region" aria-label="교사 임장 시간표 스크롤 영역" tabIndex={0}><table className="duty-table duty-table-transposed" style={{minWidth:84+columns.length*132}} aria-label="날짜별 교사 임장 시간표">
        <colgroup><col className="duty-period-column"/></colgroup>{dateGroups.map(({day,count})=><colgroup key={day.date} span={count}/>)}
        <thead><tr><th scope="col" rowSpan={2} className="duty-axis">교시</th>{dateGroups.map(({day,count})=><th scope="colgroup" colSpan={count} className="duty-date-header" key={day.date}><strong>{schoolDate(day.date)}</strong><span>{day.weekday}요일</span></th>)}</tr><tr>{columns.map(({day,room})=><th scope="col" className="room-cell" key={`${day.date}-${room}`}><span className={`room-tag room-${room}`}>{roomLabel(room)}</span><small>{room+2}반 교실</small></th>)}</tr></thead>
        <tbody>{Array.from({length:7},(_,i)=>{const p=i+1;return <tr key={p}><th scope="row" className="duty-axis">{p}교시</th>{columns.map(({day,room})=>{
          const a=state.assignments.find(a=>a.date===day.date&&a.room===room&&a.period===p);
          const count=expectedCount(state,day.date,room,p);
          return <td key={`${day.date}-${room}`}>{p>day.periods?<span className="inactive-cell">수업 없음</span>:!a?(count>0||showEmpty?<button className={`duty-cell ${count>0?'unassigned-duty':'empty-duty'}`} aria-label={`${schoolDate(day.date)} ${roomLabel(room)} ${p}교시 교사 배정`} onClick={()=>onEdit({id:slotKey(day.date,room,p),date:day.date,room,period:p,teacherId:'',extra:true})}><span>{count>0?'교사 배정':'추가 배정'}</span><small>{count>0?`${count}명 · 미배정`:'학생 없음'}</small></button>:<span className="inactive-cell">학생 없음</span>):<button className={`duty-cell ${teacher!=='all'&&teacher!==a.teacherId?'muted-duty':''}`} aria-label={`${schoolDate(day.date)} ${roomLabel(room)} ${p}교시 ${a.teacherId} 변경`} onClick={()=>onEdit(a)}><span className="duty-teacher">{a.teacherId}<Pencil size={14} aria-hidden="true"/></span><small>{count}명{a.extra?' · 추가':''}</small></button>}</td>;
        })}</tr>;})}</tbody>
      </table></div>}
    </section>
  </>;
}

export function ScheduleEditor({snapshot,assignmentId,onClose,onSave}:{snapshot:Snapshot;assignmentId:string;onClose:()=>void;onSave:(payload:ScheduleMutation)=>Promise<void>}){
  const {state}=snapshot;const source=state.assignments.find(a=>a.id===assignmentId)!;
  const [mode,setMode]=useState<'change'|'swap'>('change');const [teacher,setTeacher]=useState(source.teacherId);
  const [swapId,setSwapId]=useState('');const [reason,setReason]=useState('');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const day=state.days.find(d=>d.date===source.date)!;
  const preview=useMemo(()=>{
    if(teacher===source.teacherId)return {errors:[],warnings:[]};
    if(mode==='swap'&&!swapId)return {errors:['맞교환할 일정을 선택해 주세요.'],warnings:[]};
    try{
      const next=changedSchedule(state,source.id,teacher,mode==='swap'?swapId:undefined);
      const errors=scheduleErrors(state,next,{requireCoverage:false});const warnings:string[]=[];
      for(const id of [teacher,source.teacherId]){
        const days=[...new Set(next.filter(a=>a.teacherId===id).map(a=>a.date))];
        for(const d of days)if(next.filter(a=>a.teacherId===id&&a.date===d).length>2)warnings.push(`${id} 선생님은 ${schoolDate(d)}에 3교시 이상 임장합니다.`);
      }
      return {errors,warnings:[...new Set(warnings)]};
    }catch(e){return {errors:[e instanceof Error?e.message:'일정을 확인해 주세요.'],warnings:[]};}
  },[state,source,teacher,mode,swapId]);
  const swaps=state.assignments.filter(a=>!a.extra&&a.teacherId===teacher&&a.id!==source.id);
  const commit=async()=>{setSaving(true);setError('');try{await onSave({kind:'schedule',assignmentId:source.id,teacherId:teacher,swapId:mode==='swap'?swapId:undefined,reason,baseRevision:snapshot.revision});}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}finally{setSaving(false);}};
  return <Modal title="임장 교사 변경" description={`${schoolDate(source.date,true)} (${day.weekday}) · ${roomLabel(source.room)}(${source.room+2}반) · ${source.period}교시`} onClose={()=>{if(!saving)onClose();}}>
    <div className="current-assignment"><span>현재 담당</span><strong>{source.teacherId} 선생님</strong><span>{expectedCount(state,source.date,source.room,source.period)}명 관리</span></div>
    <div className="segmented full"><button className={mode==='change'?'selected':''} onClick={()=>{setMode('change');setSwapId('');}}>교사 변경</button><button className={mode==='swap'?'selected':''} onClick={()=>setMode('swap')}><ArrowLeftRight size={15}/>일정 맞교환</button></div>
    <label className="field"><span>{mode==='swap'?'맞교환할 교사':'새 담당 교사'}</span><select value={teacher} onChange={e=>{setTeacher(e.target.value);setSwapId('');setError('');}}>{state.teachers.map(t=><option key={t.id} value={t.id}>{t.name} · 현재 {teacherLoad(state,t.id)}교시{t.minDuties?` (기준 ${t.minDuties}~${t.maxDuties})`:''}</option>)}</select></label>
    {mode==='swap'&&teacher!==source.teacherId&&<label className="field"><span>맞교환할 임장 일정</span><select value={swapId} onChange={e=>{setSwapId(e.target.value);setError('');}}><option value="">일정 선택</option>{swaps.map(a=><option key={a.id} value={a.id}>{schoolDate(a.date)} · {roomLabel(a.room)} · {a.period}교시</option>)}</select></label>}
    {teacher!==source.teacherId&&preview.errors.length>0&&<div className="inline-alert error"><AlertCircle size={17}/><div>{preview.errors.slice(0,2).map(e=><p key={e}>{e}</p>)}</div></div>}
    {preview.warnings.length>0&&<div className="inline-alert warning"><AlertCircle size={17}/><div>{preview.warnings.map(w=><p key={w}>{w}</p>)}</div></div>}
    <label className="field"><span>변경 메모 <small>선택</small></span><textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} rows={2} placeholder="대체 임장 등 필요한 내용을 남겨 주세요."/></label>
    {error&&<div className="inline-alert error">{error}</div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>취소</button><button className="button primary" disabled={saving||teacher===source.teacherId||preview.errors.length>0} onClick={commit}>{saving?<Loader2 size={16} className="spin"/>:<Pencil size={16}/>}변경 저장</button></div>
  </Modal>;
}

export interface CoverageMutation {kind:'coverage';date:string;room:Room;period:number;teacherId:string;baseRevision:number}
export function CoverageEditor({snapshot,source,onClose,onSave}:{snapshot:Snapshot;source:Assignment;onClose:()=>void;onSave:(change:CoverageMutation)=>Promise<void>}){
  const {state}=snapshot,[teacher,setTeacher]=useState(source.teacherId),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const next=state.assignments.filter(a=>a.id!==source.id);if(teacher)next.push({...source,teacherId:teacher,extra:true});
  const errors=teacher===source.teacherId?[]:scheduleErrors(state,next,{requireCoverage:false});
  const save=async()=>{setSaving(true);setError('');try{await onSave({kind:'coverage',date:source.date,room:source.room,period:source.period,teacherId:teacher,baseRevision:snapshot.revision});}catch(e){setError(e instanceof Error?e.message:'임장을 저장하지 못했습니다.');}finally{setSaving(false);}};
  return <Modal title={source.teacherId?'추가 임장 변경':'임장 교사 배정'} description={`${schoolDate(source.date,true)} · ${roomLabel(source.room)} · ${source.period}교시 · ${expectedCount(state,source.date,source.room,source.period)}명`} onClose={()=>{if(!saving)onClose();}}>
    <label className="field"><span>담당 교사</span><select disabled={saving} value={teacher} onChange={e=>{setTeacher(e.target.value);setError('');}}><option value="">미배정</option>{state.teachers.map(t=><option key={t.id} value={t.id}>{t.name} · 전체 {teacherLoad(state,t.id)}교시</option>)}</select></label>
    {errors.length>0&&<div className="inline-alert error" role="alert"><AlertCircle size={17}/>{errors[0]}</div>}
    {!teacher&&source.teacherId&&<div className="inline-alert warning">배정을 해제하면 이 교시는 미배정으로 표시됩니다.</div>}
    {error&&<div className="inline-alert error" role="alert">{error}</div>}
    <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={saving||teacher===source.teacherId||errors.length>0} onClick={save}>{saving?<Loader2 size={17} className="spin"/>:<Pencil size={17}/>}배정 저장</button></div>
  </Modal>;
}
