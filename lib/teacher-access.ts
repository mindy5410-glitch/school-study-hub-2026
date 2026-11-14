import {collection,doc,onSnapshot,query,limit,runTransaction,serverTimestamp,type Firestore,type Unsubscribe} from 'firebase/firestore';
import type {User} from 'firebase/auth';
import type {Teacher} from './types';
import type {TeacherGrant} from '../app/components/teacher-accounts';
export function watchTeacherAccess(db:Firestore,user:User,ownerUid:string,onValue:(grant:TeacherGrant|null)=>void,onError:(error:unknown)=>void):Unsubscribe{
  const email=user.email?.toLowerCase();if(!email){onValue(null);return()=>{};}
  return onSnapshot(doc(db,'access',email),snapshot=>{
    if(!snapshot.exists()){onValue(user.uid===ownerUid?{email,teacherId:'',displayName:'관리자',enabled:true}:null);return;}
    const data=snapshot.data();
    if(user.uid===ownerUid){onValue({email,teacherId:String(data.teacherId??''),displayName:data.enabled?String(data.displayName??'관리자'):'관리자',enabled:true});return;}
    onValue(data.enabled===true?{email,teacherId:String(data.teacherId),displayName:String(data.displayName),enabled:true}:null);
  },onError);
}
export function watchTeacherList(db:Firestore,onValue:(grants:TeacherGrant[])=>void,onError:(error:unknown)=>void){
  return onSnapshot(query(collection(db,'access'),limit(50)),snapshot=>onValue(snapshot.docs.map(d=>({email:d.id,...d.data()} as TeacherGrant)).sort((a,b)=>a.displayName.localeCompare(b.displayName,'ko'))),onError);
}
export async function saveTeacherAccess(db:Firestore,user:User,ownerUid:string,email:string,teacherId:string,enabled:boolean,teachers:Teacher[]){
  if(user.uid!==ownerUid)throw new Error('관리자만 교사 계정을 등록할 수 있습니다.');
  email=email.trim().toLowerCase();const teacher=teachers.find(t=>t.id===teacherId);
  if(!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)||email.length>254||!teacher)throw new Error('교사와 이메일을 확인해 주세요.');
  if(email===user.email?.toLowerCase()&&!enabled)throw new Error('관리자 계정은 중지할 수 없습니다.');
  await runTransaction(db,async transaction=>{await transaction.get(doc(db,'school','config'));transaction.set(doc(db,'access',email),{teacherId:teacher.id,displayName:teacher.name,enabled,updatedAt:serverTimestamp(),updatedBy:user.uid});});
}
