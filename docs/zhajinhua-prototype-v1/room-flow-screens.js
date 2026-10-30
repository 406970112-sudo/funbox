// V1.2 原型：一桌多场，每场多轮；只演示本地记账。
function roundNet(r) {
  return names.map((_,i)=>(i===r.winner?r.sum:0)-r.paid[i]+(r.bonus?.net[i]||0));
}
function recordRound(r) {
  if (!roomHistory.some(item=>item.number===r.number)) roomHistory.push(r);
}
function roomTotals() {
  return roomHistory.reduce((acc,r)=>acc.map((n,i)=>n+roundNet(r)[i]),names.map(()=>0));
}
function renderBillPage() {
  const r=resultDraft(), ledger=r.bonus||{net:names.map(()=>0),transfers:[]};
  const game=names.map((_,i)=>(i===r.winner?r.sum:0)-r.paid[i]), total=roundNet(r), cumulative=roomTotals();
  main.innerHTML=top('老友局 · 第 '+(r.number||handNumber)+' 场','本场已记，继续开场',r.bonus?'本场积分与喜钱已入整桌账本':'账单示例 · 喜钱尚未登记')+
    `<div class="zp-summaryhero"><span class="zp-pill zp-online">${names[r.winner]}赢下本场积分池</span><div class="zp-number">${signed(total[r.winner])}<em>分本场净得分</em></div><p class="zp-sub">牌局 ${signed(game[r.winner])} ＋ 喜钱 ${signed(ledger.net[r.winner])}</p></div>
    <div class="zp-box"><h3>本场账单</h3>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}<small style="display:block">牌局 ${signed(game[i])} · 喜钱 ${signed(ledger.net[i])}</small></span><strong class="${total[i]>0?'zp-positive':total[i]<0?'zp-negative':'zp-muted'}">${signed(total[i])} 分</strong></div>`).join('')}<div class="zp-balance">本场合计 ${total.reduce((a,n)=>a+n,0)} 分 · 已核平</div></div>
    <div class="zp-box"><div class="zp-row"><h3>整桌累计</h3><span class="zp-pill">已完成 ${roomHistory.length} 场</span></div>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}</span><strong class="${cumulative[i]>0?'zp-positive':cumulative[i]<0?'zp-negative':'zp-muted'}">${signed(cumulative[i])} 分</strong></div>`).join('')}</div>
    ${b(roomEnded?'本桌已散场':`开始第 ${(r.number||handNumber)+1} 场`,'next','zp-action',!r.bonus||roomEnded)}
    <p class="zp-sub" style="text-align:center;margin-top:9px">房主开始下一场 · 沿用房间与座位 · 累计积分保留</p>
    ${b('查看整桌账本','roomledger','zp-link')}
    <details><summary>本场喜钱明细 · ${ledger.transfers.length} 笔</summary>${ledger.transfers.length?ledger.transfers.map(t=>`<div class="zp-row zp-line"><span>${names[t.payer]} → ${names[t.recipient]}<small style="display:block">${t.kind==='baozi'?'豹子':'顺金'}喜钱 · 房主已核对</small></span><span>${t.amount} 分</span></div>`).join(''):'<p class="zp-sub">本场无喜钱</p>'}</details>`;
  note('06','一场结束，接着下一场','场内每轮跟注，场末核对喜钱并累计。本场结束只记账，不触发整桌散场。','主要操作只有“开始下一场”；真正不玩时，再从“更多”进入散场结算。');
}
function renderRoomLedger() {
  const totals=roomTotals();
  main.innerHTML=top('老友局 · 房间 628319',roomEnded?'本桌已散场':'整桌账本',`已完成 ${roomHistory.length} 场 · ${roomEnded?'账本只读':'房间保留，可继续下一场'}`)+
    `<div class="zp-box"><h3>累计积分（含喜钱）</h3>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}</span><strong class="${totals[i]>0?'zp-positive':totals[i]<0?'zp-negative':'zp-muted'}">${signed(totals[i])} 分</strong></div>`).join('')}<div class="zp-balance">整桌合计 ${totals.reduce((a,n)=>a+n,0)} 分</div></div>
    <div class="zp-sectiontitle"><h3>逐场记录</h3><span class="zp-sub">按完成时间倒序</span></div>
    ${roomHistory.slice().reverse().map(r=>`<details class="zp-box"><summary>第 ${r.number} 场 · ${names[r.winner]}赢下积分池</summary>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}</span><span>${signed(roundNet(r)[i])} 分</span></div>`).join('')}<p class="zp-sub" style="margin-top:10px">牌局与喜钱已一并入账</p></details>`).join('')}
    ${phase==='between'&&!roomEnded?b('返回，继续下一场','backbill'):''}
    <div class="zp-callout">查看累计账本不会散场；只有房主明确确认“结束整桌”才停止继续开场。</div>`;
  note('07','这张账本贯穿整晚','每场有独立账单，整桌累计所有已完成场次；打开、退出页面都不会清空累计。','散场仅发生一次，按整桌最终净分结算。演示展示积分汇总，金额与转账方案在详细设计阶段接入。');
}
function renderRoomMenu() {
  if(!roomMenu)return;
  main.innerHTML+=`<section class="zp-modal" aria-label="房间更多操作"><h3>${finishPrompt?'确定结束整桌？':'房间 · 更多'}</h3>${finishPrompt?`<p class="zp-sub">将汇总已完成的 ${roomHistory.length} 场积分及喜钱。确认后房间只读，不能再开始下一场。</p>${b('确认结束整桌，查看汇总','finishroom','zp-action',phase!=='between'||roomEnded)}${b('继续玩，暂不散场','cancelFinish','zp-action zp-secondary')}`:`${b('查看整桌账本','roomledger','zp-action zp-secondary')}${b(roomEnded?'本桌已散场':'散场结算 · 结束整桌','finishprompt','zp-action zp-secondary',phase!=='between'||roomEnded||!roomHistory.length)}<p class="zp-sub" style="margin-top:9px">${phase==='between'?'仅房主可结束整桌。':'请先完成本场牌局与喜钱登记，再散场。'}</p>${b('收起','closemenu','zp-link')}`}</section>`;
}
