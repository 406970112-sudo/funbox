const test=require('node:test');const assert=require('node:assert/strict');const calls=[];let finishAction;let apiError;let readRoom;let startRoomRequest;
const apiPath=require.resolve('../utils/score-api');require.cache[apiPath]={id:apiPath,filename:apiPath,loaded:true,exports:{getScoreRoom:()=>readRoom(),getScoreErrorMessage:e=>e.message,confirmPokerBonuses:async(c,r,h,bonuses)=>{calls.push({bonuses,h});return {...r,version:r.version+1,currentZhaJinHuaHand:null};},settleScoreRoom:async(c,r,rate)=>{calls.push({settleRate:rate});return {...r,version:r.version+1,status:'settled'};},pokerAction:(c,r,h,input)=>{calls.push({c,r,h,input});if(apiError)return Promise.reject(apiError);return new Promise(resolve=>finishAction=resolve);},startScoreRoom:async(c,r)=>{calls.push({startRoom:r.version});if(startRoomRequest)return startRoomRequest(r);return {...r,status:'active',version:r.version+1};},startPokerHand:async(c,r)=>{calls.push({startHand:r.version});return {...r,version:r.version+1};},updatePokerSettings:async(c,r,settings)=>{calls.push({updateSettings:settings});return {...r,zhaJinHuaSettings:settings,version:r.version+1};},issueScoreInviteCode:async()=>{calls.push({nativeInvite:true});return {imageBase64:'AA==',mediaType:'image/png'};},issueScoreInviteToken:async()=> 'invite'}};
let realtimeStatus;
const realtimePath = require.resolve('../utils/score-realtime');
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: {
 connectScoreRealtime({onStatus}) { realtimeStatus = onStatus; return () => {}; },
} };
let savedSession;
global.wx={env:{USER_DATA_PATH:'/tmp'},getFileSystemManager:()=>({writeFile:o=>o.success(),unlink:()=>{}}),getStorageSync:key=>key==='funboxScoreSessionV1'?savedSession||'':'',setStorageSync:()=>{},showModal:o=>o.success({confirm:true}),redirectTo:o=>calls.push(o)};
let pageDefinition;global.Page=d=>pageDefinition=d;require('../pages/score/poker-room/index');const pokerDefinition=pageDefinition;
const {derivePoker}=require('../utils/poker-state');
function room(){return {id:'r',version:2,status:'active',gameType:'zhajinhua',maxPlayers:4,centsPerPoint:50,selfParticipantId:'a',zhaJinHuaSettings:{antePoints:1,maxBetPoints:20,compareThreshold:3},participants:[{id:'a',displayName:'甲',role:'host',status:'active',seatStatus:'seated',totalPoints:0},{id:'b',displayName:'乙',status:'active',seatStatus:'seated',totalPoints:0}],currentZhaJinHuaHand:{id:'h',phase:'betting',number:1,currentBetPoints:2,players:[{participantId:'a',status:'active'},{participantId:'b',status:'active'}],currentTurnParticipantId:'a'}};}
function page(r=room()){return {...pokerDefinition,credential:{token:'token'},data:{...pokerDefinition.data,room:r,poker:derivePoker(r,'a')},setData(patch,cb){for(const [key,value] of Object.entries(patch)){if(key.includes('.')){const [a,b]=key.split('.');this.data[a][b]=value;}else this.data[key]=value;}if(cb)cb();},startRealtime(){},startPolling(){},maybeBindParticipantAccount(){},ensureInviteToken:async()=>{},ensureInviteCode(){},renderInviteCode(){},refreshRoom:pokerDefinition.refreshRoom};}
test.beforeEach(()=>{calls.length=0;startRoomRequest=null;apiError=null;savedSession=null;readRoom=async()=>{throw new Error('read unavailable');};});
test('pending requests lock duplicate follow and restore paid compare on snapshot',async()=>{const p=page();const first=p.payCompare();p.payCompare();p.follow();assert.equal(calls.length,1);assert.equal(p.data.busy,true);const response=room();response.version=3;response.currentZhaJinHuaHand.phase='comparing';response.currentZhaJinHuaHand.pendingComparison={actorParticipantId:'a',points:2};finishAction(response);await first;assert.equal(p.data.sheet,'compare');assert.equal(p.data.poker.comparePending,true);assert.equal(p.data.poker.canAct,false);assert.equal(p.data.busy,false);});
test('offline blocks writes and conflicts apply authoritative snapshot without replay',async()=>{const p=page();p.data.offline=true;p.updatePoker();await p.follow();assert.equal(calls.length,0);p.data.offline=false;p.updatePoker();const response=room();response.version=4;response.currentZhaJinHuaHand.currentTurnParticipantId='b';apiError={message:'版本变化',snapshot:response};await p.follow();assert.equal(calls.length,1);assert.equal(p.data.room.version,4);assert.equal(p.data.poker.canAct,false);assert.equal(p.data.errorMessage,'版本变化');});
test('starting first hand uses returned room version after room start',async()=>{const r=room();r.status='waiting';r.currentZhaJinHuaHand=null;const p=page(r);await p.startHand();assert.deepEqual(calls,[{startRoom:2},{startHand:3}]);assert.equal(p.data.room.version,4);});
test('unlimited room can save next-hand settings',async()=>{const r=room();r.maxPlayers=0;r.currentZhaJinHuaHand=null;const p=page(r);p.data.settingsDraft={...r.zhaJinHuaSettings,antePoints:2,maxBetPoints:10,baoziBonusPoints:20,shunjinBonusPoints:10};await p.saveSettings();const saved=calls.find(call=>call.updateSettings);assert.ok(saved);assert.deepEqual(saved.updateSettings,{rulesVersion:2,antePoints:2,maxBetPoints:10,compareThreshold:3,baoziBonusPoints:20,shunjinBonusPoints:10});assert.equal(p.data.errorMessage,'');});
test('generic room entry routes poker snapshots and retains invite credentials',()=>{require('../pages/score/room/index');const d=pageDefinition;const p={...d,data:{inviteScene:'scene-a'}};assert.equal(p.routePoker({gameType:'zhajinhua',id:'r'},true),true);assert.match(calls[0].url,/poker-room\/index\?scene=scene-a/);assert.equal(p.routePoker({gameType:'mahjong'},false),false);});
test('network recovery keeps writes paused until a successful current read completes',async()=>{const p=page();p.data.roomId='r';p.data.offline=true;let answer;readRoom=()=>new Promise(resolve=>answer=resolve);const syncing=p.handleNetwork({isConnected:true});assert.equal(p.data.poker.canAct,false);await p.follow();assert.equal(calls.length,0);answer(room());await syncing;assert.equal(p.data.poker.canAct,true);});
test('poker failed recovery remains paused, equal-version later read resumes and hidden response cannot reopen',async()=>{const p=page();p.data.roomId='r';p.data.offline=true;readRoom=async()=>{throw new Error('unavailable');};const failed=p.handleNetwork({isConnected:true});await failed;assert.equal(p.data.networkSyncing,true);assert.equal(p.data.poker.canAct,false);let answer;readRoom=()=>new Promise(resolve=>answer=resolve);const retry=p.refreshRoom();answer(room());await retry;assert.equal(p.data.networkSyncing,false);assert.equal(p.data.poker.canAct,true);await p.handleNetwork({isConnected:false});const pending=p.handleNetwork({isConnected:true});p.onHide();answer(room());await pending;assert.equal(p.data.networkSyncing,true);});
test('poker confirmations block repeated dialogs and network loss before confirmation sends no write',async()=>{const p=page();let answer,count=0;wx.showModal=o=>{count++;answer=o.success;};const first=p.fold();await p.fold();assert.equal(count,1);assert.equal(p.data.busy,true);await p.handleNetwork({isConnected:false});answer({confirm:true});await first;assert.equal(calls.length,0);assert.equal(p.data.busy,false);assert.match(p.data.errorMessage,/网络|同步/);wx.showModal=o=>o.success({confirm:true});});

