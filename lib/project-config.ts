import type {FirebaseOptions} from 'firebase/app';
export interface ProjectConfig {firebase:FirebaseOptions;databaseId:string;ownerUid:string;sharedAccountEmail:string;sharedAccountUid:string}
export async function loadProjectConfig():Promise<ProjectConfig>{
  const response=await fetch(new URL('./project-config.json',document.baseURI),{cache:'no-store'});
  if(!response.ok)throw new Error('공동 저장소 연결 설정을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.');
  const config=await response.json() as ProjectConfig;
  if(config.firebase.projectId!=='school-study-hub-2026-n4k7'||typeof config.firebase.apiKey!=='string'||!config.firebase.apiKey||typeof config.firebase.appId!=='string'||!config.firebase.appId||!config.databaseId||typeof config.ownerUid!=='string'||typeof config.sharedAccountUid!=='string'||!config.sharedAccountUid||typeof config.sharedAccountEmail!=='string'||!config.sharedAccountEmail)throw new Error('공동 저장소 연결을 확인하고 있습니다. 관리자에게 문의해 주세요.');
  return config;
}
