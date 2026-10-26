const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(result={requires_reply:true,is_customer:true,category:'customer',summary:'request',reason:'question'}){
 let sent,calls=0;
 const ctx=vm.createContext({WpCore:require('../src/Core.js'),
  Utilities:{base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')})},
  UrlFetchApp:{fetch:(url,options)=>{calls++;sent=JSON.parse(options.payload);return {getResponseCode:()=>200,
   getContentText:()=>JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]})};}}});
 vm.runInContext(fs.readFileSync('src/Api.js','utf8'),ctx);
 return {api:ctx.WpApi,request:()=>sent,calls:()=>calls};
}
function message(id,at,text){return {id,internalDate:String(at),labelIds:['INBOX'],snippet:text,
 payload:{headers:[{name:'From',value:'client@example.com'},{name:'Subject',value:'Request '+id}]}};}
test('AI receives only the exact incoming message, even in a long unordered thread',()=>{
 const f=fixture(),source=message('target',10,'NEW QUESTION '+('"\\\n').repeat(2000));
 const previous=Array.from({length:9},(_,i)=>message('old'+i,i,'old '.repeat(2000)));
 const future=message('future',11,'DO NOT INCLUDE'),draft={...message('draft',9,'DRAFT TEXT'),labelIds:['DRAFT']};
 f.api.analyze([source,future,draft,...previous.reverse()],source,'FAKE');
 const input=f.request().messages[1].content,context=JSON.parse(input);
 assert.ok(Buffer.byteLength(JSON.stringify(f.request()),'utf8')<=4500);assert.equal(context.length,1);
 assert.equal(context.at(-1).subject,'Request target');assert.ok(context.at(-1).text.startsWith('NEW QUESTION'));
 assert.ok(!input.includes('DO NOT INCLUDE'));assert.ok(!input.includes('DRAFT TEXT'));
 assert.ok(!input.includes('old '));assert.equal(f.calls(),1);assert.equal(f.request().max_completion_tokens,600);
});
test('AI ignores attachment body text and never follows HTML or remote content',()=>{
 const f=fixture(),source=message('target',10,'');
 source.payload.mimeType='multipart/mixed';source.payload.parts=[
  {mimeType:'text/plain',body:{data:Buffer.from('Actual question').toString('base64url')}},
  {mimeType:'text/plain',filename:'attachment.txt',body:{data:Buffer.from('ATTACHMENT SECRET').toString('base64url')}},
  {mimeType:'text/html',body:{data:Buffer.from('<img src="https://example.com/track">HTML SECRET').toString('base64url')}}];
 f.api.analyze([source],source,'FAKE');const input=f.request().messages[1].content;
 assert.ok(input.includes('Actual question'));assert.ok(!input.includes('SECRET'));assert.ok(!input.includes('https://example'));
});
test('AI target remains valid with control characters and oversized headers',()=>{
 const f=fixture(),source=message('target',10,'\u0000\u0001'.repeat(10000)+'Need quotation');
 source.payload.headers.push({name:'Ignored',value:'x'.repeat(50000)});
 f.api.analyze([source],source,'FAKE');const input=f.request().messages[1].content;
 assert.ok(Buffer.byteLength(JSON.stringify(f.request()),'utf8')<=4500);assert.equal(JSON.parse(input)[0].text,'Need quotation');
});
test('large Unicode and escape-heavy messages obey the full UTF-8 request budget and preserve the tail',()=>{
 for(const body of ['报价🙂'.repeat(4000),'"\\\n'.repeat(5000),'x'.repeat(50000)]) {
  const f=fixture(),source=message('target',10,'');
  source.payload.mimeType='text/plain';source.payload.body={data:Buffer.from('Please check\n'+body+'\nEND QUESTION').toString('base64url')};
  source.payload.headers[0].value='名🙂'.repeat(2000);source.payload.headers[1].value='新问题🙂'.repeat(2000);
  f.api.analyze([source],source,'FAKE');const p=f.request(),input=JSON.parse(p.messages[1].content)[0];
  assert.ok(Buffer.byteLength(JSON.stringify(p),'utf8')<=4500);assert.ok(input.text.startsWith('Please check'));
  assert.ok(input.text.endsWith('END QUESTION'));assert.equal(input.truncated,true);assert.equal(f.calls(),1);
 }
});
test('a multi-megabyte plain-text email still produces only one small request',()=>{
 const f=fixture(),source=message('large',10,'');
 source.payload.mimeType='text/plain';source.payload.body={data:Buffer.from('FIRST QUESTION\n'+'Щ🙂'.repeat(500000)+'\nLAST QUESTION').toString('base64url')};
 f.api.analyze([source],source,'FAKE');const p=f.request(),input=JSON.parse(p.messages[1].content)[0];
 assert.ok(Buffer.byteLength(JSON.stringify(p))<=4500);assert.equal(f.calls(),1);
 assert.ok(input.text.startsWith('FIRST QUESTION'));assert.ok(input.text.endsWith('LAST QUESTION'));assert.equal(input.truncated,true);
});
test('delimited quoted reply history is not sent, but new content and forwards remain',()=>{
 const f=fixture(),source=message('target',10,'Please quote ten panels.\n\nOn Mon, Example Person wrote:\n> OLD CONFIDENTIAL HISTORY');
 f.api.analyze([source],source,'FAKE');let input=JSON.parse(f.request().messages[1].content)[0];
 assert.equal(input.text,'Please quote ten panels.');assert.equal(input.history_omitted,true);assert.equal(input.truncated,false);
 source.snippet='Thanks.\n\n-----Original Message-----\n> OLD REQUEST';f.api.analyze([source],source,'FAKE');
 assert.equal(JSON.parse(f.request().messages[1].content)[0].text,'Thanks.');
 source.snippet='Begin forwarded message:\nPlease confirm delivery tomorrow.';f.api.analyze([source],source,'FAKE');
 assert.ok(JSON.parse(f.request().messages[1].content)[0].text.includes('confirm delivery'));
});
test('new inline or bottom-posted client text is not removed with the quote history',()=>{
 const f=fixture(),source=message('target',10,'Hello.\nOn Mon, Example wrote:\n> The older quotation\nPlease confirm delivery tomorrow.');
 f.api.analyze([source],source,'FAKE');const input=JSON.parse(f.request().messages[1].content)[0];
 assert.ok(input.text.includes('Please confirm delivery tomorrow.'));assert.equal(input.history_omitted,false);
});
test('a clipped message cannot silently lose reminders through a negative AI result',()=>{
 const negative={requires_reply:false,is_customer:false,category:'marketing',summary:'Рассылка',reason:'Не нужен ответ'};
 const f=fixture(negative),source=message('target',10,'x'.repeat(10000));
 const result=f.api.analyze([source],source,'FAKE');assert.equal(result.requires_reply,true);assert.match(result.reason,/сокращён/);
 source.snippet='Our newsletter, no response needed.';assert.equal(f.api.analyze([source],source,'FAKE').requires_reply,false);
});
test('a confirmed long mailing-list newsletter stays excluded instead of being resurrected by truncation',()=>{
 const f=fixture({requires_reply:false,is_customer:false,category:'marketing',summary:'Новостная рассылка',reason:'Ответ не требуется'});
 const source=message('newsletter',10,'Weekly cybersecurity news. '.repeat(1200));
 source.payload.headers[0].value='Newsletter <noreply@news.example.org>';
 source.payload.headers.push({name:'List-Unsubscribe',value:'<https://example.org/unsubscribe?private=DO_NOT_TRANSMIT>'});
 const value=f.api.analyze([source],source,'FAKE');
 assert.equal(value.requires_reply,false);assert.equal(value.reason,'Ответ не требуется');assert.equal(f.calls(),1);
 const request=f.request(),input=JSON.parse(request.messages[1].content)[0];
 assert.equal(input.mailing_list,true);assert.equal(input.truncated,true);assert.ok(!JSON.stringify(request).includes('DO_NOT_TRANSMIT'));
 assert.ok(Buffer.byteLength(JSON.stringify(request))<=4500);assert.equal(request.max_completion_tokens,600);
});
test('no-reply alone, uncertain category or customer classification cannot bypass truncated-mail protection',()=>{
 for(const kind of ['noreply_only','uncertain','customer']){
  const f=fixture({requires_reply:false,is_customer:kind==='customer',category:kind==='uncertain'?'other':'marketing',summary:'x',reason:'x'});
  const source=message('target',10,'x'.repeat(10000));source.payload.headers[0].value='noreply@example.org';
  if(kind!=='noreply_only')source.payload.headers.push({name:'List-ID',value:'list.example.org'});
  assert.equal(f.api.analyze([source],source,'FAKE').requires_reply,true);
 }
});
test('an actionable automated client request remains eligible even with unsubscribe headers',()=>{
 const f=fixture(),source=message('target',10,'Please approve the panel layout by replying. '.repeat(1500));
 source.payload.headers[0].value='noreply@client.example.org';source.payload.headers.push({name:'Precedence',value:'bulk'});
 assert.equal(f.api.analyze([source],source,'FAKE').requires_reply,true);
});
test('a short latest reply is not contaminated by an earlier actionable client request',()=>{
 const f=fixture(),source=message('target',10,'Thank you, no further action needed.');
 f.api.analyze([message('older',1,'Please send a quotation. REPEAT_OLD_REQUEST'),source],source,'FAKE');
 const input=JSON.parse(f.request().messages[1].content);assert.equal(input.length,1);assert.equal(input[0].text,source.snippet);
 assert.ok(!f.request().messages[1].content.includes('REPEAT_OLD_REQUEST'));
});