test('original invite restores matching left guest identity instead of joining again',async()=>{savedSession={roomId:'r',guestToken:'saved-guest',participantId:'a'};const p=page();let loaded=0;p.loadRoom=async()=>{loaded++;};await p.prepareInvitePreview(async()=>({room:{id:'r',gameType:'zhajinhua'}}));assert.equal(loaded,1);assert.equal(p.credential.token,'saved-guest');assert.equal(p.data.roomId,'r');assert.notEqual(p.data.joinNeeded,true);});
test('confirmation opened on one hand cannot mutate a newer unseen hand',async()=>{const p=page();let answer;const original=wx.showModal;wx.showModal=o=>answer=o.success;const pending=p.fold();const newer=room();newer.version=5;newer.currentZhaJinHuaHand.id='h2';p.data.room=newer;p.updatePoker();answer({confirm:true});await pending;wx.showModal=original;assert.equal(calls.length,0);assert.match(p.data.errorMessage,/变化/);});
test('raise preview uses a new base and seen multiplier with exact money',()=>{const p=page();p.data.room.currentZhaJinHuaHand.players[0].seen=true;p.updatePoker();p.field({currentTarget:{dataset:{field:'raiseBase'}},detail:{value:'7'}});assert.equal(p.data.raiseCostPoints,14);assert.equal(p.data.raiseCostMoney,'¥7.00');});
test('background polling preserves unsubmitted comparison payment and paid-result drafts',async()=>{const p=page();p.openCompare();assert.equal(p.data.sheet,'comparePay');await p.applyRoom(room());assert.equal(p.data.sheet,'comparePay');p.data.offline=true;await p.applyRoom(room());assert.equal(p.data.sheet,'comparePay');const paid=room();paid.currentZhaJinHuaHand.phase='comparing';paid.currentZhaJinHuaHand.pendingComparison={actorParticipantId:'a',points:2};p.data.offline=false;await p.applyRoom(paid);p.data.targetId='b';p.data.outcome='tie';await p.applyRoom(paid);assert.equal(p.data.sheet,'compare');assert.equal(p.data.targetId,'b');assert.equal(p.data.outcome,'tie');const next=room();next.version=3;next.currentZhaJinHuaHand.currentTurnParticipantId='b';await p.applyRoom(next);assert.equal(p.data.sheet,'');assert.equal(p.data.targetId,'');});
test('active between-hand poker keeps expanded QR across polls and requests native code',async()=>{const r=room();r.currentZhaJinHuaHand=null;r.zhaJinHuaSettings.rulesVersion=2;const p=page(r);p.data.qrExpanded=true;p.data.inviteToken='invite';p.data.isHost=true;p.ensureInviteCode=pokerDefinition.ensureInviteCode;await p.ensureInviteCode();assert.match(p.data.qrImageSrc,/score-invite-r/);assert.equal(calls.filter(c=>c.nativeInvite).length,1);await p.applyRoom(r);assert.equal(p.data.qrExpanded,true);assert.match(p.data.qrImageSrc,/score-invite-r/);assert.equal(calls.filter(c=>c.nativeInvite).length,1);});

