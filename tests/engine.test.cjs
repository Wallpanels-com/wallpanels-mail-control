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
  const ctx=vm.createContext({console,Date:Clock,Intl,WpCore:require('../src/Core.js'),WpRollout:require('../src/Rollout.js'),WpTest:require('../src/TestCampaign.js'),WpMessages:require('../src/Messages.js'),WpApi:api,Utilities:{getUuid:()=>String(++serial).padStart(32,'0')},
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
test('successful AI analysis is reused on resync instead of spending tokens on the same message again',()=>{
 const f=fixture(),m={id:'real1',internalDate:'1000',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'}]}};let analyses=0;
 f.api.gmail=()=>({messages:[m]});f.api.analyze=()=>{analyses++;return {requires_reply:true,category:'customer',summary:'Запрос',reason:'Нужен ответ'};};
 f.app.reconcile(f.db,f.cfg,'shared@example.org','thread1',0);f.app.reconcile(f.db,f.cfg,'shared@example.org','thread1',0);
 assert.equal(analyses,1);assert.equal(f.tables.Emails.find(r=>r.messageId==='real1').aiStatus,'complete');
});
test('an actual Gmail reply closes an incoming without an unnecessary AI call',()=>{
 const f=fixture(),m={id:'real1',internalDate:'1000',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'},{name:'Message-ID',value:'<original@example.com>'}]}};
 const reply={id:'sent1',internalDate:'2000',labelIds:['SENT'],payload:{headers:[{name:'To',value:'client@example.com'},{name:'In-Reply-To',value:'<original@example.com>'}]}};
 f.api.gmail=()=>({messages:[m,reply]});f.api.analyze=()=>{throw Error('MUST_NOT_SPEND_TOKENS');};
 f.app.reconcile(f.db,f.cfg,'shared@example.org','thread1',0);
 assert.equal(f.tables.Emails.find(r=>r.messageId==='real1').status,'replied');assert.equal(f.tables.Errors.length,0);
});
test('budget recovery retries only existing 413 failures once, without resetting mail or delivery history',()=>{
 const f=fixture();f.db.setting=()=> 'production';f.api.aiRevision='single-message-v2';f.states.productionCutoff=500;
 const row={id:'live',kind:'live',mailbox:'shared@example.org',receivedAt:1000,status:'awaiting',aiStatus:'pending',nextAiAt:999999,aiAttempts:20};
 const other={...row,id:'other'},old={...row,id:'old',receivedAt:100},closed={...row,id:'closed',status:'no_reply_needed'},done={...row,id:'done',aiStatus:'complete'};
 f.tables.Emails.push(row,other,old,closed,done);
 for(const ref of ['live','old','closed','done']) f.tables.Errors.push({id:ref,component:'ai',code:'GROQ_HTTP_413',reference:ref});
 f.tables.Reminders.push({id:'receipt',emailId:'live',stage:30,status:'sent',telegramMessageId:50});
 const before=JSON.stringify(f.tables.Reminders);f.app.recoverAiBudget(f.db);
 assert.equal(row.nextAiAt,0);assert.equal(row.receivedAt,1000);assert.equal(row.aiAttempts,20);
 for(const r of [other,old,closed,done])assert.equal(r.nextAiAt,999999);
 assert.equal(JSON.stringify(f.tables.Reminders),before);assert.equal(f.states['aiBudgetRecovery:single-message-v2'].queued,1);
 row.nextAiAt=777777;f.app.recoverAiBudget(f.db);assert.equal(row.nextAiAt,777777);
 f.db.setting=()=> 'test';f.api.aiRevision='later';f.app.recoverAiBudget(f.db);assert.ok(!f.states['aiBudgetRecovery:later']);
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
function resumable(){
 const f=fixture();f.cfg.testEmployee={email:f.row.mailbox,telegramId:3};
 Object.assign(f.row,{kind:'live',status:'no_reply_needed',closedAt:90000,closedBy:'3',closeReason:'employee_button'});
 f.states.test247={id:'campaign',active:true,mailbox:f.row.mailbox,messageId:f.row.messageId,threadId:'t1',startedAt:50000,client:['client@example.com']};
 f.ctx.wpTestResumeRequest=()=>({id:'resume-1',campaignId:'campaign',messageId:'m1',expectedStartedAt:50000});
 f.api.gmail=()=>({messages:[{id:'m1',internalDate:'10',payload:{headers:[{name:'From',value:'client@example.com'}]},labelIds:['INBOX']}]});
 return f;
}
test('owner test resume preserves original epoch and closure audit without duplicate cards',()=>{
 const f=resumable();f.app.resumeTestRequest(f.db,f.cfg);f.app.resumeTestRequest(f.db,f.cfg);
 assert.equal(f.row.status,'awaiting');assert.equal(f.row.closedAt,'');assert.equal(f.states.test247.startedAt,50000);
 assert.equal(f.states['testResume:resume-1'].previousStatus,'no_reply_needed');assert.equal(f.states['testResume:resume-1'].previousClosedAt,90000);
 assert.equal(f.tables.Reminders.length,2);assert.ok(f.tables.Reminders.every(r=>r.stage==='resume' && r.recipient==='3'));
});
test('resume never reopens a message with an actual sent reply',()=>{
 const f=resumable(),get=f.api.gmail;
 f.api.gmail=()=>({messages:get().messages.concat([{id:'out',internalDate:'20',labelIds:['SENT'],payload:{headers:[{name:'To',value:'client@example.com'}]}}])});
 assert.throws(()=>f.app.resumeTestRequest(f.db,f.cfg),/TEST_RESUME_ALREADY_REPLIED/);
 assert.equal(f.row.status,'no_reply_needed');assert.equal(f.tables.Reminders.length,0);
});
test('resume restores only cancelled unsent SLA jobs and retains all already sent jobs',()=>{
 const f=resumable();
 f.tables.Reminders.push({id:'x:campaign-campaign:view-employee',emailId:f.row.id,stage:30,mode:'test',status:'cancelled'},
  {id:'y:campaign-campaign:view-admin',emailId:f.row.id,stage:30,mode:'test',status:'sent',sentAt:70000});
 f.app.resumeTestRequest(f.db,f.cfg);assert.equal(f.tables.Reminders[0].status,'pending');assert.equal(f.tables.Reminders[1].status,'sent');
 assert.equal(f.tables.Reminders[1].sentAt,70000);assert.equal(f.states.test247.startedAt,50000);
});
test('resume rejects a request that would change the campaign or its start time',()=>{
 const f=resumable();f.ctx.wpTestResumeRequest=()=>({id:'resume-1',campaignId:'campaign',messageId:'m1',expectedStartedAt:60000});
 assert.throws(()=>f.app.resumeTestRequest(f.db,f.cfg),/TEST_RESUME_SCOPE/);assert.equal(f.row.status,'no_reply_needed');
});
test('replayed old No Reply Needed callback cannot close an explicitly resumed test',()=>{
 const f=resumable();f.states['callback:cb1']={at:90000};
 f.app.queue(f.db,f.cfg,f.row,'initial','test');Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
 f.app.resumeTestRequest(f.db,f.cfg);f.app.handle(f.db,f.cfg,callback(f),'test');
 assert.equal(f.row.status,'awaiting');assert.equal(f.states['callback:cb1'].at,90000);assert.equal(f.states.test247.startedAt,50000);
});
test('format refresh edits both existing role cards once, preserving delivery ledger, buttons and epoch',()=>{
 const f=resumable();f.row.status='awaiting';f.app.queue(f.db,f.cfg,f.row,'initial','test');
 f.tables.Reminders.forEach((j,i)=>Object.assign(j,{status:'sent',sentAt:60000,telegramMessageId:50+i}));
 const before=JSON.stringify(f.tables.Reminders);
 f.app.refreshTestMessages(f.db,f.cfg);f.app.refreshTestMessages(f.db,f.cfg);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.method==='editMessageText' && c.payload.chat_id==='3' && c.payload.parse_mode==='HTML'));
 assert.ok(f.calls[0].payload.text.includes('👤 Employee'));assert.ok(f.calls[1].payload.text.includes('🛡 Admin'));
 assert.ok(f.calls[0].payload.text.includes('0 мин.')); // Historical wait at sentAt, not at edit time.
 assert.ok(f.calls[0].payload.reply_markup.inline_keyboard.flat().some(b=>b.text==='No Reply Needed'));
 assert.equal(JSON.stringify(f.tables.Reminders),before);assert.equal(f.states.test247.startedAt,50000);
 f.tables.Reminders.push({...f.tables.Reminders[0],id:'future:campaign-campaign:view-employee',telegramMessageId:99});
 f.app.refreshTestMessages(f.db,f.cfg);assert.equal(f.calls.length,2);
});
test('format refresh never edits production, other recipients, campaigns or mailboxes',()=>{
 const f=resumable();f.app.queue(f.db,f.cfg,f.row,'initial','test');
 const original={...f.tables.Reminders[0],status:'sent',sentAt:60000,telegramMessageId:50};
 f.tables.Reminders.splice(0,f.tables.Reminders.length,
  {...original,mode:'production'}, {...original,recipient:'4'}, {...original,id:'other:campaign-other:view-employee'});
 f.app.refreshTestMessages(f.db,f.cfg);assert.equal(f.calls.length,0);
});
test('failed message edit never resends a notification or changes the SLA clock',()=>{
 const f=resumable();f.app.queue(f.db,f.cfg,f.row,'initial','test');
 f.tables.Reminders.forEach(j=>Object.assign(j,{status:'sent',sentAt:60000,telegramMessageId:50}));
 f.api.telegram=()=>{const e=Error('TELEGRAM_HTTP_400');e.code=400;throw e;};
 f.app.refreshTestMessages(f.db,f.cfg);f.app.refreshTestMessages(f.db,f.cfg);
 assert.equal(f.tables.Errors.length,2);assert.equal(f.tables.Reminders.length,2);
 assert.ok(f.tables.Reminders.every(j=>j.status==='sent' && j.sentAt===60000));assert.equal(f.states.test247.startedAt,50000);
});
test('a waiting message subsequently moved to spam or trash stops all pending reminders',()=>{
 for(const label of ['SPAM','TRASH']) {
  const f=resumable();f.row.status='awaiting';f.app.queue(f.db,f.cfg,f.row,30,'test');
  f.api.gmail=()=>({messages:[{id:'m1',internalDate:'10',labelIds:[label],payload:{headers:[{name:'From',value:'client@example.com'}]}}]});
  f.app.dispatch(f.db,f.cfg,'test');
  assert.equal(f.row.status,'not_required');assert.equal(f.row.closeReason,'gmail_excluded');
  assert.ok(f.tables.Reminders.every(j=>j.status==='cancelled'));assert.equal(f.calls.length,0);
 }
});
test('AI exclusion records the reason and never creates reminders for a newsletter',()=>{
 const f=fixture();f.tables.Emails.length=0;
 f.api.gmail=()=>({messages:[{id:'newsletter',internalDate:'10',labelIds:['INBOX'],snippet:'Our weekly newsletter',
  payload:{headers:[{name:'From',value:'marketing@example.com'},{name:'Subject',value:'Weekly news'}]}}]});
 f.api.analyze=()=>({requires_reply:false,is_customer:false,category:'marketing',summary:'Рассылка',reason:'Ответ не нужен'});
 f.app.reconcile(f.db,f.cfg,'shared@example.org','thread',1);
 assert.equal(f.tables.Emails[0].status,'not_required');assert.equal(f.tables.Emails[0].reason,'Ответ не нужен');
 assert.equal(f.tables.Reminders.length,0);assert.equal(f.calls.length,0);
});
test('Send Reminder accurately acknowledges cooldown and replay without duplicate manual sends',()=>{
 const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'test');
 Object.assign(f.tables.Reminders[0],{status:'sent',telegramMessageId:50});
 const first=callback(f,3,'r');f.app.handle(f.db,f.cfg,first,'test');
 const second=callback(f,3,'r');second.callback_query.id='cb2';f.app.handle(f.db,f.cfg,second,'test');
 f.app.handle(f.db,f.cfg,first,'test');
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,1);
 const acks=f.calls.filter(c=>c.method==='answerCallbackQuery').map(c=>c.payload.text);
 assert.ok(acks[0].includes('в очередь'));assert.ok(acks[1].includes('Повторите через 5 мин.'));assert.ok(acks[2].includes('уже обработано'));
});
test('employee cannot invoke the admin reminder action even with proof of another delivered card',()=>{
 const f=fixture();f.app.queue(f.db,f.cfg,f.row,30,'production');
 f.tables.Reminders.forEach(j=>Object.assign(j,{status:'sent',telegramMessageId:50}));
 f.app.handle(f.db,f.cfg,callback(f,1,'r'),'production');
 assert.equal(f.tables.Reminders.length,4);assert.equal(f.row.status,'awaiting');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.text,'Нет доступа.');
});
test('production Start registers only an allowlisted private ID and does not disclose other mailboxes',()=>{
 const f=fixture(),msg=id=>({update_id:id,message:{date:100,from:{id},chat:{id,type:'private'},text:'/start'}});
 f.app.handle(f.db,f.cfg,msg(1),'production');assert.equal(f.states['telegramReady:1'].active,true);
 assert.ok(f.calls[0].payload.text.includes('shared@example.org'));assert.ok(!f.calls[0].payload.text.includes('администратор'));
 f.app.handle(f.db,f.cfg,msg(99),'production');assert.equal(f.states['telegramReady:99'],undefined);assert.ok(!f.calls.at(-1).payload.text.includes('@'));
 const admin=msg(4);admin.update_id=400;f.app.handle(f.db,f.cfg,admin,'production');assert.ok(f.calls.at(-1).payload.text.includes('по всем подключённым ящикам'));
 f.app.handle(f.db,f.cfg,admin,'production');assert.equal(f.calls.length,3);
});
test('production queues for an unstarted user without attempting Telegram delivery',()=>{
 const f=fixture();Object.assign(f.row,{kind:'live',receivedAt:1});f.ctx.WpCore={...f.ctx.WpCore,isWorking:()=>true};
 f.api.gmail=()=>({messages:[{id:'m1',internalDate:'1',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.com'}]}}]});
 f.app.queue(f.db,f.cfg,f.row,30,'production');f.app.dispatch(f.db,f.cfg,'production');
 assert.equal(f.calls.length,0);assert.ok(f.tables.Reminders.every(j=>j.status==='waiting_start'));
 f.states['telegramReady:1']={active:true};f.app.dispatch(f.db,f.cfg,'production');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.chat_id,'1');
});
test('production excludes old test rows even if a pending reservation survived cutover',()=>{
 const f=fixture();f.states.productionCutoff=200000;f.app.queue(f.db,f.cfg,f.row,30,'production');f.row.receivedAt=1;
 f.app.dispatch(f.db,f.cfg,'production');assert.equal(f.calls.length,0);assert.ok(f.tables.Reminders.every(j=>j.status==='cancelled'));
});
test('a delayed but genuine Start still connects an approved employee after polling downtime',()=>{
 const f=fixture();f.app.handle(f.db,f.cfg,{update_id:500,message:{date:-100000,from:{id:1},chat:{id:1,type:'private'},text:'/start'}},'production');
 assert.equal(f.states['telegramReady:1'].active,true);
});
