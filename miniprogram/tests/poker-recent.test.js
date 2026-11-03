const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('equal-version poker snapshot refreshes recent-room metadata', async () => {
 let page, saved;
 const base = {data:{}, maybeBindParticipantAccount(){}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../pages/score/poker-room/index.js'),'utf8'), {
  require: p => p.includes('score-room-base') ? base : p.includes('score-session') ? {saveRecentScoreRoom:(...a)=>{saved=a;}} : {},
  Page: p=>{page=p;}, wx:{}, setTimeout, clearTimeout,
 });
 const room={id:'r',version:2,status:'active'};
 const context={...page,data:{room,loading:false,poker:{betweenHands:true}},credential:{kind:'account',token:'t'}};
 await context.applyRoom({...room});
 assert.equal(saved[0].id,'r'); assert.equal(saved[1].token,'t');
});
