const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 let sent;
 const ctx=vm.createContext({WpCore:require('../src/Core.js'),
  Utilities:{base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')})},
  UrlFetchApp:{fetch:(url,options)=>{sent=JSON.parse(options.payload);return {getResponseCode:()=>200,
   getContentText:()=>JSON.stringify({choices:[{message:{content:JSON.stringify({requires_reply:true,is_customer:true,category:'customer',summary:'request',reason:'question'})}}]})};}}});
 vm.runInContext(fs.readFileSync('src/Api.js','utf8'),ctx);
 return {api:ctx.WpApi,request:()=>sent};
}
function message(id,at,text){return {id,internalDate:String(at),labelIds:['INBOX'],snippet:text,
 payload:{headers:[{name:'From',value:'client@example.com'},{name:'Subject',value:'Request '+id}]}};}
test('AI receives valid bounded JSON with the exact new request last, even in a long unordered thread',()=>{
 const f=fixture(),source=message('target',10,'NEW QUESTION '+('"\\\n').repeat(2000));
 const previous=Array.from({length:9},(_,i)=>message('old'+i,i,'old '.repeat(2000)));
 const future=message('future',11,'DO NOT INCLUDE'),draft={...message('draft',9,'DRAFT TEXT'),labelIds:['DRAFT']};
 f.api.analyze([source,future,draft,...previous.reverse()],source,'FAKE');
 const input=f.request().messages[1].content,context=JSON.parse(input);
 assert.ok(input.length<=14000);assert.ok(context.length<=5);
 assert.equal(context.at(-1).subject,'Request target');assert.ok(context.at(-1).text.startsWith('NEW QUESTION'));
 assert.ok(!input.includes('DO NOT INCLUDE'));assert.ok(!input.includes('DRAFT TEXT'));
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
 assert.ok(input.length<=14000);assert.equal(JSON.parse(input)[0].text,'Need quotation');
});
