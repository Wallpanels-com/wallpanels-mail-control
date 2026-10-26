/* Read only this project's Cloud Logging; output operational counters, never mail or credentials. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {OAuth2Client}=require('google-auth-library');
async function main(){
  const cfg=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
  if(cfg.projectId!=='wallpanels-gmail-control')throw Error('PROJECT_SCOPE');
  const cred=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.clasprc.json'),'utf8')).tokens.default;
  const auth=new OAuth2Client(cred.client_id,cred.client_secret);auth.setCredentials(cred);
  const option=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
  const hours=Number(option('hours')||1),maximum=Number(option('max')||200);
  if(!Number.isFinite(hours)||hours<=0||hours>168||!Number.isInteger(maximum)||maximum<1||maximum>5000)throw Error('INVALID_LOG_WINDOW');
  const since=new Date(option('since')||Date.now()-hours*3600000).toISOString(),until=option('until');
  if(until && !Number.isFinite(Date.parse(until)))throw Error('INVALID_LOG_END');
  const filter='timestamp >= "'+since+'"'+(until?' AND timestamp <= "'+new Date(until).toISOString()+'"':'');
  const result=[];let pageToken;
  const allowed=['ok','mode','employees','mailboxes','gmailOk','gmailTotal','bot','ai','webhook','triggers','health',
    'monitoredMailboxes','syntheticStatus','deliveries','unsafeRecipients','monitorLastSuccess','updatesLastSuccess','errorCount','paused',
    'active','delivery','stage','synthetic','testAdmin','callbackAction','status','handled','view','test247','startedAt','dueAt','activated','stages','rejected','resumed','previousStatus','formatVersion','edited','editFailed','acceptanceAudit','productionActivated','phase','admins','productionStatus','aiPending','aiRecovery','maintenance'];
  do{
    const response=await auth.request({url:'https://logging.googleapis.com/v2/entries:list',method:'POST',data:{
      resourceNames:['projects/'+cfg.projectId],filter:filter,orderBy:'timestamp desc',pageSize:100,pageToken}});
    for(const entry of response.data.entries||[]){
      const message=entry.jsonPayload?.message||entry.textPayload||'';let value;
      if(message==='TEST_READY_ADMIN_ONLY')value={ready:true};
      else try{const data=JSON.parse(message);if(data && typeof data==='object' && !Array.isArray(data)){
        value={};for(const key of allowed)if(Object.hasOwn(data,key))value[key]=data[key];
        if(!Object.keys(value).length)value=null;
      }}catch{}
      if(!value && ['ERROR','CRITICAL','ALERT','EMERGENCY'].includes(entry.severity))value={runtimeFailure:true,
        code:/^[A-Z][A-Z0-9_:.-]{0,90}$/.test(message)?message:'RUNTIME_EXCEPTION'};
      if(value)result.push({at:entry.timestamp,...value});
    }
    pageToken=response.data.nextPageToken;
  }while(pageToken && result.length<maximum);
  result.sort((a,b)=>a.at.localeCompare(b.at));
  if(process.argv.includes('--save'))fs.writeFileSync('.local/runtime-evidence.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('RUNTIME_STATUS_FAILED',e.response?.status||'',
  e.response?.data?.error==='invalid_grant'?'GOOGLE_REAUTH_REQUIRED':'');process.exitCode=1;});
