const test = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
const storage = {};
const apiPath = require.resolve('../utils/score-api');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
  createScoreRoom: async (token, input) => { calls.push({token, input}); return {room:{id:'general-room'},guestToken:'guest',actor:{participantId:'host'}}; },
  getScoreErrorMessage: e => e.message,
  settleScoreRoom: async (credential, room, rate) => { calls.push({room,rate}); return {...room,status:'settled',version:room.version+1}; },
}};
global.wx = {
  getStorageSync:key=>storage[key] || '', setStorageSync:(key,value)=>{storage[key]=value;}, removeStorageSync:key=>{delete storage[key];},
  navigateTo:({url})=>calls.push({url}), setNavigationBarTitle:({title})=>calls.push({title}),
  showModal:options=>options.success({confirm:true}),
};
function loadPage(path) { let definition; global.Page = p=>{definition=p;}; require(path); return definition; }
const roomDefinition = loadPage('../pages/score/room/index');
function page(definition, data={}) {
  return {...definition,data:{...structuredClone(definition.data),...data},
    setData(patch,cb){Object.assign(this.data,patch);if(cb)cb();},
    startRealtime(){},startPolling(){},ensureInviteToken:async()=>{},ensureInviteCode(){},maybeBindParticipantAccount(){}};
}
const members = Array.from({length:13},(_,i)=>({id:`p${i}`,displayName:i===0?'小林':`成员${i}`,role:i===0?'host':'guest',status:'active',totalPoints:i===0?-12:i===12?12:0,joinedAt:`2026-10-30T00:00:${String(i).padStart(2,'0')}Z`}));
const snapshot = {id:'general-room',version:2,gameType:'generic',maxPlayers:0,centsPerPoint:100,status:'active',selfParticipantId:'p0',participants:members,giftBatches:[]};
test.beforeEach(()=>{calls.length=0;for(const key of Object.keys(storage))delete storage[key];});

test('general creation preserves editable form values and requests flexible capacity',async()=>{
  const definition=loadPage('../pages/score/general/index');
  const p=page(definition,{roomName:' 周末好友局 ',hostNickname:' 小林 ',roomPassword:'024680'});
  await p.createRoom();
  assert.deepEqual(calls[0],{token:'',input:{name:'周末好友局',displayName:'小林',password:'024680',gameType:'generic',scene:'generic',maxPlayers:0}});
  assert.equal(calls[1].url,'/pages/score/room/index?roomId=general-room&created=1');
  assert.equal(storage.funboxHostScoreRoomPasswordsV1['general-room'].password,'024680');
});

test('general room displays every member with name avatar and no fixed empty seats',async()=>{
  const p=page(roomDefinition);
  await p.applyRoom(snapshot);
  assert.equal(p.data.isGeneral,true);
  assert.equal(p.data.activePlayers,13);
  assert.equal(p.data.participants.length,13);
  assert.equal(p.data.recipients.length,12);
  assert.equal(p.data.participants.find(m=>m.id==='p0').seatMark,'小');
  assert.equal(p.data.vacantSeats.length,0);
  assert.equal(p.data.startLabel,'开始记分');
  assert.ok(calls.some(c=>c.title==='通用记分'));
});

function giftSnapshots() {
  const participants = members.slice(0, 3).map((member, index) => ({
    ...member, totalPoints: [18, 14, 11][index],
  }));
  const previous = { ...snapshot, participants };
  const next = {
    ...previous,
    version: previous.version + 1,
    participants: participants.map((member, index) => ({ ...member, totalPoints: [8, 20, 15][index] })),
    giftBatches: [{ id: 'gift-1', kind: 'normal', gifts: [
      { fromParticipantId: 'p0', toParticipantId: 'p1', points: 6 },
      { fromParticipantId: 'p0', toParticipantId: 'p2', points: 4 },
    ] }],
  };
  return { previous, next };
}

