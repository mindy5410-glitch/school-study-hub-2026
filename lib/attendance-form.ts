import {expectedStatus,getRecord,roomRoster,sameAttendance} from './domain';
import type {AttendanceChange,AttendanceStatus,Room,SchoolState} from './types';

export type AttendanceValue={status:AttendanceStatus|null;note:string};
export type AttendanceDrafts=Record<string,AttendanceValue>;

export function attendanceInput(state:SchoolState,studentId:string,date:string,period:number):{status:AttendanceStatus;note:string}{
  const record=getRecord(state,studentId,date,period);
  return {status:record?.status??expectedStatus(state,studentId,date,period),note:record?.note??''};
}

export function attendanceChanges(state:SchoolState,date:string,room:Room,period:number,drafts:AttendanceDrafts={}):AttendanceChange[]{
  const changes:AttendanceChange[]=[];
  for(const student of roomRoster(state,date,room)){
    const value=drafts[student.id]??attendanceInput(state,student.id,date,period);
    if(!sameAttendance(getRecord(state,student.id,date,period),value))changes.push({studentId:student.id,...value});
  }
  return changes;
}
