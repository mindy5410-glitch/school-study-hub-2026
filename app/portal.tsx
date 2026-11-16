'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Calendar,ClipboardList,School,History,RefreshCw,Check,AlertCircle,X,Loader2} from 'lucide-react';
import type {Assignment,AttendanceChange,Room,Snapshot} from '../lib/types';
import {defaultSchoolDate,periodKey,roomLabel,roomRoster,schoolDate,slotKey} from '../lib/domain';
import {attendanceChanges,attendanceResetChanges} from '../lib/attendance-form';
import {CoverageEditor,ScheduleEditor,ScheduleView,type CoverageMutation,type ScheduleMutation} from './components/schedule';
import {AttendanceView,type Drafts} from './components/attendance';
import {OriginalView} from './components/original';
import {AddStudentModal,type RosterMutation} from './components/add-student';
import {RosterManager,type RosterManageMutation} from './components/roster-manager';
import {Loading,Modal,formatSaved} from './components/ui';
import {ServiceHeader,ServiceFooter,Breadcrumb} from './components/service-layout';

type View='schedule'|'attendance'|'original';
type Toast={message:string;error?:boolean;action?:{label:string;run:()=>void}};
type AttendanceContext={date:string;room:Room;period:number};
type AttendanceReset=AttendanceContext&{mode:'reset'|'undo';baseRevision:number;changes:AttendanceChange[];undoRevision?:number;count:number};
const contextLabel=({date,room,period}:AttendanceContext)=>`${schoolDate(date)} ${roomLabel(room)} ${period}교시`;
class RequestError extends Error {constructor(public status:number,message:string){super(message);}}
const views=[{id:'schedule' as View,label:'교사 임장',icon:Calendar,title:'교사 임장 시간표'},
  {id:'attendance' as View,label:'교시별 출석',icon:ClipboardList,title:'교시별 출석 기록'},
  {id:'original' as View,label:'원반별 출석부',icon:School,title:'원반별 출석부'}];

