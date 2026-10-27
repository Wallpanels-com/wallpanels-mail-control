/* Telegram HTML: clip untrusted values before escaping, never truncate markup. */
var WpMessages = (function () {
  var version='cards-v1';
  function field(value,limit) {
    var chars=Array.from(String(value==null?'':value).replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim());
    var text=chars.length>limit?chars.slice(0,limit-1).join('')+'…':chars.join('');
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function stage(value,thresholds) {
    var n=Number(value),index=(thresholds||[30,60,120]).indexOf(n);
    if(index>=0) return 'Напоминание '+(index+1)+' из 3 · '+n+' мин.';
    return {initial:'Начало тестового контроля',resume:'Тестовый контроль восстановлен',manual:'Ручное напоминание',
      test:'Проверка интерфейса',preview:'Предпросмотр'}[value]||field(value,70);
  }
  function render(row,job,options) {
    var admin=options.view==='admin';
    var blocks=['📬 <b>Письмо ожидает ответа</b>\n'+(job.mode==='test'?'🧪 TEST'+(options.testClock?' 24/7':'')+' · ':'')+
      (admin?'🛡 Admin':'👤 Employee'),
      '👤 <b>'+(admin?'Employee':'Получатель')+':</b> '+field(options.owner,120)+
      (admin?'\n📧 <b>Employee Email:</b> '+field(row.mailbox,160):''),
      '📨 <b>От / Client:</b> '+field(row.sender,260)+'\n📝 <b>Тема:</b> '+field(row.subject,240),
      '⏳ <b>Ожидание:</b> '+Math.max(0,Math.floor(Number(options.elapsed)||0))+(options.testClock?' мин.':' рабочих мин.')+
      '\n🔔 <b>Этап:</b> '+stage(job.stage,options.stages),
      '🤖 <b>AI Summary</b>\n'+field(row.summary||'Анализ ожидается.',750)];
    if(row.reason) blocks.push('💬 <b>Почему нужен ответ</b>\n'+field(row.reason,300));
    if(options.personalNoReply && !admin) blocks.push('🔕 No Reply Needed отключает напоминания по этому письму только вам.');
    blocks.push('<i>WallPanels Mail Control</i>');
    return blocks.join('\n\n');
  }
  return {version:version,render:render};
})();
if(typeof module!=='undefined') module.exports=WpMessages;