test('bonus entry starts collapsed, edits one player and preserves draft across polls',async()=>{const r=room();r.currentZhaJinHuaHand.phase='bonus';const p=page(r);await p.applyRoom(r);assert.equal(p.data.bonusEnabled,false);assert.ok(p.data.bonusRows.every(row=>row.selectedKind===''));p.enableBonuses();p.toggleBonusPlayer({currentTarget:{dataset:{id:'b'}}});p.chooseBonus({currentTarget:{dataset:{id:'b',kind:'baozi'}}});assert.deepEqual(p.data.bonusSelections,[{participantId:'b',kind:'baozi'}]);p.toggleBonusCheck();assert.equal(p.data.bonusChecked,true);await p.applyRoom({...r,version:3});assert.equal(p.data.bonusRows.find(row=>row.id==='b').selectedKind,'baozi');assert.equal(p.data.bonusChecked,true);p.disableBonuses();assert.deepEqual(p.data.bonusSelections,[]);assert.equal(p.data.bonusEnabled,false);assert.equal(p.data.bonusChecked,false);});
test('new hand clears bonus rows before they are rendered',async()=>{const r=room();r.currentZhaJinHuaHand.phase='bonus';const p=page(r);p.data.bonusSelections=[{participantId:'a',kind:'baozi'}];p.data.bonusEnabled=true;p.data.expandedBonusId='a';const next=room();next.version=3;next.currentZhaJinHuaHand.id='new';next.currentZhaJinHuaHand.phase='bonus';await p.applyRoom(next);assert.equal(p.data.bonusEnabled,false);assert.equal(p.data.expandedBonusId,'');assert.ok(p.data.bonusRows.every(row=>row.selectedKind===''));});
test('settlement snapshot closes ledger, failed settlement leaves it open',async()=>{const r=room();r.currentZhaJinHuaHand=null;const p=page(r);p.data.sheet='ledger';await p.applyRoom({...r,version:3,status:'settled'});assert.equal(p.data.sheet,'');const q=page(r);q.data.sheet='ledger';await q.runMutation(async()=>{throw new Error('network');});assert.equal(q.data.sheet,'ledger');});
test('cached invite token is not rewritten on every poll',async()=>{const r=room();r.status='waiting';r.currentZhaJinHuaHand=null;const p=page(r);p.data.isHost=true;p.data.inviteToken='cached';let renders=0;p.renderInviteCode=()=>renders++;await pokerDefinition.ensureInviteToken.call(p);await pokerDefinition.ensureInviteToken.call(p);assert.equal(renders,0);});
test('failed native QR is not requested again by background polls',async()=>{const r=room();r.status='waiting';r.currentZhaJinHuaHand=null;const p=page(r);p.data.isHost=true;p.data.qrCodeFailed=true;await pokerDefinition.ensureInviteCode.call(p,{automatic:true});assert.equal(calls.filter(c=>c.nativeInvite).length,0);});
test('unchanged waiting snapshot updates sync timestamp without repainting cards',async()=>{const r=room();r.currentZhaJinHuaHand=null;const p=page(r);await p.applyRoom(r);let renders=0;const set=p.setData;p.setData=function(...args){renders++;return set.apply(this,args);};await p.applyRoom({...r});assert.equal(renders,0);assert.ok(p.lastRoomSyncAt>0);});

