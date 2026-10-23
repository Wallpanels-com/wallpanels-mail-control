const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/Core.js');
const t=Date.parse;
const minutes=(a,b)=>C.businessMinutes(t(a),t(b));
test('30, 60, 120 working-minute stages',()=>{
  const start=t('2026-07-20T13:00:00Z');
  assert.equal(C.dueStage(start,start+29*60000,[]),0);
  assert.equal(C.dueStage(start,start+30*60000,[]),30);
  assert.equal(C.dueStage(start,start+60*60000,[30]),60);
  assert.equal(C.dueStage(start,start+120*60000,[30,60]),120);
  assert.equal(C.dueStage(start,start+150*60000,[30,60,120]),0);
});
test('evening and weekend pause',()=>{
  assert.equal(minutes('2026-07-17T22:45Z','2026-07-20T13:15Z'),30);
  assert.equal(minutes('2026-07-18T13:00Z','2026-07-19T22:00Z'),0);
  assert.equal(C.isWorking(t('2026-07-20T23:00Z')),false);
});
test('winter hours differ from summer',()=>{
  assert.equal(C.isWorking(t('2026-01-19T13:30Z')),false);
  assert.equal(C.isWorking(t('2026-07-20T13:30Z')),true);
  assert.equal(minutes('2026-01-19T14:00Z','2026-01-19T16:00Z'),120);
});
test('DST spring and autumn weekend transitions',()=>{
  assert.equal(minutes('2026-03-06T23:45Z','2026-03-09T13:15Z'),30);
  assert.equal(minutes('2026-10-30T22:45Z','2026-11-02T14:15Z'),30);
});
test('sub-minute precision, invalid and reversed intervals',()=>{
  assert.equal(minutes('2026-07-20T13:00:30Z','2026-07-20T13:01:00Z'),0.5);
  assert.equal(C.businessMinutes(20,10),0);
  assert.equal(C.businessMinutes(NaN,20),0);
});
function msg(id,ms,labels,headers={}) {return {id,internalDate:String(ms),labelIds:labels,payload:{headers:Object.entries(headers).map(([name,value])=>({name,value}))}};}
const source=msg('in-1',100,['INBOX'],{From:'Client <client@example.com>','Message-ID':'<one@client>'});
test('read state does not affect incoming classification',()=>{
  assert.equal(C.incoming(source,['person@example.org']),true);
  assert.equal(C.incoming({...source,labelIds:['INBOX','UNREAD']},['person@example.org']),true);
});
test('draft is never a reply and self messages are not incoming',()=>{
  assert.equal(C.replied([msg('draft',200,['DRAFT'],{To:'client@example.com'})],source),false);
  assert.equal(C.incoming(msg('own',200,['INBOX'],{From:'person@example.org'}),['person@example.org']),false);
});
test('sent reply closes only earlier incoming messages',()=>{
  const sent=msg('out',200,['SENT'],{To:'client@example.com','In-Reply-To':'<one@client>'});
  assert.equal(C.replied([source,sent],source),true);
  assert.equal(C.replied([source,sent],{...source,internalDate:'300'}),false);
  assert.notEqual(C.eventKey('box@example.com','in-1'),C.eventKey('box@example.com','in-2'));
});
test('unrelated sent and automatic response do not close expectation',()=>{
  assert.equal(C.replied([msg('other',200,['SENT'],{To:'other@example.com'})],source),false);
  assert.equal(C.replied([msg('auto',200,['SENT'],{To:'client@example.com','Auto-Submitted':'auto-replied'})],source),false);
});
test('PM recipients: two owners, each admin once; test routing only to test admin',()=>{
  const cfg={employees:[{email:'shared@example.org',telegramId:1},{email:'shared@example.org',telegramId:2}],adminIds:[3,4],testAdminId:3};
  assert.deepEqual(C.recipients(cfg,'shared@example.org','production'),['1','2','3','4']);
  assert.deepEqual(C.recipients(cfg,'shared@example.org','test'),['3']);
  assert.equal(C.authorized(cfg,1,'shared@example.org'),true);
  assert.equal(C.authorized(cfg,1,'other@example.org'),false);
});
test('Gmail URL selects owner account and encodes thread',()=>{
  assert.equal(C.gmailUrl('user@example.com','abc'),'https://mail.google.com/mail/u/?authuser=user%40example.com#all/abc');
});
test('admin who owns a test mailbox receives only one notification',()=>{
  const cfg={employees:[{email:'owner@example.org',telegramId:3}],adminIds:[3,4],testAdminId:3};
  assert.deepEqual(C.recipients(cfg,'owner@example.org','production'),['3','4']);
  assert.deepEqual(C.recipients(cfg,'owner@example.org','test'),['3']);
});
test('AI schema validation fails closed, bounded stored summaries',()=>{
  assert.throws(()=>C.normalizeAI({requires_reply:'false'}),/AI_SCHEMA/);
  assert.equal(C.normalizeAI({requires_reply:true,is_customer:true,category:'customer',summary:'a'.repeat(800),reason:'r'}).summary.length,500);
});
