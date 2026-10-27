const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../src/Core.js');
const rule={id:'crm',sender:'info@example.org',subjectPattern:'^New Lead \\(Example\\) was assigned to you .+$',category:'system',reason:'CRM notice'};
function message(from,subject){return {id:'m',labelIds:['INBOX'],payload:{headers:[{name:'From',value:from},{name:'Subject',value:subject}]}};}
test('CRM assignments are recognized across observed sending variants, never by no-reply alone',()=>{
 for(const from of ['info+one.example@mail.msgsndrlg.com','info+two.example@mail.msgsndrlb.com']){
  for(const subject of ['New Lead (Example Home) was assigned to you Sales','Missed Call (Example Home) assigned to you Sales'])
   assert.equal(core.exclusion(message(from,subject),[]).id,'crm_assignment_template');
  for(const subject of ['Please send a quotation','Re: New Lead (Example Home) was assigned to you Sales','New Lead (Example Home) was assigned to you Sales?'])
   assert.equal(core.exclusion(message(from,subject),[]),null);
 }
 assert.equal(core.exclusion(message('customer@example.org','New Lead (Example Home) was assigned to you Sales'),[]),null);
 assert.equal(core.exclusion(message('noreply@google.com','Share request for proposal'),[]),null);
});
test('bulk evidence uses mailing-list headers, not sender or generic Gmail category',()=>{
 const m=message('noreply@example.org','Notice');m.labelIds.push('CATEGORY_UPDATES');assert.equal(core.bulkEvidence(m),false);
 for(const [name,value] of [['List-Unsubscribe','<mailto:unsubscribe@example.org>'],['List-ID','news.example.org'],['Precedence','bulk']]){
  const x=message('client@example.org','Notice');x.payload.headers.push({name,value});assert.equal(core.bulkEvidence(x),true);
 }
});
test('reviewed exclusion requires exact sender and exact anchored template',()=>{
 assert.equal(core.exclusion(message('Example <INFO@example.org>','New Lead (Example) was assigned to you Sales'),[rule]).id,'crm');
 for(const m of [message('client@example.org','New Lead (Example) was assigned to you Sales'),
  message('info@example.org','Please quote the panels'),message('info@example.org','Re: New Lead (Example) was assigned to you Sales'),
  message('info@example.org.evil.com','New Lead (Example) was assigned to you Sales')])assert.equal(core.exclusion(m,[rule]),null);
 assert.equal(core.exclusion(message('info@example.org','New Lead (Example) was assigned to you Sales')),null);
 for(const subject of [123,true,new Date(),null])assert.doesNotThrow(()=>core.exclusion(message('info@example.org',subject),[rule]));
});
test('a manually reviewed acknowledgment can be excluded without suppressing a later question in the same thread',()=>{
 const scoped={id:'reviewed_one',sender:'client@example.org',subjectPattern:'^Re: Appointment$',category:'other',reason:'Acknowledgment only',
  messageId:'123456abcdef',mailbox:'shared@example.org'};
 const source={...message('client@example.org','Re: Appointment'),id:'123456abcdef'};
 assert.equal(core.exclusion(source,[scoped],'shared@example.org').id,'reviewed_one');
 assert.equal(core.exclusion({...source,id:'123456abcdee'},[scoped],'shared@example.org'),null);
 assert.equal(core.exclusion(source,[scoped],'different@example.org'),null);
 assert.equal(core.exclusion(source,[scoped]),null);
});
test('an existing completed AI classification is superseded without spending tokens; sent receipts survive',()=>{
 const row={id:'email',status:'awaiting',aiStatus:'complete',category:'customer',summary:'previous',reason:'previous',mailbox:'sales@example.org',messageId:'m'};
 const jobs=['pending','waiting_start','sent','unknown'].map((status,i)=>({id:String(i),emailId:'email',status,telegramMessageId:i}));
 const states={},tables={Emails:[row],Reminders:jobs};
 const db={all:n=>tables[n],save:()=>{},state:(k,...v)=>v.length?(states[k]=v[0]):states[k]};
 const ctx=vm.createContext({WpCore:core,Date,console,WpApi:{analyze:()=>{throw Error('NO_AI');}}});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
 const cfg={mailExclusions:[rule]},source=message('info@example.org','New Lead (Example) was assigned to you Sales');
 assert.equal(ctx.WpApp.exclude(db,cfg,row,source),true);
 assert.equal(row.status,'not_required');assert.equal(row.closeReason,'filter:crm');assert.equal(row.aiStatus,'complete');
 assert.deepEqual(jobs.map(j=>j.status),['cancelled','cancelled','sent','unknown']);
 assert.equal(states['mailFilter:email'].previous.summary,'previous');assert.equal(ctx.WpApp.exclude(db,cfg,row,source),true);
 assert.equal(states['mailFilter:email'].previous.summary,'previous');
});
test('new roster counts retain duplicate-ID, mailbox and admin safeguards',()=>{
 const cfg={projectId:'wallpanels-gmail-control',sheetId:'fake',serviceAccount:'test@wallpanels-gmail-control.iam.gserviceaccount.com',
  employeeCount:8,employeeMailboxCount:7,employees:['one','two','three','four','five','shared','shared','new'].map((s,i)=>({id:'e'+i,email:s+'@wallpanels.com',telegramId:String(10+i)})),
  adminIds:['3','4'],testAdminId:'3',testEmployee:{id:'owner',email:'owner@wallpanels.com',telegramId:'3',role:'admin_employee'},mailExclusions:[rule]};
 const ctx=vm.createContext({WpCore:core,console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='WP_CONFIG_JSON'?JSON.stringify(cfg):'FAKE'})}});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
 assert.equal(ctx.WpApp.config().employees.length,9);assert.equal(ctx.WpApp.config().mailboxes.length,8);
 cfg.employees[7].telegramId='10';assert.throws(()=>ctx.WpApp.config(),/CONFIG_ROSTER/);cfg.employees[7].telegramId='17';
 cfg.mailExclusions[0]={...rule,subjectPattern:'anything'};assert.throws(()=>ctx.WpApp.config(),/CONFIG_EXCLUSIONS/);
});
test('extra memberships, SLA ordering and polling cadence cannot bypass the mailbox allowlist',()=>{
 const cfg={projectId:'wallpanels-gmail-control',sheetId:'fake',serviceAccount:'test@wallpanels-gmail-control.iam.gserviceaccount.com',
  employees:['one','two','three','four','five','shared','shared'].map((s,i)=>({id:'e'+i,email:s+'@wallpanels.com',telegramId:String(10+i)})),
  adminIds:['3','4'],testAdminId:'3'};
 const ctx=vm.createContext({WpCore:core,console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='WP_CONFIG_JSON'?JSON.stringify(cfg):'FAKE'})}});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
 cfg.employees[0].additionalMailboxes=['unapproved@wallpanels.com'];assert.throws(()=>ctx.WpApp.config(),/CONFIG_MEMBERSHIPS/);
 cfg.employees[0].additionalMailboxes=['shared@wallpanels.com'];cfg.employees[0].mailboxSince={'unapproved@wallpanels.com':1};
 assert.throws(()=>ctx.WpApp.config(),/CONFIG_MEMBERSHIP_EPOCH/);cfg.employees[0].mailboxSince={'shared@wallpanels.com':1};
 cfg.mailboxPolicies={'shared@wallpanels.com':{effectiveAt:1,stages:[5,5,15]}};assert.throws(()=>ctx.WpApp.config(),/CONFIG_SLA/);
 cfg.mailboxPolicies['shared@wallpanels.com'].stages=[5,10,15];cfg.monitorMinutes=2;assert.throws(()=>ctx.WpApp.config(),/CONFIG_POLLING/);
 cfg.monitorMinutes=1;assert.equal(ctx.WpApp.config().mailboxes.length,6);
});
