var WpApp = (function () {
  'use strict';
  var jobStart=0, aiCalls=0;
  function config() {
    var p=PropertiesService.getScriptProperties(), raw=p.getProperty('WP_CONFIG_JSON');
    if(!raw) throw new Error('CONFIG_MISSING');
    var c=JSON.parse(raw);
    if(c.projectId!=='wallpanels-gmail-control' || !c.sheetId || !c.serviceAccount ||
      !c.serviceAccount.endsWith('@wallpanels-gmail-control.iam.gserviceaccount.com')) throw new Error('CONFIG_SCOPE');
    if(!Array.isArray(c.employees) || c.employees.length!==7 || c.adminIds.length!==2) throw new Error('CONFIG_ROSTER');
    var expectedMailboxCount=6;
    if(c.testEmployee) {
      if(c.testEmployee.role!=='admin_test' || String(c.testEmployee.telegramId)!==String(c.testAdminId) ||
        c.employees.some(function(e){return e.email===c.testEmployee.email || e.id===c.testEmployee.id;})) throw new Error('CONFIG_TEST_OWNER');
      c.employees=c.employees.concat([c.testEmployee]); expectedMailboxCount++;
    }
    c.mailboxes=Array.from(new Set(c.employees.map(function(e){return e.email;})));
    if(c.mailboxes.length!==expectedMailboxCount || c.mailboxes.some(function(m){return !/^[a-z][a-z0-9.]*@wallpanels\.com$/.test(m);})) throw new Error('CONFIG_MAILBOXES');
    if(c.adminIds.some(function(id){return c.employees.some(function(e){return String(e.telegramId)===String(id) && e.role!=='admin_test';});})) throw new Error('CONFIG_ADMIN_OVERLAP');
    if(c.adminIds.map(String).indexOf(String(c.testAdminId))<0) throw new Error('CONFIG_TEST_ADMIN');
    c.token=p.getProperty('TELEGRAM_BOT_TOKEN'); c.groq=p.getProperty('GROQ_API_KEY');
    if(!c.token || !c.groq) throw new Error('SECRET_PROPERTY_MISSING');
    return c;
  }
  function budget(limit) {return Date.now()-jobStart < (limit||240000);}
  function ack(c,cb,text) {
    try {WpApi.telegram(c.token,'answerCallbackQuery',{callback_query_id:cb.id,text:text});}
    catch(e) {if(e.code!==400) throw e;} // Expired callback acknowledgements must never poison the polling offset.
  }
  function id() {return Utilities.getUuid().replace(/-/g,'').slice(0,20);}
  function locked(action) {
    var lock=LockService.getScriptLock(); if(!lock.tryLock(1000)) return {skipped:'locked'};
    jobStart=Date.now(); aiCalls=0;
    try {return action();} finally {lock.releaseLock();}
  }
  function error(db,component,e,ref) {
    var code=/^[A-Z][A-Z0-9_:.-]{0,90}$/.test(e.message||'')?e.message:'UNEXPECTED_ERROR';
    db.save('Errors',{id:id(),at:Date.now(),component:component,code:code,reference:ref||'',resolved:false});
  }
  function close(db,row,status,by,reason) {
    Object.assign(row,{status:status,closedAt:Date.now(),closedBy:String(by||'system'),closeReason:reason,updatedAt:Date.now()});
    db.save('Emails',row);
  }
  function analyze(db,c,row,messages,source) {
    if(row.aiStatus==='complete' || +row.nextAiAt>Date.now() || aiCalls>=3 || !budget()) return;
    aiCalls++;
    try {
      var v=WpApi.analyze(messages,source,c.groq);
      Object.assign(row,{aiStatus:'complete',category:v.category,summary:v.summary,reason:v.reason,updatedAt:Date.now()});
      if(!v.requires_reply) close(db,row,'not_required','ai',v.reason);
      else db.save('Emails',row);
    } catch(e) {
      row.aiAttempts=Number(row.aiAttempts||0)+1;
      row.aiStatus='pending'; row.nextAiAt=Date.now()+Math.max(60000,Math.min(3600000,60000*Math.pow(2,row.aiAttempts)));
      row.summary='AI временно недоступен: требуется проверка сотрудником.';
      db.save('Emails',row); error(db,'ai',e,row.id);
    }
  }
  function reconcile(db,c,mailbox,threadId,baseline) {
    var thread=WpApi.gmail(c,mailbox,'threads/'+encodeURIComponent(threadId),{format:'full'});
    var msgs=(thread.messages||[]).sort(function(a,b){return +a.internalDate-+b.internalDate;});
    var rows=db.all('Emails'), changed=0;
    msgs.filter(function(m){return +m.internalDate>=baseline && WpCore.incoming(m,[mailbox]);}).forEach(function(m){
      var key=WpCore.eventKey(mailbox,m.id), row=rows.find(function(r){return r.key===key;});
      if(!row) {
        row={id:id(),key:key,kind:'live',mailbox:mailbox,messageId:m.id,threadId:threadId,
          sender:WpCore.header(m,'From').slice(0,250),subject:WpCore.header(m,'Subject').slice(0,300),receivedAt:+m.internalDate,
          status:'awaiting',aiStatus:'pending',summary:'Ожидает AI-проверки.',updatedAt:Date.now(),aiAttempts:0};
        db.save('Emails',row); changed++;
      }
      if(row.status!=='awaiting') return;
      if(WpCore.replied(msgs,m)) close(db,row,'replied','system','sent_reply');
      else analyze(db,c,row,msgs,m);
    });
    return changed;
  }
  function sync(db,c,mailbox) {
    var key='gmail:'+mailbox, state=db.state(key), now=Date.now();
    if(!state) {
      // Snapshot current history BEFORE setting the baseline. Never enumerate old inbox mail on first run.
      var profile=WpApi.gmail(c,mailbox,'profile');
      db.state(key,{historyId:profile.historyId,baseline:now,lastSync:now}); return;
    }
    if(state.recovery) {recover(db,c,mailbox,state); return;}
    var page=state.pageToken||'', finished=false;
    while(budget(150000) && !finished) {
      var result;
      try {result=WpApi.gmail(c,mailbox,'history',{startHistoryId:state.historyId,pageToken:page,maxResults:100});}
      catch(e) {
        if(e.code!==404) throw e;
        state.recovery={after:Math.max(state.baseline,(state.lastSync||state.baseline)-3600000),snapshot:WpApi.gmail(c,mailbox,'profile').historyId};
        delete state.pageToken; db.state(key,state); recover(db,c,mailbox,state); return;
      }
      var threads={};
      (result.history||[]).forEach(function(h){
        (h.messagesAdded||[]).forEach(function(a){threads[a.message.threadId]=true;});
        (h.labelsAdded||[]).forEach(function(a){if((a.labelIds||[]).indexOf('SENT')>=0) threads[a.message.threadId]=true;});
      });
      var ids=Object.keys(threads);
      for(var j=0;j<ids.length;j++) {
        if(!budget(150000)) return; // Replay this page on retry. Per-message keys make it idempotent.
        reconcile(db,c,mailbox,ids[j],state.baseline);
      }
      page=result.nextPageToken||'';
      if(page) {state.pageToken=page; db.state(key,state);}
      else {state.historyId=result.historyId; delete state.pageToken;state.lastSync=now;db.state(key,state);finished=true;}
    }
  }
  function recover(db,c,mailbox,state) {
    var rec=state.recovery;
    while(budget(150000)) {
      var page=WpApi.gmail(c,mailbox,'messages',{q:'after:'+Math.floor(rec.after/1000),pageToken:rec.pageToken||'',maxResults:50});
      var threads=Array.from(new Set((page.messages||[]).map(function(m){return m.threadId;})));
      for(var i=0;i<threads.length;i++) {if(!budget(150000)) return;reconcile(db,c,mailbox,threads[i],state.baseline);}
      if(page.nextPageToken) {rec.pageToken=page.nextPageToken;db.state('gmail:'+mailbox,state);}
      else {
        state.historyId=rec.snapshot; state.lastSync=Date.now(); delete state.recovery; db.state('gmail:'+mailbox,state);return;
      }
    }
  }
  function current(db,c,row) {
    if(row.status!=='awaiting') return false;
    if(row.kind==='synthetic') return true;
    var thread;
    try {thread=WpApi.gmail(c,row.mailbox,'threads/'+encodeURIComponent(row.threadId),{format:'metadata'});}
    catch(e) {if(e.code===404) {close(db,row,'unavailable','system','gmail_deleted');return false;} throw e;}
    var source=(thread.messages||[]).find(function(m){return m.id===row.messageId;});
    if(!source) {close(db,row,'unavailable','system','message_missing'); return false;}
    if(WpCore.replied(thread.messages||[],source)) {close(db,row,'replied','system','sent_reply');return false;}
    return true;
  }
  function keyboard(c,row,recipient,mode) {
    var admin=c.adminIds.map(String).indexOf(String(recipient))>=0;
    var result=[[{text:'Open Gmail',url:WpCore.gmailUrl(row.mailbox,row.threadId)}]];
    if(!admin || WpCore.authorized(c,recipient,row.mailbox) || mode==='test') result.push([{text:'No Reply Needed',callback_data:'n:'+row.id}]);
    if(admin) {
      c.employees.filter(function(e){return e.email===row.mailbox;}).forEach(function(e){
        result.push([{text:'Chat with '+e.name,url:e.username?'https://t.me/'+e.username.replace(/^@/,''):'tg://user?id='+e.telegramId}]);
      });
      result.push([{text:'Send Reminder',callback_data:'r:'+row.id}]);
    }
    return {inline_keyboard:result};
  }
  function queue(db,c,row,stage,mode,suffix,onlyEmployees) {
    var recipients=onlyEmployees?c.employees.filter(function(e){return e.email===row.mailbox;}).map(function(e){return String(e.telegramId);}):WpCore.recipients(c,row.mailbox,mode);
    if(mode==='test') recipients=[String(c.testAdminId)];
    recipients.forEach(function(to){
      var key=row.id+':'+stage+':'+to+':'+mode+(suffix?':'+suffix:'');
      if(db.all('Reminders').some(function(r){return r.id===key;})) return;
      db.save('Reminders',{id:key,emailId:row.id,stage:stage,recipient:to,mode:mode,status:'pending'});
    });
  }
  function dispatch(db,c,mode) {
    var jobs=db.all('Reminders');
    for(var i=0;i<jobs.length && budget();i++) {
      var job=jobs[i];
      if(job.mode!==mode || job.status!=='pending' || +job.nextAttemptAt>Date.now()) continue;
      var row=db.all('Emails').find(function(e){return e.id===job.emailId;});
      if(row && row.kind!=='synthetic' && [30,60,120].indexOf(Number(job.stage))>=0 && !WpCore.isWorking(Date.now())) continue;
      if(!row || !current(db,c,row) || (mode==='production' && row.kind==='synthetic')) {
        job.status='cancelled';db.save('Reminders',job);continue;
      }
      var elapsed=Math.floor(WpCore.businessMinutes(row.receivedAt,Date.now()));
      var text=(mode==='test'?'[TEST — только администратор]\n':'')+'WallPanels Mail Control\n'+row.mailbox+'\n'+
        'Ожидание: '+elapsed+' рабочих мин. Этап: '+job.stage+'\nОт: '+row.sender+'\nТема: '+row.subject+'\n'+row.summary+'\n'+(row.reason||'');
      job.status='sending';job.attemptAt=Date.now();db.save('Reminders',job);
      try {
        var sent=WpApi.telegram(c.token,'sendMessage',{chat_id:String(job.recipient),text:text.slice(0,3500),
          reply_markup:keyboard(c,row,job.recipient,mode),link_preview_options:{is_disabled:true}});
        job.status='sent';job.sentAt=Date.now();job.telegramMessageId=sent.message_id;db.save('Reminders',job);
      } catch(e) {
        // Telegram has no idempotency key. Ambiguous sends must not be blindly repeated.
        job.status=e.code===429?'pending':(e.code>=400 && e.code<500?'failed':'unknown');
        job.nextAttemptAt=Date.now()+Math.max(60000,Number(e.retryAfter||60)*1000);
        job.error=e.code?'HTTP_'+e.code:'DELIVERY_UNKNOWN';db.save('Reminders',job);error(db,'telegram',e,job.id);
      }
    }
  }
  function monitor() {return locked(function(){
    var c=config(),db=WpStore.open(c.sheetId),mode=db.setting('MODE');
    if(mode==='production' && PropertiesService.getScriptProperties().getProperty('WP_PRODUCTION_APPROVED')!=='yes') throw new Error('PRODUCTION_NOT_APPROVED');
    if(['test','production'].indexOf(mode)<0) return {paused:true};
    db.all('Reminders').filter(function(r){return r.status==='sending' && +r.attemptAt<Date.now()-360000;}).forEach(function(r){
      r.status='unknown';r.error='INTERRUPTED_SEND';db.save('Reminders',r);error(db,'outbox',new Error('DELIVERY_UNKNOWN'),r.id);
    });
    var turn=Number(db.state('mailboxRotation')||0);
    for(var i=0;i<c.mailboxes.length && budget(150000);i++) {
      var mailbox=c.mailboxes[(turn+i)%c.mailboxes.length];
      try {sync(db,c,mailbox);} catch(e){error(db,'gmail-sync',e,mailbox);}
    }
    db.state('mailboxRotation',(turn+1)%c.mailboxes.length);
    var open=db.all('Emails').filter(function(r){return r.status==='awaiting' && r.kind!=='synthetic';});
    var rotation=Number(db.state('openRotation')||0),visited=0;
    for(var j=0;j<open.length && budget(200000);j++) {
      var row=open[(rotation+j)%open.length];visited++;
      try {
        if(!current(db,c,row)) continue;
        if(row.aiStatus!=='complete' && Number(row.nextAiAt||0)<=Date.now() && aiCalls<3) {
          var t=WpApi.gmail(c,row.mailbox,'threads/'+row.threadId,{format:'full'});
          var source=t.messages.find(function(m){return m.id===row.messageId;});
          if(source) analyze(db,c,row,t.messages,source);
        }
        if(row.status!=='awaiting') continue;
        var stages=db.all('Reminders').filter(function(r){return r.emailId===row.id && r.mode===mode && ['cancelled'].indexOf(r.status)<0;}).map(function(r){return +r.stage;});
        Array.from(new Set(stages.filter(function(n){return [30,60,120].indexOf(n)>=0;}))).forEach(function(n){queue(db,c,row,n,mode);});
        var due=WpCore.dueStage(row.receivedAt,Date.now(),stages);
        if(due) queue(db,c,row,due,mode);
      } catch(e){error(db,'reconcile',e,row.id);}
    }
    if(open.length) db.state('openRotation',(rotation+visited)%open.length);
    if(WpCore.isWorking(Date.now())) dispatch(db,c,mode);
    db.state('monitorLastSuccess',Date.now());return {ok:true,mode:mode,mailboxes:c.mailboxes.length,active:open.length};
  });}
  function handle(db,c,update,mode) {
    if(!update.callback_query) return;
    var cb=update.callback_query,user=String(cb.from.id), msg=cb.message;
    var match=/^([nr]):([a-f0-9]{20})$/.exec(cb.data||'');
    if(!match || !msg || msg.chat.type!=='private' || String(msg.chat.id)!==user) return;
    var row=db.all('Emails').find(function(r){return r.id===match[2];});
    var admin=c.adminIds.map(String).indexOf(user)>=0;
    var proof=db.all('Reminders').some(function(r){return r.emailId===match[2] && String(r.recipient)===user &&
      String(r.telegramMessageId)===String(msg.message_id) && r.status==='sent' && r.mode===mode;});
    var allowed=row && proof && (mode==='test'?user===String(c.testAdminId):(admin || WpCore.authorized(c,user,row.mailbox)));
    if(!allowed) {ack(c,cb,'Нет доступа.');return;}
    if(!db.state('callback:'+cb.id)) {
      if(match[1]==='n') {
        if(!WpCore.authorized(c,user,row.mailbox) && !(mode==='test' && user===String(c.testAdminId))) return;
        if(row.status==='awaiting') close(db,row,'no_reply_needed',user,'employee_button');
      } else if(admin && current(db,c,row)) {
        var last=db.state('manual:'+row.id)||0;
        if(Date.now()-last>300000) {
          queue(db,c,row,'manual',mode,cb.id,true);db.state('manual:'+row.id,Date.now());
        }
      }
      db.state('callback:'+cb.id,{at:Date.now()});
    }
    ack(c,cb,row.status==='awaiting'?'Напоминание поставлено в очередь.':'Ожидание закрыто.');
    dispatch(db,c,mode);
  }
  function updates() {return locked(function(){
    var c=config(),db=WpStore.open(c.sheetId),mode=db.setting('MODE');
    if(mode==='production' && PropertiesService.getScriptProperties().getProperty('WP_PRODUCTION_APPROVED')!=='yes') throw new Error('PRODUCTION_NOT_APPROVED');
    if(['test','production'].indexOf(mode)<0) return {paused:true};
    var offset=Number(db.state('telegramOffset')||0), list=WpApi.telegram(c.token,'getUpdates',{
      offset:offset,limit:50,timeout:0,allowed_updates:['callback_query','message']});
    for(var i=0;i<list.length && budget();i++) {
      try {handle(db,c,list[i],mode);}
      catch(e){error(db,'telegram-update',e,String(list[i].update_id));return {retry:true};}
      db.state('telegramOffset',list[i].update_id+1);
    }
    db.state('updatesLastSuccess',Date.now());return {ok:true,handled:list.length};
  });}
  function setup() {return locked(function(){
    var c=config(),db=WpStore.initialize(c.sheetId);
    if(!db.setting('MODE')) db.setting('MODE','test','test / production / paused');
    c.employees.forEach(function(e){
      var old=db.all('Employees').find(function(r){return r.id===e.id;});
      if(!old) db.save('Employees',Object.assign({enabled:true},e));
    });
    db.setting('TIMEZONE','America/New_York','Weekdays 09:00–19:00');
    db.setting('REMINDER_MINUTES','30,60,120','Business minutes; polling adds up to five minutes');
    var hook=WpApi.telegram(c.token,'getWebhookInfo');
    if(hook.url) throw new Error('EXISTING_WEBHOOK_REQUIRES_REVIEW');
    var bot=WpApi.telegram(c.token,'getMe');
    db.state('botVerified',{id:bot.id,username:bot.username});return {ok:true,mode:db.setting('MODE'),employees:c.employees.length,mailboxes:c.mailboxes.length};
  });}
  function health() {return locked(function(){
    var c=config(),db=WpStore.open(c.sheetId),report={mailboxes:[],mode:db.setting('MODE')};
    c.mailboxes.forEach(function(m){
      try {var p=WpApi.gmail(c,m,'profile'); report.mailboxes.push({mailbox:m,ok:p.emailAddress===m});}
      catch(e){report.mailboxes.push({mailbox:m,ok:false,code:e.code||'AUTH'});}
    });
    report.bot=!!WpApi.telegram(c.token,'getMe').id;
    var test={id:'synthetic',internalDate:String(Date.now()),labelIds:['INBOX'],payload:{headers:[
      {name:'From',value:'client@example.com'},{name:'Subject',value:'Please confirm a quotation'}]},snippet:'Please send a quotation for ten wall panels. Can you confirm delivery next week?'};
    report.ai=WpApi.analyze([test],test,c.groq).requires_reply;
    report.webhook=!!WpApi.telegram(c.token,'getWebhookInfo').url;
    db.state('health',Object.assign({at:Date.now()},report));return report;
  });}
  function installTriggers() {
    var c=config(),db=WpStore.open(c.sheetId),h=db.state('health');
    if(!h || Date.now()-h.at>3600000 || !h.bot || !h.ai || h.webhook || h.mailboxes.length!==c.mailboxes.length ||
      h.mailboxes.some(function(m){return !m.ok || c.mailboxes.indexOf(m.mailbox)<0;})) throw new Error('HEALTH_GATE');
    var expected={wpMonitor:5,wpTelegramUpdates:1}, ts=ScriptApp.getProjectTriggers();
    Object.keys(expected).forEach(function(name){
      if(!ts.some(function(t){return t.getHandlerFunction()===name;})) ScriptApp.newTrigger(name).timeBased().everyMinutes(expected[name]).create();
    });
    return ScriptApp.getProjectTriggers().filter(function(t){return expected[t.getHandlerFunction()];}).map(function(t){return {handler:t.getHandlerFunction(),id:t.getUniqueId()};});
  }
  function syntheticTest() {return locked(function(){
    var c=config(),db=WpStore.open(c.sheetId);
    if(db.setting('MODE')!=='test') throw new Error('TEST_MODE_REQUIRED');
    var existing=db.state('syntheticTestId');
    var row=db.all('Emails').find(function(r){return r.id===existing;}) || {id:id(),key:'synthetic:'+id(),kind:'synthetic',mailbox:c.testEmployee?c.testEmployee.email:c.mailboxes[0],messageId:'synthetic',threadId:'synthetic',
      sender:'client@example.com',subject:'Synthetic callback acceptance test',receivedAt:Date.now(),status:'awaiting',aiStatus:'complete',
      summary:'Синтетический тест. Нажмите No Reply Needed для проверки кнопки.',updatedAt:Date.now()};
    db.save('Emails',row);db.state('syntheticTestId',row.id);queue(db,c,row,'test','test');dispatch(db,c,'test');
    return {id:row.id,delivered:db.all('Reminders').some(function(r){return r.emailId===row.id && r.stage==='test' && r.status==='sent';})};
  });}
  return {config:config,setup:setup,monitor:monitor,updates:updates,health:health,installTriggers:installTriggers,
    syntheticTest:syntheticTest,handle:handle,current:current,queue:queue,dispatch:dispatch,reconcile:reconcile,sync:sync};
})();
function wpSetup() {return WpApp.setup();}
function wpMonitor() {var result=WpApp.monitor(); console.log(JSON.stringify(result));return result;}
function wpTelegramUpdates() {var result=WpApp.updates();if(result.handled) console.log(JSON.stringify(result));return result;}
function wpHealth() {var result=WpApp.health(); console.log(JSON.stringify({mode:result.mode,gmailOk:result.mailboxes.filter(function(m){return m.ok;}).length,
  gmailTotal:result.mailboxes.length,bot:result.bot,ai:result.ai,webhook:result.webhook}));return result;}
