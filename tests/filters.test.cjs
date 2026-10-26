const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../src/Core.js');
const rule={id:'crm',sender:'info@example.org',subjectPattern:'^New Lead \\(Example\\) was assigned to you .+$',category:'system',reason:'CRM notice'};
function message(from,subject){return {id:'m',labelIds:['INBOX'],payload:{headers:[{name:'From',value:from},{name:'Subject',value:subject}]}};}
test('reviewed exclusion requires exact sender and exact anchored template',()=>{
 assert.equal(core.exclusion(message('Example <INFO@example.org>','New Lead (Example) was assigned to you Sales'),[rule]).id,'crm');
 for(const m of [message('client@example.org','New Lead (Example) was assigned to you Sales'),
  message('info@example.org','Please quote the panels'),message('info@example.org','Re: New Lead (Example) was assigned to you Sales'),
  message('info@example.org.evil.com','New Lead (Example) was assigned to you Sales')])assert.equal(core.exclusion(m,[rule]),null);
 assert.equal(core.exclusion(message('info@example.org','New Lead (Example) was assigned to you Sales')),null);
 for(const subject of [123,true,new Date(),null])assert.doesNotThrow(()=>core.exclusion(message('info@example.org',subject),[rule]));
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
