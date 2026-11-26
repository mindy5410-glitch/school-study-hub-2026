import type {Teacher} from '../../lib/types';

export function TeacherDutyRules({teachers}:{teachers:Teacher[]}){
  const groups=new Map<string,Teacher[]>();
  for(const teacher of teachers){
    const key=teacher.minDuties>0||teacher.maxDuties!==null?`limit:${teacher.minDuties}:${teacher.maxDuties}`:`preferred:${teacher.preferredDuties}`;
    const group=groups.get(key);
    if(group)group.push(teacher);else groups.set(key,[teacher]);
  }
  return <>{[...groups].map(([key,group])=>{
    const first=group[0],limited=first.minDuties>0||first.maxDuties!==null;
    const label=limited?group.map(t=>t.name).join('·'):`그 외 ${group.length}명`;
    const range=first.maxDuties===null?`${first.minDuties}교시 이상`:first.minDuties===first.maxDuties?`${first.minDuties}교시`:`${first.minDuties}~${first.maxDuties}교시`;
    return <p key={key}>{label}: {limited?`전체 기간 각 ${range}`:`기준 배정 각 ${first.preferredDuties}교시`}</p>;
  })}</>;
}
