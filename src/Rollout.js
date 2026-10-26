/* Explicit owner-authorized cutover. Preserve test evidence; never import the old inbox. */
var WpRollout = (function () {
  function activate(db,c,p,operation,profile,triggers) {
    if(!/^[a-z0-9-]{1,60}$/.test(operation)) throw new Error('ROLLOUT_ID');
    var key='productionRollout:'+operation,receipt=db.state(key),mode=db.setting('MODE');
    if(receipt && receipt.phase==='active') {
      if(mode!=='production' || p.getProperty('WP_PRODUCTION_APPROVED')!=='yes') throw new Error('ROLLOUT_ALREADY_COMPLETED');
      return receipt;
    }
    if(['test','paused'].indexOf(mode)<0 && !(mode==='production' && receipt && receipt.phase==='prepared' &&
      db.state('productionCutoff')===receipt.cutoffAt && p.getProperty('WP_PRODUCTION_APPROVED')==='yes')) throw new Error('ROLLOUT_MODE');
    var h=db.state('health');
    if(!h || Date.now()-h.at>3600000 || !h.bot || !h.ai || h.webhook || h.mailboxes.length!==c.mailboxes.length ||
      c.mailboxes.some(function(m){return !h.mailboxes.some(function(x){return x.mailbox===m && x.ok;});})) throw new Error('HEALTH_GATE');
    ['wpMonitor','wpTelegramUpdates'].forEach(function(name){
      if(triggers.filter(function(t){return t.getHandlerFunction()===name;}).length!==1) throw new Error('ROLLOUT_TRIGGERS');
    });
    if(db.all('Reminders').some(function(j){return ['sending','unknown'].indexOf(j.status)>=0;})) throw new Error('ROLLOUT_AMBIGUOUS_DELIVERY');
    if(!receipt) {
      var cursors={},previous={};
      c.mailboxes.forEach(function(m){var r=profile(m);if(r.emailAddress!==m || !r.historyId) throw new Error('ROLLOUT_GMAIL');
        cursors[m]=r.historyId;previous[m]=db.state('gmail:'+m);});
      receipt={phase:'prepared',cutoffAt:Date.now(),cursors:cursors,previousCursors:previous,
        previousCampaign:db.state('test247'),previousMode:mode};
      db.state(key,receipt); // A durable cutoff survives retries and partial writes.
    }
    db.setting('MODE','paused','Production cutover in progress');
    c.mailboxes.forEach(function(m){db.state('gmail:'+m,{historyId:receipt.cursors[m],baseline:receipt.cutoffAt,lastSync:receipt.cutoffAt});});
    db.state('productionCutoff',receipt.cutoffAt);
    var campaign=db.state('test247');
    if(campaign) {campaign.active=false;campaign.stoppedAt=receipt.cutoffAt;campaign.stopReason='production_rollout';db.state('test247',campaign);}
    db.all('Reminders').filter(function(j){return j.mode==='test' && ['pending','waiting_start'].indexOf(j.status)>=0;})
      .forEach(function(j){j.status='cancelled';db.save('Reminders',j);});
    db.all('Emails').filter(function(r){return r.status==='awaiting' && (r.kind==='synthetic' || Number(r.receivedAt)<receipt.cutoffAt);})
      .forEach(function(r){db.state('rolloutArchive:'+operation+':'+r.id,{status:r.status,closedAt:r.closedAt||'',closedBy:r.closedBy||'',closeReason:r.closeReason||''});
        Object.assign(r,{status:'archived_rollout',closedAt:receipt.cutoffAt,closedBy:'system',closeReason:'production_cutover'});db.save('Emails',r);});
    // Only a previously confirmed chat is seeded; everyone else must press Start themselves.
    if(db.all('Reminders').some(function(j){return j.status==='sent' && String(j.recipient)===String(c.testAdminId);}))
      db.state('telegramReady:'+c.testAdminId,{active:true,at:receipt.cutoffAt,source:'confirmed_test_delivery'});
    var raw=JSON.parse(p.getProperty('WP_CONFIG_JSON'));
    if(raw.testEmployee) {raw.testEmployee.role='admin_employee';p.setProperty('WP_CONFIG_JSON',JSON.stringify(raw));
      var owner=db.all('Employees').find(function(e){return e.id===raw.testEmployee.id;});
      if(owner) {owner.role='admin_employee';db.save('Employees',owner);}}
    p.deleteProperty('WP_TEST247_ACTIVE');p.setProperty('WP_PRODUCTION_APPROVED','yes');
    db.setting('TEST_SCHEDULE','disabled','Production Mon–Fri 09:00–19:00 America/New_York');
    db.setting('TIMEZONE','America/New_York','Weekdays 09:00–19:00');db.setting('REMINDER_MINUTES','30,60,120','Cumulative business minutes');
    db.setting('MODE','production','Explicit owner authorization');
    receipt.phase='active';receipt.activatedAt=Date.now();db.state(key,receipt);return receipt;
  }
  function release(db,user) {
    var jobs=db.all('Reminders').filter(function(j){return j.mode==='production' && String(j.recipient)===String(user) && ['pending','waiting_start'].indexOf(j.status)>=0;});
    var latest={};
    jobs.forEach(function(j){var group=j.emailId+':'+(Number.isInteger(Number(j.stage)) && Number(j.stage)>0?'sla':j.stage);
      if(!latest[group] || Number(j.stage)>=Number(latest[group].stage) || j.stage==='manual') latest[group]=j;});
    jobs.forEach(function(j){var group=j.emailId+':'+(Number.isInteger(Number(j.stage)) && Number(j.stage)>0?'sla':j.stage);
      j.status=latest[group]===j?'pending':'superseded';db.save('Reminders',j);});
  }
  return {activate:activate,release:release};
})();
if(typeof module!=='undefined') module.exports=WpRollout;
