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
  function reconcile(db,c,mailbox,threadId,baseline,onlyMessageId) {
    var thread=WpApi.gmail(c,mailbox,'threads/'+encodeURIComponent(threadId),{format:'full'});
    var msgs=(thread.messages||[]).sort(function(a,b){return +a.internalDate-+b.internalDate;});
    var rows=db.all('Emails'), changed=0;
    var campaign=db.setting('MODE')==='test'?db.state('test247'):null;
    msgs.filter(function(m){
      if(!WpCore.incoming(m,[mailbox])) return false;
      if(onlyMessageId) return m.id===onlyMessageId;
      if(+m.internalDate<baseline) return false;
      if(campaign && campaign.active) return WpTest.controls(campaign,{kind:'live',mailbox:mailbox,messageId:m.id,receivedAt:+m.internalDate,sender:WpCore.header(m,'From')},'test');
      return true;
    }).forEach(function(m){
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
    var hasReply=WpCore.replied(thread.messages||[],source),campaign=db.state('test247');
    if(db.setting('MODE')==='test' && WpTest.controls(campaign,row,'test')) {
      var prior=db.state('testEvidence:'+row.id)||{};
      db.state('testEvidence:'+row.id,{checkedAt:Date.now(),readObserved:!!prior.readObserved || (source.labelIds||[]).indexOf('UNREAD')<0,
        sentReplyObserved:!!prior.sentReplyObserved || hasReply});
    }
    if(hasReply) {close(db,row,'replied','system','sent_reply');return false;}
    return true;
  }
  function keyboard(c,row,recipient,mode,view) {
    var admin=view?view==='admin':c.adminIds.map(String).indexOf(String(recipient))>=0;
    var result=view==='admin'?[]:[[{text:'Open Gmail',url:WpCore.gmailUrl(row.mailbox,row.threadId)}]];
    if(view!=='admin' && (!admin || WpCore.authorized(c,recipient,row.mailbox) || mode==='test')) result.push([{text:'No Reply Needed',callback_data:'n:'+row.id}]);
    if(admin) {
      c.employees.filter(function(e){return e.email===row.mailbox;}).forEach(function(e){
        result.push([{text:'Chat with Employee · '+e.name,url:e.username?'https://t.me/'+e.username.replace(/^@/,''):'tg://user?id='+e.telegramId}]);
      });
      result.push([{text:'Send Reminder',callback_data:'r:'+row.id}]);
    }
    return {inline_keyboard:result};
  }
  function queue(db,c,row,stage,mode,suffix,onlyEmployees) {
    var campaign=db.state('test247'),dual=WpTest.controls(campaign,row,mode);
    var recipients=onlyEmployees?c.employees.filter(function(e){return e.email===row.mailbox;}).map(function(e){return String(e.telegramId);}):WpCore.recipients(c,row.mailbox,mode);
    if(mode==='test') recipients=[String(c.testAdminId)];
    recipients.forEach(function(to){
      (dual?(onlyEmployees?['employee']:['employee','admin']):[null]).forEach(function(view){
      var key=row.id+':'+stage+':'+to+':'+mode+(dual?':campaign-'+campaign.id+':view-'+view:'')+(suffix?':'+suffix:'');
      if(db.all('Reminders').some(function(r){return r.id===key;})) return;
      db.save('Reminders',{id:key,emailId:row.id,stage:stage,recipient:to,mode:mode,status:'pending'});
      });
    });
  }
  function card(db,c,row,job,at) {
    var testClock=WpTest.controls(db.state('test247'),row,job.mode),view=WpTest.view(job);
    return {chat_id:String(job.recipient),parse_mode:'HTML',
      text:WpMessages.render(row,job,{testClock:testClock,
        elapsed:testClock?WpTest.minutes(db.state('test247'),row,at):WpCore.businessMinutes(row.receivedAt,at),
        owner:c.employees.filter(function(e){return e.email===row.mailbox;}).map(function(e){return e.name;}).join(', '),
        view:view||(c.adminIds.map(String).indexOf(String(job.recipient))>=0?'admin':'employee')}),
      reply_markup:keyboard(c,row,job.recipient,job.mode,view),link_preview_options:{is_disabled:true}};
  }
  function refreshTestMessages(db,c) {
    // A versioned snapshot edits existing test cards only; it never requeues deliveries or changes SLA clocks.
    var campaign=db.state('test247');
    if(db.setting('MODE')!=='test' || !campaign || !campaign.active || !c.testEmployee ||
      campaign.mailbox!==c.testEmployee.email || String(c.testEmployee.telegramId)!==String(c.testAdminId)) return;
    var key='messageFormat:'+WpMessages.version+':'+campaign.id,receipt=db.state(key);
    if(receipt && receipt.completedAt) return;
    var jobs=db.all('Reminders'),rows=db.all('Emails');
    function scoped(job) {
      var row=rows.find(function(r){return r.id===job.emailId;});
      return job.mode==='test' && job.status==='sent' && job.telegramMessageId && String(job.recipient)===String(c.testAdminId) &&
        job.id.indexOf(':campaign-'+campaign.id+':')>=0 && row && WpTest.controls(campaign,row,'test');
    }
    if(!receipt) {
      receipt={requestedAt:Date.now(),jobs:jobs.filter(scoped).map(function(j){return j.id;}),results:{}};
      db.state(key,receipt);
    }
    for(var i=0;i<receipt.jobs.length && budget();i++) {
      var jobId=receipt.jobs[i],prior=receipt.results[jobId];
      if(prior && (prior.done || prior.nextAttemptAt>Date.now())) continue;
      var job=jobs.find(function(j){return j.id===jobId;});
      if(!job || !scoped(job)) {receipt.results[jobId]={done:true,skipped:true};db.state(key,receipt);continue;}
      var row=rows.find(function(r){return r.id===job.emailId;});
      var payload=card(db,c,row,job,Number(job.sentAt||job.attemptAt||Date.now()));
      payload.message_id=Number(job.telegramMessageId);
      try {
        WpApi.telegram(c.token,'editMessageText',payload);
        receipt.results[jobId]={done:true,editedAt:Date.now()};
      } catch(e) {
        var attempts=(prior?prior.attempts:0)+1;
        receipt.results[jobId]={done:attempts>=3 || (e.code>=400 && e.code<500 && e.code!==429),attempts:attempts,
          error:e.code?'HTTP_'+e.code:'EDIT_UNKNOWN',nextAttemptAt:Date.now()+Math.max(60000,Number(e.retryAfter||60)*1000)};
        error(db,'telegram-format',e,job.id);
      }
      db.state(key,receipt);
    }
    if(receipt.jobs.every(function(id){return receipt.results[id] && receipt.results[id].done;})) {
      receipt.completedAt=Date.now();db.state(key,receipt);
      console.log(JSON.stringify({formatVersion:WpMessages.version,
        edited:receipt.jobs.filter(function(id){return receipt.results[id].editedAt;}).length,
        editFailed:receipt.jobs.filter(function(id){return receipt.results[id].error;}).length,
        test247:true,startedAt:campaign.startedAt}));
    }
  }
  function dispatch(db,c,mode) {
    var jobs=db.all('Reminders');
    for(var i=0;i<jobs.length && budget();i++) {
      var job=jobs[i];
      if(job.mode!==mode || job.status!=='pending' || +job.nextAttemptAt>Date.now()) continue;
      var row=db.all('Emails').find(function(e){return e.id===job.emailId;});
      var campaign=db.state('test247'),testClock=row && WpTest.controls(campaign,row,mode);
      if(mode==='test' && campaign && campaign.active && (!testClock || job.id.indexOf(':campaign-'+campaign.id+':')<0)) continue;
      if(mode==='test' && String(job.recipient)!==String(c.testAdminId)) throw new Error('TEST_RECIPIENT_BLOCKED');
      if(row && !testClock && row.kind!=='synthetic' && [30,60,120].indexOf(Number(job.stage))>=0 && !WpCore.isWorking(Date.now())) continue;
      if(!row || !current(db,c,row) || (mode==='production' && row.kind==='synthetic')) {
        job.status='cancelled';db.save('Reminders',job);continue;
      }
      var view=WpTest.view(job),payload=card(db,c,row,job,Date.now());
      job.status='sending';job.attemptAt=Date.now();db.save('Reminders',job);
      try {
        var sent=WpApi.telegram(c.token,'sendMessage',payload);
        job.status='sent';job.sentAt=Date.now();job.telegramMessageId=sent.message_id;db.save('Reminders',job);
        console.log(JSON.stringify({delivery:'sent',mode:mode,stage:job.stage,view:view,synthetic:row.kind==='synthetic',testAdmin:String(job.recipient)===String(c.testAdminId)}));
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
    if(mode==='test') activateTestRequest(db,c);
    var campaign=mode==='test'?db.state('test247'):null;
    if(mode==='test') refreshTestMessages(db,c);
    var monitored=campaign && campaign.active?[campaign.mailbox]:c.mailboxes;
    db.all('Reminders').filter(function(r){return r.status==='sending' && +r.attemptAt<Date.now()-360000;}).forEach(function(r){
      r.status='unknown';r.error='INTERRUPTED_SEND';db.save('Reminders',r);error(db,'outbox',new Error('DELIVERY_UNKNOWN'),r.id);
    });
    var turn=Number(db.state('mailboxRotation')||0);
    for(var i=0;i<monitored.length && budget(150000);i++) {
      var mailbox=monitored[(turn+i)%monitored.length];
      try {sync(db,c,mailbox);} catch(e){error(db,'gmail-sync',e,mailbox);}
    }
    db.state('mailboxRotation',(turn+1)%c.mailboxes.length);
    var open=db.all('Emails').filter(function(r){return r.status==='awaiting' && r.kind!=='synthetic' &&
      (!(campaign && campaign.active) || WpTest.controls(campaign,r,mode));});
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
        var stages=db.all('Reminders').filter(function(r){return r.emailId===row.id && r.mode===mode && r.status!=='cancelled' &&
          (!(campaign && campaign.active) || r.id.indexOf(':campaign-'+campaign.id+':')>=0);}).map(function(r){return +r.stage;});
        Array.from(new Set(stages.filter(function(n){return [30,60,120].indexOf(n)>=0;}))).forEach(function(n){queue(db,c,row,n,mode);});
        var due=WpTest.controls(campaign,row,mode)?WpTest.due(campaign,row,Date.now(),stages):WpCore.dueStage(row.receivedAt,Date.now(),stages);
        if(due) queue(db,c,row,due,mode);
      } catch(e){error(db,'reconcile',e,row.id);}
    }
    if(open.length) db.state('openRotation',(rotation+visited)%open.length);
    if((campaign && campaign.active) || WpCore.isWorking(Date.now())) dispatch(db,c,mode);
    db.state('monitorLastSuccess',Date.now());
    if(campaign && campaign.active) console.log(JSON.stringify({test247:true,startedAt:campaign.startedAt,status:(db.all('Emails').find(function(r){return r.messageId===campaign.messageId;})||{}).status,
      stages:db.all('Reminders').filter(function(r){return r.id.indexOf(':campaign-'+campaign.id+':')>=0;}).map(function(r){return {stage:r.stage,view:WpTest.view(r),status:r.status};})}));
    return {ok:true,mode:mode,mailboxes:monitored.length,active:open.length};
  });}
  function activateTestRequest(db,c) {
    if(typeof wpTestRequest!=='function') return;
    var req=wpTestRequest();
    if(!c.testEmployee || req.mailbox!==c.testEmployee.email || String(c.testAdminId)!==String(c.testEmployee.telegramId) ||
      !/^[a-f0-9]{16,}$/.test(req.messageId) || !/^[a-z0-9-]{1,60}$/.test(req.id)) throw new Error('TEST_REQUEST_SCOPE');
    var state=db.state('test247');
    if(state && state.id===req.id && state.initialized) return;
    if(!state || state.id!==req.id) {
      var thread=WpApi.gmail(c,req.mailbox,'threads/'+encodeURIComponent(req.threadId),{format:'full'});
      var source=(thread.messages||[]).find(function(m){return m.id===req.messageId;});
      if(!source || !WpCore.incoming(source,[req.mailbox])) throw new Error('TEST_INCOMING_NOT_FOUND');
      if(WpCore.replied(thread.messages,source)) throw new Error('TEST_ALREADY_REPLIED');
      state={id:req.id,mailbox:req.mailbox,messageId:req.messageId,threadId:req.threadId,client:WpCore.addresses(WpCore.header(source,'From')),
        startedAt:Date.now(),active:true,initialized:false};
      db.state('test247',state); // Persist the epoch BEFORE any subsequent API call. Retries cannot reset it.
    }
    reconcile(db,c,req.mailbox,req.threadId,0,req.messageId);
    var row=db.all('Emails').find(function(r){return r.mailbox===req.mailbox && r.messageId===req.messageId;});
    if(!row || row.status!=='awaiting') {
      state.active=false;state.initialized=true;state.rejected=row?row.status:'missing';db.state('test247',state);
      console.log(JSON.stringify({test247:false,rejected:state.rejected}));return;
    }
    queue(db,c,row,'initial','test');
    state.initialized=true;db.state('test247',state);
    db.setting('TEST_SCHEDULE','24/7','Only the approved test mailbox and client; production calendar unchanged');
    PropertiesService.getScriptProperties().setProperty('WP_TEST247_ACTIVE','yes');
    console.log(JSON.stringify({test247:true,activated:true,startedAt:state.startedAt,
      dueAt:[30,60,120].map(function(m){return state.startedAt+m*60000;})}));
  }
  function testTick() {
    if(typeof wpTestRequest!=='function' && PropertiesService.getScriptProperties().getProperty('WP_TEST247_ACTIVE')!=='yes') return;
    var c=config(),db=WpStore.open(c.sheetId);
    if(db.setting('MODE')==='test') {
      if(typeof wpTestResumeRequest==='function') locked(function(){resumeTestRequest(WpStore.open(c.sheetId),c);});
      return monitor();
    }
  }
  function resumeTestRequest(db,c) {
    // The durable receipt prevents a completed one-off restoration from reopening later closures.
    if(typeof wpTestResumeRequest!=='function') return;
    var req=wpTestResumeRequest(),state=db.state('test247');
    if(db.setting('MODE')!=='test' || !state || !state.active || !c.testEmployee || state.mailbox!==c.testEmployee.email ||
      state.id!==req.campaignId || state.messageId!==req.messageId || state.startedAt!==req.expectedStartedAt ||
      !/^[a-z0-9-]{1,60}$/.test(req.id)) throw new Error('TEST_RESUME_SCOPE');
    var key='testResume:'+req.id,receipt=db.state(key);
    if(receipt && receipt.completedAt) return;
    var row=db.all('Emails').find(function(r){return r.mailbox===state.mailbox && r.messageId===state.messageId;});
    if(!row || ['awaiting','no_reply_needed'].indexOf(row.status)<0) throw new Error('TEST_RESUME_STATUS');
    var thread=WpApi.gmail(c,state.mailbox,'threads/'+encodeURIComponent(state.threadId),{format:'metadata'});
    var source=(thread.messages||[]).find(function(m){return m.id===state.messageId;});
    if(!source || WpCore.replied(thread.messages,source)) throw new Error('TEST_RESUME_ALREADY_REPLIED');
    if(!receipt) {
      receipt={requestedAt:Date.now(),startedAt:state.startedAt,previousStatus:row.status,previousClosedAt:row.closedAt||'',
        previousClosedBy:row.closedBy||'',previousCloseReason:row.closeReason||'',reason:'explicit_owner_test_resume'};
      db.state(key,receipt); // Preserve the closure audit before clearing the active row's closure fields.
    }
    Object.assign(row,{status:'awaiting',closedAt:'',closedBy:'',closeReason:'',updatedAt:Date.now()});db.save('Emails',row);
    db.all('Reminders').filter(function(r){return r.emailId===row.id && r.mode==='test' && r.status==='cancelled' &&
      !r.sentAt && [30,60,120].indexOf(Number(r.stage))>=0 && r.id.indexOf(':campaign-'+state.id+':')>=0;})
      .forEach(function(r){r.status='pending';db.save('Reminders',r);});
    queue(db,c,row,'resume','test',req.id);
    receipt.completedAt=Date.now();db.state(key,receipt);
    console.log(JSON.stringify({test247:true,resumed:true,status:row.status,startedAt:state.startedAt,
      previousStatus:receipt.previousStatus,dueAt:[30,60,120].map(function(m){return state.startedAt+m*60000;})}));
  }
  function handle(db,c,update,mode) {
    if(update.message && mode==='test' && c.testEmployee) {
      var message=update.message, commandKey='command:'+update.update_id;
      if(message.chat.type==='private' && String(message.from.id)===String(c.testAdminId) && String(message.chat.id)===String(c.testAdminId) &&
        /^\/testoff(?:@\w+)?$/.test(message.text||'') && Date.now()-message.date*1000<900000 && !db.state(commandKey)) {
        var running=db.state('test247');
        if(running) {
          running.active=false;running.stoppedAt=Date.now();db.state('test247',running);
          db.all('Reminders').filter(function(r){return r.status==='pending' && r.id.indexOf(':campaign-'+running.id+':')>=0;})
            .forEach(function(r){r.status='cancelled';db.save('Reminders',r);});
        }
        PropertiesService.getScriptProperties().deleteProperty('WP_TEST247_ACTIVE');
        db.setting('TEST_SCHEDULE','disabled','Production calendar remains Mon–Fri 09:00–19:00 America/New_York');
        db.state(commandKey,{at:Date.now()});
        WpApi.telegram(c.token,'sendMessage',{chat_id:String(c.testAdminId),text:'TEST MODE 24/7 отключён. Тестовая рассылка по-прежнему только вам; production не включён.'});return;
      }
      if(message.chat.type==='private' && String(message.from.id)===String(c.testAdminId) &&
        String(message.chat.id)===String(c.testAdminId) && /^\/preview(?:@\w+)?$/.test(message.text||'') &&
        Date.now()-message.date*1000<900000 && !db.state(commandKey)) {
        var latest=db.all('Emails').filter(function(r){return r.kind==='live' && r.status==='awaiting' && r.mailbox===c.testEmployee.email;})
          .sort(function(a,b){return Number(b.receivedAt)-Number(a.receivedAt);})[0];
        if(latest && current(db,c,latest)) {
          queue(db,c,latest,'preview','test');db.state(commandKey,{at:Date.now()});dispatch(db,c,'test');
        } else {
          db.state(commandKey,{at:Date.now()});
          WpApi.telegram(c.token,'sendMessage',{chat_id:String(c.testAdminId),text:'В тестовом ящике пока нет нового письма, ожидающего ответа. Мониторинг выполняется каждые 5 минут.'});
        }
      }
      return;
    }
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
    console.log(JSON.stringify({callbackAction:match[1],status:row.status,synthetic:row.kind==='synthetic',mode:mode}));
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
      if(!old) db.save('Employees',Object.assign({enabled:true,role:e.role||'employee'},e));
      else if(!old.role) {old.role=e.role||'employee';db.save('Employees',old);}
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
    syntheticTest:syntheticTest,handle:handle,current:current,queue:queue,dispatch:dispatch,reconcile:reconcile,sync:sync,
    activateTestRequest:activateTestRequest,testTick:testTick,keyboard:keyboard,resumeTestRequest:resumeTestRequest,
    refreshTestMessages:refreshTestMessages};
})();
function wpSetup() {return WpApp.setup();}
function wpMonitor() {var result=WpApp.monitor(); console.log(JSON.stringify(result));return result;}
function wpTelegramUpdates() {var result=WpApp.updates();if(result.handled) console.log(JSON.stringify(result));if(result.ok) WpApp.testTick();return result;}
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
