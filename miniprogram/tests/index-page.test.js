const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHome() {
  let definition;
  let clipboard;
  const toasts = [];
  const tabs = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../pages/index/index.js"), "utf8"), {
    require: () => ({}),
    Page: (page) => { definition = page; },
    wx: {
      setClipboardData: (options) => { clipboard = options; },
      hideToast: () => {},
      showToast: (options) => toasts.push(options),
      hideTabBar: () => tabs.push("hide"),
      showTabBar: () => tabs.push("show"),
    },
  });
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  return { page, toasts, tabs, clipboard: () => clipboard };
}

test("website guidance waits for a successful copy and closing restores tabs", () => {
  const home = loadHome();
  home.page.copyWebsite();
  assert.equal(home.clipboard().data, "https://xwhub.cn");
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.equal(home.page.data.copyingWebsite, true);
  const pending = home.clipboard();
  home.page.copyWebsite();
  assert.equal(home.clipboard(), pending);
  pending.success();
  assert.equal(home.page.data.showWebsiteDialog, true);
  assert.equal(home.page.data.copyingWebsite, false);
  assert.deepEqual(home.tabs, ["hide"]);
  home.page.closeWebsiteDialog();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.deepEqual(home.tabs, ["hide", "show"]);
});

test("failed website copy shows a retry message and can be retried", () => {
  const home = loadHome();
  home.page.copyWebsite();
  const first = home.clipboard();
  first.fail();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.equal(home.page.data.copyingWebsite, false);
  assert.equal(home.toasts[0].icon, "none");
  assert.match(home.toasts[0].title, /失败.*重试/);
  assert.deepEqual(home.tabs, []);
  home.page.copyWebsite();
  assert.notEqual(home.clipboard(), first);
  home.clipboard().success();
  home.page.onHide();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.deepEqual(home.tabs, ["hide", "show"]);
});

test("home keeps three score entries without availability pills or arrow decorations", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../pages/index/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "../pages/index/index.wxss"), "utf8");

  assert.equal((template.match(/class="scene-card /g) || []).length, 3);
  assert.match(template, /class="scene-card mahjong-card" bindtap="openMahjong"/);
  assert.match(template, /class="scene-card poker-card" bindtap="openPoker"/);
  assert.match(template, /class="scene-card general-card" bindtap="openGeneral"/);
  assert.doesNotMatch(template, /scene-arrow|scene-pill|available-pill|已开放/);
  assert.doesNotMatch(styles, /\.scene-arrow\s*\{/);
  assert.doesNotMatch(styles, /\.scene-pill\s*\{|\.available-pill\s*\{|\.poker-card\s+\.scene-pill\s*\{/);
});

test('resume validates the account room before navigating without joining', async () => {
  let definition, navigated = '', reads = 0;
  const recent = { roomId: 'r', credentialKind: 'account', userId: 'u', gameType: 'generic', status: 'active' };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages/index/index.js'), 'utf8'), {
    require: (p) => p.includes('score-api') ? { getScoreRoom: async (credential) => { reads++; assert.equal(credential.kind, 'account'); return { id: 'r', status: 'active', gameType: 'generic' }; } } : p.includes('score-session') ? { getRecentScoreRoom: () => recent, saveRecentScoreRoom: () => {} } : p.includes('auth') ? { getAccessToken: () => 'account', getStoredUser: () => ({ id: 'u' }) } : {},
    Page: p => { definition = p; }, wx: { navigateTo: o => { navigated = o.url; } },
  });
  const page = { ...definition, data: { ...definition.data, recentRoom: recent }, setData(p) { Object.assign(this.data, p); } };
  await page.resumeRoom();
  assert.equal(reads, 1);
  assert.match(navigated, /roomId=r/);
  assert.match(navigated, /identity=account/);
});

test('resume ignores stale token, guest replacement, and hidden page results', async () => {
  for (const change of ['token', 'guest', 'hide']) {
    let definition, resolveRead, navigated = false, token = 't';
    let recent = {roomId:'r', credentialKind: change === 'guest' ? 'guest' : 'account', userId:'u', guestSessionId:'s', status:'active'};
    let session = {roomId:'r',guestToken:'g',sessionId:'s'};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages/index/index.js'), 'utf8'), {
      require: p => p.includes('score-api') ? {getScoreRoom: () => new Promise(r => {resolveRead=r;})} : p.includes('score-session') ? {getRecentScoreRoom:()=>recent,getScoreSession:()=>session,saveRecentScoreRoom:()=>{throw Error('stale save');}} : p.includes('auth') ? {getAccessToken:()=>token,getStoredUser:()=>({id:'u'})} : {},
      Page:p=>{definition=p;}, wx:{navigateTo:()=>{navigated=true;}} });
    const page={...definition,data:{...definition.data},setData(p){Object.assign(this.data,p);}};
    const pending=page.resumeRoom();
    if(change==='token') token='new';
    if(change==='guest') session={...session,guestToken:'new'};
    if(change==='hide') page.onHide();
    resolveRead({id:'r',status:'active'});
    await pending;
    assert.equal(navigated,false,change);
  }
});

test('terminal and expired resume show feedback; transient failures preserve recent room', async () => {
  for(const scenario of ['terminal','expired','network']) {
    let definition, cleared=0; const recent={roomId:'r',credentialKind:'account',userId:'u',status:'active'};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../pages/index/index.js'),'utf8'),{
      require:p=>p.includes('score-api')?{getScoreRoom:async()=>{if(scenario==='terminal')return {id:'r',status:'settled'}; throw Object.assign(new Error('failure'),{statusCode:scenario==='expired'?401:0,isNetworkError:scenario==='network'});},getScoreErrorMessage:()=> 'failure'}:p.includes('score-session')?{getRecentScoreRoom:()=>recent,saveRecentScoreRoom:()=>{},clearRecentScoreRoom:()=>{cleared++;}}:p.includes('auth')?{getAccessToken:()=> 't',getStoredUser:()=>({id:'u'})}:{},
      Page:p=>{definition=p;},wx:{} });
    const page={...definition,data:{...definition.data,recentRoom:recent},setData(p){Object.assign(this.data,p);}};
    await page.resumeRoom();
    assert.ok(page.data.resumeError);
    assert.equal(cleared,scenario!=='network'?1:0);
    assert.equal(page.data.recentRoom===null,scenario!=='network');
  }
});

