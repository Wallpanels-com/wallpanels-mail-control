var WpStore = (function () {
  'use strict';
  var schemas = {
    Employees:['id','name','email','telegramId','username','enabled','role'],
    Emails:['id','key','kind','mailbox','messageId','threadId','sender','subject','receivedAt','status','aiStatus','category','summary','reason','closedAt','closedBy','closeReason','nextAiAt','aiAttempts','updatedAt'],
    Reminders:['id','emailId','stage','recipient','mode','status','attemptAt','sentAt','telegramMessageId','error','nextAttemptAt'],
    Sync_State:['key','value','updatedAt'],
    Settings:['key','value','description'],
    Errors:['id','at','component','code','reference','resolved']
  };
  function safe(v) {
    if(v===null || v===undefined) return '';
    if(typeof v==='string' && /^[=+@\-]/.test(v)) return "'"+v;
    return v;
  }
  function open(id) {
    var book=SpreadsheetApp.openById(id), cache={};
    function sheet(name) {
      var s=book.getSheetByName(name);
      if(!s) throw new Error('SHEET_MISSING:'+name);
      var cols=schemas[name], headers=s.getRange(1,1,1,cols.length).getValues()[0];
      if(JSON.stringify(headers)!==JSON.stringify(cols)) throw new Error('SCHEMA_MISMATCH:'+name);
      return s;
    }
    function all(name) {
      if(cache[name]) return cache[name];
      var s=sheet(name), cols=schemas[name];
      cache[name]=s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,cols.length).getValues().map(function(row,i){
        var obj={_row:i+2}; cols.forEach(function(c,j){ obj[c]=row[j]; }); return obj;
      });
      return cache[name];
    }
    function save(name,obj) {
      var s=sheet(name), cols=schemas[name], rows=all(name), values=cols.map(function(c){return safe(obj[c]);});
      if(obj._row) s.getRange(obj._row,1,1,cols.length).setValues([values]);
      else { obj._row=s.getLastRow()+1; s.getRange(obj._row,1,1,cols.length).setValues([values]); rows.push(obj); }
      SpreadsheetApp.flush();
      return obj;
    }
    function state(key,value) {
      var obj=all('Sync_State').find(function(r){return r.key===key;});
      if(arguments.length===1) return obj?JSON.parse(String(obj.value)):null;
      save('Sync_State',Object.assign(obj||{key:key},{value:JSON.stringify(value),updatedAt:Date.now()}));
      return value;
    }
    function setting(key,value,description) {
      var obj=all('Settings').find(function(r){return r.key===key;});
      if(arguments.length===1) return obj?String(obj.value):null;
      save('Settings',Object.assign(obj||{key:key},{value:value,description:description||''}));
      return value;
    }
    return {all:all,save:save,state:state,setting:setting,book:book};
  }
  function initialize(id) {
    var book=SpreadsheetApp.openById(id);
    Object.keys(schemas).forEach(function(name){
      var s=book.getSheetByName(name), cols=schemas[name];
      if(!s) s=book.insertSheet(name);
      if(s.getLastRow()>0) {
        var headers=s.getRange(1,1,1,cols.length).getValues()[0];
        // Append-only migration of our initial six-column roster; never replace user data.
        if(name==='Employees' && s.getLastColumn()===6 && JSON.stringify(headers.slice(0,6))===JSON.stringify(cols.slice(0,6)) && !headers[6]) {
          s.getRange(1,7).setValue('role').setFontWeight('bold').setBackground('#17365d').setFontColor('#ffffff');
          return;
        }
        if(JSON.stringify(headers)!==JSON.stringify(cols)) throw new Error('SCHEMA_MISMATCH:'+name);
        return; // Preserve existing data and formatting.
      }
      s.getRange(1,1,1,cols.length).setValues([cols]).setFontWeight('bold').setBackground('#17365d').setFontColor('#ffffff');
      s.setFrozenRows(1); s.getRange(1,1,s.getMaxRows(),cols.length).createFilter();
      s.setColumnWidths(1,cols.length,155); s.getRange(1,1,s.getMaxRows(),cols.length).setVerticalAlignment('top');
    });
    return open(id);
  }
  return {open:open,initialize:initialize,schemas:schemas,safe:safe};
})();
if(typeof module!=='undefined') module.exports=WpStore;
