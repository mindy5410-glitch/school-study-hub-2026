import {expectedStatus,getRecord,roomRoster,sameAttendance} from './domain';
import type {AttendanceChange,Room,SchoolState} from './types';

export const attendanceOptions=['present','absent'] as const;
export type AttendanceCheckStatus=typeof attendanceOptions[number];
export type AttendanceValue={status:AttendanceCheckStatus|null;note:string};
export type AttendanceDrafts=Record<string,AttendanceValue>;

export function attendanceInput(state:SchoolState,studentId:string,date:string,period:number):{status:AttendanceCheckStatus;note:string}{
  const record=getRecord(state,studentId,date,period);
  const status=record?.status??expectedStatus(state,studentId,date,period);
  // This screen tracks presence only; the separate plan keeps field-trip dates.
  return {status:status==='absent'||status==='experience'?'absent':'present',note:record?.note??''};
}

export function attendanceChanges(state:SchoolState,date:string,room:Room,period:number,drafts:AttendanceDrafts={}):AttendanceChange[]{
  const changes:AttendanceChange[]=[];
  for(const student of roomRoster(state,date,room)){
    const value=drafts[student.id]??attendanceInput(state,student.id,date,period);
    if(!sameAttendance(getRecord(state,student.id,date,period),value))changes.push({studentId:student.id,...value});
  }
  return changes;
}

// Use the full room roster so a search never narrows a whole-period reset.
export function attendanceResetChanges(state:SchoolState,date:string,room:Room,period:number):AttendanceChange[]{
  return roomRoster(state,date,room)
    .filter(student=>!!getRecord(state,student.id,date,period))
    .map(student=>({studentId:student.id,status:null,note:''}));
}
