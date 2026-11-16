import {collection,doc,getDocFromServer,limit,onSnapshot,onSnapshotsInSync,orderBy,query,runTransaction,serverTimestamp,type Firestore,type Unsubscribe} from 'firebase/firestore';
import type {Auth,User} from 'firebase/auth';
import type {AttendanceChange,Room,RosterDateEntry,Snapshot} from './types';
import {recordKey,roomLabel,schoolDate} from './domain';
import {applyMutation,MutationError} from './mutations';
import {buildCloudConfig,cloudSchedule,cloudRoster,rosterParticipants,decodeInitialData,stateWithSchedule,type CloudConfig,type CloudSchedule,type CloudHead,type CloudAttendance,type CloudHistory,type CloudRoster} from './cloud-model';
import {friendlyCloudError} from './firebase-runtime';

type SyncStatus='loading'|'ready'|'empty'|'error';
export function createSharedClient(db:Firestore,auth:Auth,user:User,actorName:string,isOwner:boolean,onStatus:(status:SyncStatus,error?:string)=>void){
  const configRef=doc(db,'school','config'),scheduleRef=doc(db,'school','schedule'),headRef=doc(db,'school','live');
  const unsubscribe:Unsubscribe[]=[];const serverReady=new Map<string,boolean>();
  let config:CloudConfig|null=null,schedule:CloudSchedule|null=null,head:CloudHead|null=null;
  let records=new Map<string,CloudAttendance>(),history=new Map<string,CloudHistory>(),rosters=new Map<string,CloudRoster>(),cached:Snapshot|null=null;
  let status:SyncStatus='loading',lastError='',disposed=false,fatalAuthorization=false,lastPublished=-1;
  const waiters=new Set<{minimum:number;resolve:(s:Snapshot)=>void;reject:(e:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
  const active=()=>{if(disposed||auth.currentUser?.uid!==user.uid)throw new MutationError(401,'다시 로그인해 주세요.');if(fatalAuthorization)throw new MutationError(403,lastError);};
  const initialTimer=setTimeout(()=>{if(status==='loading'&&!cached)fail(new Error('공동 저장소에 연결하지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.'));},25000);
  function changeStatus(next:SyncStatus,error?:string){if(next!=='loading')clearTimeout(initialTimer);if(status!==next||lastError!==(error??'')){status=next;lastError=error??'';onStatus(next,error);}}
  function fail(error:unknown){if(disposed)return;const code=(error as {code?:string})?.code??'';if(code.includes('permission-denied')||code.includes('unauthenticated')){fatalAuthorization=true;cached=null;records.clear();history.clear();rosters.clear();for(const stop of unsubscribe)stop();}const message=friendlyCloudError(error);changeStatus('error',message);for(const w of waiters){clearTimeout(w.timer);w.reject(new MutationError(503,message));}waiters.clear();}
  function publish(){
    if(disposed||fatalAuthorization||serverReady.size!==6||[...serverReady.values()].some(v=>!v))return;
    if(!config){changeStatus('empty');return;}
    if(!schedule||!head){fail(new Error('공동 운영 자료의 초기 설정을 확인해 주세요.'));return;}
    try{
      const state=stateWithSchedule(config,schedule);
      state.additionalParticipants=rosterParticipants([...rosters.values()]);
      for(const [id,r] of records)if(r.status!=='unrecorded')state.attendance[id]={studentId:r.studentId,date:r.date,period:r.period,status:r.status,note:r.note,updatedAt:r.updatedAt.toDate().toISOString(),updatedBy:r.actorName};
      cached={state,revision:head.revision,updatedAt:head.updatedAt.toDate().toISOString(),history:[...history.entries()].map(([id,h])=>({id,revision:h.revision,kind:h.kind,actor:h.actorName,created_at:h.createdAt.toDate().toISOString(),summary:h.kind==='schedule'?`${schoolDate(h.date)} ${roomLabel(h.room)} ${h.period}교시 ${h.fromTeacher} → ${h.toTeacher}${h.swapId?' (맞교환)':''}`:h.kind==='roster-batch'?`${state.students.find(s=>s.id===h.studentId)?.name??h.studentId} · ${Object.keys(h.entries??{}).sort().map(d=>schoolDate(d)).join(', ')} ${h.action==='add'?'학생 추가':'추가 취소'}`:h.kind==='roster'?`${schoolDate(h.date)} ${roomLabel(h.room)} ${state.students.find(s=>s.id===h.studentId)?.name??h.studentId} ${h.action==='add'?'학생 추가':'추가 취소'}`:`${schoolDate(h.date)} ${roomLabel(h.room)} ${h.period}교시 출석 기록 변경`})).sort((a,b)=>b.revision-a.revision).slice(0,20)};
      changeStatus('ready');for(const w of waiters)if(cached.revision>=w.minimum){clearTimeout(w.timer);w.resolve(cached);waiters.delete(w);}
      if(cached.revision!==lastPublished){lastPublished=cached.revision;window.dispatchEvent(new Event('school:updated'));}
    }catch(error){fail(error);}
  }
  const options={includeMetadataChanges:true};
  unsubscribe.push(onSnapshot(configRef,options,s=>{config=s.exists()?s.data() as CloudConfig:null;serverReady.set('config',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  unsubscribe.push(onSnapshot(scheduleRef,options,s=>{schedule=s.exists()?s.data() as CloudSchedule:null;serverReady.set('schedule',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  unsubscribe.push(onSnapshot(headRef,options,s=>{head=s.exists()?s.data() as CloudHead:null;serverReady.set('head',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  unsubscribe.push(onSnapshot(collection(db,'attendance'),options,s=>{records=new Map(s.docs.map(d=>[d.id,d.data() as CloudAttendance]));serverReady.set('attendance',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  // Daily roster edits must appear on every teacher's screen alongside attendance.
  unsubscribe.push(onSnapshot(collection(db,'dailyRosters'),options,s=>{rosters=new Map(s.docs.map(d=>[d.id,d.data() as CloudRoster]));serverReady.set('rosters',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  unsubscribe.push(onSnapshot(query(collection(db,'history'),orderBy('revision','desc'),limit(20)),options,s=>{history=new Map(s.docs.map(d=>[d.id,d.data() as CloudHistory]));serverReady.set('history',!s.metadata.fromCache&&!s.metadata.hasPendingWrites);},fail));
  // This barrier keeps the head, timetable, attendance, and history on the same
  // committed watch snapshot before exposing a revision to the editing UI.
  unsubscribe.push(onSnapshotsInSync(db,publish));
  function waitForRevision(minimum=0,allowEmpty=false):Promise<Snapshot>{
    active();if(status==='ready'&&cached&&cached.revision>=minimum)return Promise.resolve(cached);
    if(status==='error')return Promise.reject(new MutationError(503,lastError));
    if(status==='empty'&&!allowEmpty)return Promise.reject(new MutationError(428,'초기 운영 자료 등록이 필요합니다.'));
    return new Promise((resolve,reject)=>{const waiter={minimum,resolve,reject,timer:setTimeout(()=>{waiters.delete(waiter);reject(new MutationError(503,'공동 저장소 응답을 기다리고 있습니다. 연결을 확인하고 다시 시도해 주세요.'));},20000)};waiters.add(waiter);});
  }
  async function mutate(body:Record<string,unknown>){
    active();const before=await waitForRevision();applyMutation(before,body,actorName);
    const batchEntries=body.kind==='roster-batch'?[...body.entries as RosterDateEntry[]].sort((a,b)=>a.date.localeCompare(b.date)):[];
    const logRef=doc(collection(db,'history'));
    let seenRevision=before.revision;
    try{
      const revision=await runTransaction(db,async tx=>{
        active();const headSnapshot=await tx.get(headRef);if(!headSnapshot.exists())throw new MutationError(503,'초기 운영 자료를 확인해 주세요.');
        const currentHead=headSnapshot.data() as CloudHead;seenRevision=currentHead.revision;
        if(body.baseRevision!==currentHead.revision)throw new MutationError(409,'다른 변경이 먼저 저장되었습니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.');
        const configSnapshot=await tx.get(configRef),scheduleSnapshot=await tx.get(scheduleRef);
        if(!configSnapshot.exists()||!scheduleSnapshot.exists())throw new MutationError(503,'운영 자료를 확인해 주세요.');
        const serverState=stateWithSchedule(configSnapshot.data() as CloudConfig,scheduleSnapshot.data() as CloudSchedule);
        const rosterDates=body.kind==='roster-batch'?batchEntries.map(e=>e.date):body.kind==='attendance'||body.kind==='roster'?[String(body.date)]:[];
        const rosterRefs=rosterDates.map(date=>doc(db,'dailyRosters',date));
        const rosterSnapshots=await Promise.all(rosterRefs.map(ref=>tx.get(ref)));
        const rosterRef=rosterRefs[0];
        serverState.additionalParticipants=rosterParticipants(rosterSnapshots.filter(s=>s.exists()).map(s=>s.data() as CloudRoster));
        serverState.attendance=before.state.attendance;
        const result=applyMutation({...before,state:serverState,revision:currentHead.revision},body,actorName);
        const nextRevision=currentHead.revision+1;const timestamp=serverTimestamp();
        if(result.kind==='schedule'){
          const source=serverState.assignments.find(a=>a.id===body.assignmentId)!;
          tx.set(scheduleRef,cloudSchedule(result.state,user.uid,timestamp,nextRevision));
          tx.set(logRef,{revision:nextRevision,kind:'schedule',date:source.date,room:source.room,period:source.period,assignmentId:source.id,fromTeacher:source.teacherId,toTeacher:String(body.teacherId),swapId:typeof body.swapId==='string'?body.swapId:'',reason:typeof body.reason==='string'?body.reason.trim().slice(0,300):'',actorUid:user.uid,actorName,createdAt:timestamp});
        }else if(result.kind==='roster-batch'){
          const studentId=String(body.studentId),action=body.action as 'add'|'remove',anchor=batchEntries[0];
          batchEntries.forEach((entry,index)=>tx.set(rosterRefs[index],cloudRoster(result.state,entry.date,studentId,action,user.uid,actorName,timestamp,nextRevision)));
          tx.set(logRef,{revision:nextRevision,kind:'roster-batch',date:anchor.date,room:anchor.room,period:anchor.startPeriod,endPeriod:anchor.endPeriod,studentId,action,entries:Object.fromEntries(batchEntries.map(e=>[e.date,`${e.room}:${e.startPeriod}:${e.endPeriod}`])),actorUid:user.uid,actorName,createdAt:timestamp});
        }else if(result.kind==='roster'){
          const date=String(body.date),studentId=String(body.studentId),action=body.action as 'add'|'remove';
          tx.set(rosterRef!,cloudRoster(result.state,date,studentId,action,user.uid,actorName,timestamp,nextRevision));
          tx.set(logRef,{revision:nextRevision,kind:'roster',date,room:body.room,period:body.startPeriod,endPeriod:body.endPeriod,studentId,action,actorUid:user.uid,actorName,createdAt:timestamp});
        }else{
          const changes=body.changes as AttendanceChange[],date=String(body.date),period=Number(body.period),room=body.room as Room;
          for(const c of changes){const id=recordKey(date,c.studentId,period),ref=doc(db,'attendance',id),r=result.state.attendance[id];tx.set(ref,{studentId:c.studentId,date,period,room,status:r?.status??'unrecorded',note:r?.note??'',updatedAt:timestamp,updatedBy:user.uid,actorName,revision:nextRevision});}
          tx.set(logRef,{revision:nextRevision,kind:'attendance',date,room,period,firstStudentId:changes[0].studentId,actorUid:user.uid,actorName,createdAt:timestamp});
        }
        tx.update(headRef,{revision:nextRevision,updatedAt:timestamp,updatedBy:user.uid,lastLog:logRef.id});
        return nextRevision;
      });
      active();return await waitForRevision(revision);
    }catch(error){
      if(error instanceof MutationError&&error.status===409){await waitForRevision(seenRevision);throw error;}
      // Rules can reject an obsolete revision before the transaction conflict is
      // returned. Re-read with the same account; only a changed head is a conflict.
      if((error as {code?:string})?.code?.includes('permission-denied')){
        // The competing commit may still be in flight. Bound the recheck and
        // never turn a denial into success or retry an obsolete user change.
        for(const delay of [0,100,300,600]){
          if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
          active();const latest=await getDocFromServer(headRef);
          if(latest.exists()&&latest.data().revision!==body.baseRevision){await waitForRevision(latest.data().revision);throw new MutationError(409,'다른 변경이 먼저 저장되었습니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.');}
        }
      }
      throw error;
    }
  }
  return {
    request:async(path:string,init?:RequestInit):Promise<Response>=>{
      try{active();if(path==='/api/state')return Response.json(await waitForRevision());if(path==='/api/mutate'&&init?.method==='POST')return Response.json(await mutate(JSON.parse(String(init.body??'{}'))));throw new MutationError(404,'요청한 화면을 찾지 못했습니다.');}
      catch(error){const code=(error as {code?:string})?.code??'';const status=error instanceof MutationError?error.status:code.includes('permission-denied')?403:code.includes('unauthenticated')?401:503;return Response.json({error:error instanceof MutationError?error.message:friendlyCloudError(error)},{status});}
    },
    initialize:async(raw:string)=>{
      active();if(!isOwner)throw new MutationError(403,'관리자만 운영 자료를 등록할 수 있습니다.');
      const state=await decodeInitialData(raw),timestamp=serverTimestamp();
      await runTransaction(db,async transaction=>{if((await transaction.get(configRef)).exists())throw new MutationError(409,'운영 자료가 이미 등록되어 있습니다. 새로고침해 주세요.');transaction.set(configRef,buildCloudConfig(state,user.uid,timestamp));transaction.set(scheduleRef,cloudSchedule(state,user.uid,timestamp));transaction.set(headRef,{revision:0,updatedAt:timestamp,updatedBy:user.uid,lastLog:''});});
      await waitForRevision(0,true);
    },
    snapshot:()=>cached,
    dispose:()=>{disposed=true;clearTimeout(initialTimer);for(const stop of unsubscribe)stop();for(const w of waiters){clearTimeout(w.timer);w.reject(new MutationError(401,'다시 로그인해 주세요.'));}waiters.clear();cached=null;records.clear();history.clear();rosters.clear();config=null;schedule=null;head=null;},
  };
}
export type SharedClient=ReturnType<typeof createSharedClient>;
