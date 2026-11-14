// All people and records in this fixture are fictional. No source roster is read.
export function makeFixture(domain) {
  const days=[];
  for(let n=0;n<30;n++){
    const d=new Date(Date.UTC(2026,10,30+n)),date=d.toISOString().slice(0,10),w=d.getUTCDay();
    if(w===0||w===6||['2026-12-11','2026-12-25'].includes(date))continue;
    days.push({date,weekday:['일','월','화','수','목','금','토'][w],periods:w===2||w===5?7:6});
  }
  const targets=[3,3,6,5,8,8,8,8,8,8,8,8,8];
  const teachers=targets.map((q,i)=>({id:`teacher${String(i+1).padStart(2,'0')}`,name:`예시교사${i+1}`,minDuties:i<2?2:i<4?5:0,maxDuties:i<2?3:i<4?6:null,preferredDuties:q}));
  const students=Array.from({length:315},(_,i)=>{const c=i%13+1,n=Math.floor(i/13)+1,name=`가상학생${String(i+1).padStart(3,'0')}`;return{id:`${c}-${n}`,classNo:c,number:n,name,originalName:name};});
  const participants=[];const assignments=[];
  for(const [i,day] of days.slice(0,12).entries())for(const room of i<2?[1,2]:[1]){
    for(const c of room===1?[1,3]:[2,4])participants.push({studentId:`${c}-1`,date:day.date,room,leavePeriod:i===0&&c<=2?5:null});
    for(let p=1;p<=day.periods;p++)assignments.push({id:`${day.date}-${room}-${p}`,date:day.date,room,period:p,teacherId:''});
  }
  const firstDayPupils=new Set(participants.filter(p=>p.date===days[0].date).map(p=>p.studentId));
  for(const s of students.filter(s=>!firstDayPupils.has(s.id)).slice(0,26))participants.push({studentId:s.id,date:days[0].date,room:1,leavePeriod:null});
  const blocked=[['teacher01','월',4],['teacher02','화',1],['teacher06','수',2],['teacher04','수',2]].map(([teacherId,weekday,period])=>({teacherId,weekday,period,grade:1,classNo:1,subject:'가상 수업',sourceCell:'synthetic'}));
  const state={schemaVersion:1,students,days,participants,teachers,assignments,blocked,attendance:{},settings:{roomNames:{1:'기간1반',2:'기간2반'},leaveStartPeriod:5,leaveStartTime:'14:00',excludedTeachers:['가상 제외 교사'],sourceVersion:'synthetic-test',weeklyTimetableRepeats:true,wednesday56NoRegularLessons:true}};
  const remaining=Object.fromEntries(teachers.map((t,i)=>[t.id,targets[i]]));
  function fill(i){
    if(i===assignments.length)return true;
    const a=assignments[i],weekday=days.find(d=>d.date===a.date).weekday;
    const options=teachers.filter(t=>remaining[t.id]>0&&!blocked.some(b=>b.teacherId===t.id&&b.weekday===weekday&&b.period===a.period)&&!assignments.slice(0,i).some(b=>b.date===a.date&&b.period===a.period&&b.teacherId===t.id)).sort((x,y)=>remaining[y.id]-remaining[x.id]||x.id.localeCompare(y.id));
    for(const t of options){a.teacherId=t.id;remaining[t.id]--;if(fill(i+1))return true;remaining[t.id]++;}
    a.teacherId='';return false;
  }
  if(!fill(0))throw new Error('Could not construct synthetic timetable');
  if(assignments.length!==89||days.length!==20||domain.scheduleErrors(state,assignments).length)throw new Error('Invalid synthetic fixture');
  return state;
}
