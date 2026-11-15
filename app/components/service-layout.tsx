import {School,Home,ChevronRight,LogOut,Settings,CalendarDays,LockKeyhole} from 'lucide-react';
import type {ReactNode} from 'react';

export function ServiceHeader({children,displayName,onHome,onRules,onSignOut}:{children?:ReactNode;displayName?:string;onHome?:()=>void;onRules?:()=>void;onSignOut?:()=>void}){
  return <><a className="skip-link" href="#main-content">본문 바로가기</a><div className="service-strip"><div className="service-inner"><span><School size={15}/>교직원 공동 운영 서비스</span><span>2026학년도 교외체험학습</span></div></div><header className="service-header"><div className="service-inner service-masthead"><a className="service-brand" href="#main-content" onClick={onHome?e=>{e.preventDefault();onHome();}:undefined} aria-label="체험학습 운영실 첫 화면"><span className="service-brand-icon"><School size={31} strokeWidth={1.8}/></span><span>체험학습 운영실<small>교사 임장 · 출석 통합 관리</small></span></a><div className="service-utilities">{displayName?<><span className="service-user"><LockKeyhole size={17}/>{displayName}</span>{onRules&&<button onClick={onRules}><Settings size={18}/>운영 기준</button>}{onSignOut&&<button onClick={onSignOut}><LogOut size={18}/>로그아웃</button>}</>:<span className="service-public-label"><CalendarDays size={18}/>2026. 11. 30. ~ 12. 29.</span>}</div></div>{children}</header></>;
}

export function Breadcrumb({current,onHome}:{current:string;onHome?:()=>void}){
  return <nav className="breadcrumbs" aria-label="현재 위치">{onHome?<button onClick={onHome} aria-label="처음으로"><Home size={17}/></button>:<span aria-label="처음"><Home size={17}/></span>}<ChevronRight size={14}/><span>체험학습 운영</span><ChevronRight size={14}/><strong aria-current="page">{current}</strong></nav>;
}

export function ServiceFooter(){
  return <footer className="service-footer"><div className="service-inner"><div className="footer-top"><div className="footer-brand"><School size={29}/><strong>체험학습 운영실</strong></div><span>함께 확인하고, 정확하게 기록합니다.</span></div><div className="footer-bottom"><p>운영 기간 2026. 11. 30. ~ 12. 29.<span>12월 11일 제외</span></p><p>교사 임장 시간표 · 교시별 출석 기록 · 원반별 출석부</p></div></div></footer>;
}
