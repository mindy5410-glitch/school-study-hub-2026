import {useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {onAuthStateChanged,type User} from 'firebase/auth';
import Portal from './app/portal';
import {AccountGate,BootstrapGate} from './app/components/account-gate';
import {loadProjectConfig,type ProjectConfig} from './lib/project-config';
import {initializeSchoolFirebase,friendlyCloudError,type SchoolFirebase} from './lib/firebase-runtime';
import {watchWorkspaceAccess,type WorkspaceRole} from './lib/teacher-access';
import {createSharedClient,type SharedClient} from './lib/shared-client';
import './app/globals.css';
import './app/accounts.css';
import './app/status.css';

function App(){
  const [project,setProject]=useState<ProjectConfig|null>(null),[firebase,setFirebase]=useState<SchoolFirebase|null>(null);
  const [user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false),[error,setError]=useState('');
  const [role,setRole]=useState<WorkspaceRole>(null),[accessReady,setAccessReady]=useState(false);
  const [client,setClient]=useState<SharedClient|null>(null),[sync,setSync]=useState<'loading'|'ready'|'empty'|'error'>('loading'),[syncError,setSyncError]=useState('');
  useEffect(()=>{let active=true;loadProjectConfig().then(async config=>{const runtime=await initializeSchoolFirebase(config);if(active){setProject(config);setFirebase(runtime);}}).catch(e=>{if(active){setError(friendlyCloudError(e));setAuthReady(true);}});return()=>{active=false;};},[]);
  useEffect(()=>{if(!firebase)return;return onAuthStateChanged(firebase.auth,next=>{setUser(next);setAuthReady(true);setRole(null);setAccessReady(false);setError('');});},[firebase]);
  useEffect(()=>{
    if(!firebase||!project||!user)return;let active=true;
    const stop=watchWorkspaceAccess(firebase.db,user,project,value=>{if(active){setRole(value);setAccessReady(true);setError('');}},e=>{if(active){setRole(null);setAccessReady(true);setError(friendlyCloudError(e));}});
    return()=>{active=false;stop();};
  },[firebase,project,user]);
  const owner=role==='owner',actor=owner?'관리자':'공용 접속';
  useEffect(()=>{
    if(!firebase||!user||!accessReady||!role){setClient(null);return;}
    let active=true;setSync('loading');setSyncError('');
    const api=createSharedClient(firebase.db,firebase.auth,user,actor,owner,(next,message)=>{if(active){setSync(next);setSyncError(message??'');}});
    setClient(api);return()=>{active=false;api.dispose();};
  },[firebase,user,accessReady,role,actor,owner]);
  const adminSignIn=useCallback(async()=>{if(firebase)await firebase.signIn();},[firebase]);
  const passwordSignIn=useCallback(async(password:string)=>{if(!firebase)throw new Error('연결을 확인하고 다시 시도해 주세요.');await firebase.signInWithSharedPassword(password);},[firebase]);
  const signOut=useCallback(async()=>{if(firebase)await firebase.signOut();},[firebase]);
  const gateProps={onAdminSignIn:adminSignIn,onPasswordSignIn:passwordSignIn,onSignOut:signOut};
  if(!authReady)return <AccountGate status="loading" {...gateProps}/>;
  if(!firebase||!project)return <AccountGate status="preparing" error={error} {...gateProps}/>;
  if(!user)return <AccountGate status="signed-out" error={error} {...gateProps}/>;
  if(!accessReady)return <AccountGate status="loading" {...gateProps}/>;
  if(!role)return <AccountGate status="not-allowed" error={error} {...gateProps}/>;
  if(sync==='empty'&&owner&&client)return <BootstrapGate onInitialize={raw=>client.initialize(raw)} onSignOut={signOut}/>;
  if(!client||!client.snapshot())return <AccountGate status={sync==='loading'?'loading':'preparing'} error={syncError} {...gateProps}/>;
  return <div className={syncError?'connection-problem':''}>{syncError&&<div className="connection-alert" role="alert">{syncError}</div>}<Portal displayName={actor} request={client.request} onSignOut={signOut}/></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
