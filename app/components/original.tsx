'use client';
import {Search} from 'lucide-react';
import type {Room,Snapshot} from '../../lib/types';
import {dayParticipants,expectedStatus,getRecord,roomLabel,STATUS} from '../../lib/domain';
import {DatePicker,EmptyState} from './ui';

export function OriginalView({snapshot,date,onDate,classNo,onClass,search,onSearch,onOpenRecord}:{snapshot:Snapshot;date:string;onDate:(d:string)=>void;classNo:number;onClass:(c:number)=>void;search:string;onSearch:(v:string)=>void;onOpenRecord:(date:string,room:Room,period:number)=>void}){
  const {state}=snapshot,day=state.days.find(d=>d.date===date)!;
  const members=state.students.filter(s=>classNo===0||s.classNo===classNo).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
  const students=members.filter(s=>`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.toLowerCase()));
  const participants=dayParticipants(state,date).filter(p=>members.some(s=>s.id===p.studentId));
  return <>
    <section className="panel"><div className="panel-toolbar"><DatePicker days={state.days} date={date} onChange={onDate}/><label className="field inline"><span>원반 선택</span><select value={classNo} onChange={e=>onClass(Number(e.target.value))}><option value={0}>전체 원반</option>{Array.from({length:13},(_,i)=><option key={i} value={i+1}>원반 {i+1}반</option>)}</select></label><div className="toolbar-right"><label className="search-box"><Search size={16}/><input aria-label="원반 출석부 학생 검색" placeholder="학생 이름 검색" value={search} onChange={e=>onSearch(e.target.value)}/></label></div></div>
      <div className="table-caption"><p><strong>{classNo?`원반 ${classNo}반`:'전체 원반'} 출석부</strong></p></div>
      {!students.length?<EmptyState title="검색한 학생이 없습니다"/>:<div className="table-scroll"><table className="original-table"><thead><tr><th scope="col">원반</th><th scope="col">번호</th><th scope="col">학생</th><th scope="col">선택일 관리반</th>{Array.from({length:7},(_,i)=><th scope="col" key={i}>{i+1}교시</th>)}</tr></thead><tbody>{students.map(s=>{
        const participant=participants.find(p=>p.studentId===s.id);
        return <tr key={s.id}><td><span className="class-pill">{s.classNo}반</span></td><td>{s.number}</td><th scope="row" className="student-name" title={s.originalName}>{s.name}</th><td>{participant?<span className={`room-tag room-${participant.room}`}>{roomLabel(participant.room)} ({participant.room+2}반)</span>:<span className="subtle">체험학습</span>}</td>{Array.from({length:7},(_,i)=>{
          const p=i+1;if(p>day.periods)return <td className="no-class" key={p}>—</td>;
          const r=getRecord(state,s.id,date,p),planned=expectedStatus(state,s.id,date,p),tone=r?STATUS[r.status].tone:planned==='experience'?'planned':'unrecorded';
          const content=<span className={`mini-status ${tone}`}>{r?STATUS[r.status].short:planned==='experience'?'체험예정':'미기록'}</span>;
          return <td key={p}>{participant?<button className="record-link" title={r?.note||`${s.name} ${p}교시 출석 기록`} aria-label={`${s.name} ${p}교시 출석 기록 열기`} onClick={()=>onOpenRecord(date,participant.room,p)}>{content}</button>:content}</td>;
        })}</tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}
