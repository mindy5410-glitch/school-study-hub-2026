'use client';
import {Search,Download} from 'lucide-react';
import type {Room,Snapshot} from '../../lib/types';
import {expectedStatus,getRecord,STATUS} from '../../lib/domain';
import {DatePicker,EmptyState,downloadCSV} from './ui';

export function OriginalView({snapshot,date,onDate,classNo,onClass,search,onSearch,onOpenRecord}:{snapshot:Snapshot;date:string;onDate:(d:string)=>void;classNo:number;onClass:(c:number)=>void;search:string;onSearch:(v:string)=>void;onOpenRecord:(date:string,room:Room,period:number)=>void}){
  const {state}=snapshot,day=state.days.find(d=>d.date===date)!;
  const members=state.students.filter(s=>classNo===0||s.classNo===classNo).sort((a,b)=>a.classNo-b.classNo||a.number-b.number);
  const students=members.filter(s=>`${s.classNo}반 ${s.number}번 ${s.name} ${s.originalName}`.toLowerCase().includes(search.toLowerCase()));
  const participants=state.participants.filter(p=>p.date===date&&members.some(s=>s.id===p.studentId));
  const cellLabel=(id:string,p:number)=>{const r=getRecord(state,id,date,p);return r?STATUS[r.status].label:expectedStatus(state,id,date,p)==='present'?'미기록':'체험학습 예정';};
  const exportRoster=()=>downloadCSV(`원반출석부_${classNo||'전체'}반_${date}.csv`,[
    ['날짜','원반','번호','이름','관리반',...Array.from({length:7},(_,i)=>`${i+1}교시`)],
    ...students.map(s=>{const participant=participants.find(p=>p.studentId===s.id);return [date,s.classNo,s.number,s.name,participant?`기간${participant.room}반(${participant.room+2}반)`:'체험학습',...Array.from({length:7},(_,i)=>i+1>day.periods?'수업 없음':cellLabel(s.id,i+1))];}),
  ]);
  return <>
    <section className="panel"><div className="panel-toolbar"><DatePicker days={state.days} date={date} onChange={onDate}/><label className="field inline"><span>원반 선택</span><select value={classNo} onChange={e=>onClass(Number(e.target.value))}><option value={0}>전체 원반</option>{Array.from({length:13},(_,i)=><option key={i} value={i+1}>원반 {i+1}반</option>)}</select></label><div className="toolbar-right"><label className="search-box"><Search size={16}/><input aria-label="원반 출석부 학생 검색" placeholder="학생 이름 검색" value={search} onChange={e=>onSearch(e.target.value)}/></label><button className="button secondary compact" onClick={exportRoster}><Download size={16}/>출석부 내려받기</button></div></div>
      <div className="table-caption"><p><strong>{classNo?`원반 ${classNo}반`:'전체 원반'} 출석부</strong><span>관리반에서 저장한 기록이 함께 표시됩니다. 등교 학생의 교시를 누르면 기록 화면으로 이동합니다.</span></p></div>
      {!students.length?<EmptyState title="검색한 학생이 없습니다" description="원반이나 검색어를 바꿔 주세요."/>:<div className="table-scroll"><table className="original-table"><thead><tr><th scope="col">원반</th><th scope="col">번호</th><th scope="col">학생</th><th scope="col">선택일 관리반</th>{Array.from({length:7},(_,i)=><th scope="col" key={i}>{i+1}교시</th>)}</tr></thead><tbody>{students.map(s=>{
        const participant=participants.find(p=>p.studentId===s.id);
        return <tr key={s.id}><td><span className="class-pill">{s.classNo}반</span></td><td>{s.number}</td><th scope="row" className="student-name" title={s.originalName}>{s.name}</th><td>{participant?<span className={`room-tag room-${participant.room}`}>기간{participant.room}반 ({participant.room+2}반)</span>:<span className="subtle">체험학습</span>}</td>{Array.from({length:7},(_,i)=>{
          const p=i+1;if(p>day.periods)return <td className="no-class" key={p}>—</td>;
          const r=getRecord(state,s.id,date,p),planned=expectedStatus(state,s.id,date,p),tone=r?STATUS[r.status].tone:planned==='experience'?'planned':'unrecorded';
          const content=<span className={`mini-status ${tone}`}>{r?STATUS[r.status].short:planned==='experience'?'체험예정':'미기록'}</span>;
          return <td key={p}>{participant?<button className="record-link" title={r?.note||`${s.name} ${p}교시 출석 기록`} aria-label={`${s.name} ${p}교시 출석 기록 열기`} onClick={()=>onOpenRecord(date,participant.room,p)}>{content}</button>:content}</td>;
        })}</tr>;
      })}</tbody></table></div>}
      <div className="panel-footnote"><span className="tiny-dot"/>‘체험예정’은 신청 일정에 따른 표시이며, 교사가 저장한 ‘체험’ 기록과 구분됩니다.</div>
    </section>
  </>;
}
