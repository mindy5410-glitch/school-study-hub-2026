import {useEffect,useState} from 'react';
import {Modal} from './ui';

// Keep this dated announcement visible through November 27 in Korea.
const noticeEndsAt=Date.parse('2026-11-28T00:00:00+09:00');

export function SiteNotice(){
  const [open,setOpen]=useState(()=>Date.now()<noticeEndsAt);
  useEffect(()=>{
    if(!open)return;
    const remaining=noticeEndsAt-Date.now();
    if(remaining<=0){setOpen(false);return;}
    const timer=window.setTimeout(()=>setOpen(false),Math.min(remaining,2147483647));
    return()=>window.clearTimeout(timer);
  },[open]);
  if(!open)return null;
  return <Modal title="체험학습 신청 기안 안내" className="notice-modal" onClose={()=>setOpen(false)}>
    <div className="notice-body">
      <p>안녕하세요 ^__^</p>
      <p>11월 30일(월)~12월 4일(금) 체험학습 신청 기안을<br/><strong>11월 27일(이번 주 금요일) 오전 9시까지</strong> 올려주세요.</p>
      <p>서류에 수정할 부분이 있을 경우 확인하고 고칠 시간이 필요해요.<br/>조금 촉박하시겠지만, 기한을 지켜 주시면 감사하겠습니다.<br/>협조해 주셔서 고맙습니다!</p>
    </div>
    <div className="modal-actions"><button className="button primary" onClick={()=>setOpen(false)}>확인했습니다</button></div>
  </Modal>;
}
