const {test}=require('node:test');
const assert=require('node:assert/strict');
const Messages=require('../src/Messages.js');
const row={mailbox:'employee@example.org',sender:'Client <client@example.org>',subject:'A & B',summary:'Please reply.',reason:'Question about delivery.'};
const options={owner:'Dmitry',view:'employee',testClock:true,elapsed:30};
test('structured employee card has readable sections, escaped fields and a cumulative SLA label',()=>{
 const text=Messages.render(row,{mode:'test',stage:30},options);
 assert.ok(text.includes('🧪 TEST 24/7 · 👤 Employee'));
 assert.ok(text.includes('Client &lt;client@example.org&gt;'));
 assert.ok(text.includes('A &amp; B'));assert.ok(text.includes('Напоминание 1 из 3 · 30 мин.'));
 assert.ok(text.includes('\n\n🤖 <b>AI Summary</b>\nPlease reply.'));
 assert.ok(!text.includes('Employee Email'));
});
test('admin card clearly identifies the employee and mailbox',()=>{
 const text=Messages.render(row,{mode:'test',stage:120},{...options,view:'admin',elapsed:120});
 assert.ok(text.includes('🛡 Admin'));assert.ok(text.includes('<b>Employee:</b> Dmitry'));
 assert.ok(text.includes('<b>Employee Email:</b> employee@example.org'));assert.ok(text.includes('Напоминание 3 из 3'));
});
test('untrusted HTML is escaped and long Unicode values cannot break markup or Telegram length',()=>{
 const bad='<b>🧪&</b>'.repeat(2000);
 const text=Messages.render({mailbox:bad,sender:bad,subject:bad,summary:bad,reason:bad},
  {mode:'test',stage:60},{...options,view:'admin',owner:bad});
 assert.ok(text.includes('&lt;b&gt;'));assert.ok(!text.includes('<b>🧪'));
 const plain=text.replace(/<\/?[bi]>/g,'').replace(/&(?:amp|lt|gt);/g,'x');
 assert.ok(plain.length<4096);assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text));
 assert.equal((text.match(/<b>/g)||[]).length,(text.match(/<\/b>/g)||[]).length);
 const emoji='🧪'.repeat(10000);
 const longest=Messages.render({mailbox:emoji,sender:emoji,subject:emoji,summary:emoji,reason:emoji},
  {mode:'test',stage:120},{...options,view:'admin',owner:emoji});
 assert.ok(longest.replace(/<\/?[bi]>/g,'').length<4096);
});
test('production card keeps business-minute wording and no test banner',()=>{
 const text=Messages.render(row,{mode:'production',stage:60},{...options,testClock:false,elapsed:60});
 assert.ok(!text.includes('TEST'));assert.ok(text.includes('60 рабочих мин.'));
});
