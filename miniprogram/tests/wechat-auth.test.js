const test = require('node:test');
const assert = require('node:assert/strict');
let storage, requests, navigations, loginCalls, nextResponse, loginError, toasts;
global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key,value) => { storage[key]=value; },
  removeStorageSync: key => { delete storage[key]; },
  login(options) {loginCalls++; if(loginError) options.fail(loginError); else options.success({code:'fresh-code'});},
  request(options) { requests.push(options); options.success(nextResponse); },
  showToast(options) {toasts.push(options);},
  navigateBack(options) {navigations.push(['back',options]);},
  switchTab(options) {navigations.push(['tab',options]);},
  redirectTo(options) {navigations.push(['redirect',options]);},
  reLaunch(options) {navigations.push(['reLaunch',options]);},
  navigateTo(options) {navigations.push(['navigate',options]);},
};
let syncs;
global.getApp=()=>({syncAuthState(){syncs++;}});
global.getCurrentPages=()=>[{},{}];
const auth=require('../utils/auth');
let definition;
global.Page=p=>{definition=p;};require('../pages/auth/index');
function page(data={}) {return {...definition,data:{...definition.data,...data},setData(p){Object.assign(this.data,p);}};}

test.beforeEach(()=>{
 storage={};requests=[];navigations=[];loginCalls=0;syncs=0;toasts=[];loginError=null;
 nextResponse={statusCode:200,data:{accessToken:'wechat-jwt',user:{id:'wechat-user',displayName:'微信牌友',wechatBound:true}}};
 auth.clearSession();
});

test('entering the login page never calls wx.login; consent is required before creating an account',async()=>{
 const p=page();p.onLoad({mode:'login',returnTo:encodeURIComponent('/pages/score/room/index?roomId=123')});
 assert.equal(p.data.mode,'wechat');assert.equal(loginCalls,0);
 await p.handleWeChatLogin();assert.equal(loginCalls,0);assert.equal(requests.length,0);assert.match(p.data.errorMessage,/协议|隐私/);
});

test('WeChat login exchanges only a fresh code and stores the FunBox session',async()=>{
 await auth.loginWithWeChat();assert.equal(loginCalls,1);
 assert.equal(requests[0].url.endsWith('/auth/wechat/login'),true);
 assert.deepEqual(requests[0].data,{code:'fresh-code'});assert.equal(requests[0].header.Authorization,undefined);
 assert.equal(auth.getAccessToken(),'wechat-jwt');assert.equal(auth.getStoredUser().id,'wechat-user');
});

test('approved login returns to the source and suppresses duplicate taps',async()=>{
 let pending;
 const original=wx.request;wx.request=o=>{requests.push(o);pending=o;};
 try {
  const p=page({agreed:true,returnTo:'/pages/score/room/index?roomId=123'});
  const work=p.handleWeChatLogin();await Promise.resolve();await Promise.resolve();
  await p.handleWeChatLogin();assert.equal(loginCalls,1);
  pending.success(nextResponse);await work;
  assert.equal(p.data.loading,false);assert.equal(syncs,1);
  assert.deepEqual(navigations[0],['redirect',{url:'/pages/score/room/index?roomId=123'}]);
 }finally {wx.request=original;}
});

test('logout or page unload during login cannot restore an account',async()=>{
 const original=wx.request;
 try {
  for(const end of ['logout','unload']){
   let pending;wx.request=o=>{pending=o;};
   const p=page({agreed:true});const work=p.handleWeChatLogin();await Promise.resolve();await Promise.resolve();
   if(end==='logout')auth.clearSession();else p.onUnload();
   pending.success(nextResponse);await work;
   assert.equal(auth.getAccessToken(),'');assert.equal(navigations.length,0);assert.equal(syncs,0);
  }
 }finally{wx.request=original;}
});

test('WeChat failure permits a fresh-code retry without clearing an existing account',async()=>{
 auth.saveSession({accessToken:'old-token',user:{id:'old'}});
 nextResponse={statusCode:401,data:{error:'wechat_code_invalid'}};
 const p=page({agreed:true});await p.handleWeChatLogin();
 assert.equal(p.data.loading,false);assert.equal(auth.getAccessToken(),'old-token');assert.match(p.data.errorMessage,/重试/);
 nextResponse={statusCode:200,data:{accessToken:'new-token',user:{id:'new'}}};await p.handleWeChatLogin();
 assert.equal(loginCalls,2);assert.equal(auth.getAccessToken(),'new-token');
});

test('binding requires the current account, preserves its token and stores the updated user',async()=>{
 await assert.rejects(auth.bindWeChat(),/登录/);assert.equal(loginCalls,0);
 auth.saveSession({accessToken:'old-token',user:{id:'old'}});
 nextResponse={statusCode:200,data:{user:{id:'old',wechatBound:true,displayName:'原有昵称'}}};
 await auth.bindWeChat();assert.equal(requests[0].url.endsWith('/users/me/wechat'),true);
 assert.equal(requests[0].header.Authorization,'Bearer old-token');assert.equal(auth.getAccessToken(),'old-token');assert.equal(auth.getStoredUser().wechatBound,true);
});

test('tab return targets, guest exit and policy links use working destinations',()=>{
 const p=page({returnTo:'/pages/profile/index'});p.finishAuth();assert.deepEqual(navigations.pop(),['tab',{url:'/pages/profile/index'}]);
 p.data.returnTo='/pages/score/room/index?roomId=123';p.continueAsGuest();assert.deepEqual(navigations.pop(),['tab',{url:'/pages/index/index'}]);
 p.openLegal({currentTarget:{dataset:{type:'privacy'}}});assert.deepEqual(navigations.pop(),['navigate',{url:'/pages/legal/index?type=privacy'}]);
});

test('guest exit does not return into a protected-page login loop',()=>{
 const original=global.getCurrentPages;
 try {
  global.getCurrentPages=()=>[{route:'pages/game-history/index'},{route:'pages/auth/index'}];
  page().continueAsGuest();assert.deepEqual(navigations.pop(),['tab',{url:'/pages/index/index'}]);
  global.getCurrentPages=()=>[{route:'pages/score/room/index'},{route:'pages/auth/index'}];
  page().continueAsGuest();assert.equal(navigations.pop()[0],'back');
 }finally{global.getCurrentPages=original;}
});
