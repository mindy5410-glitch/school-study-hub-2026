'use client';
import {useMemo} from 'react';
import {Users,CheckCheck,ClipboardList,AlertCircle,Save,Loader2,Search,Download} from 'lucide-react';
import type {AttendanceChange,AttendanceStatus,Room,SchoolState,Snapshot} from '../../lib/types';
import {expectedCount,expectedStatus,getRecord,recordKey,roomRoster,sameAttendance,schoolDate,STATUS,statusOptions} from '../../lib/domain';
import {DatePicker,EmptyState,StatCard,StatusBadge,downloadCSV} from './ui';

export type Drafts=Record<string,{status:AttendanceStatus|null;note:string}>;
export function AttendanceView({snapshot,date,room,period,onDate,onRoom,onPeriod,drafts,onDrafts,onSave,saving,search,onSearch}:{snapshot:Snapshot;date:string;room:Room;period:number;onDate:(d:string)=>void;onRoom:(r:Room)=>void;onPeriod:(p:number)=>void;drafts:Drafts;onDrafts:(d:Drafts)=>void;onSave:()=>void;saving:boolean;search:string;onSearch:(s:string)=>void}){
  const {state}=snapshot;const day=state.days.find(d=>d.date===date)!;
  const all=useMemo(()=>roomRoster(state,date,room),[state,date,room]);
  const roster=all.filter(s=>`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.toLowerCase()));
  const recorded=all.filter(s=>!!getRecord(state,s.id,date,period)).length;
  const changed=Object.keys(drafts).filter(id=>!sameAttendance(getRecord(state,id,date,period),drafts[id]));
  const irregular=all.filter(s=>{const r=getRecord(state,s.id,date,period);return r&&['late','early','absent'].includes(r.status);}).length;
  const unrecorded=all.filter(s=>!getRecord(state,s.id,date,period)&&!drafts[s.id]?.status).length;
  const current=(id:string)=>drafts[id]??{status:getRecord(state,id,date,period)?.status??null,note:getRecord(state,id,date,period)?.note??''};
  const update=(id:string,change:Partial<{status:AttendanceStatus|null;note:string}>)=>{
    const next={...drafts,[id]:{...current(id),...change}};
    if(sameAttendance(getRecord(state,id,date,period),next[id]))delete next[id];
    onDrafts(next);
  };
  const bulk=()=>{
    const next={...drafts};
    for(const s of all)if(!getRecord(state,s.id,date,period)&&!next[s.id]?.status)next[s.id]={status:expectedStatus(state,s.id,date,period),note:next[s.id]?.note??''};
    onDrafts(next);
  };
  const exportRecords=()=>downloadCSV(`체험학습_${date}_기간${room}반_${period}교시.csv`,[
    ['날짜','관리반','교시','원반','번호','이름','예정','출석 기록','메모'],...all.map(s=>{const r=getRecord(state,s.id,date,period);return [date,`기간${room}반(${room+2}반)`,period,s.classNo,s.number,s.name,expectedStatus(state,s.id,date,period)==='present'?'출석 예정':'체험학습 예정',r?STATUS[r.status].label:'미기록',r?.note??''];}),
  ]);
  return <>
    <div className="stats-grid"><StatCard label="선택 교시 출석 예정" value={expectedCount(state,date,room,period)} unit="명" sub={`${schoolDate(date)} · 기간${room}반 · ${period}교시`} icon={<Users size={19}/>}/><StatCard label="출석 기록 완료" value={`${recorded} / ${all.length}`} unit="명" sub="실제로 저장한 기록 기준" icon={<ClipboardList size={19}/>}/><StatCard label="출석 변동" value={irregular} unit="명" sub="지각 · 조퇴 · 결석 기록" icon={<AlertCircle size={19}/>}/></div>
    <section className="panel"><div className="panel-toolbar"><DatePicker days={state.days} date={date} onChange={onDate}/><div className="room-tabs"><button className={room===1?'selected':''} onClick={()=>onRoom(1)}>기간1반 <small>3반</small></button><button disabled={date>'2026-12-01'} className={room===2?'selected':''} onClick={()=>onRoom(2)}>기간2반 <small>4반</small></button></div><button className="button secondary compact push-right" onClick={exportRecords}><Download size={16}/>내려받기</button></div>
      <div className="period-toolbar"><span className="control-label">교시 선택</span><div className="period-tabs">{Array.from({length:day.periods},(_,i)=><button key={i} className={period===i+1?'selected':''} onClick={()=>onPeriod(i+1)}>{i+1}교시</button>)}</div></div>
      <div className="table-caption"><p><strong>기간{room}반 출석 명단</strong><span>원반과 번호순 · 체험학습 예정은 실제 기록과 구분됩니다.</span></p><div className="toolbar-right"><label className="search-box"><Search size={16}/><input aria-label="출석 명단 학생 검색" placeholder="이름 또는 원반 검색" value={search} onChange={e=>onSearch(e.target.value)}/></label><button className="button secondary compact" disabled={!unrecorded||saving} onClick={bulk} title="미기록 학생만 출석 또는 체험학습 예정에 따라 입력합니다. 저장 버튼을 눌러 확정하세요."><CheckCheck size={16}/>미기록 일괄 입력</button></div></div>
      {!all.length?<EmptyState title="출석 예정 학생이 없습니다" description={date>'2026-12-16'?'이 날짜에는 모든 학생이 체험학습 예정입니다.':'날짜와 관리반을 확인해 주세요.'}/>:!roster.length?<EmptyState title="검색한 학생이 없습니다" description="다른 이름이나 원반으로 검색해 주세요."/>:<div className="table-scroll"><table className="attendance-table"><thead><tr><th scope="col">원반</th><th scope="col">번호</th><th scope="col">학생</th><th scope="col">해당 교시 예정</th><th scope="col">실제 출석 기록</th><th scope="col">메모</th></tr></thead><tbody>{roster.map(s=>{
        const r=getRecord(state,s.id,date,period),v=current(s.id),planned=expectedStatus(state,s.id,date,period),dirty=!!drafts[s.id];
        return <tr key={s.id} className={dirty?'draft-row':''}><td><span className="class-pill">{s.classNo}반</span></td><td>{s.number}</td><th scope="row" className="student-name" title={s.originalName}>{s.name}{dirty&&<small className="draft-label">저장 전</small>}</th><td><StatusBadge status={planned} planned/></td><td><select className={`status-select ${v.status??''}`} aria-label={`${s.name} 출석 상태`} value={v.status??''} disabled={saving} onChange={e=>update(s.id,{status:(e.target.value||null)as AttendanceStatus|null,note:e.target.value?v.note:''})}><option value="">미기록</option>{statusOptions.map(x=><option key={x} value={x}>{STATUS[x].label}</option>)}</select></td><td><input className="note-input" aria-label={`${s.name} 출석 메모`} maxLength={300} value={v.note} disabled={!v.status||saving} placeholder={v.status?'메모 추가':'상태 선택 후 메모'} title={r?`${r.updatedBy} · ${r.updatedAt}`:undefined} onChange={e=>update(s.id,{note:e.target.value})}/></td></tr>;
      })}</tbody></table></div>}
      <div className="panel-footnote"><span className="tiny-dot"/>{date>'2026-12-01'?'12월 2일부터 출석 학생은 모두 기간1반(3반)에서 관리합니다.':'14:00에 조퇴하는 학생은 5교시부터 체험학습 예정으로 표시됩니다.'}</div>
    </section>
    {changed.length>0&&<div className="save-bar"><div><strong>{changed.length}명 변경 사항</strong><span>{schoolDate(date)} 기간{room}반 · {period}교시</span></div><div><button className="button secondary" disabled={saving} onClick={()=>onDrafts({})}>변경 취소</button><button className="button primary" disabled={saving} onClick={onSave}>{saving?<Loader2 size={17} className="spin"/>:<Save size={17}/>}출석 기록 저장</button></div></div>}
  </>;
}