test('resume coalesces repeated taps and rejects a switched account', async () => {
  let definition, finish, reads=0, navigation=0, user={id:'u'};
  const recent={roomId:'r',credentialKind:'account',userId:'u',status:'active'};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../pages/index/index.js'),'utf8'),{
    require:p=>p.includes('score-api')?{getScoreRoom:()=>{reads++;return new Promise(r=>{finish=r;});}}:p.includes('score-session')?{getRecentScoreRoom:()=>recent,saveRecentScoreRoom:()=>{throw Error('stale save');}}:p.includes('auth')?{getAccessToken:()=> 'token',getStoredUser:()=>user}:{},
    Page:p=>{definition=p;},wx:{navigateTo:()=>{navigation++;}} });
  const page={...definition,data:{...definition.data},setData(p){Object.assign(this.data,p);}};
  const pending=page.resumeRoom(); const repeated=page.resumeRoom(); assert.equal(reads,1);
  user={id:'other'}; finish({id:'r',status:'active'}); await Promise.all([pending, repeated]);
  assert.equal(navigation,0);
});

function freshHome(kind = 'account') {
  let definition;
  const state = {token: 'A', user: {id: 'u'}, session: {roomId: 'r', sessionId: 's', guestToken: 'g'},
    recent: {roomId: 'r', name: 'old', status: 'active', credentialKind: kind, userId: 'u', guestSessionId: 's'}};
  const reads = [], routes = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages/index/index.js'), 'utf8'), {
    require: p => p.includes('score-api') ? {
      getScoreRoom: () => new Promise((resolve, reject) => reads.push({resolve, reject})), getScoreErrorMessage: () => '连接失败，请重试'
    } : p.includes('score-session') ? {
      getRecentScoreRoom: () => state.recent, getScoreSession: () => state.session,
      saveRecentScoreRoom: room => {state.recent = {...state.recent, name: room.name, status: room.status};},
      clearRecentScoreRoom: id => {if (state.recent && state.recent.roomId === id) state.recent = null;}
    } : p.includes('auth') ? {getAccessToken: () => state.token, getStoredUser: () => state.user} : {},
    Page: p => {definition = p;}, wx: {navigateTo: o => routes.push(o.url)}
  });
  const page = {...definition, data: {...definition.data}, setData(p) {Object.assign(this.data, p);}};
  return {state, reads, routes, page};
}
const homeTick = async () => {for (let i = 0; i < 6; i++) await Promise.resolve();};

