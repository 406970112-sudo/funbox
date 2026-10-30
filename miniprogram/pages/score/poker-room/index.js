const base=require('../../../utils/score-room-base');
const api=require('../../../utils/score-api');
const {formatCNY}=require('../../../utils/score-format');
const {derivePoker,shouldRemind,createPokerInput,potChangeFeedback}=require('../../../utils/poker-state');
const {getScoreSession}=require('../../../utils/score-session');
function confirm(title,content){return new Promise(resolve=>wx.showModal({title,content,confirmColor:'#2d5bff',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));}
Page({...base,
 data:{...base.data,poker:null,offline:false,sheet:'',targetId:'',outcome:'',winnerId:'',raiseBase:'',bonusSelections:[],bonusChecked:false,reducedMotion:false,potMotion:true,vibrate:true,potPulse:false,settingsDraft:{},vibrationKeys:[]},
 onLoad(options){
  if(wx.getWindowInfo){try{this.setData({windowWidth:wx.getWindowInfo().windowWidth});}catch(e){}}
  const prefs=wx.getStorageSync('funboxPokerFeedback')||{};this.setData({reducedMotion:!!prefs.reducedMotion,potMotion:prefs.potMotion!==false,vibrate:prefs.vibrate!==false});
  this.networkHandler=r=>this.handleNetwork(r);
  if(wx.onNetworkStatusChange)wx.onNetworkStatusChange(this.networkHandler);
  if(wx.getNetworkType)wx.getNetworkType({success:r=>this.networkHandler({isConnected:r.networkType!=='none'})});
  base.onLoad.call(this,options);
 },
 onUnload(){if(wx.offNetworkStatusChange)wx.offNetworkStatusChange(this.networkHandler);if(this.pulseTimer)clearTimeout(this.pulseTimer);base.onUnload.call(this);},
 async handleNetwork(r){this.setData({offline:!r.isConnected,networkSyncing:!!r.isConnected});this.updatePoker();if(r.isConnected){await this.refreshRoom();this.setData({networkSyncing:false});this.updatePoker();}},
 updatePoker(){if(!this.data.room)return;const id=this.data.room.selfParticipantId||(getScoreSession()||{}).participantId;this.setData({poker:derivePoker(this.data.room,id,{offline:this.data.offline||this.data.networkSyncing,busy:this.data.busy,width:this.data.windowWidth})});},
 async applyRoom(room){
  const old=this.data.room;if(old&&old.id===room.id&&room.version<old.version)return false;
  const id=room.selfParticipantId||(getScoreSession()||{}).participantId;
  const remind=shouldRemind(old,room,id),key=room.currentZhaJinHuaHand?`${room.currentZhaJinHuaHand.id}:${(room.currentZhaJinHuaHand.actions||[]).length}`:'';
  await base.applyRoom.call(this,room);this.updatePoker();
  this.setData({bonusRows:this.data.poker.bonusPlayers.map(p=>({...p,selectedKind:(this.data.bonusSelections.find(b=>b.participantId===p.id)||{}).kind||''}))});
  if(remind&&this.pageVisible!==false&&!this.remindedKeys?.has(key)){this.remindedKeys=this.remindedKeys||new Set();this.remindedKeys.add(key);if(this.data.vibrate&&wx.vibrateShort)wx.vibrateShort({type:'light'});}
  const h=room.currentZhaJinHuaHand,oldH=old&&old.currentZhaJinHuaHand;
  const potFeedback = potChangeFeedback(oldH, h, room.centsPerPoint, this.data);
  if (potFeedback) {
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.setData({potPulse: true, potFeedback});
    this.pulseTimer = setTimeout(() => this.setData({potPulse: false, potFeedback: null}), 600);
  } else if (!h || !oldH || h.id !== oldH.id || this.data.reducedMotion || !this.data.potMotion) {
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.setData({potPulse: false, potFeedback: null});
  }
  const ownsPaidComparison = h && h.phase === 'comparing' && h.pendingComparison?.actorParticipantId === id;
  const sameHand = oldH && h && oldH.id === h.id;
  // Transport state disables submission, but must not discard a valid draft.
  const paymentDraftValid = sameHand && derivePoker(room, id).canCompare;
  if (ownsPaidComparison) {
    const newlyPaid = !sameHand || oldH.phase !== 'comparing';
    if (newlyPaid || this.data.sheet === 'comparePay') this.setData({sheet: 'compare'});
  } else if (this.data.sheet === 'compare' || (this.data.sheet === 'comparePay' && !paymentDraftValid)) {
    this.setData({sheet: '', targetId: '', outcome: ''});
  }
  if(!oldH||oldH.id!==(h&&h.id)||oldH.phase!==(h&&h.phase))this.setData({bonusSelections:[],bonusChecked:false,winnerId:''});
  return true;
 },
 async ensureInviteToken(){return base.ensureInviteToken.call(this);},
 async confirmCurrent(title,content){const reviewed=this.data.room;const id=reviewed&&reviewed.id,version=reviewed&&reviewed.version;const ok=await confirm(title,content);if(!ok)return false;if(!this.data.room||this.data.room.id!==id||this.data.room.version!==version){this.setData({errorMessage:'牌局已经变化，请重新核对后操作。'});return false;}return true;},
 async runMutation(fn){if(this.data.busy||this.data.offline||this.data.networkSyncing||!this.data.room)return;this.setData({busy:true,errorMessage:''});this.updatePoker();try{await this.applyRoom(await fn());}catch(e){if(e.snapshot)await this.applyRoom(e.snapshot);else await this.refreshRoom();this.setData({errorMessage:api.getScoreErrorMessage(e)});}finally{this.setData({busy:false});this.updatePoker();}},
 async startHand(){if(!this.data.poker.canStart)return;await this.runMutation(async()=>{let room=this.data.room;if(room.status==='waiting')room=await api.startScoreRoom(this.credential,room);return api.startPokerHand(this.credential,room);});},
 act(input){const h=this.data.poker.hand;if(!h)return;return this.runMutation(()=>api.pokerAction(this.credential,this.data.room,h.id,input));},
 follow(){if(this.data.poker.canAct)return this.act({actionType:'follow'});},
 look(){if(this.data.poker.canLook)return this.act({actionType:'look'});},
 async fold(){if(!this.data.poker.canAct)return;if(await this.confirmCurrent('确认弃牌？','已投入分数保留，退出本场行动，仍参与本场喜钱。'))this.act({actionType:'fold'});},
 openRaise(){if(this.data.poker.canRaise){this.setData({sheet:'raise',raiseBase:String(this.data.poker.hand.currentBetPoints+1)});this.updateRaisePreview();}},
 confirmRaise(){const points=Number(this.data.raiseBase),p=this.data.poker;if(!p.canRaise||!Number.isSafeInteger(points)||points<=p.hand.currentBetPoints||points>p.settings.maxBetPoints)return this.setData({errorMessage:'新基准需高于当前基准且不超过封顶。'});this.setData({sheet:''});return this.act({actionType:'raise',points});},
 openCompare(){if(this.data.poker.canCompare)this.setData({sheet:'comparePay'});},
 async payCompare(){if(!this.data.poker.canCompare)return;return this.act({actionType:'compare_pay'});},
 selectTarget(e){if(this.data.poker.comparePending)this.setData({targetId:e.currentTarget.dataset.id,outcome:''});},
 selectOutcome(e){this.setData({outcome:e.currentTarget.dataset.value});},
 async confirmCompare(){const p=this.data.poker;if(!p.comparePending||!p.compareTargets.some(t=>t.id===this.data.targetId)||!['win','lose','tie'].includes(this.data.outcome))return;if(await this.confirmCurrent('已现场核对比牌结果？','同大小主动方输；本次只记录结果，不会再次扣分。'))return this.act({actionType:'compare_result',targetParticipantId:this.data.targetId,outcome:this.data.outcome});},
 selectWinner(e){this.setData({winnerId:e.currentTarget.dataset.id});},
 async confirmShowdown(){if(!this.data.isHost||this.data.poker.phase!=='showdown'||!this.data.poker.showdownPlayers.some(p=>p.id===this.data.winnerId))return;if(await this.confirmCurrent('确认现场开牌赢家？','请核对实体牌。并列时先按桌上约定确认唯一赢家，再记录。'))return this.act({actionType:'showdown',winnerParticipantId:this.data.winnerId});},
 chooseBonus(e){if(!this.data.isHost||this.data.poker.phase!=='bonus')return;const id=e.currentTarget.dataset.id,kind=e.currentTarget.dataset.kind;const entries=this.data.bonusSelections.filter(b=>b.participantId!==id);if(kind)entries.push({participantId:id,kind});this.setData({bonusSelections:entries,bonusChecked:false,bonusRows:this.data.poker.bonusPlayers.map(p=>({...p,selectedKind:(entries.find(b=>b.participantId===p.id)||{}).kind||''}))});},
 toggleBonusCheck(e){this.setData({bonusChecked:e.detail.value.length>0});},
 async confirmBonus(e){if(!this.data.isHost||this.data.poker.phase!=='bonus')return;const none=e.currentTarget.dataset.none;if(!none&&!this.data.bonusChecked)return this.setData({errorMessage:'请先确认已现场核对牌型与本场所有喜钱。'});const bonuses=none?[]:this.data.bonusSelections;if(await this.confirmCurrent(none?'确认本场无喜钱？':'确认喜钱入账？','喜钱与本场输赢无关，本场冻结名单内其他所有人支付，包含已弃牌玩家。'))return this.runMutation(()=>api.confirmPokerBonuses(this.credential,this.data.room,this.data.poker.hand.id,bonuses));},
 openSheet(e){if(this.data.busy)return;const sheet=e.currentTarget.dataset.sheet;if(sheet==='settings'){const s=this.data.room.zhaJinHuaSettings;this.setData({settingsDraft:{...s}});}this.setData({sheet});},
 closeSheet(){if(this.data.busy)return;this.setData({sheet:''});},
 updateRaisePreview(){const own=this.data.poker.hand.players.find(p=>p.participantId===this.data.self?.id||p.participantId===this.data.room.selfParticipantId);const base=Number(this.data.raiseBase);const points=Number.isSafeInteger(base)&&base>0?base*(own?.seen?2:1):0;this.setData({raiseCostPoints:points,raiseCostMoney:formatCNY(points*this.data.room.centsPerPoint)});},
 field(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value,errorMessage:''});if(e.currentTarget.dataset.field==='raiseBase')this.updateRaisePreview();},
 async memberAction(e){const {id,action}=e.currentTarget.dataset;if(!this.data.poker.betweenHands)return;if(['leave','offer_host'].includes(action)&&!await this.confirmCurrent(action==='leave'?'确认离场？':'转让房主？','身份、累计分数与历史保留。房主转让需对方接受后生效。'))return;return this.runMutation(()=>api.managePokerMember(this.credential,this.data.room,id,action));},
 async saveSettings(){if(!this.data.poker.canManage)return;try{const s=createPokerInput({roomName:'局',hostNickname:'我',roomPassword:'666666',rate:String(this.data.room.centsPerPoint/100),...this.data.settingsDraft});await this.runMutation(()=>api.updatePokerSettings(this.credential,this.data.room,s.zhaJinHuaSettings));this.setData({sheet:''});}catch(e){this.setData({errorMessage:e.message});}},
 async cancelHand(){const p=this.data.poker;if(!this.data.isHost||!p.hand||p.betweenHands||p.ended||this.data.busy||this.data.offline)return;const reviewed=this.data.room,handId=p.hand.id;if(await this.confirmCurrent('撤销本场？','全部本场投入和喜钱不入账，累计历史保留。仅用于现场牌局无法继续的情况。'))await this.runMutation(()=>api.cancelPokerHand(this.credential,reviewed,handId));},
 async settle(){if(!this.data.poker.canManage)return;if(await this.confirmCurrent('确定结束整桌？',`每分金额固定为 ${this.data.poker.rateMoney}，含全部已离场玩家。确认后只读。`))return this.runMutation(()=>api.settleScoreRoom(this.credential,this.data.room,this.data.room.centsPerPoint));},
 togglePreference(e){const field=e.currentTarget.dataset.field;this.setData({[field]:e.detail.value,potPulse:false});wx.setStorageSync('funboxPokerFeedback',{reducedMotion:this.data.reducedMotion,potMotion:this.data.potMotion,vibrate:this.data.vibrate});},
 onShareAppMessage(){return {title:`邀请你加入「${this.data.room?.name||'炸金花'}」`,path:this.data.inviteToken?require('../../../utils/invite').buildInviteContent(this.data.inviteToken):'/pages/score/poker/index'};}
});
