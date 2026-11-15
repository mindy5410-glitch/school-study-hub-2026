import {doc,onSnapshot,type Firestore,type Unsubscribe} from 'firebase/firestore';
import {getIdTokenResult,type User} from 'firebase/auth';
import type {ProjectConfig} from './project-config';
export type WorkspaceRole='owner'|'shared'|null;
export function watchWorkspaceAccess(db:Firestore,user:User,config:Pick<ProjectConfig,'ownerUid'|'sharedAccountUid'>,onValue:(role:WorkspaceRole)=>void,onError:(error:unknown)=>void):Unsubscribe{
  const provider=(id:string)=>user.providerData.some(p=>p.providerId===id);
  if(user.uid===config.ownerUid&&user.emailVerified&&provider('google.com')){onValue('owner');return()=>{};}
  if(user.uid!==config.sharedAccountUid||!provider('password')){onValue(null);return()=>{};}
  let active=true,stop:Unsubscribe=()=>{};
  getIdTokenResult(user).then(token=>{
    if(!active)return;
    const authTime=token.claims.auth_time;
    if(token.signInProvider!=='password'||typeof authTime!=='number'){onValue(null);return;}
    stop=onSnapshot(doc(db,'security','shared'),snapshot=>{
      if(!active)return;const d=snapshot.data();
      onValue(d?.enabled===true&&Number.isInteger(d.validAfter)&&authTime>=d.validAfter?'shared':null);
    },onError);
  }).catch(error=>{if(active)onError(error);});
  return()=>{active=false;stop();};
}
