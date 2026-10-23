/* Read only this project's Cloud Logging; output operational counters, never mail or credentials. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {OAuth2Client}=require('google-auth-library');
async function main(){
  const cfg=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
  if(cfg.projectId!=='wallpanels-gmail-control')throw Error('PROJECT_SCOPE');
  const cred=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.clasprc.json'),'utf8')).tokens.default;
  const auth=new OAuth2Client(cred.client_id,cred.client_secret);auth.setCredentials(cred);
  const since=new Date(Date.now()-60*60000).toISOString(),result=[];let pageToken;
  const allowed=['ok','mode','employees','mailboxes','gmailOk','gmailTotal','bot','ai','webhook','triggers','health',
    'monitoredMailboxes','syntheticStatus','deliveries','unsafeRecipients','monitorLastSuccess','updatesLastSuccess','errorCount',
    'active','delivery','stage','synthetic','testAdmin','callbackAction','status','handled','view','test247','startedAt','dueAt','activated','stages','rejected'];
  do{
    const response=await auth.request({url:'https://logging.googleapis.com/v2/entries:list',method:'POST',data:{
      resourceNames:['projects/'+cfg.projectId],filter:'timestamp >= "'+since+'"',orderBy:'timestamp desc',pageSize:100,pageToken}});
    for(const entry of response.data.entries||[]){
      const message=entry.jsonPayload?.message||entry.textPayload||'';let value;
      if(message==='TEST_READY_ADMIN_ONLY')value={ready:true};
      else try{const data=JSON.parse(message);if(data && typeof data==='object' && !Array.isArray(data)){
        value={};for(const key of allowed)if(Object.hasOwn(data,key))value[key]=data[key];
        if(!Object.keys(value).length)value=null;
      }}catch{}
      if(value)result.push({at:entry.timestamp,...value});
    }
    pageToken=response.data.nextPageToken;
  }while(pageToken && result.length<200);
  result.sort((a,b)=>a.at.localeCompare(b.at));
  if(process.argv.includes('--save'))fs.writeFileSync('.local/runtime-evidence.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('RUNTIME_STATUS_FAILED',e.response?.status||'');process.exitCode=1;});
