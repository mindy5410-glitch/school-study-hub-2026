'use client';
import {useMemo,useState} from 'react';
import {Pencil,Download,ArrowLeftRight,AlertCircle,Loader2} from 'lucide-react';
import type {Assignment,Room,Snapshot} from '../../lib/types';
import {changedSchedule,expectedCount,roomLabel,scheduleErrors,schoolDate,teacherLoad} from '../../lib/domain';
import {DatePicker,EmptyState,Modal,downloadCSV} from './ui';

export interface ScheduleMutation {kind:'schedule';assignmentId:string;teacherId:string;swapId?:string;reason:string;baseRevision:number}
export function ScheduleView({snapshot,date,onDate,teacher,onTeacher,scope,onScope,onEdit}:{snapshot:Snapshot;date:string;onDate:(date:string)=>void;teacher:string;onTeacher:(id:string)=>void;scope:'all'|'day';onScope:(s:'all'|'day')=>void;onEdit:(a:Assignment)=>void}){
  const {state}=snapshot;const [showEmpty,setShowEmpty]=useState(false);
  const rows=state.days.flatMap(day=>(day.date<='2026-12-01'?[1,2]:[1]).map(room=>({day,room:room as Room})))
    .filter(({day,room})=>(scope==='all'||day.date===date)&&(showEmpty||expectedCount(state,day.date,room,1)>0))
    .filter(({day,room})=>teacher==='all'||state.assignments.some(a=>a.date===day.date&&a.room===room&&a.teacherId===teacher));
  const exportRows=()=>downloadCSV('체험학습_교사임장시간표.csv',[
    ['날짜','요일','관리반','1교시','2교시','3교시','4교시','5교시','6교시','7교시'],
    ...rows.map(({day,room})=>[day.date,day.weekday,roomLabel(room),...Array.from({length:7},(_,i)=>i+1>day.periods?'수업 없음':state.assignments.find(a=>a.date===day.date&&a.room===room&&a.period===i+1)?.teacherId??'학생 없음')]),
  ]);
  return <>
    <section className="panel"><div className="panel-toolbar"><div className="segmented"><button className={scope==='all'?'selected':''} onClick={()=>onScope('all')}>전체 기간</button><button className={scope==='day'?'selected':''} onClick={()=>onScope('day')}>선택일</button></div>
      <div className="toolbar-right">{scope==='day'&&<DatePicker days={state.days} date={date} onChange={onDate}/>}<label className="sr-only" htmlFor="teacher-filter">교사별 조회</label><select id="teacher-filter" className="control teacher-filter" value={teacher} onChange={e=>onTeacher(e.target.value)}><option value="all">전체 교사</option>{state.teachers.map(t=><option key={t.id} value={t.id}>{t.name} · {teacherLoad(state,t.id)}교시</option>)}</select><button className="button secondary compact" onClick={exportRows}><Download size={16}/>내려받기</button></div></div>
      <div className="table-caption"><p><strong>{teacher==='all'?'반별 임장 시간표':`${teacher} 선생님 임장 시간표`}</strong><span>교사 이름을 누르면 담당 교사를 변경할 수 있습니다.</span></p><label className="checkbox-label"><input type="checkbox" checked={showEmpty} onChange={e=>setShowEmpty(e.target.checked)}/>미운영일 포함</label></div>
      {!rows.length?<EmptyState title="해당하는 임장 일정이 없습니다" description="다른 날짜 또는 교사를 선택해 주세요."/>:<div className="table-scroll"><table className="duty-table"><thead><tr><th scope="col">날짜</th><th scope="col">관리반</th>{Array.from({length:7},(_,i)=><th scope="col" key={i}>{i+1}교시{i===4&&<small>14:00~</small>}</th>)}</tr></thead><tbody>{rows.map(({day,room})=><tr key={`${day.date}-${room}`}><th scope="row" className="date-cell"><strong>{schoolDate(day.date)}</strong><span>{day.weekday}요일</span></th><td className="room-cell"><span className={`room-tag room-${room}`}>기간{room}반</span><small>{room+2}반 교실</small></td>{Array.from({length:7},(_,i)=>{
        const p=i+1;const a=state.assignments.find(a=>a.date===day.date&&a.room===room&&a.period===p);
        return <td key={p}>{p>day.periods?<span className="inactive-cell">수업 없음</span>:!a?<span className="inactive-cell">학생 없음</span>:<button className={`duty-cell ${teacher!=='all'&&teacher!==a.teacherId?'muted-duty':''}`} aria-label={`${schoolDate(day.date)} 기간${room}반 ${p}교시 ${a.teacherId} 변경`} onClick={()=>onEdit(a)}><span>{a.teacherId}</span><small>{expectedCount(state,day.date,room,p)}명<Pencil size={12}/></small></button>}</td>;
      })}</tr>)}</tbody></table></div>}
      <div className="panel-footnote"><span className="tiny-dot"/>11월 30일·12월 1일은 두 반 운영, 12월 2일부터 기간1반(3반) 통합 운영</div>
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
      const errors=scheduleErrors(state,next);const warnings:string[]=[];
      for(const id of [teacher,source.teacherId]){
        const days=[...new Set(next.filter(a=>a.teacherId===id).map(a=>a.date))];
        for(const d of days)if(next.filter(a=>a.teacherId===id&&a.date===d).length>2)warnings.push(`${id} 선생님은 ${schoolDate(d)}에 3교시 이상 임장합니다.`);
      }
      return {errors,warnings:[...new Set(warnings)]};
    }catch(e){return {errors:[e instanceof Error?e.message:'일정을 확인해 주세요.'],warnings:[]};}
  },[state,source,teacher,mode,swapId]);
  const swaps=state.assignments.filter(a=>a.teacherId===teacher&&a.id!==source.id);
  const commit=async()=>{setSaving(true);setError('');try{await onSave({kind:'schedule',assignmentId:source.id,teacherId:teacher,swapId:mode==='swap'?swapId:undefined,reason,baseRevision:snapshot.revision});}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}finally{setSaving(false);}};
  return <Modal title="임장 교사 변경" description={`${schoolDate(source.date,true)} (${day.weekday}) · 기간${source.room}반(${source.room+2}반) · ${source.period}교시`} onClose={onClose}>
    <div className="current-assignment"><span>현재 담당</span><strong>{source.teacherId} 선생님</strong><span>{expectedCount(state,source.date,source.room,source.period)}명 관리</span></div>
    <div className="segmented full"><button className={mode==='change'?'selected':''} onClick={()=>{setMode('change');setSwapId('');}}>교사 변경</button><button className={mode==='swap'?'selected':''} onClick={()=>setMode('swap')}><ArrowLeftRight size={15}/>일정 맞교환</button></div>
    <label className="field"><span>{mode==='swap'?'맞교환할 교사':'새 담당 교사'}</span><select value={teacher} onChange={e=>{setTeacher(e.target.value);setSwapId('');setError('');}}>{state.teachers.map(t=><option key={t.id} value={t.id}>{t.name} · 현재 {teacherLoad(state,t.id)}교시{t.minDuties?` (기준 ${t.minDuties}~${t.maxDuties})`:''}</option>)}</select></label>
    {mode==='swap'&&teacher!==source.teacherId&&<label className="field"><span>맞교환할 임장 일정</span><select value={swapId} onChange={e=>{setSwapId(e.target.value);setError('');}}><option value="">일정 선택</option>{swaps.map(a=><option key={a.id} value={a.id}>{schoolDate(a.date)} · 기간{a.room}반 · {a.period}교시</option>)}</select></label>}
    {teacher!==source.teacherId&&preview.errors.length>0&&<div className="inline-alert error"><AlertCircle size={17}/><div>{preview.errors.slice(0,2).map(e=><p key={e}>{e}</p>)}{mode==='change'&&<small>배정 횟수를 유지하려면 ‘일정 맞교환’을 이용하세요.</small>}</div></div>}
    {preview.warnings.length>0&&<div className="inline-alert warning"><AlertCircle size={17}/><div>{preview.warnings.map(w=><p key={w}>{w}</p>)}</div></div>}
    <label className="field"><span>변경 메모 <small>선택</small></span><textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} rows={2} placeholder="대체 임장 등 필요한 내용을 남겨 주세요."/></label>
    {error&&<div className="inline-alert error">{error}</div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>취소</button><button className="button primary" disabled={saving||teacher===source.teacherId||preview.errors.length>0} onClick={commit}>{saving?<Loader2 size={16} className="spin"/>:<Pencil size={16}/>}변경 저장</button></div>
  </Modal>;
}
