/* Operational evidence only. Never include addresses, message text, credentials or recipient IDs. */
var WpAudit = (function () {
  function build(db,c,now,triggers,productionApproved) {
    var campaign=db.state('test247'),emails=db.all('Emails'),jobs=db.all('Reminders'),errors=db.all('Errors');
    var target=campaign && emails.find(function(r){return r.mailbox===campaign.mailbox && r.messageId===campaign.messageId;});
    var selected=campaign?jobs.filter(function(j){return target && j.emailId===target.id &&
      j.id.indexOf(':campaign-'+campaign.id+':')>=0;}):[];
    var evidence=target?db.state('testEvidence:'+target.id)||{}:{},health=db.state('health');
    function age(at) {return at?Math.max(0,Math.floor((now-Number(at))/1000)):null;}
    function duplicates(values) {return values.length-new Set(values).size;}
    function role(job) {var m=/:view-(employee|admin)(?::|$)/.exec(job.id);return m?m[1]:'combined';}
    var numeric=selected.filter(function(j){return j.mode==='test' && [30,60,120].indexOf(Number(j.stage))>=0;});
    return {at:now,mode:db.setting('MODE'),productionApproved:!!productionApproved,
      test247:!!(campaign && campaign.active),startedAt:campaign?campaign.startedAt:null,
      currentStatus:target?target.status:'missing',readObserved:!!evidence.readObserved,sentReplyObserved:!!evidence.sentReplyObserved,
      monitorAgeSeconds:age(db.state('monitorLastSuccess')),updatesAgeSeconds:age(db.state('updatesLastSuccess')),
      totals:{emails:emails.length,awaiting:emails.filter(function(r){return r.status==='awaiting';}).length,
        reminders:jobs.length,sent:jobs.filter(function(j){return j.status==='sent';}).length,
        pending:jobs.filter(function(j){return j.status==='pending';}).length,
        failedOrUnknown:jobs.filter(function(j){return ['failed','unknown'].indexOf(j.status)>=0;}).length,
        unsafeTestRecipients:jobs.filter(function(j){return j.mode==='test' && String(j.recipient)!==String(c.testAdminId);}).length,
        duplicateKeys:duplicates(jobs.map(function(j){return j.id;})),
        duplicateSlaRoles:duplicates(numeric.map(function(j){return j.stage+':'+role(j)+':'+String(j.recipient);}))},
      sla:numeric.map(function(j){var due=Number(campaign.startedAt)+Number(j.stage)*60000;return {
        stage:Number(j.stage),view:role(j),status:j.status,sentAt:j.sentAt||null,dueAt:due,
        delaySeconds:j.sentAt?Math.round((Number(j.sentAt)-due)/1000):null,testAdmin:String(j.recipient)===String(c.testAdminId)};}),
      ai:target?{status:target.aiStatus,category:target.category,summaryPresent:!!target.summary,reasonPresent:!!target.reason,
        summaryRussian:/[А-Яа-яЁё]/.test(target.summary||''),reasonRussian:/[А-Яа-яЁё]/.test(target.reason||'')}:null,
      errors:errors.map(function(e){return {at:e.at,component:/^[a-z-]{1,40}$/.test(e.component)?e.component:'other',
        code:/^[A-Z][A-Z0-9_:.-]{0,90}$/.test(e.code)?e.code:'UNEXPECTED_ERROR',resolved:e.resolved===true};}),
      health:health?{ageSeconds:age(health.at),gmailOk:health.mailboxes.filter(function(m){return m.ok;}).length,
        gmailTotal:health.mailboxes.length,bot:health.bot,ai:health.ai,webhook:health.webhook}:null,
      triggers:triggers.map(function(t){return t.getHandlerFunction();}).filter(function(n){return ['wpMonitor','wpTelegramUpdates'].indexOf(n)>=0;}),
      calendar:{timezone:db.setting('TIMEZONE'),minutes:db.setting('REMINDER_MINUTES'),testSchedule:db.setting('TEST_SCHEDULE')}};
  }
  return {build:build};
})();
if(typeof module!=='undefined') module.exports=WpAudit;
