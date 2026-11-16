'use client';
import {useCallback,useEffect,useState} from 'react';
import {Calendar,ClipboardList,School,Settings,History,RefreshCw,Check,AlertCircle,X,ChevronRight,LogOut,Loader2,ArrowLeftRight} from 'lucide-react';
import type {Assignment,AttendanceChange,Room,Snapshot} from '../lib/types';
import {getRecord,schoolDate} from '../lib/domain';
import {attendanceChanges,attendanceResetChanges} from '../lib/attendance-form';
import {ScheduleEditor,ScheduleView,type ScheduleMutation} from './components/schedule';
import {AttendanceView,type Drafts} from './components/attendance';
import {OriginalView} from './components/original';
import {AddStudentModal,type RosterMutation} from './components/add-student';
import {Loading,Modal,formatSaved} from './components/ui';
import {ServiceHeader,ServiceFooter,Breadcrumb} from './components/service-layout';

type View='schedule'|'attendance'|'original';
type Toast={message:string;error?:boolean;action?:{label:string;run:()=>void}};
type AttendanceReset={date:string;room:Room;period:number;baseRevision:number;changes:AttendanceChange[];previous:AttendanceChange[]};
class RequestError extends Error {constructor(public status:number,message:string){super(message);}}
const views=[{id:'schedule' as View,label:'교사 임장',icon:Calendar,title:'교사 임장 시간표'},
  {id:'attendance' as View,label:'교시별 출석',icon:ClipboardList,title:'교시별 출석 기록'},
  {id:'original' as View,label:'원반별 출석부',icon:School,title:'원반별 출석부'}];

