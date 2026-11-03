const test = require('node:test');
const assert = require('node:assert/strict');
const { giftDraft, giftHistory, canCancelRoom } = require('../utils/score-ux');
test('draft validates every input and aggregate, and derives explicit preview', () => {
  assert.deepEqual(giftDraft([{id:'b',displayName:'B',pointsInput:'5'}, {id:'c',displayName:'C',pointsInput:'2'}]), {total:7, valid:true, preview:'你扣除 7 分；B 增加 5 分，C 增加 2 分'});
  assert.equal(giftDraft([{pointsInput:'2147483648'}]).valid, false);
  assert.equal(giftDraft([{pointsInput:'2147483647'}, {pointsInput:'1'}]).valid, false);
  assert.equal(giftDraft([{pointsInput:'1.5'}, {pointsInput:'3'}]).valid, false);
});
test('history derives reversal across the whole list and forbids reversal entries', () => {
  const batches = [{id:'a',number:1,kind:'gift',gifts:[]}, ...Array.from({length:6},(_,i)=>({id:`x${i}`,number:i+2,kind:'gift',gifts:[]})), {id:'r',number:8,kind:'reversal',reversesBatchId:'a',gifts:[]}];
  const rows = giftHistory(batches, {}, true);
  assert.equal(rows[0].reversed, true);
  assert.equal(rows[0].canReverse, false);
  const reversal = giftHistory([batches[7], batches[0]], {}, true)[0];
  assert.equal(reversal.originalNumber, 1);
  assert.equal(reversal.canReverse, false);
  assert.equal(giftHistory([{id:'a',kind:'gift',gifts:[]}], {}, false)[0].canReverse, false);
});
test('cancellation permits only eligible host rooms with no visible history', () => {
  const r = {status:'active',gameType:'generic',giftBatches:[],rounds:[],zhaJinHuaHands:[]};
  assert.equal(canCancelRoom(r,true),true);
  assert.equal(canCancelRoom(r,false),false);
  assert.equal(canCancelRoom({...r,giftBatches:[{}]},true),false);
  assert.equal(canCancelRoom({...r,currentRound:{}},true),false);
  assert.equal(canCancelRoom({...r,rounds:[{}]},true),false);
  assert.equal(canCancelRoom({...r,zhaJinHuaHands:[{}]},true),false);
  assert.equal(canCancelRoom({...r,gameType:'zhajinhua'},true),false);
  assert.equal(canCancelRoom({...r,status:'settled'},true),false);
  assert.equal(canCancelRoom({...r,status:'waiting',gameType:'zhajinhua'},true),true);
});