test('default no-bonus action submits empty bonuses and completes hand',async()=>{const r=room();r.currentZhaJinHuaHand.phase='bonus';const p=page(r);await p.applyRoom(r);await p.confirmBonus({currentTarget:{dataset:{none:true}}});assert.deepEqual(calls,[{bonuses:[],h:'h'}]);assert.equal(p.data.poker.betweenHands,true);});
test('checked bonus draft submits selected players only',async()=>{const r=room();r.currentZhaJinHuaHand.phase='bonus';const p=page(r);await p.applyRoom(r);p.enableBonuses();p.chooseBonus({currentTarget:{dataset:{id:'b',kind:'shunjin'}}});p.toggleBonusCheck();await p.confirmBonus({currentTarget:{dataset:{}}});assert.deepEqual(calls,[{bonuses:[{participantId:'b',kind:'shunjin'}],h:'h'}]);});
test('settle action uses fixed room rate and closes the ledger',async()=>{const r=room();r.currentZhaJinHuaHand=null;const p=page(r);await p.applyRoom(r);p.data.sheet='ledger';await p.settle();assert.deepEqual(calls,[{settleRate:50}]);assert.equal(p.data.sheet,'');assert.equal(p.data.poker.ended,true);});
test('unchanged waiting snapshot still checks account binding after login return',async()=>{const r=room();r.currentZhaJinHuaHand=null;const p=page(r);await p.applyRoom(r);let checks=0;p.maybeBindParticipantAccount=()=>checks++;await p.applyRoom({...r});assert.equal(checks,1);});
test('poker delegates a single native network subscription to base and removes it on hide',()=>{const p=page();let added=0,removed=0,handler;wx.onNetworkStatusChange=f=>{added++;handler=f;};wx.offNetworkStatusChange=f=>{assert.equal(f,handler);removed++;};wx.getNetworkType=o=>o.success({networkType:'wifi'});p.onLoad({});p.onShow();assert.equal(added,1);p.onHide();assert.equal(removed,1);p.onUnload();assert.equal(removed,1);delete wx.onNetworkStatusChange;delete wx.offNetworkStatusChange;delete wx.getNetworkType;});

function confirmedFollow() {
 const before = room();
 before.currentZhaJinHuaHand = {...before.currentZhaJinHuaHand, actions: [], potPoints: 2, currentTurnParticipantId: 'b', players: [
  {participantId: 'a', position: 1, status: 'active', contributionPoints: 1},
  {participantId: 'b', position: 2, status: 'active', contributionPoints: 1},
 ]};
 const after = structuredClone(before);
 after.version = 3;
 after.currentZhaJinHuaHand.potPoints = 4;
 after.currentZhaJinHuaHand.players[1].contributionPoints = 3;
 after.currentZhaJinHuaHand.actions.push({sequence: 1, actionType: 'follow', actorParticipantId: 'b', points: 2});
 after.currentZhaJinHuaHand.currentTurnParticipantId = 'a';
 return {before, after};
}