export default function Portal({displayName,request,onSignOut,onManage}:{displayName:string;request:(path:string,init?:RequestInit)=>Promise<Response>;onSignOut:()=>void;onManage?:()=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[loadError,setLoadError]=useState('');
  const [view,setView]=useState<View>('schedule'),[date,setDate]=useState('2026-11-30');
  const [room,setRoom]=useState<Room>(1),[period,setPeriod]=useState(1),[classNo,setClassNo]=useState(1);
  const [teacher,setTeacher]=useState('all'),[scope,setScope]=useState<'all'|'day'>('all');
  const [attendanceSearch,setAttendanceSearch]=useState(''),[originalSearch,setOriginalSearch]=useState('');
  const [drafts,setDrafts]=useState<Drafts>({}),[saving,setSaving]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [edit,setEdit]=useState<Assignment|null>(null),[rules,setRules]=useState(false),[history,setHistory]=useState(false);
  const [addingStudent,setAddingStudent]=useState(false);
  const [attendanceReset,setAttendanceReset]=useState<AttendanceReset|null>(null),[resetError,setResetError]=useState('');
  const [pendingNav,setPendingNav]=useState<(()=>void)|null>(null),[toast,setToast]=useState<Toast|null>(null);
  const dirty=Object.keys(drafts).length>0;
  const attendanceNeedsSave=!!snapshot&&view==='attendance'&&attendanceChanges(snapshot.state,date,room,period,drafts).length>0;
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const load=useCallback(async()=>{
    const response=await request('/api/state',{cache:'no-store'});const json=await response.json()as Snapshot&{error?:string};
    if(!response.ok)throw new RequestError(response.status,json.error??'자료를 불러오지 못했습니다.');
    setSnapshot(json);setLoadError('');return json as Snapshot;
  },[request]);
  useEffect(()=>{load().catch(e=>setLoadError(e.message));},[load]);
  useEffect(()=>{
    if(dirty||edit||saving||addingStudent||attendanceReset)return;
    const update=()=>load().catch(()=>undefined);const timer=setInterval(update,45000);
    window.addEventListener('focus',update);window.addEventListener('school:updated',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('school:updated',update);};
  },[load,dirty,edit,saving,addingStudent,attendanceReset]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),toast.action?12000:7000);return()=>clearTimeout(timer);},[toast]);
  const guard=(action:()=>void)=>{if(dirty)setPendingNav(()=>action);else action();};
  const changeDate=(next:string)=>guard(()=>{setDate(next);if(next>'2026-12-01')setRoom(1);setPeriod(p=>Math.min(p,snapshot?.state.days.find(d=>d.date===next)?.periods??6));setAttendanceSearch('');});
  const refresh=()=>guard(async()=>{setRefreshing(true);try{await load();setToast({message:'최신 내용을 불러왔습니다.'});}catch(e){setToast({message:e instanceof Error?e.message:'자료를 불러오지 못했습니다.',error:true});}finally{setRefreshing(false);}});
  const mutate=async(payload:Record<string,unknown>)=>{
    const response=await request('/api/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const json=await response.json()as Snapshot&{error?:string};
    if(!response.ok){
      if(response.status===409){await load();setEdit(null);}
      throw new RequestError(response.status,json.error??'저장하지 못했습니다.');
    }
    setSnapshot(json);return json as Snapshot;
  };
  const saveSchedule=async(payload:ScheduleMutation)=>{
    if(!snapshot)return;const original=snapshot.state.assignments.find(a=>a.id===payload.assignmentId)!;setSaving(true);
    try{
      const result=await mutate({...payload});setEdit(null);
      setToast({message:payload.swapId?'임장 일정을 맞교환했습니다.':'담당 교사를 변경했습니다.',action:{label:'되돌리기',run:async()=>{
        try{await mutate({kind:'schedule',assignmentId:payload.assignmentId,teacherId:original.teacherId,swapId:payload.swapId,reason:'직전 변경 되돌리기',baseRevision:result.revision});setToast({message:'변경을 되돌렸습니다.'});}catch(e){setToast({message:e instanceof Error?e.message:'되돌리지 못했습니다.',error:true});}
      }}});
    }catch(e){if(e instanceof RequestError&&e.status===409)setToast({message:e.message,error:true});throw e;}finally{setSaving(false);}
  };
  const saveAttendance=async()=>{
    if(!snapshot)return;const changes=attendanceChanges(snapshot.state,date,room,period,drafts);
    if(!changes.length)return;const oldChanges=changes.map(c=>{const old=getRecord(snapshot.state,c.studentId,date,period);return {studentId:c.studentId,status:old?.status??null,note:old?.note??''};});
    const context={date,room,period};setSaving(true);
    try{
      const result=await mutate({kind:'attendance',...context,changes,baseRevision:snapshot.revision});setDrafts({});
      setToast({message:`${changes.length}명의 출석 기록을 저장했습니다.`,action:{label:'되돌리기',run:async()=>{
        try{await mutate({kind:'attendance',...context,changes:oldChanges,baseRevision:result.revision});setToast({message:'출석 기록을 이전 상태로 되돌렸습니다.'});}catch(e){setToast({message:e instanceof Error?e.message:'되돌리지 못했습니다.',error:true});}
      }}});
    }catch(e){setToast({message:e instanceof Error?e.message:'저장하지 못했습니다.',error:true});}finally{setSaving(false);}
  };
  const beginAttendanceReset=()=>{
    if(!snapshot||saving)return;
    const changes=attendanceResetChanges(snapshot.state,date,room,period);
    if(!changes.length)return;
    const previous=changes.map(c=>{const record=getRecord(snapshot.state,c.studentId,date,period)!;return {studentId:c.studentId,status:record.status,note:record.note};});
    // Freeze the scope and revision shown in the confirmation dialog.
    setAttendanceReset({date,room,period,baseRevision:snapshot.revision,changes,previous});setResetError('');setToast(null);
  };
  const resetAttendance=async()=>{
    if(!attendanceReset||saving)return;
    const {date,room,period,baseRevision,changes,previous}=attendanceReset,context={date,room,period};
    setSaving(true);setResetError('');
    try{
      const result=await mutate({kind:'attendance',...context,changes,baseRevision});setDrafts({});setAttendanceReset(null);
      setToast({message:`${schoolDate(date)} 기간${room}반 ${period}교시 ${changes.length}명의 기록을 저장 전으로 복원했습니다.`,action:{label:'복원 취소',run:async()=>{
        setSaving(true);
        try{await mutate({kind:'attendance',...context,changes:previous,baseRevision:result.revision});setToast({message:'복원을 취소하고 출석 상태와 메모를 되살렸습니다.'});}
        catch(e){setToast({message:e instanceof Error?e.message:'복원을 취소하지 못했습니다.',error:true});}
        finally{setSaving(false);}
      }}});
    }catch(e){
      const message=e instanceof Error?e.message:'기록을 복원하지 못했습니다.';
      if(e instanceof RequestError&&e.status===409){setAttendanceReset(null);setToast({message,error:true});}else setResetError(message);
    }finally{setSaving(false);}
  };
  const saveRoster=async(payload:RosterMutation)=>{
    if(!snapshot)return;const pupil=snapshot.state.students.find(s=>s.id===payload.studentId);setSaving(true);
    try{
      const result=await mutate({...payload});setAddingStudent(false);setAttendanceSearch('');
      setToast({message:`${pupil?.name??''} 학생을 출석 명단에 추가했습니다.`,action:{label:'추가 취소',run:async()=>{
        try{await mutate({...payload,action:'remove',baseRevision:result.revision});setDrafts(previous=>{const next={...previous};delete next[payload.studentId];return next;});setToast({message:'명단 추가를 취소했습니다.'});}
        catch(e){setToast({message:e instanceof Error?e.message:'추가를 취소하지 못했습니다.',error:true});}
      }}});
    }finally{setSaving(false);}
  };
  const selected=views.find(v=>v.id===view)!;
  return <div className={`app-shell ${dirty||attendanceNeedsSave?'has-drafts':''}`}>
    <ServiceHeader displayName={displayName} onHome={()=>guard(()=>setView('schedule'))} onRules={()=>setRules(true)} onSignOut={()=>guard(onSignOut)}>
      <nav className="service-navigation" aria-label="운영 메뉴"><div className="service-inner">{views.map(v=><button key={v.id} className={view===v.id?'active':''} aria-current={view===v.id?'page':undefined} onClick={()=>guard(()=>setView(v.id))}><v.icon size={21}/>{v.label}</button>)}</div></nav>
    </ServiceHeader>
    <main id="main-content" className="main-content" tabIndex={-1}><Breadcrumb current={selected.title} onHome={()=>guard(()=>setView('schedule'))}/><header className="page-heading"><div><span className="eyebrow">체험학습 운영</span><h1>{selected.title}</h1></div><div className="heading-actions">{snapshot&&<span className={`saved-status ${attendanceNeedsSave?'pending':''}`} role="status">{attendanceNeedsSave?'저장 전':<><Check size={14}/>저장됨<small>{formatSaved(snapshot.updatedAt)}</small></>}</span>}<button className="icon-button bordered" aria-label="최신 내용 새로고침" disabled={refreshing||saving} onClick={refresh}><RefreshCw size={17} className={refreshing?'spin':''}/></button><button className="button secondary compact" onClick={()=>setHistory(true)}><History size={16}/>변경 내역</button></div></header>
      {!snapshot?loadError?<section className="panel error-panel"><AlertCircle size={28}/><h2>운영 자료를 불러오지 못했습니다</h2><p>{loadError}</p><button className="button primary" onClick={()=>{setLoadError('');load().catch(e=>setLoadError(e.message));}}>다시 불러오기</button>{loadError.includes('로그인')&&<a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하기</a>}</section>:<Loading/>:<>
        {view==='schedule'&&<ScheduleView snapshot={snapshot} date={date} onDate={changeDate} teacher={teacher} onTeacher={setTeacher} scope={scope} onScope={setScope} onEdit={setEdit}/>}
        {view==='attendance'&&<AttendanceView snapshot={snapshot} date={date} room={room} period={period} onDate={changeDate} onRoom={r=>guard(()=>{setRoom(r);setAttendanceSearch('');})} onPeriod={p=>guard(()=>setPeriod(p))} drafts={drafts} onDrafts={setDrafts} onSave={saveAttendance} onAddStudent={()=>setAddingStudent(true)} onReset={beginAttendanceReset} saving={saving} search={attendanceSearch} onSearch={setAttendanceSearch}/>}
        {view==='original'&&<OriginalView snapshot={snapshot} date={date} onDate={changeDate} classNo={classNo} onClass={setClassNo} search={originalSearch} onSearch={setOriginalSearch} onOpenRecord={(d,r,p)=>guard(()=>{setDate(d);setRoom(r);setPeriod(p);setAttendanceSearch('');setView('attendance');})}/>}
      </>}

    </main>
    <ServiceFooter/>

    {edit&&snapshot&&<ScheduleEditor snapshot={snapshot} assignmentId={edit.id} onClose={()=>setEdit(null)} onSave={saveSchedule}/>}
    {addingStudent&&snapshot&&<AddStudentModal snapshot={snapshot} date={date} room={room} period={period} onClose={()=>setAddingStudent(false)} onSave={saveRoster}/>}
    {attendanceReset&&<Modal title="이 교시 전체 기록을 되돌릴까요?" onClose={()=>{if(!saving)setAttendanceReset(null);}}>
      <p className="reset-scope"><strong>{schoolDate(attendanceReset.date,true)} · 기간{attendanceReset.room}반 · {attendanceReset.period}교시</strong></p>
      <p className="reset-description">저장된 {attendanceReset.changes.length}명의 출석 상태와 메모를 모두 저장 전(미기록) 상태로 복원합니다. 검색으로 보이지 않는 학생도 포함됩니다.</p>
      <p className="reset-description">학생 명단과 다른 날짜·반·교시의 기록은 유지됩니다.{dirty&&' 입력 중인 변경 내용은 취소됩니다.'}</p>
      {resetError&&<div className="inline-alert error" role="alert"><AlertCircle size={17}/>{resetError}</div>}
      <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={()=>setAttendanceReset(null)}>취소</button><button className="button primary" disabled={saving} onClick={resetAttendance}>{saving&&<Loader2 size={17} className="spin"/>}전체 기록 복원</button></div>
    </Modal>}
    {pendingNav&&<Modal title="저장하지 않은 출석 기록이 있습니다" description="현재 교시의 변경 내용을 저장하지 않고 이동할까요?" onClose={()=>setPendingNav(null)}><div className="modal-actions"><button className="button secondary" onClick={()=>setPendingNav(null)}>돌아가기</button><button className="button primary" onClick={()=>{setDrafts({});pendingNav();setPendingNav(null);}}>저장하지 않고 이동</button></div></Modal>}
    {history&&<Modal title="최근 변경 내역" onClose={()=>setHistory(false)} wide><div className="history-list">{!snapshot?.history.length?<div className="empty-history"><History size={25}/><p>아직 저장한 변경이 없습니다.</p></div>:snapshot.history.map(h=><article key={h.id}><span className="history-icon">{h.kind==='schedule'?<Calendar size={17}/>:<ClipboardList size={17}/>}</span><div><strong>{h.summary}</strong><p>{h.actor}<span>·</span>{formatSaved(h.created_at)}</p></div></article>)}</div></Modal>}
    {rules&&snapshot&&<Modal title="운영 기준" onClose={()=>setRules(false)} wide><div className="rules-grid"><section><h3>관리반과 교시</h3><p>11/30·12/1: 기간1반(3반), 기간2반(4반)</p><p>12/2부터: 기간1반(3반) 통합</p><p>월·수·목 6교시 / 화·금 7교시</p><p>14:00은 5교시 시작 시각</p><p>주말·12월 11일·12월 25일 제외</p></section><section><h3>임장 배정</h3><p>{snapshot.state.teachers.filter(t=>t.minDuties===2).map(t=>t.name).join('·')}: 전체 기간 각 2~3교시</p><p>{snapshot.state.teachers.filter(t=>t.minDuties===5).map(t=>t.name).join('·')}: 전체 기간 각 5~6교시</p><p>그 외 {snapshot.state.teachers.filter(t=>t.minDuties===0).length}명: 기준 배정 각 8교시</p><p>{snapshot.state.settings.excludedTeachers.join('·')} 선생님은 배정 대상에서 제외</p></section></div><section className="rule-lessons"><h3>1·2학년 수업 제외 시간</h3>{snapshot.state.teachers.filter(t=>snapshot.state.blocked.some(b=>b.teacherId===t.id)).map(t=><div key={t.id}><strong>{t.name}</strong><span>{snapshot.state.blocked.filter(b=>b.teacherId===t.id).map(b=>`${b.weekday} ${b.period}교시`).join(' · ')}</span></div>)}<p className="subtle">제공 시간표를 전체 기간에 요일별로 동일 적용합니다. 수요일 5·6교시에는 1·2학년 수업이 없습니다.</p></section></Modal>}
    {toast&&<div className={`toast ${toast.error?'error':''}`} role="status">{toast.error?<AlertCircle size={18}/>:<Check size={18}/>}<span>{toast.message}</span>{toast.action&&<button onClick={toast.action.run}>{toast.action.label}</button>}<button className="toast-close" onClick={()=>setToast(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
  </div>;
}
