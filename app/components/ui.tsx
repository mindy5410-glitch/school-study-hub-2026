'use client';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X,Loader2,ChevronLeft,ChevronRight,Calendar} from 'lucide-react';
import type {SchoolDay,AttendanceStatus} from '../../lib/types';
import {schoolDate,STATUS} from '../../lib/domain';

export function Modal({title,description,children,onClose,wide=false,className=''}:{title:string;description?:string;children:ReactNode;onClose:()=>void;wide?:boolean;className?:string}){
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
    <section ref={dialog} className={`modal ${wide?'wide':''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={20}/></button></div>
      {children}
    </section>
  </div>;
}
export function CalendarGrid({days,month,onMonth,selectedDates,onSelect,multiple=false,disabled=false,disabledDates={}}:{days:SchoolDay[];month:string;onMonth:(month:string)=>void;selectedDates:string[];onSelect:(date:string)=>void;multiple?:boolean;disabled?:boolean;disabledDates?:Record<string,string>}){
  const months=[...new Set(days.map(d=>d.date.slice(0,7)))].sort(),monthIndex=months.indexOf(month);
  const [year,monthNumber]=month.split('-').map(Number);
  const firstWeekday=new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay();
  const monthLength=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
  const cells=Array.from({length:Math.ceil((firstWeekday+monthLength)/7)*7},(_,index)=>{
    const number=index-firstWeekday+1;
    return number<1||number>monthLength?null:{number,date:`${month}-${String(number).padStart(2,'0')}`,weekday:index%7};
  });
  const operatingDates=new Set(days.map(d=>d.date)),weekdays=['일','월','화','수','목','금','토'];
  return <div className={multiple?'calendar-multiple':undefined}>
    <div className="calendar-month"><button className="icon-button bordered" aria-label="이전 달" disabled={disabled||monthIndex<=0} onClick={()=>onMonth(months[monthIndex-1])}><ChevronLeft size={20}/></button><h3 aria-live="polite">{year}년 {monthNumber}월</h3><button className="icon-button bordered" aria-label="다음 달" disabled={disabled||monthIndex<0||monthIndex>=months.length-1} onClick={()=>onMonth(months[monthIndex+1])}><ChevronRight size={20}/></button></div>
    <table className="date-calendar" aria-label={`${year}년 ${monthNumber}월 운영일 달력`}><thead><tr>{weekdays.map(day=><th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({length:cells.length/7},(_,row)=><tr key={row}>{cells.slice(row*7,row*7+7).map((cell,column)=>{
      if(!cell)return <td key={column}/>;
      const selected=selectedDates.includes(cell.date),reason=disabledDates[cell.date];
      return <td key={column}><button className={`calendar-day ${selected?'selected':''} ${selected&&reason?'calendar-conflict':''}`} aria-label={`${year}년 ${monthNumber}월 ${cell.number}일 ${weekdays[cell.weekday]}요일`} aria-current={!multiple&&selected?'date':undefined} aria-pressed={multiple?selected:undefined} disabled={disabled||!operatingDates.has(cell.date)||!!reason&&!selected} title={reason||(!operatingDates.has(cell.date)?'운영하지 않는 날':undefined)} onClick={()=>onSelect(cell.date)}>{cell.number}</button></td>;
    })}</tr>)}</tbody></table>
  </div>;
}
export function DatePicker({days,date,onChange,disabled=false}:{days:SchoolDay[];date:string;onChange:(date:string)=>void;disabled?:boolean}){
  const selectedDateId=useId();
  const [open,setOpen]=useState(false),[month,setMonth]=useState(date.slice(0,7));
  const i=days.findIndex(d=>d.date===date),selected=days[i];
  return <>
    <div className="date-picker"><button className="icon-button" aria-label="이전 운영일" disabled={disabled||i<=0} onClick={()=>onChange(days[i-1].date)}><ChevronLeft size={17}/></button>
      <button className="date-trigger" aria-label="운영 날짜 선택" aria-describedby={selectedDateId} aria-haspopup="dialog" aria-expanded={open} disabled={disabled||!days.length} onClick={()=>{setMonth((selected??days[0]).date.slice(0,7));setOpen(true);}}><Calendar size={17} aria-hidden="true"/><span id={selectedDateId}>{selected?`${schoolDate(date,true)} (${selected.weekday})`:'날짜 선택'}</span></button>
      <button className="icon-button" aria-label="다음 운영일" disabled={disabled||i<0||i>=days.length-1} onClick={()=>onChange(days[i+1].date)}><ChevronRight size={17}/></button>
    </div>
    {open&&createPortal(<Modal title="운영 날짜 선택" className="calendar-modal" onClose={()=>setOpen(false)}>
      <CalendarGrid days={days} month={month} onMonth={setMonth} selectedDates={[date]} disabled={disabled} onSelect={next=>{if(disabled)return;setOpen(false);onChange(next);}}/>
    </Modal>,document.body)}
  </>;
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
