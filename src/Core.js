/* Pure logic shared by Apps Script V8 and Node tests. No credentials or staff data. */
var WpCore = (function () {
  'use strict';
  var TZ = 'America/New_York';
  function parts(ms) {
    var out = {};
    new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit',
      day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'})
      .formatToParts(new Date(ms)).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  function localUtc(y, m, d, h) {
    var target = Date.UTC(y,m-1,d,h), guess = target;
    for (var i=0;i<3;i++) {
      var p = parts(guess);
      guess += target - Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    }
    return guess;
  }
  function businessMinutes(start, end) {
    start = Number(start); end = Number(end);
    if (!isFinite(start) || !isFinite(end) || end <= start) return 0;
    var first = parts(start), last = parts(end), total = 0;
    var day = Date.UTC(+first.year,+first.month-1,+first.day);
    var stop = Date.UTC(+last.year,+last.month-1,+last.day);
    for (; day <= stop; day += 86400000) {
      var date = new Date(day), dow = date.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      var open = localUtc(date.getUTCFullYear(), date.getUTCMonth()+1, date.getUTCDate(),9);
      var close = localUtc(date.getUTCFullYear(), date.getUTCMonth()+1, date.getUTCDate(),19);
      total += Math.max(0,Math.min(end,close)-Math.max(start,open));
    }
    return total/60000;
  }
  function isWorking(ms) {
    var p = parts(ms), dow = new Date(Date.UTC(+p.year,+p.month-1,+p.day)).getUTCDay();
    return dow > 0 && dow < 6 && +p.hour >= 9 && +p.hour < 19;
  }
  function header(msg,name) {
    var h = ((msg.payload||{}).headers||[]).find(function (v) {return v.name.toLowerCase()===name.toLowerCase();});
    return h ? h.value : '';
  }
  function addresses(s) { return (String(s).toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+/g)||[]); }
  function incoming(msg, ownAddresses) {
    var labels = msg.labelIds||[];
    return !labels.some(function (l) {return ['SENT','DRAFT','SPAM','TRASH'].indexOf(l)>=0;}) &&
      !addresses(header(msg,'From')).some(function (a) {return ownAddresses.indexOf(a)>=0;});
  }
  function exclusion(msg,rules) {
    var from=addresses(header(msg,'From')),subject=String(header(msg,'Subject')||'').trim();
    return (rules||[]).find(function(rule){
      // An exact sender AND a reviewed subject template. Never block all info@/noreply@ mail.
      return from.length===1 && from[0]===rule.sender && new RegExp(rule.subjectPattern,'i').test(subject);
    })||((from.length===1 && /^info\+[^@]+@mail\.msgsndr[a-z0-9]+\.com$/.test(from[0]) &&
      /^(?:New Lead|Missed Call) \([^\r\n()]{1,100}\) (?:was )?assigned to you [^\r\n?]{1,160}$/i.test(subject))?
      {id:'crm_assignment_template',category:'system',reason:'Автоуведомление CRM о назначении лида или звонка. Ответ на это письмо не требуется.'}:null);
  }
  function bulkEvidence(msg) {
    return !!String(header(msg,'List-Unsubscribe')||'').trim() || !!String(header(msg,'List-ID')||'').trim() ||
      /^(?:bulk|list|junk)$/i.test(String(header(msg,'Precedence')||'').trim());
  }
  function replied(messages, source) {
    var sender = addresses(header(source,'From'));
    var messageId = header(source,'Message-ID');
    return messages.some(function (m) {
      var labels = m.labelIds||[];
      if (labels.indexOf('SENT')<0 || labels.indexOf('DRAFT')>=0 || +m.internalDate <= +source.internalDate) return false;
      var auto = header(m,'Auto-Submitted');
      if (auto && auto.toLowerCase()!=='no') return false;
      var references = header(m,'In-Reply-To')+' '+header(m,'References');
      var recipients = addresses(header(m,'To')+' '+header(m,'Cc'));
      return (!!messageId && references.indexOf(messageId)>=0) || sender.some(function (s) {return recipients.indexOf(s)>=0;});
    });
  }
  function eventKey(mailbox,message) {return mailbox.toLowerCase()+'/'+message;}
  function normalizeAI(value) {
    if (!value || typeof value.requires_reply!=='boolean' || typeof value.is_customer!=='boolean' ||
      typeof value.summary!=='string' || typeof value.reason!=='string') throw new Error('AI_SCHEMA');
    if (['customer','marketing','automated','system','other'].indexOf(value.category)<0) throw new Error('AI_SCHEMA');
    return {requires_reply:value.requires_reply, is_customer:value.is_customer, category:value.category,
      summary:value.summary.slice(0,500),reason:value.reason.slice(0,300)};
  }
  function gmailUrl(mailbox,thread) {
    return 'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(mailbox)+'#all/'+encodeURIComponent(thread);
  }
  function employeeMailboxes(employee) {
    return Array.from(new Set([employee.email].concat(employee.additionalMailboxes||[])));
  }
  function owners(config,mailbox,receivedAt) {
    return config.employees.filter(function(e){
      var since=(e.mailboxSince||{})[mailbox]||e.notificationsSince||0;
      return employeeMailboxes(e).indexOf(mailbox)>=0 && (receivedAt===undefined || Number(receivedAt)>=Number(since));
    });
  }
  function reminderStages(config,row) {
    var policy=(config.mailboxPolicies||{})[row.mailbox];
    return policy && Number(row.receivedAt)>=Number(policy.effectiveAt)?policy.stages.slice():[30,60,120];
  }
  function isSlaStage(value) {return Number.isInteger(Number(value)) && Number(value)>0;}
  function authorized(config, user, mailbox) {
    return owners(config,mailbox).some(function(e){return String(e.telegramId)===String(user);});
  }
  function recipients(config, mailbox, mode,receivedAt) {
    if(mode==='test') return [String(config.testAdminId)];
    var ids = owners(config,mailbox,receivedAt).map(function(e){return String(e.telegramId);})
      .concat(config.adminIds.map(String));
    return Array.from(new Set(ids));
  }
  function dueStage(received,now,sentStages,thresholds) {
    if(!isWorking(now)) return 0;
    var elapsed=businessMinutes(received,now), due=(thresholds||[30,60,120]).filter(function(n){return elapsed>=n && sentStages.indexOf(n)<0;});
    return due.length ? due[0] : 0; // At most one new stage per monitoring run after an outage.
  }
  return {businessMinutes:businessMinutes,isWorking:isWorking,header:header,addresses:addresses,
    incoming:incoming,exclusion:exclusion,bulkEvidence:bulkEvidence,replied:replied,eventKey:eventKey,normalizeAI:normalizeAI,gmailUrl:gmailUrl,
    employeeMailboxes:employeeMailboxes,owners:owners,reminderStages:reminderStages,isSlaStage:isSlaStage,
    authorized:authorized,recipients:recipients,dueStage:dueStage};
})();
if(typeof module!=='undefined') module.exports=WpCore;
