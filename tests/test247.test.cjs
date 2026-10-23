const {test}=require('node:test'),assert=require('node:assert/strict');
global.WpCore=require('../src/Core.js');const T=require('../src/TestCampaign.js'),C=global.WpCore;
const epoch=Date.parse('2026-10-24T22:00:00Z'); // Saturday, well outside production hours.
const state={id:'campaign',active:true,mailbox:'test@example.org',messageId:'old',startedAt:epoch,client:['client@example.com']};
const row={kind:'live',mailbox:state.mailbox,messageId:'old',receivedAt:epoch-86400000,sender:'Client <client@example.com>'};
test('24/7 timer starts at activation, not previous receipt time',()=>{
 assert.equal(T.minutes(state,row,epoch),0);assert.equal(T.due(state,row,epoch+29*60000,[]),0);
 for(const [minute,prior] of [[30,[]],[60,[30]],[120,[30,60]]]) assert.equal(T.due(state,row,epoch+minute*60000,prior),minute);
 assert.equal(T.due(state,row,epoch+121*60000,[30,60,120]),0);
});
test('production Saturday remains paused while test clock runs',()=>{
 assert.equal(C.dueStage(epoch,epoch+120*60000,[]),0);assert.equal(T.due(state,row,epoch+30*60000,[]),30);
 assert.equal(T.controls(state,row,'production'),false);
});
test('scope excludes other mailboxes, old unrelated messages and synthetic messages',()=>{
 assert.equal(T.controls(state,row,'test'),true);
 for(const change of [{mailbox:'other@example.org'},{kind:'synthetic'},{messageId:'unrelated',receivedAt:epoch-1},{messageId:'new',receivedAt:epoch+1,sender:'other@example.com'}])
   assert.equal(T.controls(state,{...row,...change},'test'),false);
});
test('new incoming message from same client starts an independent cycle',()=>{
 const next={...row,messageId:'new',receivedAt:epoch+3600000};
 assert.equal(T.controls(state,next,'test'),true);assert.equal(T.minutes(state,next,next.receivedAt),0);
 assert.equal(T.due(state,next,next.receivedAt+30*60000,[]),30);
});
test('stored campaign preserves epoch over serialized restarts',()=>{
 const restored=JSON.parse(JSON.stringify(state));assert.equal(T.start(restored,row),epoch);
 assert.equal(T.due(restored,row,epoch+60*60000,[30]),60);
});
