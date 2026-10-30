// V1.5 原型：按人数及屏幕可用宽度自动排布；预览人数仅用于评审。
function seatColumns(count) { return count<=4?2:count<=8?3:4; }
function compactPot() {
  return `<div class="zp-pot zp-pot-compact"><div class="zp-row"><div class="zp-pot-score"><span class="zp-sub">公共积分池</span><div class="zp-number">${pot()}<em>分</em></div></div><div class="zp-pot-cash"><strong aria-live="polite">${pointMoney(pot())}</strong><small>1 分 = ${pointMoney(1)}</small></div></div><p class="zp-sub zp-cap-caption">${capStatus(s)}</p><div class="zp-potfooter"><span>基准单注<strong>${s.base} 分</strong></span><span>本人应跟<strong>${cost()} 分</strong></span><span>比牌门槛<strong>剩 ${s.compareAt} 人</strong></span></div></div>`;
}
function playerRoster() {
  const columns=seatColumns(s.players.length);
  return `<div class="zp-roster-wrap"><div class="zp-seats zp-seats-${columns}" aria-label="${s.players.length} 人座位，按座位号顺序行动">${s.players.map((p,i)=>`<div class="zp-seat ${p.out?'zp-seat-out':''} ${i===s.turn?'zp-seat-current':''}" ${i===s.turn?'aria-current="true"':''}><div class="zp-seat-top"><span class="zp-seat-number">${i+1}号</span><span class="zp-seat-turn">${i===s.turn?'行动中':p.out?'出局':'在局'}</span></div><span class="zp-seat-name" aria-label="${esc(p.name)}">${esc(p.name)}</span><span class="zp-seat-status">${p.out?(p.outReason||'已弃牌'):p.seen?'已看 · 2 倍':'闷牌 · 1 倍'}</span><span class="zp-seat-paid">${p.paid}<small> 分</small></span></div>`).join('')}</div></div><p class="zp-sub" style="margin-top:7px">按座位号顺时针行动 · 分数为本场已投入</p><details><summary>展开 ${s.players.length} 人的完整明细</summary><div class="zp-players">${playerRows()}</div></details>`;
}
function seedPlayerPreview(count) {
  names=playerNamePool.slice(0,count);
  roomHistory=[];roomEnded=false;roomMenu=false;finishPrompt=false;roomRateCents=cfg.rateCents;
  for(let number=1;number<=2;number++){
    const paid=names.map(()=>number);
    recordRound({number,winner:number-1,paid,sum:paid.reduce((a,n)=>a+n,0),rates:{baozi:cfg.baozi,shunjin:cfg.shunjin},bonus:{net:names.map(()=>0),transfers:[]}});
  }
  bonusDraft=names.map((_,i)=>i===1?'shunjin':'none');
  const paid=names.map((_,i)=>i===1?21:i===3?3:11);
  last={number:3,winner:0,paid,sum:paid.reduce((a,n)=>a+n,0),rates:{baozi:cfg.baozi,shunjin:cfg.shunjin},bonus:bonusLedger(bonusDraft,{baozi:cfg.baozi,shunjin:cfg.shunjin}),types:bonusDraft.slice()};
  recordRound(last);
  handNumber=4;phase='playing';reset(true);s.base=10;
  s.players.forEach((p,i)=>p.paid=i===1?21:i===3?1:11);
  s.log=['上一圈基准 10 分，闷牌投入 10，看牌投入 20','按实际座位顺序行动，出局玩家保留已投入积分'];
  page=2;
}