test('confirmed general gifts animate both recipients while keeping authoritative scores and the input order', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { previous, next } = giftSnapshots();
  const p = page(roomDefinition);
  await p.applyRoom(previous);
  p.setData({ recipients: p.data.recipients.map(item => ({ ...item, pointsInput: '5' })) });
  await p.applyRoom(next);

  const effect = p.data.generalScoreMotion;
  assert.deepEqual(p.data.participants.map(({ id, totalPoints }) => [id, totalPoints]), [
    ['p1', 20], ['p2', 15], ['p0', 8],
  ]);
  assert.deepEqual(p.data.recipients.map(({ id, pointsInput }) => [id, pointsInput]), [['p1', '5'], ['p2', '5']]);
  assert.deepEqual(Object.fromEntries(Object.entries(effect.rows).map(([id, row]) => [id, row.deltaText])), {
    p0: '-10', p1: '+6', p2: '+4',
  });
  assert.deepEqual([effect.rows.p0.shift, effect.rows.p1.shift, effect.rows.p2.shift], [-200, 100, 100]);
  assert.equal(effect.transfers.length, 2);
  assert.ok(effect.transfers[1].travelY > effect.transfers[0].travelY);

  await p.applyRoom(next);
  assert.equal(p.data.generalScoreMotion, effect);
  t.mock.timers.tick(1000);
  assert.equal(p.data.generalScoreMotion, null);
  assert.equal(p.data.participants[0].totalPoints, 20);
});

test('general score loads history, reconnects, and reduces motion with final values immediately', async () => {
  const { previous, next } = giftSnapshots();
  for (const condition of ['initial', 'reconnect', 'reduced', 'gap', 'reversal']) {
    const p = page(roomDefinition);
    if (condition === 'reduced') storage.funboxMahjongReducedMotionV1 = true;
    if (condition !== 'initial') await p.applyRoom(previous);
    if (condition === 'reconnect') p.setData({ networkSyncing: true });
    const incoming = condition === 'gap' ? { ...next, version: next.version + 1 }
      : condition === 'reversal' ? { ...next, giftBatches: [{ ...next.giftBatches[0], kind: 'reversal' }] }
        : next;
    await p.applyRoom(incoming);
    assert.equal(p.data.generalScoreMotion, null, condition);
    assert.equal(p.data.participants[0].totalPoints, 20, condition);
    delete storage.funboxMahjongReducedMotionV1;
  }
});

test('backgrounding a general room removes its effects and skips any historical gifts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { previous, next } = giftSnapshots();
  const p = page(roomDefinition);
  await p.applyRoom(previous);
  await p.applyRoom(next);
  assert.ok(p.data.generalScoreMotion);
  p.onHide();
  assert.equal(p.data.generalScoreMotion, null);
  await p.applyRoom({ ...next, version: next.version + 1 });
  assert.equal(p.data.generalScoreMotion, null);
  assert.equal(p.motionResuming, true);
});

test('invite preview uses the general theme before the member joins',async()=>{
  const p=page(roomDefinition);
  await p.prepareInvitePreview(async()=>({room:snapshot}));
  assert.equal(p.data.isGeneral,true);
  assert.equal(p.data.joinNeeded,true);
});

test('general host previews half-yuan conversion and submits the confirmed rate',async()=>{
  const p=page(roomDefinition);
  await p.applyRoom(snapshot);
  p.openSettlement();
  p.handleSettlementRateInput({detail:{value:'0.50'}});
  assert.equal(p.data.settlementRows.find(m=>m.participantId==='p0').amountText,'-¥6.00');
  assert.equal(p.data.settlementRows.find(m=>m.participantId==='p12').amountText,'¥6.00');
  await p.confirmSettlement();
  assert.equal(calls.find(c=>c.rate).rate,50);
  assert.equal(p.data.room.status,'settled');
});

test('non-host cannot submit settlement even if an old dialog remains open',async()=>{
  const p=page(roomDefinition,{room:snapshot,isHost:false,settlementOpen:true,settlementRateInput:'0.50'});
  await p.confirmSettlement();
  assert.equal(calls.filter(c=>c.rate).length,0);
});

test('mahjong retains directional seats and fixed empty slots',async()=>{
  const p=page(roomDefinition);
  await p.applyRoom({...snapshot,gameType:'mahjong',maxPlayers:4,participants:members.slice(0,2),status:'waiting'});
  assert.equal(p.data.isGeneral,false);
  assert.equal(p.data.participants.find(m=>m.id==='p0').seatMark,'東');
  assert.equal(p.data.vacantSeats.length,2);
});