function deferPokerGeometry(t) {
 const ticks = [];
 const queries = [];
 const rectangles = {
  '#poker-motion-anchor': {left: 6, top: 20, width: 360, height: 740},
  '#poker-pot-values': {left: 20, top: 152, width: 280, height: 40},
  '#poker-seat-number-2': {left: 228, top: 312, width: 20, height: 20},
 };
 wx.nextTick = fn => ticks.push(fn);
 wx.createSelectorQuery = () => {
  const selections = [];
  return {
   select: id => ({boundingClientRect: () => selections.push(id)}),
   exec: cb => queries.push(() => cb(selections.map(id => rectangles[id]))),
  };
 };
 t.after(() => { delete wx.nextTick; delete wx.createSelectorQuery; });
 return {ticks, queries};
}

test('confirmed poker state and new turn are usable before chip geometry, and repeated snapshots do not replay', async t => {
 const {before, after} = confirmedFollow();
 const {ticks, queries} = deferPokerGeometry(t);
 const p = page(before);
 t.after(() => p.onHide());
 await p.applyRoom(after);
 assert.equal(p.data.poker.potMoney, '¥2.00');
 assert.equal(p.data.poker.canAct, true);
 assert.equal(ticks.length, 1);
 ticks.shift()();
 queries.shift()();
 const motion = p.data.pokerMotion[0];
 assert.deepEqual(motion.flight, {startX: 232, startY: 302, travelX: -78, travelY: -150});
 assert.equal(motion.nextActorId, 'a');
 await p.applyRoom(structuredClone(after));
 assert.equal(ticks.length, 0);
 assert.deepEqual(p.data.pokerMotion[0], motion);
 await p.applyRoom(before);
 assert.equal(p.data.room.version, 3);
 assert.deepEqual(p.data.pokerMotion[0], motion);
});

test('late geometry cannot restart a hidden poker effect and recovery only updates final values', async t => {
 const {before, after} = confirmedFollow();
 const {ticks, queries} = deferPokerGeometry(t);
 const p = page(before);
 p.data.roomId = 'r';
 await p.applyRoom(after);
 assert.equal(ticks.length, 1);
 ticks.shift()();
 p.onHide();
 queries.shift()();
 assert.deepEqual(p.data.pokerMotion, []);

 const next = structuredClone(after);
 next.version = 4;
 next.currentZhaJinHuaHand.potPoints = 6;
 next.currentZhaJinHuaHand.players[0].contributionPoints = 3;
 next.currentZhaJinHuaHand.actions.push({sequence: 2, actionType: 'follow', actorParticipantId: 'a', points: 2});
 next.currentZhaJinHuaHand.currentTurnParticipantId = 'b';
 readRoom = async () => next;
 p.onShow();
 await p.refreshRoom();
 assert.equal(p.data.poker.potMoney, '¥3.00');
 assert.equal(p.data.networkSyncing, false);
 assert.equal(ticks.length, 0);
 assert.deepEqual(p.data.pokerMotion, []);
 p.onUnload();
});

test('newer between-hands state invalidates a chip while the invite token is still loading', async t => {
 const {before, after} = confirmedFollow();
 const {ticks, queries} = deferPokerGeometry(t);
 const p = page(before);
 t.after(() => p.onHide());
 await p.applyRoom(after);
 ticks.shift()();

 const ended = {...after, version: after.version + 1, currentZhaJinHuaHand: null,
  zhaJinHuaSettings: {...after.zhaJinHuaSettings, rulesVersion: 2}};
 let finishInvite;
 p.ensureInviteToken = () => new Promise(resolve => { finishInvite = resolve; });
 const update = p.applyRoom(ended);
 assert.equal(p.data.room.version, ended.version);
 queries.shift()();
 const staleEffect = p.data.pokerMotion[0];
 finishInvite();
 await update;
 assert.equal(staleEffect, undefined);
});

