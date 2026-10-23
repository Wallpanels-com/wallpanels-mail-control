const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const tables={Emails:[],Reminders:[],Errors:[],Employees:[]},states={};let serial=0;
  const db={all:n=>tables[n],save:(n,o)=>{if(!tables[n].includes(o))tables[n].push(o);return o;},
    state:(k,...v)=>v.length?(states[k]=v[0]):states[k],setting:()=> 'test'};
  const cfg={employees:[{email:'shared@example.org',telegramId:1,name:'First'},{email:'shared@example.org',telegramId:2,name:'Second'}],
    adminIds:[3,4],testAdminId:3,token:'FAKE',groq:'FAKE'};
  const calls=[];let api={telegram:(token,method,payload)=>{calls.push({method,payload});return {message_id:50};},
    gmail:()=>({messages:[]}),analyze:()=>{throw Error('GROQ_HTTP_429');}};
  class Clock extends Date {static now(){return 100000;}}
  const ctx=vm.createContext({console,Date:Clock,Intl,WpCore:require('../src/Core.js'),WpTest:require('../src/TestCampaign.js'),WpApi:api,Utilities:{getUuid:()=>String(++serial).padStart(32,'0')},
    module:{},CacheService:{},PropertiesService:{}});
  vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
  const row={id:'a'.repeat(20),status:'awaiting',kind:'synthetic',mailbox:'shared@example.org',messageId:'m1',threadId:'t1',receivedAt:Date.now(),subject:'test'};
  tables.Emails.push(row);
  return {app:ctx.WpApp,db,cfg,calls,tables,states,api,row,ctx};
}
test('outbox reservation is idempotent and admins are not duplicated for PM',()=>{
  const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'production');f.app.queue(f.db,f.cfg,f.row,30,'production');
  assert.equal(f.tables.Reminders.length,4);
});
test('unknown Telegram delivery is not automatically queued again',()=>{
  const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'test'); f.tables.Reminders[0].status='unknown';
  f.app.queue(f.db,f.cfg,f.row,30,'test');assert.equal(f.tables.Reminders.length,1);assert.equal(f.tables.Reminders[0].status,'unknown');
});
function callback(f,user=3,action='n'){return {callback_query:{id:'cb1',from:{id:user},data:action+':'+f.row.id,message:{message_id:50,chat:{id:user,type:'private'}}}};}
test('callback must originate from a delivered notification and authorized chat',()=>{
  const f=fixture();f.app.handle(f.db,f.cfg,callback(f), 'test');assert.equal(f.row.status,'awaiting');
  f.app.queue(f.db,f.cfg,f.row,30,'test');Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
  f.app.handle(f.db,f.cfg,callback(f,99),'test');assert.equal(f.row.status,'awaiting');
  f.app.handle(f.db,f.cfg,callback(f),'test');assert.equal(f.row.status,'no_reply_needed');assert.equal(f.row.closedBy,'3');
});
test('duplicate callback has exactly one closure record',()=>{
  const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'test');Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
  f.app.handle(f.db,f.cfg,callback(f),'test');const at=f.row.closedAt;
  f.app.handle(f.db,f.cfg,callback(f),'test');assert.equal(f.row.closedAt,at);assert.equal(f.tables.Emails.length,1);
});
test('No Reply Needed affects only one incoming; future message in same thread remains active',()=>{
  const f=fixture();const newRow={...f.row,id:'b'.repeat(20),messageId:'m2'};f.tables.Emails.push(newRow);
  f.app.queue(f.db,f.cfg,f.row,30,'test');Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
  f.app.handle(f.db,f.cfg,callback(f),'test');assert.equal(newRow.status,'awaiting');
});
test('first sync sets a baseline without importing or notifying historic mail',()=>{
  const f=fixture();f.api.gmail=(c,m,path)=>{assert.equal(path,'profile');return {historyId:'100'};};
  f.app.sync(f.db,f.cfg,'shared@example.org');assert.equal(f.states['gmail:shared@example.org'].historyId,'100');assert.equal(f.tables.Reminders.length,0);
});
test('Sheets formula injection is escaped',()=>{
  const Store=require('../src/Store.js');for(const s of ['=IMPORTXML("x")','+1','@x','-2'])assert.equal(Store.safe(s),"'"+s);
  assert.equal(Store.safe('normal'), 'normal');
});
test('ambiguous external send is recorded unknown and not sent twice',()=>{
  const f=fixture();let sends=0;f.api.telegram=()=>{sends++;throw Error('TELEGRAM_NETWORK');};
  f.app.queue(f.db,f.cfg,f.row,30,'test');f.app.dispatch(f.db,f.cfg,'test');f.app.dispatch(f.db,f.cfg,'test');
  assert.equal(sends,1);assert.equal(f.tables.Reminders[0].status,'unknown');assert.equal(f.tables.Errors.length,1);
});
test('explicit Telegram rate limit defers delivery',()=>{
  const f=fixture();f.api.telegram=()=>{throw Object.assign(Error('TELEGRAM_HTTP_429'),{code:429,retryAfter:120});};
  f.app.queue(f.db,f.cfg,f.row,30,'test');f.app.dispatch(f.db,f.cfg,'test');
  assert.equal(f.tables.Reminders[0].status,'pending');assert.equal(f.tables.Reminders[0].nextAttemptAt,220000);
});
test('permanent blocked-chat rejection is recorded failed',()=>{
  const f=fixture();f.api.telegram=()=>{throw Object.assign(Error('TELEGRAM_HTTP_403'),{code:403});};
  f.app.queue(f.db,f.cfg,f.row,30,'test');f.app.dispatch(f.db,f.cfg,'test');assert.equal(f.tables.Reminders[0].status,'failed');
});
test('production dispatch cannot send synthetic tests',()=>{
  const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'production');f.app.dispatch(f.db,f.cfg,'production');
  assert.equal(f.calls.length,0);assert.ok(f.tables.Reminders.every(r=>r.status==='cancelled'));
});
test('reconcile stores a new incoming even when Groq fails, and repeats do not duplicate it',()=>{
  const f=fixture();const m={id:'real1',internalDate:'1000',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'}]}};
  f.api.gmail=()=>({messages:[m]});
  f.app.reconcile(f.db,f.cfg,'shared@example.org','thread1',0);f.app.reconcile(f.db,f.cfg,'shared@example.org','thread1',0);
  const row=f.tables.Emails.find(r=>r.messageId==='real1');
  assert.equal(row.status,'awaiting');assert.equal(row.aiStatus,'pending');assert.equal(row.aiAttempts,1);assert.equal(f.tables.Emails.length,2);
});
test('history cursor is not advanced when processing a thread fails',()=>{
  const f=fixture();f.states['gmail:shared@example.org']={historyId:'1',baseline:0,lastSync:0};
  f.api.gmail=(c,m,path)=>{if(path==='history')return {history:[{messagesAdded:[{message:{threadId:'t'}}]}],historyId:'2'};throw Error('GMAIL_HTTP_503');};
  assert.throws(()=>f.app.sync(f.db,f.cfg,'shared@example.org'),/GMAIL_HTTP_503/);assert.equal(f.states['gmail:shared@example.org'].historyId,'1');
});
test('expired history recovers with bounded scan then uses captured snapshot',()=>{
  const f=fixture();f.states['gmail:shared@example.org']={historyId:'1',baseline:500,lastSync:900};const paths=[];
  f.api.gmail=(c,m,path,params)=>{paths.push(path);if(path==='history')throw Object.assign(Error('GMAIL_HTTP_404'),{code:404});
    if(path==='profile')return {historyId:'10'};assert.equal(params.q,'after:0');return {};};
  f.app.sync(f.db,f.cfg,'shared@example.org');assert.equal(f.states['gmail:shared@example.org'].historyId,'10');
  assert.equal(f.states['gmail:shared@example.org'].baseline,500);assert.deepEqual(paths,['history','profile','messages']);
});
test('expired callback acknowledgement does not poison the update pipeline',()=>{
  const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'test');Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
  f.api.telegram=()=>{throw Object.assign(Error('TELEGRAM_HTTP_400'),{code:400});};
  assert.doesNotThrow(()=>f.app.handle(f.db,f.cfg,callback(f),'test'));assert.equal(f.row.status,'no_reply_needed');
});
test('approved admin test owner adds one mailbox without replacing seven employees',()=>{
  const f=fixture(), emails=['one','two','three','four','five','shared','shared'];
  const cfg={projectId:'wallpanels-gmail-control',sheetId:'fake',serviceAccount:'test@wallpanels-gmail-control.iam.gserviceaccount.com',
    employees:emails.map((s,i)=>({id:'e'+i,email:s+'@wallpanels.com',telegramId:String(10+i)})),adminIds:['3','4'],testAdminId:'3',
    testEmployee:{id:'admin-test',email:'owner.test@wallpanels.com',telegramId:'3',role:'admin_test'}};
  f.ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='WP_CONFIG_JSON'?JSON.stringify(cfg):'FAKE'})};
  const actual=f.app.config();assert.equal(actual.employees.length,8);assert.equal(actual.mailboxes.length,7);
  assert.equal(actual.adminIds.join(','),'3,4');assert.ok(actual.mailboxes.includes('owner.test@wallpanels.com'));
  cfg.testEmployee.telegramId='4';assert.throws(()=>f.app.config(),/CONFIG_TEST_OWNER/);
});
test('test preview rejects another user and production mode',()=>{
  const f=fixture();f.cfg.testEmployee={email:'shared@example.org'};
  const update={update_id:1,message:{date:100,from:{id:99},chat:{id:99,type:'private'},text:'/preview'}};
  f.app.handle(f.db,f.cfg,update,'test');assert.equal(f.calls.length,0);
  update.message.from.id=3;update.message.chat.id=3;f.app.handle(f.db,f.cfg,update,'production');assert.equal(f.calls.length,0);
});
test('test preview reserves only the approved test mailbox without consuming SLA stages',()=>{
  const f=fixture();f.cfg.testEmployee={email:'shared@example.org'};
  Object.assign(f.row,{kind:'live',receivedAt:100});
  f.api.gmail=()=>({messages:[{id:'m1',internalDate:'100',payload:{headers:[]},labelIds:['INBOX']}]});
  const update={update_id:1,message:{date:100,from:{id:3},chat:{id:3,type:'private'},text:'/preview'}};
  f.app.handle(f.db,f.cfg,update,'test');f.app.handle(f.db,f.cfg,update,'test');
  assert.equal(f.tables.Reminders.length,1);assert.equal(f.tables.Reminders[0].stage,'preview');
  assert.equal(f.tables.Reminders[0].recipient,'3');assert.equal(f.tables.Reminders[0].status,'sent');
});
test('campaign creates exactly two role-specific deliveries only to test admin, including on retries',()=>{
 const f=fixture();Object.assign(f.row,{kind:'live',receivedAt:1});
 f.states.test247={id:'campaign',active:true,mailbox:f.row.mailbox,messageId:f.row.messageId,startedAt:1,client:['client@example.com']};
 f.app.queue(f.db,f.cfg,f.row,30,'test');f.app.queue(f.db,f.cfg,f.row,30,'test');
 assert.equal(f.tables.Reminders.length,2);assert.ok(f.tables.Reminders.every(r=>r.recipient==='3'));
 assert.ok(f.tables.Reminders[0].id.includes('view-employee'));assert.ok(f.tables.Reminders[1].id.includes('view-admin'));
 const emp=f.app.keyboard(f.cfg,f.row,3,'test','employee').inline_keyboard.flat();
 const adm=f.app.keyboard(f.cfg,f.row,3,'test','admin').inline_keyboard.flat();
 assert.deepEqual(Array.from(emp,b=>b.text),['Open Gmail','No Reply Needed']);
 assert.ok(adm.some(b=>b.text==='Send Reminder'));assert.ok(!adm.some(b=>b.text==='No Reply Needed'));
});
test('campaign still checks actual Gmail reply before either notification',()=>{
 const f=fixture();Object.assign(f.row,{kind:'live',receivedAt:1});
 f.states.test247={id:'campaign',active:true,mailbox:f.row.mailbox,messageId:f.row.messageId,startedAt:1,client:['client@example.com']};
 f.app.queue(f.db,f.cfg,f.row,30,'test');
 f.api.gmail=()=>({messages:[{id:'m1',internalDate:'1',payload:{headers:[{name:'From',value:'client@example.com'}]}},
   {id:'reply',internalDate:'2',labelIds:['SENT'],payload:{headers:[{name:'To',value:'client@example.com'}]}}]});
 f.app.dispatch(f.db,f.cfg,'test');assert.equal(f.row.status,'replied');assert.equal(f.calls.length,0);
 assert.ok(f.tables.Reminders.every(r=>r.status==='cancelled'));
});
test('one-off activation imports only selected historic message and never resets epoch',()=>{
 const f=fixture();f.cfg.testEmployee={email:f.row.mailbox,telegramId:3};
 const mid='1'.repeat(16);f.ctx.wpTestRequest=()=>({id:'campaign',mailbox:f.row.mailbox,messageId:mid,threadId:'thread'});
 f.ctx.PropertiesService={getScriptProperties:()=>({setProperty:()=>{}})};
 f.db.setting=()=> 'test';
 f.api.gmail=()=>({messages:[{id:mid,internalDate:'10',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'}]}},
   {id:'2'.repeat(16),internalDate:'1',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'}]}}]});
 f.api.analyze=()=>({requires_reply:true,category:'customer',summary:'request',reason:'reply needed'});
 f.app.activateTestRequest(f.db,f.cfg);const start=f.states.test247.startedAt;
 f.app.activateTestRequest(f.db,f.cfg);
 assert.equal(f.states.test247.startedAt,start);assert.equal(f.states.test247.initialized,true);
 assert.equal(f.tables.Emails.filter(r=>r.kind==='live').length,1);
 assert.equal(f.tables.Reminders.length,2);
});
test('testoff cancels only pending campaign jobs and cannot be used by other users',()=>{
 const f=fixture();f.cfg.testEmployee={email:f.row.mailbox};f.states.test247={id:'campaign',active:true};
 f.ctx.PropertiesService={getScriptProperties:()=>({deleteProperty:()=>{}})};
 f.tables.Reminders.push({id:'x:campaign-campaign:view-employee',status:'pending'},{id:'sent:campaign-campaign:view-admin',status:'sent'});
 const command={update_id:10,message:{date:100,from:{id:99},chat:{id:99,type:'private'},text:'/testoff'}};
 f.app.handle(f.db,f.cfg,command,'test');assert.equal(f.states.test247.active,true);
 command.message.from.id=3;command.message.chat.id=3;f.app.handle(f.db,f.cfg,command,'test');
 assert.equal(f.states.test247.active,false);assert.equal(f.tables.Reminders[0].status,'cancelled');assert.equal(f.tables.Reminders[1].status,'sent');
});
