export type Room = 1 | 2;
export type AttendanceStatus = 'present'|'late'|'early'|'absent'|'experience';
export interface Student {id:string;classNo:number;number:number;name:string;originalName:string}
export interface SchoolDay {date:string;weekday:string;periods:number}
export interface Participant {studentId:string;date:string;room:Room;leavePeriod:number|null;startPeriod?:number}
export interface AdditionalParticipant {studentId:string;date:string;room:Room;startPeriod:number;endPeriod:number;addedRevision:number}
export interface Teacher {id:string;name:string;minDuties:number;maxDuties:number|null;preferredDuties:number}
export interface Assignment {id:string;date:string;room:Room;period:number;teacherId:string}
export interface BlockedLesson {teacherId:string;weekday:string;period:number;grade:number;classNo:number;subject:string;sourceCell:string}
export interface AttendanceRecord {studentId:string;date:string;period:number;status:AttendanceStatus;note:string;updatedAt:string;updatedBy:string}
export interface SchoolState {
  schemaVersion:number;students:Student[];days:SchoolDay[];participants:Participant[];teachers:Teacher[];
  assignments:Assignment[];blocked:BlockedLesson[];attendance:Record<string,AttendanceRecord>;additionalParticipants?:AdditionalParticipant[];
  settings:{roomNames:Record<Room,string>;leaveStartPeriod:number;leaveStartTime:string;excludedTeachers:string[];sourceVersion:string;weeklyTimetableRepeats:boolean;wednesday56NoRegularLessons:boolean};
}
export interface HistoryEntry {id:string;revision:number;kind:string;actor:string;summary:string;created_at:string}
export interface Snapshot {state:SchoolState;revision:number;updatedAt:string;history:HistoryEntry[]}
export interface AttendanceChange {studentId:string;status:AttendanceStatus|null;note:string}