test('a socket-only reconnect catches up without animating the missing action', async t => {
 const {before, after} = confirmedFollow();
 const {ticks} = deferPokerGeometry(t);
 const p = page(before);
 t.after(() => p.onHide());
 p.data.roomId = 'r';
 p.startRealtime = pokerDefinition.startRealtime;
 readRoom = async () => before;
 p.startRealtime();
 realtimeStatus('online');
 await p.refreshPromise;
 realtimeStatus('offline');
 readRoom = async () => after;
 realtimeStatus('online');
 await p.refreshPromise;
 assert.equal(p.data.poker.potMoney, '¥2.00');
 assert.equal(p.data.poker.canAct, true);
 assert.equal(ticks.length, 0);
 assert.deepEqual(p.data.pokerMotion, []);
});

test('a read already in flight cannot consume the post-reconnect poker baseline', async t => {
 const {before, after} = confirmedFollow();
 const {ticks} = deferPokerGeometry(t);
 const p = page(before);
 t.after(() => p.onHide());
 p.data.roomId = 'r';
 p.startRealtime = pokerDefinition.startRealtime;
 readRoom = async () => before;
 p.startRealtime();
 realtimeStatus('online');
 await p.refreshPromise;
 realtimeStatus('offline');
 let finishPoll;
 readRoom = () => new Promise(resolve => { finishPoll = resolve; });
 const oldPoll = p.refreshRoom();
 readRoom = async () => after;
 realtimeStatus('online');
 finishPoll(before);
 await oldPoll;
 await p.refreshPromise;
 assert.equal(p.data.poker.potMoney, '¥2.00');
 assert.equal(ticks.length, 0);

 const liveAction = structuredClone(after);
 liveAction.version += 1;
 liveAction.currentZhaJinHuaHand.potPoints += 2;
 liveAction.currentZhaJinHuaHand.players[0].contributionPoints += 2;
 liveAction.currentZhaJinHuaHand.currentTurnParticipantId = 'b';
 liveAction.currentZhaJinHuaHand.actions.push({sequence: 2, actionType: 'follow', actorParticipantId: 'a', points: 2});
 await p.applyRoom(liveAction);
 assert.equal(ticks.length, 1);
});

test('global reduce motion keeps the new-turn vibration and static actor state', async t => {
 const originalStorage = wx.getStorageSync;
 let vibrations = 0;
 wx.getStorageSync = key => key === 'funboxMahjongReducedMotionV1' ? true : originalStorage(key);
 wx.vibrateShort = () => { vibrations++; };
 const {before, after} = confirmedFollow();
 const {ticks} = deferPokerGeometry(t);
 const p = page(before);
 t.after(() => {
  p.onHide();
  wx.getStorageSync = originalStorage;
  delete wx.vibrateShort;
 });
 await p.applyRoom(after);
 assert.equal(p.data.poker.canAct, true);
 assert.equal(p.data.poker.seats.find(seat => seat.isActor).id, 'a');
 assert.equal(vibrations, 1);
 assert.equal(ticks.length, 0);
 assert.deepEqual(p.data.pokerMotion, []);
});

for (const interruption of ['offline', 'hide', 'recovered']) {
 test(`initial poker start never continues its second write after ${interruption} while room start is pending`, async () => {
  const waiting = room(); waiting.status = 'waiting'; waiting.currentZhaJinHuaHand = null;
  const started = {...waiting, status: 'active', version: 3};
  const p = page(waiting); p.data.roomId = 'r';
  let finishStart;
  startRoomRequest = () => new Promise(resolve => { finishStart = resolve; });
  readRoom = async () => started;
  const pending = p.startHand();
  assert.deepEqual(calls, [{startRoom: 2}]);
  if (interruption === 'hide') p.onHide();
  else {
   await p.handleNetwork({isConnected: false});
   if (interruption === 'recovered') {
    await p.handleNetwork({isConnected: true});
    assert.equal(p.data.networkSyncing, false);
   }
  }
  finishStart(started);
  await pending;
  assert.deepEqual(calls, [{startRoom: 2}]);
  assert.equal(p.data.busy, false);
  assert.match(p.data.errorMessage, /同步|重新|变化|暂停/);
  // A subsequent successful read reconciles state; it never retries the hand write.
  if (interruption === 'hide') p.onShow();
  if (interruption === 'offline') await p.handleNetwork({isConnected: true});
  await p.refreshRoom();
  assert.deepEqual(calls, [{startRoom: 2}]);
 });
}