function wpInstallTriggers() {return WpApp.installTriggers();}
function wpSyntheticTest() {return WpApp.syntheticTest();}
function wpCommissionTest() {
  var c=WpApp.config(), db=WpStore.open(c.sheetId);
  if(db.setting('MODE')!=='test') throw new Error('TEST_MODE_REQUIRED');
  var report=wpHealth();
  if(!report.bot || !report.ai || report.webhook || report.mailboxes.some(function(m){return !m.ok;})) throw new Error('HEALTH_GATE');
  wpMonitor();
  console.log(JSON.stringify({triggers:wpInstallTriggers().map(function(t){return t.handler;})}));
  var synthetic=wpSyntheticTest();
  if(!synthetic.delivered) throw new Error('TEST_DELIVERY_NOT_CONFIRMED');
  wpStatus();
  console.log('TEST_READY_ADMIN_ONLY');
}
function wpStatus() {
  var c=WpApp.config(),db=WpStore.open(c.sheetId),testId=db.state('syntheticTestId');
  var row=db.all('Emails').find(function(r){return r.id===testId;});
  var result={mode:db.setting('MODE'),health:db.state('health')?true:false,
    monitoredMailboxes:c.mailboxes.filter(function(m){return !!db.state('gmail:'+m);}).length,
    syntheticStatus:row?row.status:'none',deliveries:db.all('Reminders').filter(function(r){return r.mode==='test' && r.status==='sent';}).length,
    unsafeRecipients:db.all('Reminders').filter(function(r){return String(r.recipient)!==String(c.testAdminId);}).length,
    monitorLastSuccess:db.state('monitorLastSuccess'),updatesLastSuccess:db.state('updatesLastSuccess'),
    errorCount:db.all('Errors').length};
  console.log(JSON.stringify(result));return result;
}
