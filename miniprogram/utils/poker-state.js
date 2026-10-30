const {formatCNY,formatScore,parseYuanToCents}=require('./score-format');
function createPokerInput(d){
 const integer=(key,min,max=Number.MAX_SAFE_INTEGER)=>{const value=Number(d[key]);if(!/^\d+$/.test(String(d[key]))||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('请检查规则整数范围。');return value;};
 const centsPerPoint=parseYuanToCents(d.rate);if(!centsPerPoint)throw new Error('每分金额需大于 0，最多两位小数。');
 const antePoints=integer('antePoints',1,1000000),maxBetPoints=integer('maxBetPoints',antePoints,1000000);
 return {name:d.roomName.trim(),displayName:d.hostNickname.trim(),password:d.roomPassword,scene:'generic',gameType:'zhajinhua',maxPlayers:0,centsPerPoint,zhaJinHuaSettings:{rulesVersion:2,antePoints,maxBetPoints,compareThreshold:integer('compareThreshold',2),baoziBonusPoints:integer('baoziBonusPoints',0,1000000),shunjinBonusPoints:integer('shunjinBonusPoints',0,1000000)}};
}
function derivePoker(room,selfId,flags={}){
 const hand=room.currentZhaJinHuaHand||null,settings=(hand&&hand.settings)||room.zhaJinHuaSettings||{},phase=hand&&hand.phase||'',participants=room.participants||[];
 const self=participants.find(p=>p.id===selfId),isHost=!!self&&self.role==='host',ended=['settled','cancelled'].includes(room.status);
 const betweenHands=!ended&&(!hand||phase==='finished'||hand.status==='cancelled'),players=hand&&hand.players||[],live=players.filter(p=>p.status==='active');
 const row=p=>{const member=participants.find(m=>m.id===p.participantId)||{};return {...member,...p,id:p.participantId,name:member.displayName||'玩家',isSelf:p.participantId===selfId,isActor:p.participantId===(hand&&hand.currentTurnParticipantId),stateText:p.status==='folded'?'已弃牌':p.status==='eliminated'?'比牌出局':p.seen?'已看牌':'闷牌',deltaText:formatScore(p.deltaPoints),bonusText:formatScore(p.bonusPoints),gameText:formatScore(p.gamePoints),money:formatCNY((p.deltaPoints||0)*room.centsPerPoint)};};
 const own=players.find(p=>p.participantId===selfId),locked=!!flags.offline||!!flags.busy,canAct=!locked&&!ended&&phase==='betting'&&!!own&&own.status==='active'&&hand.currentTurnParticipantId===selfId;
 const seated=participants.filter(p=>(p.seatStatus||'seated')==='seated'&&p.status!=='left');
 const activeSeats=betweenHands?seated.map((p,i)=>({...p,name:p.displayName,position:i+1,isSelf:p.id===selfId,stateText:'已入座',scoreText:formatScore(p.totalPoints)})):players.map(row);
 const bonusPlayers=players.map(row),followPoints=(hand&&hand.currentBetPoints||0)*(own&&own.seen?2:1);
 const history=room.zhaJinHuaHands||[],latestFinishedHand=history.filter(h=>h.phase==='finished'||h.status==='finished').sort((a,b)=>b.number-a.number)[0]||(phase==='finished'?hand:null);
 const activeOrder = live.slice().sort((a,b) => a.position - b.position);
 const actorIndex = activeOrder.findIndex(p => p.participantId === (hand && hand.currentTurnParticipantId));
 const actorSeat = activeOrder[actorIndex];
 const nextSeat = actorIndex >= 0 && activeOrder.length > 1 ? activeOrder[(actorIndex + 1) % activeOrder.length] : null;
 const nextMember = nextSeat && participants.find(p => p.id === nextSeat.participantId);
 const pendingMembers=participants.filter(p=>p.seatStatus==='pending');
 const seatNotice=!ended&&self&&['left','pending'].includes(self.seatStatus)?self.seatStatus:'';
 return {seatNotice,showAdmissionNotice:!ended&&isHost&&pendingMembers.length>0,actorPosition:actorSeat&&actorSeat.position,nextActorPosition:nextSeat&&nextSeat.position,nextActorName:nextMember&&nextMember.displayName||'',latestFinishedHand,resultPlayers:((latestFinishedHand&&latestFinishedHand.players)||[]).map(row),nextHandNumber:Math.max(0,...history.map(h=>h.number),hand&&hand.number||0)+1,hand,phase,settings,self,isHost,betweenHands,ended,canAct,canLook:canAct&&!own.seen,canRaise:canAct&&hand.currentBetPoints<settings.maxBetPoints,canCompare:canAct&&live.length<=settings.compareThreshold,comparePending:!locked&&phase==='comparing'&&!!hand.pendingComparison&&hand.pendingComparison.actorParticipantId===selfId,compareTargets:live.filter(p=>p.participantId!==selfId).map(row),bonusPlayers,showdownPlayers:live.map(row),seats:activeSeats,seatColumns:flags.width>=600?3:2,liveCount:live.length,followPoints,followMoney:formatCNY(followPoints*room.centsPerPoint),potMoney:formatCNY((hand&&hand.potPoints||0)*room.centsPerPoint),rateMoney:formatCNY(room.centsPerPoint),actorName:(participants.find(p=>p.id===(hand&&hand.currentTurnParticipantId))||{}).displayName||'玩家',canManage:betweenHands&&isHost&&!locked,canStart:betweenHands&&isHost&&!locked&&seated.length>=2,canAcceptHost:betweenHands&&!locked&&room.pendingHostParticipantId===selfId,canLeave:betweenHands&&!locked&&!!self&&(self.seatStatus||'seated')==='seated'&&!isHost,canRejoin:betweenHands&&!locked&&!!self&&self.seatStatus==='left',pendingMembers,members:participants.map(p=>({...p,scoreText:formatScore(p.totalPoints),money:formatCNY(p.totalPoints*room.centsPerPoint),seatLabel:p.seatStatus==='pending'?'待入座':p.seatStatus==='left'?'已离场':'已入座'})),ledger:(room.zhaJinHuaHands||[]).slice().reverse().map(h=>({...h,rows:(h.players||[]).map(row)}))};
}
function shouldRemind(previous,next,selfId){return !!previous&&!!next.currentZhaJinHuaHand&&next.currentZhaJinHuaHand.phase==='betting'&&next.currentZhaJinHuaHand.currentTurnParticipantId===selfId&&(!previous.currentZhaJinHuaHand||previous.currentZhaJinHuaHand.id!==next.currentZhaJinHuaHand.id||previous.currentZhaJinHuaHand.currentTurnParticipantId!==selfId);}
module.exports={createPokerInput,derivePoker,shouldRemind};

// Compare integer cents so the ¥200 / ¥500 boundaries remain exact.
function potAmountBand(amountCents) {
  if (amountCents < 20000) return 'small';
  return amountCents < 50000 ? 'medium' : 'large';
}

function potChangeFeedback(previous, next, centsPerPoint, preferences = {}) {
  if (!previous || !next || previous.id !== next.id || preferences.reducedMotion || preferences.potMotion === false) return null;
  const deltaPoints = next.potPoints - previous.potPoints;
  if (deltaPoints <= 0) return null;
  return {
    band: potAmountBand(next.potPoints * centsPerPoint),
    deltaPoints,
    deltaMoney: formatCNY(deltaPoints * centsPerPoint),
  };
}
Object.assign(module.exports, { potAmountBand, potChangeFeedback });
