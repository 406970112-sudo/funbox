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
    assert.equal(cleared,scenario==='expired'?1:0);
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
  const pending=page.resumeRoom(); await page.resumeRoom(); assert.equal(reads,1);
  user={id:'other'}; finish({id:'r',status:'active'}); await pending;
  assert.equal(navigation,0);
});
