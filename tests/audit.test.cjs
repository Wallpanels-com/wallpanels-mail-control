const {test}=require('node:test');
const assert=require('node:assert/strict');
const Audit=require('../src/Audit.js');
test('acceptance audit reconciles six role deliveries and never exports private content',()=>{
 const epoch=100000,c={testAdminId:3};
 const emails=[{id:'row',mailbox:'private@example.org',messageId:'private-message',status:'awaiting',aiStatus:'complete',category:'customer',summary:'Секретная тема',reason:'Ответ нужен'}];
 const reminders=[30,60,120].flatMap(stage=>['employee','admin'].map(view=>({id:'row:'+stage+':campaign-test:view-'+view,emailId:'row',stage,mode:'test',recipient:'3',status:'sent',sentAt:epoch+stage*60000+5000})));
 const states={test247:{id:'test',mailbox:'private@example.org',messageId:'private-message',active:true,startedAt:epoch},
  'testEvidence:row':{readObserved:true},monitorLastSuccess:7300000,updatesLastSuccess:7350000};
 const db={all:n=>({Emails:emails,Reminders:reminders,Errors:[]})[n],state:k=>states[k],setting:k=>({MODE:'test',TIMEZONE:'America/New_York',REMINDER_MINUTES:'30,60,120',TEST_SCHEDULE:'24/7'})[k]};
 const r=Audit.build(db,c,7360000,[{getHandlerFunction:()=> 'wpMonitor'},{getHandlerFunction:()=> 'wpTelegramUpdates'}],false);
 assert.equal(r.sla.length,6);assert.ok(r.sla.every(j=>j.delaySeconds===5 && j.testAdmin));
 assert.equal(r.totals.duplicateSlaRoles,0);assert.equal(r.totals.unsafeTestRecipients,0);assert.equal(r.productionApproved,false);
 assert.equal(r.monitorAgeSeconds,60);assert.equal(r.readObserved,true);
 const json=JSON.stringify(r);for(const value of ['private@example.org','private-message','Секретная тема'])assert.ok(!json.includes(value));
 reminders.push({...reminders[0],recipient:'99'});const broken=Audit.build(db,c,7360000,[],false);
 assert.equal(broken.totals.unsafeTestRecipients,1);assert.equal(broken.totals.duplicateKeys,1);
});
