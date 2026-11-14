import {getApps,initializeApp} from 'firebase/app';
import {getAuth,setPersistence,browserSessionPersistence,GoogleAuthProvider,signInWithPopup,signOut} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
import type {ProjectConfig} from './project-config';
export async function initializeSchoolFirebase(config:ProjectConfig){
  const app=getApps().find(a=>a.name==='school-study-hub')??initializeApp(config.firebase,'school-study-hub');const auth=getAuth(app);await setPersistence(auth,browserSessionPersistence);
  const db=getFirestore(app,config.databaseId);
  return {app,auth,db,signIn:async()=>{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});try{await signInWithPopup(auth,provider);}catch(error){throw new Error(friendlyCloudError(error));}},signOut:async()=>{await signOut(auth);}};
}
export type SchoolFirebase=Awaited<ReturnType<typeof initializeSchoolFirebase>>;
export function friendlyCloudError(error:unknown){
  const code=(error as {code?:string})?.code??'';
  if(code.includes('popup-closed-by-user')||code.includes('cancelled-popup-request'))return '로그인 창이 닫혔습니다. 다시 로그인해 주세요.';
  if(code.includes('popup-blocked'))return '로그인 팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러 주세요.';
  if(code.includes('unauthorized-domain')||code.includes('operation-not-allowed'))return '로그인 연결 설정을 확인하고 있습니다. 관리자에게 문의해 주세요.';
  if(code.includes('permission-denied')||code.includes('unauthenticated'))return '이 계정의 사용 권한을 확인해 주세요. 다시 로그인하거나 관리자에게 문의해 주세요.';
  if(code.includes('resource-exhausted')||code.includes('quota-exceeded'))return '공동 저장소의 이용 한도에 도달했습니다. 관리자에게 문의해 주세요.';
  if(code.includes('unavailable')||code.includes('network-request-failed'))return '공동 저장소에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  return error instanceof Error&& !code?error.message:'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
