'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X,Loader2,ChevronLeft,ChevronRight,Calendar} from 'lucide-react';
import type {SchoolDay,AttendanceStatus} from '../../lib/types';
import {schoolDate,STATUS} from '../../lib/domain';

export function Modal({title,description,children,onClose,wide=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const dialog=useRef<HTMLElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const focusable=()=>Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]).filter(el=>el.offsetParent!==null);
    focusable()[0]?.focus();
    const listener=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();closeRef.current();}
      if(e.key==='Tab'){const items=focusable();const first=items[0],last=items[items.length-1];if(!first){e.preventDefault();return;}if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    };
    document.addEventListener('keydown',listener);const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',listener);document.body.style.overflow=old;previous?.focus();};
  },[]);
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={dialog} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={20}/></button></div>
      {children}
    </section>
  </div>;
}
export function DatePicker({days,date,onChange}:{days:SchoolDay[];date:string;onChange:(date:string)=>void}){
  const i=days.findIndex(d=>d.date===date);
  return <div className="date-picker"><button className="icon-button" aria-label="이전 운영일" disabled={i<=0} onClick={()=>onChange(days[i-1].date)}><ChevronLeft size={17}/></button>
    <Calendar size={16} aria-hidden="true"/><select aria-label="운영 날짜" value={date} onChange={e=>onChange(e.target.value)}>{days.map(d=><option key={d.date} value={d.date}>{schoolDate(d.date,true)} ({d.weekday})</option>)}</select>
    <button className="icon-button" aria-label="다음 운영일" disabled={i>=days.length-1} onClick={()=>onChange(days[i+1].date)}><ChevronRight size={17}/></button></div>;
}
export function StatusBadge({status,planned=false}:{status:AttendanceStatus|null;planned?:boolean}){
  if(!status)return <span className="status-badge unrecorded">미기록</span>;
  return <span className={`status-badge ${planned?'planned':STATUS[status].tone}`}>{STATUS[status].label}{planned?' 예정':''}</span>;
}
export function EmptyState({title,description,icon}:{title:string;description?:string;icon?:ReactNode}){
  return <div className="empty-state"><div className="empty-icon">{icon??<Calendar size={25}/>}</div><h3>{title}</h3>{description&&<p>{description}</p>}</div>;
}
export function Loading({label='자료를 불러오고 있습니다'}:{label?:string}){return <div className="loading"><Loader2 className="spin" size={23}/><p>{label}</p></div>;}
export function formatSaved(value:string){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
export function downloadCSV(filename:string,rows:(string|number|null|undefined)[][]){
  const csv=rows.map(row=>row.map(value=>{
    let s=String(value??'');if(/^[=+@-]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
