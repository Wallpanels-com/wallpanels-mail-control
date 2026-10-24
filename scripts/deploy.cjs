/* Only the existing project may be targeted. No project creation or public deployments. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const expected='1lCMdlxFrq5CkyJuuksXsRZyq3w8MvRBJStr7_1VMF1KfABTHNMxFYYC5';
const config=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
if(config.scriptId!==expected) throw Error('Refusing another Apps Script project');
const command=process.argv[2]||'prepare';
const stage='.local/stage';
if(command==='prepare') {
  fs.mkdirSync(stage,{recursive:true});
  // Never overwrite unknown files in an existing project: preserve all downloaded originals.
  for(const f of fs.readdirSync('.local/remote-original')) {
    if(f==='appsscript.json') continue;
    if(fs.existsSync(path.join('src',f))) {
      const moduleName=path.basename(f,'.js');
      const namespace=moduleName==='TestCampaign'?'Test':moduleName;
      const owned=['Api','App','Core','Store','TestCampaign','Messages','Audit','Rollout'].includes(moduleName) &&
        fs.readFileSync(path.join('.local/remote-original',f),'utf8').includes('var Wp'+namespace+' = (function () {');
      if(!owned) throw Error('Original source collision: '+f);
      continue; // A fresh clone may already contain our reviewed runtime modules.
    }
    fs.copyFileSync(path.join('.local/remote-original',f),path.join(stage,f));
  }
  for(const f of fs.readdirSync('src')) fs.copyFileSync(path.join('src',f),path.join(stage,f));
  if(process.argv.includes('--bootstrap')) fs.copyFileSync('.local/Bootstrap.js',stage+'/Bootstrap.js');
  else if(fs.existsSync(stage+'/Bootstrap.js')) fs.unlinkSync(stage+'/Bootstrap.js');
  if(process.argv.includes('--test-request')) fs.copyFileSync('.local/TestRequest.js',stage+'/TestRequest.js');
  else if(fs.existsSync(stage+'/TestRequest.js')) fs.unlinkSync(stage+'/TestRequest.js');
  if(process.argv.includes('--test-resume')) fs.copyFileSync('.local/TestResume.js',stage+'/TestResume.js');
  else if(fs.existsSync(stage+'/TestResume.js')) fs.unlinkSync(stage+'/TestResume.js');
  if(process.argv.includes('--acceptance')) fs.copyFileSync('.local/AcceptanceRequest.js',stage+'/AcceptanceRequest.js');
  else if(fs.existsSync(stage+'/AcceptanceRequest.js')) fs.unlinkSync(stage+'/AcceptanceRequest.js');
  if(process.argv.includes('--production')) fs.copyFileSync('.local/ProductionRequest.js',stage+'/ProductionRequest.js');
  else if(fs.existsSync(stage+'/ProductionRequest.js')) fs.unlinkSync(stage+'/ProductionRequest.js');
  fs.writeFileSync('.clasp.json',JSON.stringify({...config,rootDir:stage},null,2)+'\n');
  const hash=crypto.createHash('sha256');
  for(const f of fs.readdirSync('src').sort()) hash.update(f+'\n'+fs.readFileSync(path.join('src',f),'utf8'));
  fs.writeFileSync('.local/source-sha256',hash.digest('hex')+'\n');
  console.log('Prepared existing project; original files preserved. No upload performed.');
} else if(command==='push') {
  cp.execFileSync(process.execPath,['scripts/check.cjs'],{stdio:'inherit'});
  cp.execFileSync('npx',['clasp','push'],{stdio:'inherit'});
} else if(command==='verify') {
  const configBefore=fs.readFileSync('.clasp.json');
  const verify='.local/verify';fs.mkdirSync(verify,{recursive:true});
  fs.writeFileSync('.clasp.json',JSON.stringify({...config,rootDir:verify}));
  try {
    cp.execFileSync('npx',['clasp','pull'],{stdio:'inherit'});
    for(const f of fs.readdirSync('src')) {
      const a=fs.readFileSync(path.join('src',f),'utf8').trim(),b=fs.readFileSync(path.join(verify,f),'utf8').trim();
      if(f==='appsscript.json'?JSON.stringify(JSON.parse(a))!==JSON.stringify(JSON.parse(b)):a!==b) throw Error('Remote mismatch: '+f);
    }
    console.log('Verified: every tracked runtime source matches Apps Script HEAD.');
  } finally {fs.writeFileSync('.clasp.json',configBefore);}
} else throw Error('Use prepare [--bootstrap], push or verify');