export default function Portal({displayName,request,onSignOut,onManage}:{displayName:string;request:(path:string,init?:RequestInit)=>Promise<Response>;onSignOut:()=>void;onManage?:()=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[loadError,setLoadError]=useState('');
  const [view,setView]=useState<View>('schedule'),[date,setDate]=useState('2026-11-30');
  const dateInitialized=useRef(false);
  const [room,setRoom]=useState<Room>(1),[period,setPeriod]=useState(1),[classNo,setClassNo]=useState(1);
  const attendanceContext=useRef({date,room,period});attendanceContext.current={date,room,period};
  const [teacher,setTeacher]=useState('all'),[scope,setScope]=useState<'all'|'day'>('all');
  const [attendanceSearch,setAttendanceSearch]=useState(''),[originalSearch,setOriginalSearch]=useState('');
  const [drafts,setDrafts]=useState<Drafts>({}),[saving,setSaving]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [edit,setEdit]=useState<Assignment|null>(null),[rules,setRules]=useState(false),[history,setHistory]=useState(false);
  const [addingStudent,setAddingStudent]=useState(false),[managingRoster,setManagingRoster]=useState(false),[addInitialStudentId,setAddInitialStudentId]=useState('');
  const [attendanceReset,setAttendanceReset]=useState<AttendanceReset|null>(null),[resetError,setResetError]=useState('');
  const [pendingNav,setPendingNav]=useState<(()=>void)|null>(null),[toast,setToast]=useState<Toast|null>(null);
  const dirty=Object.keys(drafts).length>0;
  const attendanceNeedsSave=!!snapshot&&view==='attendance'&&attendanceChanges(snapshot.state,date,room,period,drafts).length>0;
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const load=useCallback(async()=>{
    const response=await request('/api/state',{cache:'no-store'});const json=await response.json()as Snapshot&{error?:string};
    if(!response.ok)throw new RequestError(response.status,json.error??'자료를 불러오지 못했습니다.');
    if(!dateInitialized.current){setDate(defaultSchoolDate(json.state.days));dateInitialized.current=true;}
    setSnapshot(json);setLoadError('');return json as Snapshot;
  },[request]);
  useEffect(()=>{load().catch(e=>setLoadError(e.message));},[load]);
  useEffect(()=>{
    if(dirty||edit||saving||addingStudent||managingRoster||attendanceReset)return;
    const update=()=>load().catch(()=>undefined);const timer=setInterval(update,45000);
    window.addEventListener('focus',update);window.addEventListener('school:updated',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('school:updated',update);};
  },[load,dirty,edit,saving,addingStudent,managingRoster,attendanceReset]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),toast.action?12000:7000);return()=>clearTimeout(timer);},[toast]);
  const guard=(action:()=>void)=>{if(saving)return;if(dirty)setPendingNav(()=>action);else action();};
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
  const saveSchedule=async(payload:ScheduleMutation|CoverageMutation)=>{
    if(!snapshot||saving)return;
    const id=payload.kind==='schedule'?payload.assignmentId:slotKey(payload.date,payload.room,payload.period);
    const original=snapshot.state.assignments.find(a=>a.id===id);
    const context=payload.kind==='coverage'?payload:original!;setSaving(true);
    try{
      const result=await mutate({...payload});setEdit(null);
      setToast({message:`${contextLabel(context)} 임장 ${payload.kind==='schedule'&&payload.swapId?'일정을 맞교환했습니다.':payload.teacherId?'교사를 저장했습니다.':'배정을 해제했습니다.'}`,action:{label:'되돌리기',run:async()=>{
        setSaving(true);
        try{await mutate(payload.kind==='coverage'?{...payload,teacherId:original?.teacherId??'',baseRevision:result.revision}:{...payload,teacherId:original!.teacherId,reason:'직전 변경 되돌리기',baseRevision:result.revision});setToast({message:`${contextLabel(context)} 임장 변경을 되돌렸습니다.`});}catch(e){setToast({message:e instanceof Error?e.message:'되돌리지 못했습니다.',error:true});}finally{setSaving(false);}
      }}});
    }catch(e){if(e instanceof RequestError&&e.status===409)setToast({message:e.message,error:true});throw e;}finally{setSaving(false);}
  };
  const beginAttendanceUndo=async(context:AttendanceContext,expectedRevision?:number)=>{
    if(saving)return;setSaving(true);setToast(null);
    try{
      const latest=await load(),undo=latest.attendanceUndo?.[periodKey(context.date,context.room,context.period)];
      if(!undo||expectedRevision!==undefined&&undo.revision!==expectedRevision)throw new Error(`${contextLabel(context)} 취소할 직전 저장이 없거나 다른 저장으로 바뀌었습니다.`);
      setAttendanceReset({...context,mode:'undo',baseRevision:latest.revision,undoRevision:undo.revision,changes:[],count:undo.changes.length});setResetError('');
    }catch(e){setToast({message:e instanceof Error?e.message:'직전 저장을 확인하지 못했습니다.',error:true});}finally{setSaving(false);}
  };
  const clearContextDrafts=(context:AttendanceContext)=>{const current=attendanceContext.current;if(current.date===context.date&&current.room===context.room&&current.period===context.period)setDrafts({});};
  const saveAttendance=async()=>{
    if(!snapshot||saving)return;const changes=attendanceChanges(snapshot.state,date,room,period,drafts);
    if(!changes.length)return;
    const context={date,room,period};setSaving(true);
    try{
      const result=await mutate({kind:'attendance',action:'save',...context,changes,baseRevision:snapshot.revision});clearContextDrafts(context);
      setToast({message:`${contextLabel(context)} ${changes.length}명의 기록을 저장했습니다.`,action:{label:'저장 취소',run:()=>{void beginAttendanceUndo(context,result.revision);}}});
    }catch(e){setToast({message:e instanceof Error?e.message:'저장하지 못했습니다.',error:true});}finally{setSaving(false);}
  };
  const beginAttendanceReset=()=>{
    if(!snapshot||saving)return;
    const changes=attendanceResetChanges(snapshot.state,date,room,period);
    if(!changes.length)return;
    // Freeze the scope and revision shown in the confirmation dialog.
    setAttendanceReset({date,room,period,mode:'reset',baseRevision:snapshot.revision,changes,count:changes.length});setResetError('');setToast(null);
  };
  const resetAttendance=async()=>{
    if(!attendanceReset||saving)return;
    const {date,room,period,baseRevision,changes,mode,undoRevision,count}=attendanceReset,context={date,room,period};
    setSaving(true);setResetError('');
    try{
      const result=await mutate(mode==='undo'?{kind:'attendance-undo',...context,undoRevision,baseRevision}:{kind:'attendance',action:'reset',...context,changes,baseRevision});clearContextDrafts(context);setAttendanceReset(null);
      setToast({message:`${contextLabel(context)} ${count}명의 기록을 ${mode==='undo'?'직전 저장 이전으로 되돌렸습니다.':'초기화했습니다.'}`,action:mode==='reset'?{label:'초기화 취소',run:()=>{void beginAttendanceUndo(context,result.revision);}}:undefined});
    }catch(e){
      const message=e instanceof Error?e.message:'출석 기록을 변경하지 못했습니다.';
      if(e instanceof RequestError&&e.status===409){setAttendanceReset(null);setToast({message,error:true});}else setResetError(message);
    }finally{setSaving(false);}
  };
  const saveRoster=async(payload:RosterMutation)=>{
    if(!snapshot||saving)return;const pupil=snapshot.state.students.find(s=>s.id===payload.studentId);setSaving(true);
    try{
      const result=await mutate({...payload});setAddingStudent(false);setAttendanceSearch('');
      setToast({message:`${pupil?.name??''} 학생을 선택한 ${payload.entries.length}일의 출석 명단에 추가했습니다.`,action:{label:'추가 취소',run:async()=>{
        setSaving(true);
        try{await mutate({...payload,action:'remove',baseRevision:result.revision});setDrafts(previous=>{if(!payload.entries.some(e=>e.date===attendanceContext.current.date&&e.room===attendanceContext.current.room))return previous;const next={...previous};delete next[payload.studentId];return next;});setToast({message:`${payload.entries.length}일의 명단 추가를 취소했습니다.`});}
        catch(e){setToast({message:e instanceof Error?e.message:'추가를 취소하지 못했습니다.',error:true});}
        finally{setSaving(false);}
      }}});
    }finally{setSaving(false);}
  };
  const saveManagedRoster=async(payload:RosterManageMutation)=>{
    if(!snapshot||saving)return;setSaving(true);
    try{
      const result=await mutate({...payload}),s=result.state.students.find(s=>s.id===payload.studentId),current=attendanceContext.current;
      if(current.date===payload.date&&!roomRoster(result.state,current.date,current.room,current.period).some(s=>s.id===payload.studentId))setDrafts(previous=>{const next={...previous};delete next[payload.studentId];return next;});
      setToast({message:`${schoolDate(payload.date)} ${s?.name??''} 학생의 추가 등교 일정을 ${payload.action==='update'?'수정했습니다.':'취소했습니다.'}`});
    }finally{setSaving(false);}
  };
  const selected=views.find(v=>v.id===view)!;
  return <div className={`app-shell ${dirty||attendanceNeedsSave?'has-drafts':''}`}>
    <ServiceHeader displayName={displayName} busy={saving} onHome={()=>guard(()=>setView('schedule'))} onRules={()=>setRules(true)} onSignOut={()=>guard(onSignOut)}>
      <nav className="service-navigation" aria-label="운영 메뉴"><div className="service-inner">{views.map(v=><button key={v.id} disabled={saving} className={view===v.id?'active':''} aria-current={view===v.id?'page':undefined} onClick={()=>guard(()=>setView(v.id))}><v.icon size={21}/>{v.label}</button>)}</div></nav>
    </ServiceHeader>
    <main id="main-content" className="main-content" tabIndex={-1} aria-busy={saving}><Breadcrumb current={selected.title} onHome={()=>guard(()=>setView('schedule'))}/><header className="page-heading"><div><span className="eyebrow">체험학습 운영</span><h1>{selected.title}</h1></div><div className="heading-actions">{snapshot&&<span className={`saved-status ${attendanceNeedsSave?'pending':''}`} role="status">{saving?<><Loader2 size={14} className="spin"/>처리 중</>:attendanceNeedsSave?'저장 전':<><Check size={14}/>저장됨<small>{formatSaved(snapshot.updatedAt)}</small></>}</span>}<button className="icon-button bordered" aria-label="최신 내용 새로고침" disabled={refreshing||saving} onClick={refresh}><RefreshCw size={17} className={refreshing?'spin':''}/></button><button className="button secondary compact" disabled={saving} onClick={()=>setHistory(true)}><History size={16}/>변경 내역</button></div></header>
      {!snapshot?loadError?<section className="panel error-panel"><AlertCircle size={28}/><h2>운영 자료를 불러오지 못했습니다</h2><p>{loadError}</p><button className="button primary" onClick={()=>{setLoadError('');load().catch(e=>setLoadError(e.message));}}>다시 불러오기</button>{loadError.includes('로그인')&&<a href="/signin-with-chatgpt?return_to=%2F" target="_top">로그인하기</a>}</section>:<Loading/>:<>
        {view==='schedule'&&<ScheduleView snapshot={snapshot} date={date} onDate={changeDate} teacher={teacher} onTeacher={setTeacher} scope={scope} onScope={setScope} onEdit={a=>{if(!saving)setEdit(a);}} busy={saving}/>}
        {view==='attendance'&&<AttendanceView snapshot={snapshot} date={date} room={room} period={period} onDate={changeDate} onRoom={r=>guard(()=>{setRoom(r);setAttendanceSearch('');})} onPeriod={p=>guard(()=>setPeriod(p))} drafts={drafts} onDrafts={setDrafts} onSave={saveAttendance} onAddStudent={()=>{setAddInitialStudentId('');setAddingStudent(true);}} onManageRoster={()=>setManagingRoster(true)} onReset={beginAttendanceReset} onUndo={()=>{void beginAttendanceUndo({date,room,period});}} saving={saving} search={attendanceSearch} onSearch={setAttendanceSearch}/>}
        {view==='original'&&<OriginalView snapshot={snapshot} date={date} onDate={changeDate} classNo={classNo} onClass={setClassNo} search={originalSearch} onSearch={setOriginalSearch} busy={saving} onOpenRecord={(d,r,p)=>guard(()=>{setDate(d);setRoom(r);setPeriod(p);setAttendanceSearch('');setView('attendance');})}/>}
      </>}

    </main>
    <ServiceFooter/>

    {edit&&snapshot&&(edit.extra?<CoverageEditor snapshot={snapshot} source={edit} onClose={()=>{if(!saving)setEdit(null);}} onSave={saveSchedule}/>:<ScheduleEditor snapshot={snapshot} assignmentId={edit.id} onClose={()=>{if(!saving)setEdit(null);}} onSave={saveSchedule}/>)}
    {addingStudent&&snapshot&&<AddStudentModal snapshot={snapshot} date={date} room={room} period={period} initialStudentId={addInitialStudentId} onClose={()=>{if(!saving)setAddingStudent(false);}} onSave={saveRoster}/>}
    {managingRoster&&snapshot&&<RosterManager snapshot={snapshot} onClose={()=>{if(!saving)setManagingRoster(false);}} onSave={saveManagedRoster} onAddDates={studentId=>{setManagingRoster(false);setAddInitialStudentId(studentId);setAddingStudent(true);}}/>}
    {attendanceReset&&<Modal title={attendanceReset.mode==='undo'?'직전 저장을 취소할까요?':'이 교시 기록을 초기화할까요?'} onClose={()=>{if(!saving)setAttendanceReset(null);}}>
      <p className="reset-scope"><strong>{schoolDate(attendanceReset.date,true)} · {roomLabel(attendanceReset.room)} · {attendanceReset.period}교시</strong></p>
      <p className="reset-description">{attendanceReset.mode==='undo'?`직전 저장에서 바뀐 ${attendanceReset.count}명의 출석 상태와 메모를 그 저장 이전으로 되돌립니다.`:`저장된 ${attendanceReset.count}명의 출석 상태와 메모를 미기록으로 초기화합니다. 검색으로 보이지 않는 학생도 포함됩니다.`}</p>
      {dirty&&attendanceReset.date===date&&attendanceReset.room===room&&attendanceReset.period===period&&<p className="reset-description">현재 입력 중인 변경 내용도 취소됩니다.</p>}
      {resetError&&<div className="inline-alert error" role="alert"><AlertCircle size={17}/>{resetError}</div>}
      <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={()=>setAttendanceReset(null)}>돌아가기</button><button className="button primary" disabled={saving} onClick={resetAttendance}>{saving&&<Loader2 size={17} className="spin"/>}{attendanceReset.mode==='undo'?'직전 저장 취소':'이 교시 초기화'}</button></div>
    </Modal>}
    {pendingNav&&<Modal title="저장하지 않은 출석 기록이 있습니다" description="현재 교시의 변경 내용을 저장하지 않고 이동할까요?" onClose={()=>setPendingNav(null)}><div className="modal-actions"><button className="button secondary" onClick={()=>setPendingNav(null)}>돌아가기</button><button className="button primary" onClick={()=>{setDrafts({});pendingNav();setPendingNav(null);}}>저장하지 않고 이동</button></div></Modal>}
    {history&&<Modal title="최근 변경 내역" onClose={()=>setHistory(false)} wide><div className="history-list">{!snapshot?.history.length?<div className="empty-history"><History size={25}/><p>아직 저장한 변경이 없습니다.</p></div>:snapshot.history.map(h=><article key={h.id}><span className="history-icon">{h.kind==='schedule'?<Calendar size={17}/>:<ClipboardList size={17}/>}</span><div><strong>{h.summary}</strong><p>{h.actor}<span>·</span>{formatSaved(h.created_at)}</p></div></article>)}</div></Modal>}
    {rules&&snapshot&&<Modal title="운영 기준" onClose={()=>setRules(false)} wide><div className="rules-grid"><section><h3>관리반과 교시</h3><p>11/30·12/1: {roomLabel(1)}(3반), {roomLabel(2)}(4반)</p><p>12/2부터: {roomLabel(1)}(3반) 통합</p><p>월·수·목 6교시 / 화·금 7교시</p><p>14:00은 5교시 시작 시각</p><p>주말·12월 11일·12월 25일 제외</p></section><section><h3>임장 배정</h3><p>{snapshot.state.teachers.filter(t=>t.minDuties===2).map(t=>t.name).join('·')}: 전체 기간 각 2~3교시</p><p>{snapshot.state.teachers.filter(t=>t.minDuties===5).map(t=>t.name).join('·')}: 전체 기간 각 5~6교시</p><p>그 외 {snapshot.state.teachers.filter(t=>t.minDuties===0).length}명: 기준 배정 각 8교시</p><p>{snapshot.state.settings.excludedTeachers.join('·')} 선생님은 배정 대상에서 제외</p></section></div><section className="rule-lessons"><h3>1·2학년 수업 제외 시간</h3>{snapshot.state.teachers.filter(t=>snapshot.state.blocked.some(b=>b.teacherId===t.id)).map(t=><div key={t.id}><strong>{t.name}</strong><span>{snapshot.state.blocked.filter(b=>b.teacherId===t.id).map(b=>`${b.weekday} ${b.period}교시`).join(' · ')}</span></div>)}<p className="subtle">제공 시간표를 전체 기간에 요일별로 동일 적용합니다. 수요일 5·6교시에는 1·2학년 수업이 없습니다.</p></section></Modal>}
    {toast&&<div className={`toast ${toast.error?'error':''}`} role="status">{toast.error?<AlertCircle size={18}/>:<Check size={18}/>}<span>{toast.message}</span>{toast.action&&<button disabled={saving} onClick={toast.action.run}>{toast.action.label}</button>}<button className="toast-close" onClick={()=>setToast(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
  </div>;
}
