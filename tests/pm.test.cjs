const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/Core.js'),R=require('../src/Rollout.js'),M=require('../src/Messages.js');
const cut=Date.parse('2026-10-26T14:00:00Z'); // Monday, inside New York work hours.
function config(){return {employees:[
 {id:'dual',name:'Dual',email:'sales@example.org',telegramId:'1',additionalMailboxes:['shared@example.org'],mailboxSince:{'shared@example.org':cut}},
 {id:'new',name:'New',email:'shared@example.org',telegramId:'2',notificationsSince:cut},
 {id:'old1',name:'First',email:'shared@example.org',telegramId:'3'},
 {id:'old2',name:'Second',email:'shared@example.org',telegramId:'4'},
 {id:'other',name:'Other',email:'other@example.org',telegramId:'5'}],adminIds:['8','9'],testAdminId:'8',token:'FAKE',
 mailboxPolicies:{'shared@example.org':{effectiveAt:cut,stages:[5,10,15]}}};}
function fixture(){
 const cfg=config(),tables={Emails:[],Reminders:[],Errors:[],Employees:[]},states={},calls=[];
 const db={all:n=>tables[n],save:(n,o)=>{if(!tables[n].includes(o))tables[n].push(o);return o;},
  state:(k,...v)=>v.length?(states[k]=v[0]):states[k],setting:()=> 'production'};
 const ctx=vm.createContext({console:{log:()=>{}},WpCore:C,WpRollout:R,WpMessages:M,WpTest:require('../src/TestCampaign.js'),
  WpApi:{telegram:(token,method,payload)=>{calls.push({method,payload});return {message_id:44};},
   gmail:()=>({messages:[]}),analyze:()=>{throw Error('NO_AI');}},Date,Intl,Utilities:{getUuid:()=> 'a'.repeat(32)}});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
 return {cfg,tables,states,db,ctx,app:ctx.WpApp,calls};
}
test('dual-mailbox routing gives four shared owners and two admins once, without other mailbox leakage',()=>{
 const c=config();assert.deepEqual(C.recipients(c,'shared@example.org','production',cut),['1','2','3','4','8','9']);
 assert.deepEqual(C.recipients(c,'sales@example.org','production',cut),['1','8','9']);
 for(const u of ['2','3','4']){assert.equal(C.authorized(c,u,'shared@example.org'),true);assert.equal(C.authorized(c,u,'sales@example.org'),false);}
 assert.equal(C.authorized(c,'1','shared@example.org'),true);assert.equal(C.authorized(c,'1','sales@example.org'),true);
 assert.equal(C.authorized(c,'5','shared@example.org'),false);
});
test('membership activation does not replay old shared letters to newly added members',()=>{
 const c=config();assert.deepEqual(C.recipients(c,'shared@example.org','production',cut-1),['3','4','8','9']);
 assert.deepEqual(C.recipients(c,'sales@example.org','production',cut-1),['1','8','9']);
});
test('PM SLA is cumulative 5/10/15 only after activation; other and older mail retain 30/60/120',()=>{
 const c=config(),row={mailbox:'shared@example.org',receivedAt:cut};
 assert.deepEqual(C.reminderStages(c,row),[5,10,15]);
 assert.deepEqual(C.reminderStages(c,{...row,receivedAt:cut-1}),[30,60,120]);
 assert.deepEqual(C.reminderStages(c,{...row,mailbox:'sales@example.org'}),[30,60,120]);
 const stages=C.reminderStages(c,row);
 assert.equal(C.dueStage(cut,cut+299999,[],stages),0);assert.equal(C.dueStage(cut,cut+300000,[],stages),5);
 assert.equal(C.dueStage(cut,cut+600000,[5],stages),10);assert.equal(C.dueStage(cut,cut+900000,[5,10],stages),15);
 assert.equal(C.dueStage(cut,cut+1200000,[5,10,15],stages),0);
 assert.equal(C.dueStage(cut,cut+900000,[],stages),5); // No burst of three stages after downtime.
});
test('short PM SLA still pauses at night and weekends',()=>{
 const start=Date.parse('2026-10-30T22:58:00Z'),monday=Date.parse('2026-11-02T14:03:00Z');
 assert.equal(C.dueStage(start,Date.parse('2026-10-31T15:00:00Z'),[],[5,10,15]),0);
 assert.equal(C.dueStage(start,monday,[],[5,10,15]),5);
});
test('SLA snapshot survives a later configuration change without resetting receipt time',()=>{
 const f=fixture(),row={id:'new',mailbox:'shared@example.org',receivedAt:cut};
 assert.deepEqual(f.app.rowStages(f.db,f.cfg,row),[5,10,15]);f.cfg.mailboxPolicies['shared@example.org'].stages=[7,14,21];
 assert.deepEqual(f.app.rowStages(f.db,f.cfg,row),[5,10,15]);assert.equal(row.receivedAt,cut);
});
test('all four shared owners get one queue entry per stage and correct 1/2/3 labels',()=>{
 const f=fixture(),row={id:'new',mailbox:'shared@example.org',receivedAt:cut};f.tables.Emails.push(row);
 for(const n of [5,10,15]){f.app.queue(f.db,f.cfg,row,n,'production');f.app.queue(f.db,f.cfg,row,n,'production');
  assert.ok(M.render(row,{stage:n,mode:'production'},{owner:'Group',view:'employee',elapsed:n,stages:[5,10,15]}).includes('Напоминание '+([5,10,15].indexOf(n)+1)+' из 3'));}
 assert.equal(f.tables.Reminders.length,18);assert.equal(new Set(f.tables.Reminders.map(j=>j.id)).size,18);
});
test('Start reports both mailboxes and their distinct SLAs without disclosing unrelated mail',()=>{
 const f=fixture();f.app.handle(f.db,f.cfg,{update_id:1,message:{from:{id:1},chat:{id:1,type:'private'},text:'/start'}},'production');
 const text=f.calls.at(-1).payload.text;
 assert.ok(text.includes('sales@example.org — 30 / 60 / 120'));assert.ok(text.includes('shared@example.org — 5 / 10 / 15'));
 assert.ok(!text.includes('other@example.org'));assert.equal(f.states['telegramReady:1'].active,true);
});
test('new PM Start does not expose the dual owner personal mailbox',()=>{
 const f=fixture();f.app.handle(f.db,f.cfg,{update_id:2,message:{from:{id:2},chat:{id:2,type:'private'},text:'/start'}},'production');
 assert.ok(f.calls.at(-1).payload.text.includes('shared@example.org — 5 / 10 / 15'));assert.ok(!f.calls.at(-1).payload.text.includes('sales@example.org'));
});
test('Start releases only latest held short SLA, not a burst of 5/10/15',()=>{
 const f=fixture();f.tables.Reminders=[5,10,15].map(stage=>({id:String(stage),stage,emailId:'e',recipient:'2',mode:'production',status:'waiting_start'}));
 R.release(f.db,'2');assert.deepEqual(f.tables.Reminders.map(j=>j.status),['superseded','superseded','pending']);
});
test('other shared mailboxes retain global No Reply Needed closure and unsent-job cancellation',()=>{
 for(const user of ['1','2','3','4']){
  const f=fixture(),row={id:'a'.repeat(20),mailbox:'shared@example.org',receivedAt:cut,status:'awaiting',kind:'live'};
  f.tables.Emails.push(row);f.app.queue(f.db,f.cfg,row,5,'production');
  const sent=f.tables.Reminders.find(j=>j.recipient===user);Object.assign(sent,{status:'sent',telegramMessageId:44});
  f.tables.Reminders.find(j=>j!==sent).status='waiting_start';
  f.app.handle(f.db,f.cfg,{callback_query:{id:'cb',from:{id:Number(user)},data:'n:'+row.id,message:{message_id:44,chat:{id:Number(user),type:'private'}}}},'production');
  assert.equal(row.status,'no_reply_needed');assert.ok(f.tables.Reminders.every(j=>['sent','cancelled'].includes(j.status)));
 }
});
test('sent reply from shared Gmail stops all group reminders; CC mail is not a sent reply',()=>{
 const f=fixture(),row={id:'e',mailbox:'shared@example.org',receivedAt:cut,messageId:'in',threadId:'thread',kind:'live',status:'awaiting'};
 const source={id:'in',internalDate:String(cut),labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.org'},{name:'Message-ID',value:'<in>'}]}};
 const cc={id:'cc',internalDate:String(cut+1),labelIds:['INBOX'],payload:{headers:[{name:'From',value:'colleague@example.org'},{name:'In-Reply-To',value:'<in>'}]}};
 f.tables.Emails.push(row);f.app.queue(f.db,f.cfg,row,5,'production');
 f.ctx.WpApi.gmail=()=>({messages:[source,cc]});assert.equal(f.app.current(f.db,f.cfg,row),true);
 f.ctx.WpApi.gmail=()=>({messages:[source,cc,{id:'out',internalDate:String(cut+2),labelIds:['SENT'],payload:{headers:[{name:'To',value:'client@example.org'},{name:'In-Reply-To',value:'<in>'}]}}]});
 assert.equal(f.app.current(f.db,f.cfg,row),false);assert.equal(row.status,'replied');assert.ok(f.tables.Reminders.every(j=>j.status==='cancelled'));
});
test('regular production monitor delivers each short SLA once, with no repeated AI calls',()=>{
 const f=fixture(),cfg={projectId:'wallpanels-gmail-control',sheetId:'fake',serviceAccount:'test@wallpanels-gmail-control.iam.gserviceaccount.com',
  employees:['sales','other','third','fourth','fifth','shared','shared'].map((n,i)=>({id:'e'+i,name:'Owner '+i,email:n+'@wallpanels.com',telegramId:String(10+i)})),
  adminIds:['8','9'],testAdminId:'8',monitorMinutes:1,mailboxPolicies:{'shared@wallpanels.com':{effectiveAt:cut,stages:[5,10,15]}}};
 cfg.employees[0].additionalMailboxes=['shared@wallpanels.com'];
 f.ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='WP_CONFIG_JSON'?JSON.stringify(cfg):k==='WP_PRODUCTION_APPROVED'?'yes':'FAKE'})};
 f.ctx.WpStore={open:()=>f.db};f.ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 let now=cut+300000;f.ctx.Date=class extends Date{static now(){return now;}};
 const row={id:'live',kind:'live',mailbox:'shared@wallpanels.com',messageId:'in',threadId:'thread',receivedAt:cut,status:'awaiting',aiStatus:'complete'};
 f.tables.Emails.push(row);f.states.productionCutoff=cut-1000;
 for(const e of cfg.employees){f.states['gmail:'+e.email]={historyId:'1',baseline:cut-1000,lastSync:cut};f.states['telegramReady:'+e.telegramId]={active:true};}
 for(const id of cfg.adminIds)f.states['telegramReady:'+id]={active:true};
 const source={id:'in',internalDate:String(cut),labelIds:['INBOX'],payload:{headers:[{name:'From',value:'client@example.org'}]}};
 f.ctx.WpApi.gmail=(c,m,path)=>path.startsWith('threads/')?{messages:[source]}:{historyId:'2'};
 for(const minutes of [5,10,15]){now=cut+minutes*60000;const result=f.app.monitor();assert.equal(result.errorCount,0);assert.equal(result.aiPending,0);
  f.app.monitor();assert.equal(f.tables.Reminders.filter(j=>Number(j.stage)===minutes&&j.status==='sent').length,5);}
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,15);assert.equal(row.receivedAt,cut);
 // No extra Gmail work or deliveries on Saturday, even with a one-minute trigger.
 now=Date.parse('2026-10-31T15:00:00Z');f.ctx.WpApi.gmail=()=>{throw Error('NO_WEEKEND_SCAN');};
 assert.equal(f.app.monitor().paused,'outside_working_hours');assert.equal(f.calls.length,15);
});
