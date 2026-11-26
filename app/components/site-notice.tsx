import {useEffect,useState} from 'react';
import {Modal} from './ui';

const applicationNoticeEndsAt=Date.parse('2026-11-28T00:00:00+09:00');
const noticeEndsAt=Date.parse('2026-12-30T00:00:00+09:00');

export function SiteNotice(){
  const [open,setOpen]=useState(true),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    if(!open||now>=noticeEndsAt)return;
    const next=now<applicationNoticeEndsAt?applicationNoticeEndsAt:noticeEndsAt;
    // Wake at least daily so a long-lived tab also handles the dated sections.
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(0,Math.min(next-Date.now(),86400000)));
    return()=>window.clearTimeout(timer);
  },[open,now]);
  if(!open||now>=noticeEndsAt)return null;
  return <Modal title="체험학습 운영 안내" className="notice-modal" onClose={()=>setOpen(false)}>
    <div className="notice-body" role="region" aria-label="체험학습 운영 안내 내용" tabIndex={0}>
      <p className="notice-intro">안녕하세요 ^__^</p>
      {now<applicationNoticeEndsAt&&<section className="notice-section notice-deadline" aria-labelledby="notice-deadline-title">
        <h3 id="notice-deadline-title">신청 기안 제출</h3>
        <p>11/30(월)~12/4(금) 체험학습 신청서는<br/><strong>11/27(금) 오전 9시까지</strong> 기안을 올려주세요.</p>
        <p className="notice-note">서류 확인·수정 시간이 필요하니 기한을 지켜 주시면 감사하겠습니다.</p>
      </section>}
      <section className="notice-section" aria-labelledby="notice-rooms-title">
        <h3 id="notice-rooms-title">등교 학생 교실</h3>
        <p>11/30(월)·12/1(화)은 원반에 따라 안내해 주세요.</p>
        <dl className="notice-rooms">
          <div><dt>A반 · 3반 교실</dt><dd>1·2·3·7·8·9·10·11반 학생</dd></div>
          <div><dt>B반 · 4반 교실</dt><dd>4·5·6·12·13반 학생</dd></div>
        </dl>
        <p><strong>12/2(수)부터는 모두 A반(3반 교실)</strong>에서 통합 운영합니다.</p>
        <p className="notice-note">추가 등록 등 개별 배정은 ‘원반별 출석부’의 관리반을 확인해 주세요.</p>
      </section>
      <section className="notice-section" aria-labelledby="notice-schedule-title">
        <h3 id="notice-schedule-title">임장 시간표 확인</h3>
        <p>12/17 이후 임장을 추가하고, <strong>일부 배정을 고르게 조정</strong>했습니다. ‘교사 임장’에서 최신 본인 일정을 확인해 주세요.</p>
      </section>
      <section className="notice-section" aria-labelledby="notice-add-title">
        <h3 id="notice-add-title">체험학습 대신 등교한다면</h3>
        <p>걱정하지 않으셔도 됩니다~ <strong>교시별 출석 → 학생 추가</strong>에서 학생·날짜·교시를 선택해 등록해 주세요. 원반별 출석부에도 함께 반영됩니다.</p>
      </section>
    </div>
    <div className="modal-actions"><button className="button primary" onClick={()=>setOpen(false)}>확인했습니다</button></div>
  </Modal>;
}
