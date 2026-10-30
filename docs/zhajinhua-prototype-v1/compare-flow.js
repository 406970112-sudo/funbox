// V1.3 产品原型：先跟注、再选对手、录入结果、按原座位轮转。
function compareEligible(hand) {
  const count=hand.players.filter(p=>!p.out).length;
  return count>1&&count<=hand.compareAt&&!hand.players[hand.turn].out;
}
function payCompare(hand) {
  if(hand.pendingCompare||!compareEligible(hand))return false;
  const actor=hand.turn,amount=hand.base*(hand.players[actor].seen?2:1);
  hand.players[actor].paid+=amount;
  hand.pendingCompare={actor,amount,target:-1,outcome:''};
  hand.log.push(hand.players[actor].name+'为比牌跟注 '+amount+' 分，等待选择对手');
  return true;
}
function completeCompare(hand) {
  const pending=hand.pendingCompare;
  if(!pending||pending.target<0||pending.target===pending.actor||hand.players[pending.target].out||!['win','lose','tie'].includes(pending.outcome))return false;
  const loser=pending.outcome==='win'?pending.target:pending.actor;
  const winner=loser===pending.actor?pending.target:pending.actor;
  hand.players[loser].out=true;
  hand.players[loser].outReason=pending.outcome==='tie'?'同大小 · 主动比牌输':'比牌失败';
  hand.lastCompare=hand.players[pending.actor].name+'与'+hand.players[pending.target].name+'比牌，'+(pending.outcome==='tie'?'同大小，主动方输；':'')+hand.players[loser].name+'出局';
  hand.log.push(hand.lastCompare+'；本次已跟 '+pending.amount+' 分，不再扣分');
  hand.turn=pending.actor;
  if(!hand.acted.includes(pending.actor))hand.acted.push(pending.actor);
  hand.pendingCompare=null;
  return {loser,winner,actor:pending.actor};
}
function compareSettings() {
  return `<div class="zp-form"><label for="zp-compare-at">剩余在局人数 ≤ 几人时可比牌</label><select id="zp-compare-at" data-config="compareAt">${[2,3,4,5,6,7,8].map(n=>`<option value="${n}" ${cfg.compareAt===n?'selected':''}>${n} 人</option>`).join('')}</select><small>只计算仍在局的人；满足人数才显示比牌入口。</small></div><div class="zp-callout">先按本人应跟分跟注，再选对手比牌。<br>同大小，主动比牌者输；不额外收比牌费。</div>`;
}
function comparePanel() {
  const p=s.pendingCompare;
  if(!p)return `<div class="zp-modal"><h3>先跟注，再选择比牌对手</h3><p class="zp-sub">${names[s.turn]}本次需跟 ${cost()} 分，计入公共积分池。<br>确认跟注后解锁选人，不再额外扣分。</p>${b('跟注 '+cost()+' 分，选择对手','comparepay')}${b('暂不比牌','back','zp-link')}</div>`;
  return `<div class="zp-modal"><span class="zp-pill zp-online">已跟注 ${p.amount} 分</span><h3 style="margin-top:14px">${names[p.actor]}选择比牌对手</h3><div class="zp-chiprow">${s.players.map((player,i)=>i!==p.actor&&!player.out?`<button type="button" class="zp-chip" data-compare-target="${i}" aria-pressed="${p.target===i}">${player.name}</button>`:'').join('')}</div><p class="zp-sub">只能选择本场仍在局的其他玩家。</p>${p.target>=0?`<h3 style="margin-top:16px">现场比牌结果</h3><div class="zp-chiprow">${[['win',names[p.actor]+'大'],['lose',names[p.target]+'大'],['tie','同大小 · 主动方输']].map(([value,label])=>`<button type="button" class="zp-chip" data-compare-outcome="${value}" aria-pressed="${p.outcome===value}">${label}</button>`).join('')}</div>`:''}<div class="zp-callout">${p.outcome==='tie'?names[p.actor]+'主动比牌，同大小判输并出局。':'比牌输者出局，已投入分数保留在池中。'}<br>完成后，从发起者下一位仍在局玩家继续。</div>${b('确认结果，轮到下一位','comparefinish','zp-action',!p.outcome||p.target<0)}<p class="zp-sub" style="margin-top:9px">已跟注，请完成本次比牌；不会重复扣分。</p></div>`;
}
function renderActionPage() {
  const p=s.players[s.turn],available=compareEligible(s)&&phase==='playing'&&!roomEnded;
  main.innerHTML=top('老友局 · 第 '+handNumber+' 场',`第 ${s.round} 轮，${p.name}行动`,`当前行动者视角 · ${active()} 人在局 / 4 人入座`)+
  `<div class="zp-pot"><span class="zp-sub">公共积分池</span><div class="zp-number">${pot()}<em>分</em></div><span class="zp-sub">剩 ${s.compareAt} 人及以内可比牌 · 最多 ${cfg.rounds} 轮</span><div class="zp-potfooter"><span>基准单注<strong>${s.base} 分</strong></span><span>你的本次应跟<strong>${cost()} 分</strong></span></div></div>
  ${s.lastCompare?`<div class="zp-callout" aria-live="polite">${s.lastCompare}<br>已轮到 ${p.name}跟注。</div>`:''}
  <div class="zp-sectiontitle"><h3>本场玩家</h3><span class="zp-sub">按座位顺时针</span></div><div class="zp-players">${playerRows()}</div>
  <div class="zp-sectiontitle"><h3>${p.name}的行动</h3><span class="zp-pill">${p.seen?'已看 · 2 倍':'闷牌 · 1 倍'}</span></div>
  ${s.pendingCompare||panel==='compare'?comparePanel():panel?renderPanel():`<div class="zp-actiongrid">${b('跟注 '+cost()+' 分','call')}${b('加注','raise','zp-action zp-secondary',s.base>=cfg.cap)}</div><div class="zp-actiongrid">${b(p.seen?'已看牌':'我已看牌','look','zp-action zp-secondary',p.seen)}${b('弃牌','fold','zp-action zp-secondary')}</div>${available?b('比牌','compare','zp-action zp-secondary'):''}<p class="zp-sub" style="margin-top:10px">比牌需先跟注 ${cost()} 分，再由你选择对手。<br>同大小主动方输；比完按座位轮到下一位。</p>`}
  <details><summary>动作流水 · ${s.log.length} 条</summary>${s.log.slice().reverse().map(l=>`<div class="zp-log">${esc(l)}</div>`).join('')}</details>`;
  note('03','先跟注，再选择要比谁','比牌入口只在人数字段满足时出现。支付一次跟注后，选择任一仍在局对手，再录入现场结果。','可分别试试主动方赢、对方赢和同大小。被动方不额外跟注，败者出局；下一位从发起者原座位顺序查找。');
}
