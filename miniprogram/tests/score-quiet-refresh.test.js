const test=require('node:test');const assert=require('node:assert/strict');
let failure;
const apiPath=require.resolve('../utils/score-api');require.cache[apiPath]={id:apiPath,filename:apiPath,loaded:true,exports:{getScoreRoom:async()=>{if(failure)throw failure;return {id:'r',version:3};},getScoreErrorMessage:e=>e.message}};
global.wx={getStorageSync:()=>''};
const base=require('../utils/score-room-base');
function page(){return {...base,credential:{kind:'guest',token:'g'},data:{...base.data,loading:false,roomId:'r',room:{id:'r',version:2},errorMessage:'',canRetryLoad:false},setData(p){Object.assign(this.data,p);},async applyRoom(r){this.data.room=r;}};}
test('quiet network failure preserves visible room and uses separate sync warning',async()=>{const p=page();failure=Object.assign(new Error('网络异常'),{isNetworkError:true});await p.loadRoom({quiet:true});assert.equal(p.data.room.version,2);assert.equal(p.data.loading,false);assert.equal(p.data.errorMessage,'');assert.match(p.data.syncWarning,/网络/);failure=null;await p.loadRoom({quiet:true});assert.equal(p.data.room.version,3);assert.equal(p.data.syncWarning,'');});
test('quiet refresh does not suppress authorization errors',async()=>{const p=page();failure=Object.assign(new Error('身份失效'),{statusCode:403});await p.loadRoom({quiet:true});assert.equal(p.data.errorMessage,'身份失效');});
