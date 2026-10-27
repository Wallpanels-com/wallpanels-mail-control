const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/Core.js'),R=require('../src/Rollout.js'),M=require('../src/Messages.js'),T=require('../src/TestCampaign.js');
const pm='pm@wallpanels.com',start=Date.parse('2026-10-27T14:00:00Z');
function fixture(){
 const cfg={projectId:'wallpanels-gmail-control',sheetId:'fake',serviceAccount:'test@wallpanels-gmail-control.iam.gserviceaccount.com',
  employeeCount:9,employeeMailboxCount:7,employees:['sales','pm','pm','pm','other','third','fourth','fifth','sixth'].map((s,i)=>
   ({id:'e'+i,name:'Owner '+(i+1),email:s+'@wallpanels.com',telegramId:String(i+1),enabled:true})),
  adminIds:['80','90'],testAdminId:'80',token:'FAKE',groq:'FAKE',mailboxPolicies:{[pm]:{effectiveAt:start,stages:[5,10,15]}}};
 cfg.employees[0].additionalMailboxes=[pm];
 const tables={Emails:[],Reminders:[],Errors:[],Employees:[]},states={productionCutoff:start-1000},calls=[];
 const db={all:n=>tables[n],save:(n,o)=>{if(!tables[n].includes(o))tables[n].push(o);return o;},
  state:(k,...v)=>v.length?(states[k]=v[0]):states[k],setting:()=> 'production'};
 let now=start+300000,updates=[],serial=0,analyses=0;
 const source={id:'123456abcdef1',internalDate:String(start),labelIds:['INBOX'],payload:{headers:[
  {name:'From',value:'client@example.org'},{name:'Message-ID',value:'<incoming-1>'}]}};
 let thread=[source];
 const api={gmail:(c,m,path)=>path.startsWith('threads/')?{messages:thread}:{historyId:'2'},
  telegram:(token,method,payload)=>{if(method==='getUpdates')return updates;calls.push({method,payload});return {message_id:100+calls.length};},
  analyze:()=>{analyses++;return {requires_reply:true,category:'customer',summary:'Запрос',reason:'Нужен ответ'};}};
 const ctx=vm.createContext({console:{log:()=>{}},WpCore:C,WpRollout:R,WpMessages:M,WpTest:T,WpApi:api,WpStore:{open:()=>db},Intl,
  Date:class extends Date{static now(){return now;}},Utilities:{getUuid:()=>String(++serial).padStart(32,'0')},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='WP_CONFIG_JSON'?JSON.stringify(cfg):k==='WP_PRODUCTION_APPROVED'?'yes':'FAKE'})}});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),ctx);
 const row={id:'a'.repeat(20),key:C.eventKey(pm,source.id),kind:'live',mailbox:pm,messageId:source.id,threadId:'thread',
  receivedAt:start,status:'awaiting',aiStatus:'complete'};tables.Emails.push(row);
 for(const e of cfg.employees){states['gmail:'+e.email]={historyId:'1',baseline:start-1000,lastSync:start};states['telegramReady:'+e.telegramId]={active:true};}
 for(const id of cfg.adminIds)states['telegramReady:'+id]={active:true};
 const f={cfg,tables,states,calls,db,ctx,row,source,api,app:ctx.WpApp,setTime:n=>{now=n;},setThread:t=>{thread=t;},analyses:()=>analyses,
  update:u=>{updates=[u];const result=f.app.updates();updates=[];return result;}};
 f.prove=(user,r=row)=>{
  f.app.queue(db,cfg,r,5,'production');
  for(const j of tables.Reminders.filter(j=>j.emailId===r.id&&j.stage===5))Object.assign(j,{status:'sent',telegramMessageId:44,sentAt:now});
  return {callback_query:{id:'click-'+(++serial),from:{id:Number(user)},data:'n:'+r.id,message:{message_id:44,chat:{id:Number(user),type:'private'}}}};
 };
 f.click=(user,r=row)=>f.update(f.prove(user,r));
 return f;
}
function recipients(f,stage,row=f.row){return f.tables.Reminders.filter(j=>j.emailId===row.id&&j.stage===stage&&j.status==='sent').map(j=>j.recipient).sort();}
test('each of the four PMs can dismiss only their own current incoming and unsent jobs',()=>{
 for(const user of ['1','2','3','4']){
  const f=fixture(),click=f.prove(user);
  f.app.queue(f.db,f.cfg,f.row,10,'production');
  for(const j of f.tables.Reminders.filter(j=>j.stage===10))Object.assign(j,{status:'waiting_start',nextAttemptAt:start+999999});
  const before=f.tables.Reminders.find(j=>j.recipient===user&&j.stage===5);
  const result=f.update(click);assert.equal(result.ok,true);assert.equal(result.handled,1);
  assert.equal(f.row.status,'awaiting');assert.equal(before.status,'sent');
  assert.equal(f.tables.Reminders.find(j=>j.recipient===user&&j.stage===10).error,'DISMISSED_BY_RECIPIENT');
  assert.ok(f.tables.Reminders.filter(j=>j.recipient!==user&&j.stage===10).every(j=>j.status==='pending'));
  assert.equal(f.states['recipientDismissal:production:'+f.row.id+':'+user].messageId,f.source.id);
  assert.ok(f.calls.find(c=>c.method==='answerCallbackQuery').payload.text.includes('только для вас'));
  const saved=JSON.stringify(f.states['recipientDismissal:production:'+f.row.id+':'+user]);
  f.update(click);assert.equal(JSON.stringify(f.states['recipientDismissal:production:'+f.row.id+':'+user]),saved);
 }
});
test('two dismissals survive repeated 10/15-minute monitoring while other PMs and admins continue',()=>{
 const f=fixture();f.click('3');f.click('1');
 for(const minutes of [10,15]){
  f.setTime(start+minutes*60000);f.app.monitor();f.app.monitor();
  assert.deepEqual(recipients(f,minutes),['2','4','80','90']);
 }
 assert.equal(f.row.status,'awaiting');assert.equal(f.analyses(),0);assert.equal(f.tables.Errors.length,0);
 const card=f.calls.find(c=>c.method==='sendMessage'&&c.payload.chat_id==='2').payload;
 assert.ok(card.text.includes('только вам'));assert.ok(card.reply_markup.inline_keyboard.flat().some(b=>b.text==='No Reply Needed'));
});
test('Send Reminder skips dismissed PMs and does not bypass all four dismissals',()=>{
 const f=fixture();f.click('3');f.click('1');
 const manual=()=>({callback_query:{...f.prove('80').callback_query,id:'manual-'+f.calls.length,data:'r:'+f.row.id}});
 f.update(manual());assert.deepEqual(recipients(f,'manual'),['2','4']);
 f.click('2');f.click('4');f.setTime(start+900000);f.app.monitor();f.app.monitor();
 assert.deepEqual(recipients(f,15),['80','90']);assert.equal(f.row.status,'awaiting');
 const n=f.tables.Reminders.length;f.update(manual());assert.equal(f.tables.Reminders.length,n);
 assert.ok(f.calls.filter(c=>c.method==='answerCallbackQuery').at(-1).payload.text.includes('Все сотрудники'));
});
test('sent Gmail reply closes for everyone and a subsequent incoming in the same thread starts unmuted',()=>{
 const f=fixture();f.click('3');f.click('1');f.app.queue(f.db,f.cfg,f.row,10,'production');
 const reply={id:'sent',internalDate:String(start+360000),labelIds:['SENT'],payload:{headers:[
  {name:'To',value:'client@example.org'},{name:'In-Reply-To',value:'<incoming-1>'}]}};
 f.setThread([f.source,reply]);assert.equal(f.app.current(f.db,f.cfg,f.row),false);
 assert.equal(f.row.status,'replied');assert.ok(f.tables.Reminders.filter(j=>j.stage===10).every(j=>j.status==='cancelled'));
 const next={...f.source,id:'123456abcdef2',internalDate:String(start+420000),payload:{headers:[
  {name:'From',value:'client@example.org'},{name:'Message-ID',value:'<incoming-2>'}]}};
 f.setThread([f.source,reply,next]);f.app.reconcile(f.db,f.cfg,pm,'thread',start-1000);
 const row=f.tables.Emails.find(r=>r.messageId===next.id);assert.ok(row);assert.notEqual(row.id,f.row.id);assert.equal(row.status,'awaiting');
 f.setTime(start+720000);f.app.monitor();f.app.monitor();
 assert.deepEqual(recipients(f,5,row),['1','2','3','4','80','90']);assert.equal(f.analyses(),1);
});
test('persisted dismissal survives a new runtime and blocks held jobs released by Start',()=>{
 const f=fixture();f.click('3');
 f.tables.Reminders.push({id:'late-held',emailId:f.row.id,stage:10,recipient:'3',mode:'production',status:'waiting_start'});
 vm.runInContext(fs.readFileSync('src/App.js','utf8'),f.ctx);f.app=f.ctx.WpApp;
 f.update({update_id:91,message:{from:{id:3},chat:{id:3,type:'private'},text:'/start'}});
 assert.ok(f.calls.at(-1).payload.text.includes('только вам'));
 f.setTime(start+600000);f.app.monitor();
 assert.equal(f.tables.Reminders.find(j=>j.id==='late-held').status,'cancelled');
 assert.ok(!f.tables.Reminders.some(j=>j.recipient==='3'&&j.stage===10&&j.status==='sent'));
});
test('new same-thread incoming is unmuted even while the older unanswered incoming remains personally dismissed',()=>{
 const f=fixture();f.click('3');f.click('1');
 const next={...f.source,id:'123456abcdef3',internalDate:String(start+360000)};
 f.setThread([f.source,next]);f.app.reconcile(f.db,f.cfg,pm,'thread',start-1000);
 const row=f.tables.Emails.find(r=>r.messageId===next.id);assert.equal(f.row.status,'awaiting');assert.equal(row.status,'awaiting');
 f.setTime(start+660000);f.app.monitor();f.app.monitor();
 assert.deepEqual(recipients(f,5,row),['1','2','3','4','80','90']);
 assert.deepEqual(recipients(f,10),['2','4','80','90']);
});
test('personal dismissal cancels manual and SLA holds but preserves sent and ambiguous receipts and other modes',()=>{
 const f=fixture(),click=f.prove('3');
 for(const [id,status,stage,mode] of [['held','waiting_start',10,'production'],['manual','pending','manual','production'],
  ['unknown','unknown',15,'production'],['test','pending',30,'test']])
  f.tables.Reminders.push({id,emailId:f.row.id,recipient:'3',status,stage,mode});
 f.update(click);
 assert.deepEqual(f.tables.Reminders.filter(j=>['held','manual','unknown','test'].includes(j.id)).map(j=>j.status),
  ['cancelled','cancelled','unknown','pending']);
 assert.equal(f.tables.Reminders.find(j=>j.recipient==='3'&&j.stage===5).status,'sent');
});
test('foreign employee and forged callback cannot dismiss another PM or close shared mail',()=>{
 const f=fixture(),click=f.prove('3');click.callback_query.from.id=5;click.callback_query.message.chat.id=5;f.update(click);
 assert.equal(f.row.status,'awaiting');assert.equal(Object.keys(f.states).filter(k=>k.startsWith('recipientDismissal:')).length,0);
 click.callback_query.from.id=3;click.callback_query.message.chat.id=3;click.callback_query.message.message_id=999;f.update(click);
 assert.equal(Object.keys(f.states).filter(k=>k.startsWith('recipientDismissal:')).length,0);
});
test('dual owner dismissal on PM does not alter their personal mailbox global closure',()=>{
 const f=fixture();f.click('1');const row={...f.row,id:'b'.repeat(20),mailbox:'sales@wallpanels.com'};f.tables.Emails.push(row);
 f.click('1',row);assert.equal(row.status,'no_reply_needed');assert.equal(f.row.status,'awaiting');
 assert.equal(f.states['recipientDismissal:production:'+row.id+':1'],undefined);
});
test('PM-specific behavior leaves administrator-only test-mode closure intact',()=>{
 const f=fixture();f.db.setting=()=> 'test';f.app.queue(f.db,f.cfg,f.row,30,'test');
 const j=f.tables.Reminders.find(j=>j.mode==='test');Object.assign(j,{status:'sent',telegramMessageId:44});
 const click=f.prove('80');click.callback_query.data='n:'+f.row.id;
 f.app.handle(f.db,f.cfg,click,'test');assert.equal(f.row.status,'no_reply_needed');
 assert.equal(Object.keys(f.states).filter(k=>k.startsWith('recipientDismissal:')).length,0);
});