test('home checks status on show and refreshes waiting room name before advertising it', async () => {
  const h = freshHome(); h.page.onShow();
  assert.equal(h.reads.length, 1);
  assert.equal(h.page.data.resumeState, 'checking');
  h.reads[0].resolve({id: 'r', name: 'new', status: 'waiting', gameType: 'generic'}); await homeTick();
  assert.equal(h.page.data.resumeState, 'ready');
  assert.equal(h.page.data.recentRoom.status, 'waiting'); assert.equal(h.page.data.recentRoom.name, 'new');
  assert.equal(h.routes.length, 0);
});
test('home background clears terminal and definitive invalid rooms but preserves network recovery', async () => {
  for (const scenario of ['settled', 'cancelled', 401, 403, 404, 'network']) {
    const h = freshHome(); h.page.onShow(); assert.equal(h.reads.length, 1);
    if (typeof scenario === 'number' || scenario === 'network') h.reads[0].reject({statusCode: scenario});
    else h.reads[0].resolve({id: 'r', status: scenario});
    await homeTick();
    assert.equal(!!h.state.recent, scenario === 'network', String(scenario));
    assert.equal(!!h.page.data.recentRoom, scenario === 'network');
    if (scenario === 'network') {
      assert.equal(h.page.data.resumeState, 'retry');
      const retry = h.page.resumeRoom(); assert.equal(h.reads.length, 2);
      h.reads[1].resolve({id:'r', status:'active', gameType:'zhajinhua'}); await retry;
      assert.match(h.routes[0], /poker-room/);
    }
  }
});
test('tap during background lookup coalesces read and navigation; later tap revalidates', async () => {
  const h = freshHome(); h.page.onShow();
  const a = h.page.resumeRoom(), b = h.page.resumeRoom();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve({id:'r', status:'active'}); await Promise.all([a,b]);
  assert.equal(h.routes.length, 1);
  const duplicate = h.page.resumeRoom(); assert.equal(h.reads.length, 1); await duplicate; assert.equal(h.routes.length, 1);
  h.page.onHide(); h.page.onShow(); h.reads[1].resolve({id:'r', status:'active'}); await homeTick();
  const tap = h.page.resumeRoom(); assert.equal(h.reads.length, 3);
  h.reads[2].resolve({id:'r', status:'waiting'}); await tap;
  assert.equal(h.routes.length, 2);
});
test('home background and queued taps reject hide, user/token and guest-session changes', async () => {
  for (const change of ['hide', 'user', 'token', 'guestToken', 'guestSession', 'guestAccount']) {
    const h = freshHome(change.startsWith('guest') ? 'guest' : 'account');
    h.page.onShow(); const tap = h.page.resumeRoom(); assert.equal(h.reads.length, 1);
    if (change === 'hide') h.page.onHide();
    if (change === 'user') h.state.user = {id:'B'};
    if (change === 'token' || change === 'guestAccount') h.state.token = 'B';
    if (change === 'guestToken') h.state.session.guestToken = 'new';
    if (change === 'guestSession') h.state.session.sessionId = 'new';
    let updates=0; const original=h.page.setData;
    h.page.setData=function(p) {updates++; original.call(this,p);};
    h.reads[0].resolve({id:'r', status:'settled'}); await tap;
    assert.equal(updates,0,change);
    assert.equal(h.routes.length, 0, change); assert.ok(h.state.recent, change);
  }
});
test('hidden validation never publishes completion and a later visible lookup owns the card', async () => {
  const h = freshHome(); h.page.onShow(); const tap = h.page.resumeRoom(); h.page.onHide();
  let updates = 0; const original = h.page.setData;
  h.page.setData = function(p) {updates++; original.call(this,p);};
  h.reads[0].resolve({id:'r',status:'waiting'}); await tap;
  assert.equal(updates,0);
  h.page.onShow(); h.reads[1].resolve({id:'r',name:'fresh',status:'active'}); await homeTick();
  assert.equal(h.page.data.recentRoom.name,'fresh'); assert.equal(h.page.data.resumeBusy,false);
});
