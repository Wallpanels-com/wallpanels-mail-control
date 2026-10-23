/* Read-only diagnostic using the existing owner's clasp OAuth and existing DWD SA.
 * Does not read message bodies, change cloud settings or write credential files. */
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const {OAuth2Client}=require('google-auth-library');
async function main(){
  let captured;
  const props={getProperty:()=>null,setProperty:(k,v)=>{if(k==='WP_CONFIG_JSON')captured=JSON.parse(v);}};
  const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>props},WpApp:{setup:()=>({})},wpCommissionTest:()=>{},console:{log:()=>{}}});
  vm.runInContext(fs.readFileSync('.local/Bootstrap.js','utf8'),ctx);ctx.wpBootstrap();
  if(captured.projectId!=='wallpanels-gmail-control')throw Error('Wrong project');
  const stored=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.clasprc.json'),'utf8')).tokens.default;
  const auth=new OAuth2Client(stored.client_id,stored.client_secret);auth.setCredentials(stored);
  const report=[];
  for(const mailbox of new Set(captured.employees.concat(captured.testEmployee?[captured.testEmployee]:[]).map(e=>e.email))){
    try{
      const now=Math.floor(Date.now()/1000);
      const signed=await auth.request({url:'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+encodeURIComponent(captured.serviceAccount)+':signJwt',
        method:'POST',headers:{'x-goog-user-project':captured.projectId},data:{payload:JSON.stringify({iss:captured.serviceAccount,sub:mailbox,scope:'https://www.googleapis.com/auth/gmail.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}});
      const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed.data.signedJwt})});
      if(!tokenResponse.ok)throw Error('OAUTH_HTTP_'+tokenResponse.status);
      const token=await tokenResponse.json();
      const profile=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});
      if(!profile.ok)throw Error('GMAIL_HTTP_'+profile.status);
      const data=await profile.json();report.push({mailbox,ok:data.emailAddress===mailbox});
    }catch(e){report.push({mailbox,ok:false,code:e.response?.status||(/^[A-Z_0-9]+$/.test(e.message)?e.message:'REQUEST_FAILED'),
      reasons:(e.response?.data?.error?.details||[]).map(d=>d.reason).filter(Boolean)});}
  }
  // No tokens, assertion, message content or full Google error bodies are printed.
  console.log(JSON.stringify({method:'existing-SA IAM signJwt DWD, gmail.readonly',checked:report.length,passed:report.filter(r=>r.ok).length,
    failures:report.filter(r=>!r.ok).map((r,i)=>({mailboxIndex:i+1,code:r.code,reasons:r.reasons}))}));
  process.exitCode=report.every(r=>r.ok)?0:1;
}
main().catch(()=>{console.error('GMAIL_HEALTH_SETUP_FAILED');process.exitCode=1;});
