import {useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged,type User} from 'firebase/auth';
import Portal from './app/portal';
import {AccountGate,BootstrapGate} from './app/components/account-gate';
import {TeacherAccounts,type TeacherGrant} from './app/components/teacher-accounts';
import {loadProjectConfig,type ProjectConfig} from './lib/project-config';
import {initializeSchoolFirebase,friendlyCloudError,type SchoolFirebase} from './lib/firebase-runtime';
import {watchTeacherAccess,watchTeacherList,saveTeacherAccess} from './lib/teacher-access';
import {createSharedClient,type SharedClient} from './lib/shared-client';
import './app/globals.css';
import './app/accounts.css';
import './app/status.css';

function App(){
  const [project,setProject]=useState<ProjectConfig|null>(null),[firebase,setFirebase]=useState<SchoolFirebase|null>(null);
  const [user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false),[error,setError]=useState('');
  const [grant,setGrant]=useState<TeacherGrant|null>(null),[grantReady,setGrantReady]=useState(false);
  const [client,setClient]=useState<SharedClient|null>(null),[sync,setSync]=useState<'loading'|'ready'|'empty'|'error'>('loading'),[syncError,setSyncError]=useState('');
  const [manage,setManage]=useState(false),[members,setMembers]=useState<TeacherGrant[]>([]),[memberError,setMemberError]=useState('');

  useEffect(()=>{let active=true;loadProjectConfig().then(async config=>{const runtime=await initializeSchoolFirebase(config);if(active){setProject(config);setFirebase(runtime);}}).catch(e=>{if(active){setError(friendlyCloudError(e));setAuthReady(true);}});return()=>{active=false;};},[]);
  useEffect(()=>{if(!firebase)return;return onAuthStateChanged(firebase.auth,next=>{setUser(next);setAuthReady(true);setGrant(null);setGrantReady(false);setManage(false);setError('');});},[firebase]);
  useEffect(()=>{
    if(!firebase||!project||!user||!project.ownerUid)return;
    let active=true;
    const stop=watchTeacherAccess(firebase.db,user,project.ownerUid,value=>{if(active){setGrant(value);setGrantReady(true);setError('');}},e=>{if(active){setGrant(null);setGrantReady(true);setError(friendlyCloudError(e));}});
    return()=>{active=false;stop();};
  },[firebase,project,user]);
  const owner=!!user&&!!project?.ownerUid&&user.uid===project.ownerUid;
  const actor=grant?.displayName??'관리자';
  useEffect(()=>{
    if(!firebase||!user||!grantReady||!grant?.enabled||!project?.ownerUid){setClient(null);return;}
    let active=true;setSync('loading');setSyncError('');
    const api=createSharedClient(firebase.db,firebase.auth,user,actor,owner,(next,message)=>{if(active){setSync(next);setSyncError(message??'');}});
    setClient(api);return()=>{active=false;api.dispose();};
  },[firebase,user,grantReady,grant?.enabled,actor,owner,project?.ownerUid]);
  useEffect(()=>{
    if(!manage||!owner||!firebase)return;setMemberError('');
    return watchTeacherList(firebase.db,setMembers,e=>setMemberError(friendlyCloudError(e)));
  },[manage,owner,firebase]);
  const signIn=useCallback(async()=>{if(firebase)await firebase.signIn();},[firebase]);
  const signOut=useCallback(async()=>{if(firebase)await firebase.signOut();},[firebase]);
  const email=user?.email??undefined;
  if(!authReady)return <AccountGate status="loading" onSignIn={signIn} onSignOut={signOut}/>;
  if(!firebase||!project)return <AccountGate status="preparing" error={error} onSignIn={signIn} onSignOut={signOut}/>;
  if(!user)return <AccountGate status="signed-out" error={error} onSignIn={signIn} onSignOut={signOut}/>;
  if(!project.ownerUid)return <AccountGate status="preparing" email={email} onSignIn={signIn} onSignOut={signOut}/>;
  if(!grantReady)return <AccountGate status="loading" email={email} onSignIn={signIn} onSignOut={signOut}/>;
  if(!grant?.enabled)return <AccountGate status="not-allowed" email={email} error={error} onSignIn={signIn} onSignOut={signOut}/>;
  if(sync==='empty'&&owner&&client)return <BootstrapGate onInitialize={raw=>client.initialize(raw)} onSignOut={signOut}/>;
  if(!client||!client.snapshot())return <AccountGate status={sync==='loading'?'loading':'preparing'} email={email} error={syncError} onSignIn={signIn} onSignOut={signOut}/>;
  return <div className={syncError?'connection-problem':''}>{syncError&&<div className="connection-alert" role="alert">{syncError}</div>}<Portal displayName={actor} request={client.request} onSignOut={signOut} onManage={owner?()=>setManage(true):undefined}/>{manage&&owner&&<>{memberError&&<div className="local-message" role="alert">{memberError}</div>}<TeacherAccounts members={members} teachers={client.snapshot()!.state.teachers} onClose={()=>setManage(false)} onSave={(address,teacherId,enabled)=>saveTeacherAccess(firebase.db,user,project.ownerUid,address,teacherId,enabled,client.snapshot()!.state.teachers)}/></>}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
