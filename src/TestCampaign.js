/* Temporary test schedule is independent of the production business calendar. */
var WpTest = (function () {
  function controls(state,row,mode) {
    return mode==='test' && !!state && state.active===true && row.kind==='live' && row.mailbox===state.mailbox &&
      (row.messageId===state.messageId || (Number(row.receivedAt)>=state.startedAt &&
        WpCore.addresses(row.sender).some(function(a){return state.client.indexOf(a)>=0;})));
  }
  function start(state,row) {return row.messageId===state.messageId?state.startedAt:Math.max(state.startedAt,Number(row.receivedAt));}
  function minutes(state,row,now) {return Math.max(0,(now-start(state,row))/60000);}
  function due(state,row,now,stages) {
    var elapsed=minutes(state,row,now);
    return [30,60,120].find(function(n){return elapsed>=n && stages.indexOf(n)<0;})||0;
  }
  function view(job) {var m=/:view-(employee|admin)(?::|$)/.exec(job.id);return m?m[1]:null;}
  return {controls:controls,start:start,minutes:minutes,due:due,view:view};
})();
if(typeof module!=='undefined') module.exports=WpTest;
