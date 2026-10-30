// V1.1 原型的喜钱登记与账单页面；由原型拼入现有演示，不用于小程序业务代码。
function signed(n) { return (n > 0 ? '+' : '') + n; }
function resultDraft() {
  return last || {paid:[11,21,11,3], winner:0, sum:46, rates:{baozi:cfg.baozi,shunjin:cfg.shunjin}};
}
function bonusLedger(types, rates) {
  const net = names.map(() => 0), transfers = [];
  types.forEach((kind, recipient) => {
    const amount = kind === 'none' ? 0 : rates[kind];
    if (!amount) return;
    names.forEach((name, payer) => {
      if (payer === recipient) return;
      net[payer] -= amount;
      net[recipient] += amount;
      transfers.push({payer, recipient, amount, kind});
    });
  });
  return {net, transfers};
}
function bonusSettings() {
  return `<div class="zp-box"><div class="zp-row"><h3>喜钱设置</h3><span class="zp-pill">每位其他玩家给</span></div>
    <div class="zp-pair">
      <div class="zp-form"><label for="zp-baozi">豹子喜钱 / 分·每人</label><input id="zp-baozi" type="number" min="0" max="99999" step="1" inputmode="numeric" data-config="baozi" value="${cfg.baozi}"></div>
      <div class="zp-form"><label for="zp-shunjin">顺金喜钱 / 分·每人</label><input id="zp-shunjin" type="number" min="0" max="99999" step="1" inputmode="numeric" data-config="shunjin" value="${cfg.shunjin}"></div>
    </div>
    <p class="zp-sub">示例分数，可修改；0 表示该牌型不收。<br>亮牌即收，与输赢无关，已弃牌者也要给。<br>普通金花不收；由房主现场核对后登记。</p>
  </div>`;
}
function renderBonusPage() {
  const r = resultDraft(), rates = r.rates, ledger = bonusLedger(bonusDraft, rates), isHost = bonusRole === 'host';
  main.innerHTML = top('老友局 · 第 '+handNumber+' 手', '亮牌后，记喜钱', '牌局已结束 · 喜钱登记后统一入账') +
    `<div class="zp-row"><span class="zp-pill">${isHost?'房主登记视角':'普通玩家视角'}</span>${b(isHost?'查看普通玩家视角':'返回房主登记','bonusrole','zp-link')}</div>
    <div class="zp-callout">本人向全桌亮牌 → 房主核对登记 → 全员可见。<br>房主自己有牌，也要先向大家亮牌。</div>
    <div class="zp-box"><h3>本手喜钱约定</h3><p class="zp-sub">豹子：每人 ${rates.baozi} 分 · 顺金：每人 ${rates.shunjin} 分<br>除拿牌者本人外，本手其他 3 人都给，包含已弃牌者。<br>喜钱独立记账，不放入公共积分池。</p></div>
    <div class="zp-sectiontitle"><h3>${isHost?'登记已亮出的牌型':'房主正在登记'}</h3><span class="zp-sub">输赢不影响收喜钱</span></div>
    <div class="zp-players">${names.map((name,i)=>`<div class="zp-person"><span class="zp-avatar">${name.slice(-1)}</span><div class="zp-personinfo"><span class="zp-name">${name}</span><small>${i===r.winner?'本手赢家':'本手未赢，仍可收喜钱'}</small></div>${isHost?`<select style="width:116px;flex-shrink:0" aria-label="${name}亮出的牌型" data-bonus="${i}">${[['none','未登记'],['baozi','豹子'],['shunjin','顺金']].map(([value,label])=>`<option value="${value}" ${bonusDraft[i]===value?'selected':''}>${label}</option>`).join('')}</select>`:`<span class="zp-pill">${{none:'未登记',baozi:'豹子',shunjin:'顺金'}[bonusDraft[i]]}</span>`}</div>`).join('')}</div>
    <div class="zp-box" aria-live="polite"><h3>喜钱净收支预览</h3>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}</span><strong class="${ledger.net[i]>0?'zp-positive':ledger.net[i]<0?'zp-negative':'zp-muted'}">${signed(ledger.net[i])} 分</strong></div>`).join('')}<div class="zp-balance">喜钱合计 ${ledger.net.reduce((a,n)=>a+n,0)} 分 · 已核平</div></div>
    ${isHost?`<label style="display:flex;align-items:flex-start;gap:9px;margin-top:16px;font-size:12px"><input type="checkbox" id="zp-bonus-verified" style="width:18px;min-width:18px;margin-top:2px" ${bonusVerified?'checked':''}>我已现场核对亮牌，且已核对本手所有喜钱</label>${b('房主确认，记入本手账单','bonuscommit','zp-action',!bonusVerified)}`:`<div class="zp-callout">仅房主可登记；如有遗漏或牌型不符，请现场提出。<br>房主确认后可查看完整账单。</div>`}`;
  note('05','亮牌是依据，房主负责登记','牌型由在场玩家看实体牌核对，小程序不自动识别。玩家无法在自己的视角直接申报并扣其他人的分。','可登记多个人；同一人同一手仅收一次。普通金花不在喜钱范围内。');
}
function renderBillPage() {
  const r=resultDraft(), ledger=r.bonus||{net:names.map(()=>0),transfers:[]};
  const game=names.map((name,i)=>(i===r.winner?r.sum:0)-r.paid[i]), total=game.map((n,i)=>n+ledger.net[i]);
  main.innerHTML=top('老友局 · 第 '+handNumber+' 手','这一手，记清了',r.bonus?'本手已入账 · 房主小林已核对喜钱':'账单示例 · 喜钱尚未登记')+
    `<div class="zp-summaryhero"><span class="zp-pill zp-online">${names[r.winner]}赢下积分池</span><div class="zp-number">${signed(total[r.winner])}<em>分最终净得分</em></div><p class="zp-sub">牌局 ${signed(game[r.winner])} ＋ 喜钱 ${signed(ledger.net[r.winner])}</p></div>
    <div class="zp-box"><h3>本手账单</h3>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}<small style="display:block">牌局 ${signed(game[i])} · 喜钱 ${signed(ledger.net[i])}<br>投入 ${r.paid[i]}${i===r.winner?' · 分得积分池 '+r.sum:''}</small></span><strong class="${total[i]>0?'zp-positive':total[i]<0?'zp-negative':'zp-muted'}">${signed(total[i])} 分</strong></div>`).join('')}<div class="zp-balance">最终净得分合计 ${total.reduce((a,n)=>a+n,0)} 分 · 已核平</div></div>
    <div class="zp-box"><h3>喜钱明细</h3>${ledger.transfers.length?ledger.transfers.map(t=>`<div class="zp-row zp-line"><span>${names[t.payer]} → ${names[t.recipient]}<small style="display:block">${t.kind==='baozi'?'豹子':'顺金'}喜钱 · 房主已核对</small></span><span>${t.amount} 分</span></div>`).join(''):'<p class="zp-sub">'+(r.bonus?'本手无喜钱':'尚未完成喜钱登记')+'</p>'}</div>
    <div class="zp-callout">喜钱与积分池分开记录，合并计入最终总分。<br>拿到对应牌型，即使本手输了仍收喜钱。</div>
    ${b('继续下一手','next','zp-action',!r.bonus)}${b('散场，查看本场积分','totals','zp-action zp-secondary',!r.bonus)}
    ${showTotals?`<div class="zp-box"><h3>本手积分示例（含喜钱）</h3>${names.map((name,i)=>`<div class="zp-row zp-line"><span>${name}</span><span>${signed(total[i])} 分</span></div>`).join('')}<p class="zp-sub" style="margin-top:12px">实际产品在此汇总各手总分，接入已有散场结算。</p></div>`:''}`;
  note('06','输赢和喜钱分开算','一手可以有不同的积分池赢家与喜钱收取者。所有喜钱都记录给分者、收分者、牌型和分数。','最终净得分＝牌局得分＋喜钱净收支；分开校验后再合并，避免喜钱被记进池子或重复收取。');
}
