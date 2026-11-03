const test = require('node:test');
const assert = require('node:assert/strict');
let read, mutationError, calls, listener, initialNetwork;
const apiPath = require.resolve('../utils/score-api');
require.cache[apiPath] = {id:apiPath, filename:apiPath, loaded:true, exports: {
 getScoreErrorMessage:e=>e.message,
 getScoreRoom:()=>read(),
 ...Object.fromEntries(['startScoreRoom','submitScoreGifts','reverseScoreGiftBatch','cancelScoreRoom','settleScoreRoom','bindScoreParticipantAccount','joinScoreRoom','issueScoreInviteToken','issueScoreInviteCode'].map(name=>[name, async(...args)=>{calls.push(name); if(mutationError)throw mutationError; return args[1];}]))
}};
let realtime;
const rtPath=require.resolve('../utils/score-realtime');
require.cache[rtPath]={id:rtPath,filename:rtPath,loaded:true,exports:{connectScoreRealtime:o=>{realtime=o;return ()=>{};}}};
const storage={};
global.wx={getStorageSync:k=>storage[k]||'',setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k],showModal:o=>o.success({confirm:true}),onNetworkStatusChange:f=>listener=f,offNetworkStatusChange:f=>{assert.equal(f,listener);listener=null;},getNetworkType:o=>initialNetwork=o.success};
const base=require('../utils/score-room-base');
function room(version=2){return {id:'r',name:'周末 & 好友',version,status:'active',gameType:'generic',maxPlayers:0,selfParticipantId:'a',participants:[{id:'a',displayName:'我',role:'host',status:'active',totalPoints:-20},{id:'b',displayName:'小王',status:'active',totalPoints:20}],giftBatches:[]};}
function page(){return {...base,pageActive:true,pageVisible:true,credential:{kind:'guest',token:'g'},data:{...structuredClone(base.data),roomId:'r',room:room(),isHost:true,canStart:true,activePlayers:2,recipients:[{id:'b',displayName:'小王',pointsInput:'5'}],giftHistory:[{id:'gift',canReverse:true}],settlementOpen:true,settlementRateInput:'0.50'},setData(p,cb){Object.assign(this.data,p);if(cb)cb();},startPolling(){},ensureInviteToken:async()=>{},ensureInviteCode(){},showMahjongNotice(){}};}
test.beforeEach(()=>{calls=[];mutationError=null;read=async()=>room(3);for(const k of Object.keys(storage))delete storage[k];listener=null;initialNetwork=null;});
test('true offline suppresses every shared write but websocket reconnect alone allows writes',async()=>{
 const p=page();p.data.offline=true;
 p.data.room.status="waiting";await p.startRoom();p.data.room.status="active";await p.submitGifts();await p.reverseGift({currentTarget:{dataset:{id:'gift'}}});await p.cancelRoom();await p.confirmSettlement();storage.accessToken='account';await p.bindParticipantAccount();assert.deepEqual(calls,[]);
 delete storage.accessToken;p.data.offline=false;p.data.realtimeStatus='reconnecting';await p.submitGifts();assert.deepEqual(calls,['submitScoreGifts']);
});
test('failed recovery stays blocked and later successful read releases writes',async()=>{
 const p=page();p.startRealtime=()=>{};await p.handleNetwork({isConnected:false});read=async()=>{throw Object.assign(new Error('断网'),{isNetworkError:true});};await p.handleNetwork({isConnected:true});assert.equal(p.data.networkSyncing,true);assert.match(p.data.networkRecoveryError,/同步|断网/);await p.submitGifts();assert.equal(calls.length,0);
 read=async()=>room(3);assert.equal(await p.refreshRoom(),true);assert.equal(p.data.networkSyncing,false);assert.equal(p.data.networkRecoveryError,'');await p.submitGifts();assert.equal(calls.length,1);
});
test('old reads cannot reopen writes after a newer outage or hide',async()=>{
 const p=page();p.startRealtime=()=>{};let finish;read=()=>new Promise(r=>finish=r);p.data.offline=true;const recovering=p.handleNetwork({isConnected:true});await p.handleNetwork({isConnected:false});finish(room(5));await recovering;assert.equal(p.data.offline,true);assert.equal(p.data.networkSyncing,true);assert.equal(p.data.room.version,2);
 let finish2;read=()=>new Promise(r=>finish2=r);p.data.offline=false;const pending=p.loadRoom({quiet:true});p.onHide();finish2(room(6));assert.equal(await pending,false);assert.equal(p.data.networkSyncing,true);assert.equal(p.data.room.version,2);
});
test('native listeners clean up and delayed initial/native/realtime events stay invalid after show',async()=>{
 const p=page();p.loadRoom=async()=>true;p.onShow();assert.equal(typeof listener,'function');const oldListener=listener,oldInitial=initialNetwork;p.startRealtime();const oldRealtime=realtime;p.onHide();assert.equal(listener,null);p.onShow();await p.handleNetwork({isConnected:false});oldListener({isConnected:true});oldInitial({networkType:'wifi'});oldRealtime.onStatus('online');assert.equal(p.data.offline,true);p.onUnload();assert.equal(listener,null);
});
test('give conflict and later refresh retain drafts and nearby operation error',async()=>{
 const p=page();p.startRealtime=()=>{};mutationError=Object.assign(new Error('版本变化，请核对后重试'),{snapshot:room(3)});await p.submitGifts();await p.applyRoom(room(4));assert.equal(p.data.recipients[0].pointsInput,'5');assert.match(p.data.giftError,/版本变化/);assert.equal(p.data.busy,false);
});
test('settlement confirmation locks duplicates, keeps failed sheet and rate draft with inline error',async()=>{
 const p=page();p.startRealtime=()=>{};let answer;wx.showModal=o=>answer=o.success;mutationError=Object.assign(new Error('结算失败，请重试'),{snapshot:room(3)});const first=p.confirmSettlement();assert.equal(p.data.busy,true);await p.confirmSettlement();p.closeSettlement();assert.equal(p.data.settlementOpen,true);answer({confirm:true});await first;await p.applyRoom(room(4));assert.deepEqual(calls,['settleScoreRoom']);assert.equal(p.data.settlementOpen,true);assert.equal(p.data.settlementRateInput,'0.50');assert.match(p.data.settlementError,/结算失败/);wx.showModal=o=>o.success({confirm:true});
});
test('network loss during confirmation suppresses request',async()=>{const p=page();let answer;wx.showModal=o=>answer=o.success;const pending=p.confirmSettlement();p.data.offline=true;answer({confirm:true});await pending;assert.equal(calls.length,0);assert.match(p.data.settlementError,/网络|同步/);wx.showModal=o=>o.success({confirm:true});});

test('offline also suppresses invitation joining and invitation issuance; recovery before joining does not deadlock',async()=>{const p=page();p.data.offline=true;p.data.room.status='waiting';p.data.previewRoom=p.data.room;p.data.joinNickname='游客';await p.joinFromInvite();await base.ensureInviteToken.call(p);await base.ensureInviteCode.call(p);assert.deepEqual(calls,[]);p.credential=null;p.data.room=null;await p.handleNetwork({isConnected:true});assert.equal(p.data.networkSyncing,false);});
