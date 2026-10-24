const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../src/Rollout.js'),C=require('../src/Core.js');
function fixture(){
 const c={mailboxes:['one@example.com','owner@example.com'],employees:[{id:'one',email:'one@example.com',telegramId:1},{id:'owner',email:'owner@example.com',telegramId:3}],adminIds:[3,4],testAdminId:3,testEmployee:{id:'owner',email:'owner@example.com',telegramId:3,role:'admin_test'}};
 const tables={Emails:[{id:'test',kind:'live',status:'awaiting',receivedAt:1}],Reminders:[{id:'test-sent',mode:'test',status:'sent',recipient:'3'},{id:'test-pending',mode:'test',status:'pending'}],Employees:[{id:'owner',role:'admin_test'}]};
 const states={test247:{active:true,startedAt:1},health:{at:Date.now(),bot:true,ai:true,webhook:false,mailboxes:c.mailboxes.map(mailbox=>({mailbox,ok:true}))}},settings={MODE:'test'};
 const props={WP_CONFIG_JSON:JSON.stringify(c),WP_TEST247_ACTIVE:'yes'};
 const db={all:n=>tables[n],save:(n,o)=>o,state:(k,...v)=>v.length?(states[k]=JSON.parse(JSON.stringify(v[0]))):structuredClone(states[k]),setting:(k,...v)=>v.length?(settings[k]=v[0]):settings[k]};
 const p={getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]};
 const profile=m=>({emailAddress:m,historyId:'123'}),triggers=['wpMonitor','wpTelegramUpdates'].map(n=>({getHandlerFunction:()=>n}));
 return {c,tables,states,settings,props,db,p,profile,triggers,run(){return R.activate(db,c,p,'launch',profile,triggers);}};
}
test('production activation stops test, promotes owner, preserves evidence and snapshots a fresh baseline',()=>{
 const f=fixture(),r=f.run();assert.equal(r.phase,'active');assert.equal(f.settings.MODE,'production');assert.equal(f.props.WP_PRODUCTION_APPROVED,'yes');
 assert.equal(f.props.WP_TEST247_ACTIVE,undefined);assert.equal(f.states.test247.active,false);assert.equal(f.states.test247.startedAt,1);
 assert.equal(f.tables.Reminders[0].status,'sent');assert.equal(f.tables.Reminders[1].status,'cancelled');assert.equal(f.tables.Emails[0].status,'archived_rollout');
 assert.equal(f.states['productionRollout:launch'].previousCampaign.active,true);
 for(const m of f.c.mailboxes){assert.equal(f.states['gmail:'+m].historyId,'123');assert.equal(f.states['gmail:'+m].baseline,r.cutoffAt);}
 assert.equal(JSON.parse(f.props.WP_CONFIG_JSON).testEmployee.role,'admin_employee');assert.equal(f.tables.Employees[0].role,'admin_employee');
 assert.equal(f.states['telegramReady:3'].active,true);assert.equal(f.states['telegramReady:1'],undefined);
 const before=JSON.stringify(f.states);f.run();assert.equal(JSON.stringify(f.states),before);
});
test('bad Gmail preflight cannot enable production or change cursors',()=>{
 const f=fixture();assert.throws(()=>R.activate(f.db,f.c,f.p,'launch',()=>({emailAddress:'wrong',historyId:'1'}),f.triggers),/ROLLOUT_GMAIL/);
 assert.equal(f.settings.MODE,'test');assert.equal(f.props.WP_PRODUCTION_APPROVED,undefined);assert.equal(f.states.productionCutoff,undefined);
});
test('old activation receipt cannot silently resume a deliberately paused production system',()=>{
 const f=fixture();f.run();f.settings.MODE='paused';assert.throws(()=>f.run(),/ROLLOUT_ALREADY_COMPLETED/);assert.equal(f.settings.MODE,'paused');
});
test('activation refuses unhealthy APIs, missing triggers and ambiguous deliveries',()=>{
 for(const kind of ['health','triggers','unknown']){
  const f=fixture();if(kind==='health')f.states.health.ai=false;if(kind==='triggers')f.triggers.pop();if(kind==='unknown')f.tables.Reminders[0].status='unknown';
  assert.throws(()=>f.run(),/HEALTH_GATE|ROLLOUT_TRIGGERS|ROLLOUT_AMBIGUOUS_DELIVERY/);assert.equal(f.settings.MODE,'test');
 }
});
test('cutover resumes a partial write without moving its durable cutoff',()=>{
 const f=fixture(),original=f.db.setting;let interrupted=false;
 f.db.setting=(k,...v)=>{const result=original(k,...v);if(k==='MODE'&&v[0]==='production'&&!interrupted){interrupted=true;throw Error('INTERRUPTED');}return result;};
 assert.throws(()=>f.run(),/INTERRUPTED/);const cutoff=f.states.productionCutoff;
 assert.equal(f.states['productionRollout:launch'].phase,'prepared');f.run();assert.equal(f.states.productionCutoff,cutoff);assert.equal(f.states['productionRollout:launch'].phase,'active');
});
test('Start releases only that user and only the latest held SLA stage, never already sent cards',()=>{
 const f=fixture();f.tables.Reminders=[30,60,120].map(stage=>({id:'x'+stage,mode:'production',recipient:'1',emailId:'mail',stage,status:'waiting_start'}));
 f.tables.Reminders.push({id:'other',mode:'production',recipient:'2',emailId:'mail',stage:30,status:'waiting_start'},{id:'sent',mode:'production',recipient:'1',emailId:'mail',stage:30,status:'sent'});
 R.release(f.db,'1');assert.deepEqual(f.tables.Reminders.map(j=>j.status),['superseded','superseded','pending','waiting_start','sent']);
});
test('employee-only routing, two admins, shared PM ownership and owner-admin dedup all stay exact',()=>{
 const f=fixture();assert.deepEqual(C.recipients(f.c,'one@example.com','production'),['1','3','4']);assert.deepEqual(C.recipients(f.c,'owner@example.com','production'),['3','4']);
 f.c.employees.push({email:'one@example.com',telegramId:2});assert.deepEqual(C.recipients(f.c,'one@example.com','production'),['1','2','3','4']);
});
