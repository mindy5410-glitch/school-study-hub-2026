import {useRef,useState} from 'react';
import {LockKeyhole,LogIn,LogOut,Loader2,UploadCloud,ArrowRight} from 'lucide-react';
import {ServiceHeader,ServiceFooter,Breadcrumb} from './service-layout';

export function AccountGate({status,error,onPasswordSignIn,onAdminSignIn,onSignOut}:{status:'loading'|'signed-out'|'not-allowed'|'preparing';error?:string;onPasswordSignIn:(password:string)=>Promise<void>;onAdminSignIn:()=>Promise<void>;onSignOut:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[localError,setLocalError]=useState(''),[password,setPassword]=useState('');
  const act=async(action:()=>Promise<void>)=>{setBusy(true);setLocalError('');try{await action();}catch(e){setLocalError(e instanceof Error?e.message:'접속하지 못했습니다. 다시 시도해 주세요.');}finally{setBusy(false);setPassword('');}};
  const title=status==='not-allowed'?'공용 비밀번호로 접속해 주세요':status==='preparing'?'접속 상태를 확인하고 있습니다':'공용 비밀번호 입력';
  return <div className="auth-layout">
    <ServiceHeader/>
    <main id="main-content" className="auth-main" tabIndex={-1}>
      <Breadcrumb current="운영실 접속"/>
      <header className="auth-page-title"><h1>운영실 접속</h1></header>
      <div className="auth-content-grid"><section className="auth-card" aria-labelledby="login-title">
        <div className="auth-lock"><LockKeyhole size={27}/></div>
        <h2 id="login-title">{title}</h2>
        {(error||localError)&&<div className="inline-alert error" role="alert">{error||localError}</div>}
        {status==='loading'||status==='preparing'?<div className="auth-loading" role="status"><Loader2 className="spin" size={22}/><span>접속을 확인하고 있습니다</span></div>:status==='signed-out'?<>
          <form className="password-form" onSubmit={e=>{e.preventDefault();if(password)void act(()=>onPasswordSignIn(password));}}>
            <label htmlFor="shared-password">공용 비밀번호 <span className="required-label">필수</span></label>
            <input id="shared-password" name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder="공용 비밀번호를 입력하세요" disabled={busy}/>
            <button className="button primary auth-login" disabled={busy||!password}>{busy?<Loader2 className="spin" size={20}/>:<LogIn size={20}/>}운영실 들어가기<ArrowRight size={19}/></button>
          </form>
          <button className="admin-login" disabled={busy} onClick={()=>void act(onAdminSignIn)}>관리자 로그인<ArrowRight size={15}/></button>
        </>:status==='not-allowed'?<button className="button secondary auth-login" disabled={busy} onClick={()=>void act(onSignOut)}><LogOut size={17}/>비밀번호 입력 화면으로</button>:null}
      </section></div>
    </main>
    <ServiceFooter/>
  </div>;
}

export function BootstrapGate({onInitialize,onSignOut}:{onInitialize:(raw:string)=>Promise<void>;onSignOut:()=>Promise<void>}){
  const input=useRef<HTMLInputElement>(null);const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <div className="bootstrap-page"><section className="panel bootstrap-card"><span className="auth-school"><UploadCloud size={29}/></span><h1>처음 운영 자료 등록하기</h1><input ref={input} type="file" accept=".json,application/json" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>2_000_000){setError('제공된 운영 자료 파일을 선택해 주세요.');return;}setBusy(true);setError('');try{await onInitialize(await file.text());}catch(error){setError(error instanceof Error?error.message:'운영 자료를 등록하지 못했습니다.');}finally{setBusy(false);}}}/>{error&&<div className="inline-alert error" role="alert">{error}</div>}<button className="button primary" disabled={busy} onClick={()=>input.current?.click()}>{busy?<Loader2 className="spin" size={18}/>:<UploadCloud size={18}/>}운영 자료 파일 선택</button><button className="button secondary" disabled={busy} onClick={()=>onSignOut()}>로그아웃</button></section></div>;
}
