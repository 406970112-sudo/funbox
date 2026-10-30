// V1.4 原型：按分显示金额，封顶后最多完整行动三圈。
function parseYuanPerPoint(value) {
  const match=String(value).match(/^(\d{1,4})(?:\.(\d{1,2}))?$/);
  if(!match)return null;
  const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  return cents>0?cents:null;
}
function pointMoney(points,cents=roomRateCents) {
  const value=points*cents;
  return (value<0?'-':'')+'¥'+(Math.abs(value)/100).toFixed(2);
}
function advanceCapWindow(hand) {
  if(hand.base<hand.cap)return false;
  const activeIds=hand.players.map((p,i)=>p.out?-1:i).filter(i=>i>=0);
  if(!hand.capWindow){
    hand.capWindow={remaining:3,todo:activeIds.slice()};
    hand.log.push('基准单注达到封顶 '+hand.cap+' 分；从下一位开始，最多再进行完整 3 圈');
    return false;
  }
  const window=hand.capWindow;
  window.todo=window.todo.filter(i=>i!==hand.turn&&!hand.players[i].out);
  if(window.todo.length===0){
    window.remaining--;
    hand.log.push('封顶后已完成 '+(3-window.remaining)+' 圈，还可继续 '+window.remaining+' 圈');
    if(window.remaining===0)return true;
    window.todo=activeIds.slice();
  }
  return false;
}
function capStatus(hand) {
  if(!hand.capWindow)return '封顶前不限圈数 · 单注到顶后最多再走 3 圈';
  return '已封顶 · 正在第 '+(4-hand.capWindow.remaining)+'/3 圈，本圈还需 '+hand.capWindow.todo.length+' 人行动';
}
function advance() {
  panel='';
  const ids=s.players.map((p,i)=>p.out?-1:i).filter(i=>i>=0);
  if(ids.length===1){settle(ids[0]);return;}
  if(advanceCapWindow(s)){
    capWinner=-1;capData={paid:s.players.map(p=>p.paid),eligible:ids};
    phase='bonus';page=3;return;
  }
  if(ids.every(i=>s.acted.includes(i))){s.round++;s.acted=[];}
  let next=s.turn;
  do{next=(next+1)%s.players.length;}while(s.players[next].out);
  s.turn=next;
}
